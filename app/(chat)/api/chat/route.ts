import {
  convertToModelMessages,
  createUIMessageStream,
  generateObject,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";
import { getSession, type UserType } from "@/lib/auth/server";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { createDocument } from "@/lib/ai/tools/create-document";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { getFinancialInsights } from "@/lib/ai/tools/get-financial-insights";
import { isProductionEnvironment } from "@/lib/constants";
import { myProvider } from "@/lib/ai/providers";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { postRequestBodySchema, type PostRequestBody } from "./schema";
import { geolocation } from "@vercel/functions";
import { createResumableStreamContext, type ResumableStreamContext } from "resumable-stream";
import { after } from "next/server";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import type { ChatModel } from "@/lib/ai/models";
import type { VisibilityType } from "@/components/visibility-selector";
import { google } from "@ai-sdk/google";
import { classificationAgentSchema } from "../finance/schema";
import { getUserPortfolio, isDangerousQuery, PortfolioPosition } from "../finance/helpers";
import {
  generateComparisonDataSqlQueriesResponse,
  generateTickersExtractionQueriesResponse,
} from "../finance/sql-request";
import {
  generateGoogleSearchAgentResponse,
  generatePortfolioAnalysisResponse,
  generateSQLAgentResponse,
  generateStreamFinalAgentResponse,
  getAdditionalDataResponse,
} from "../finance/agent-request";
import { langsheet } from "../finance/langsheet-client";

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

function getMessageText(message: ChatMessage): string {
  const firstPart = message.parts[0];
  return firstPart && firstPart.type === "text" ? firstPart.text : "";
}

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes("REDIS_URL")) {
        console.log(" > Resumable streams are disabled due to missing REDIS_URL");
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  console.log("🎯 POST request received at", new Date().toISOString());

  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
    console.log("✅ Request body parsed successfully");
    const messageText = getMessageText(requestBody.message);
    console.log("📝 Message preview:", messageText.substring(0, 100) || "No text found");
  } catch (error) {
    console.error("❌ Failed to parse request body:", error);
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const wantsLogs = true;

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel["id"];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await getSession();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    // For guest users, skip rate limiting based on database records
    if (session.user.type === "regular") {
      const messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
        return new ChatSDKError("rate_limit:chat").toResponse();
      }
    }

    // For guest users, skip database chat lookup
    if (session.user.type === "regular") {
      const chat = await getChatById({ id });

      if (!chat) {
        const title = await generateTitleFromUserMessage({
          message,
        });

        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      } else {
        if (chat.userId !== session.user.id) {
          return new ChatSDKError("forbidden:chat").toResponse();
        }
      }
    } else {
      // For guest users, just generate a title without saving
      await generateTitleFromUserMessage({
        message,
      });
    }

    // For guest users, start with empty message history
    const messagesFromDb = session.user.type === "regular" ? await getMessagesByChatId({ id }) : [];
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // Only save messages for regular users
    if (session.user.type === "regular") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const streamId = generateUUID();
    // Only create stream ID in database for regular users
    if (session.user.type === "regular") {
      await createStreamId({ streamId, chatId: id });
    }

    const langsheetTrace = await langsheet.newTrace({
      name: "chat-app-session",
      metadata: { user: "FilipeSommer" },
      tags: ["dev"], //TODO how to know each environment?
      input: getMessageText(message),
    });

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        console.log("📝 Stream execute function called");

        try {
          // Step 1: Classification
          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "classification",
              message: "🏷️ Analyzing your question...",
            }),
          });

          const { object: classificationObject } = await generateObject({
            model: google("gemini-2.5-flash"),
            schema: classificationAgentSchema,
            providerOptions: {
              google: {
                thinkingConfig: {
                  thinkingBudget: 0,
                },
              },
            },
            system: `You are a helpful financial assistant for eToro that classifies user queries into one or more of the following categories:
              - isAboutUserPortfolio
              - isAboutStockFundamentals
              - isStockIndustryRelevant
              - isAboutETFs
              - isAboutCurrenciesOrCommoditiesOrIndices
              - isAboutCrypto
              - userWantsToTradeAnAsset
              - isAboutNews
              - isAboutEarningsDates
              - isAboutDividendDates
              - isAboutInvestors
              - isAboutSmartPortfolios
              - isAboutAssetPricesOrPerformance
              - possibleAssetNamesOrTickers
              - isAboutEarningsCallsSummariesOrRevenueSegmentation
              - isAboutCorporateGuidanceOrStrategicOutlook
              - isAboutImportantCEOs
              - previousRelevantTickers
            `,
            prompt: `Classify this user query for:
                      0. previousRelevantTickers - If the user is asking something related to a ticker that was mentioned in the previous messages, add it to the previousRelevantTickers array.
                      1. isAboutUserPortfolio - If the user is asking about their own portfolio, or "my" portfolio/allocation/risk/assets/news, set isAboutUserPortfolio to true. Please ALWAYS check if this history includes a message where the user mentions their OWN portfolio, AND if the current prompt is clearly related to the user's portfolio. History: ${JSON.stringify(
                        uiMessages.slice(-4)
                      )}. - Example: "What are the assets in my portfolio?", or "Which investors would diversify my allocation?"
                      2. isAboutCurrenciesOrCommoditiesOrIndices - Example: "What are the best performing commodities?". Not relevant if question is specifically about an ETF.
                      3. isAboutCrypto - Example: "What are the best performing cryptocurrencies?" or "Can I trade Ethereum in eToro?"
                      4. isAboutStockFundamentals - 
                          Examples: - "What is AMD and NVDA P/E ratios?"
                                    - "Top 10 German stocks in Healthcare?" which implies a comparison of market caps of stocks.
                                    - "Which US defense stocks can I buy?" which implies looking for stocks from a specific industry or country.
                                    - "Most popular stocks" which implies looking for the most popular stocks in the etoro
                                    - "Highly rated stocks by analysts" which implies looking for stocks with high analyst ratings
                      5. isStockIndustryRelevant - Example: "Compare AMD to its competitors" or "Best stocks in John Deere's industry?" would return true.
                      4. isAboutETFs - Example: "What are the best performing ETFs?"
                      5. userWantsToTradeAnAsset - Example: "Which tech stocks can I trade?" Here you can use your common sense to find multiple popular tickers like TSLA, NVDA, AAPL, etc. 
                      6. possibleAssetNamesOrTickers - Example: "What are the main competitors of Mercedes?" - You need to use your knowledge of the market to add two possible asset names 'Mercedes' and 'Benz' and 'MBG.DE' to the array. Try to be smart about typos. E.g. Palentir is most likely the asset name "Palantir". And e.g. Google should be 'Google' and 'GOOG' and 'Alphabet' and 'GOOGL'. And e.g. Amazon should be 'Amazon' and 'AMZN'.
                      7. isAboutNews - Example: "What are the latest news on TSLA?" or "What are the latest news about real estate?" or "Why is ETOR moving?" or "Why has OIL gone up?"
                      8. isAboutEarningsDates - Example: "What are the next earnings dates for TSLA?" or "What are the latest earnings reports for AAPL?" or "What was Google's revenue over the last 4 quarters?" Give this precedence over isAboutNews.
                      9. isAboutDividendDates - Example: "What are the next dividends for TSLA?" or "How much dividend did mercedes pay last time?" Give this precedence over isAboutNews.
                      10. isAboutInvestors - If the user is asking about investors and/or provides a username, it's most likely about popular investors - Example: "How can I copy JeppeKirkBonde's portfolio?" or "Show me some investors to copy" or "What are the top 10 PIs?" 
                      11. isAboutSmartPortfolios - If the user is asking about SmartPortfolios specifically - Example: "What are the most popular SmartPortfolios?"
                      12. isAboutAssetPricesOrPerformance - Exclusive to assets, irrelevant for investors. Example: "How is Tesla performing today?" or "What are the top performing finance stocks this year?". Only relevant for questions specifically about price or price performance, and not about reasons for why the price is moving or moved in the past.
                      13. isAboutEarningsCallsSummariesOrRevenueSegmentation - Example: "What was Apple's iPhone revenue over the last two years?"
                      14. isAboutCorporateGuidanceOrStrategicOutlook - Example: "What's Meta's latest financial guidance?" or "Why has Snowflake Inc. Net Revenue Retention Rate been decreasing?" or "Write me a slide deck outline for ASML."
                      15. isAboutImportantCEOs - Example: "Who are the most important CEOs?" or "What did Elon Musk say about the future of Tesla?" or "Who is Yoni Assia, eToro's CEO?"
                      
                      Keep in mind that eToro is a social trading platform (e.g. "Biggest traders on eToro"), but also a publicly traded company with the ticker 'ETOR', which by itself has financial data (e.g. "What is the price and market cap of eToro?" and if user specifies the ETOR ticker).
                      
                      Query: ${getMessageText(message)}
                      `,
          });

          const {
            isAboutEarningsCallsSummariesOrRevenueSegmentation,
            isAboutImportantCEOs,
            isAboutUserPortfolio,
            userWantsToTradeAnAsset,
            isAboutCorporateGuidanceOrStrategicOutlook,
            isAboutCrypto,
            isAboutCurrenciesOrCommoditiesOrIndices,
            isAboutInvestors,
            isAboutSmartPortfolios,
            isAboutAssetPricesOrPerformance,
            isAboutNews,
            isAboutEarningsDates,
          } = classificationObject;

          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "classification-complete",
              message: "✅ Question analysis complete",
            }),
          });

          // Step 2: Portfolio data if needed
          let portfolioData: PortfolioPosition[] = [];
          if (isAboutUserPortfolio) {
            portfolioData = await getUserPortfolio("FilipeSommer");
          }

          // Step 3: Ticker extraction
          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "ticker-extraction",
              message: "🔍 Extracting relevant tickers...",
            }),
          });

          const mainTickerMatches = await generateTickersExtractionQueriesResponse(
            classificationObject,
            true
          );

          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "ticker-extraction-complete",
              message: "✅ Ticker extraction complete",
            }),
          });

          // Step 4: Data fetching
          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "data-fetching",
              message: "📊 Fetching financial data...",
            }),
          });

          const [portfolioAnalysis, queryResults, googleSearchResult, additionalData] =
            await Promise.all([
              // Only run portfolio analysis if it's about user portfolio
              isAboutUserPortfolio
                ? generatePortfolioAnalysisResponse(
                    langsheetTrace!,
                    classificationObject,
                    getMessageText(message),
                    uiMessages.slice(-4) as any,
                    portfolioData,
                    undefined
                  )
                : Promise.resolve(null),

              // SQL agent response
              generateSQLAgentResponse(
                langsheetTrace!,
                classificationObject,
                getMessageText(message),
                mainTickerMatches,
                [],
                uiMessages.slice(-4) as any,
                portfolioData,
                undefined
              ),

              // Google Search agent response (conditional)
              isAboutEarningsCallsSummariesOrRevenueSegmentation ||
              isAboutImportantCEOs ||
              isAboutNews ||
              isAboutEarningsDates ||
              isAboutCorporateGuidanceOrStrategicOutlook ||
              ((isAboutCrypto || isAboutCurrenciesOrCommoditiesOrIndices) &&
                !isAboutUserPortfolio &&
                !isAboutInvestors)
                ? generateGoogleSearchAgentResponse(
                    langsheetTrace!,
                    getMessageText(message),
                    wantsLogs,
                    uiMessages.slice(-4) as any,
                    portfolioData,
                    undefined
                  )
                : Promise.resolve(null),

              isAboutAssetPricesOrPerformance
                ? await getAdditionalDataResponse(
                    langsheetTrace!,
                    getMessageText(message),
                    wantsLogs,
                    uiMessages.slice(-4) as any,
                    portfolioData,
                    mainTickerMatches,
                    undefined
                  )
                : Promise.resolve(null),
            ]);

          // Extract all SQL queries from the results and remove the dangerous ones
          const allQueries = queryResults
            .filter((result) => result !== false)
            .map((result: any) => ({
              sqlQuery: result.object.sqlQuery,
              reasoning: result.object.reasoning,
              stepName: result.object.stepName,
            }));

          // 2nd agent (SQL agent): Run all safe queries in parallel and combine results
          let comparisonData = await generateComparisonDataSqlQueriesResponse(
            langsheetTrace!,
            allQueries,
            undefined
          );

          if (!comparisonData || comparisonData.length === 0) {
            comparisonData = [...comparisonData, ...mainTickerMatches];
          }

          if (googleSearchResult) {
            dataStream.write({
              type: "data-status",
              data: JSON.stringify({
                step: "google-search-complete",
                message: "✅ Latest news gathered",
              }),
            });
          }

          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "data-fetching-complete",
              message: "✅ Financial data retrieved",
            }),
          });

          // Step 5: Generate response
          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "generating-response",
              message: "🤖 Generating your response...",
            }),
          });

          // Get the finance agent's streamObject result
          console.log("🤖 Calling generateStreamFinalAgentResponse with:", {
            prompt: getMessageText(message),
            hasGoogleSearchResult: !!googleSearchResult,
            comparisonDataLength: comparisonData?.length || 0,
            portfolioDataLength: portfolioData?.length || 0,
            hasAdditionalData: !!additionalData,
          });

          const { partialObjectStream } = await generateStreamFinalAgentResponse(
            langsheetTrace!,
            true,
            getMessageText(message),
            true,
            googleSearchResult,
            comparisonData,
            portfolioData,
            portfolioAnalysis?.object.content,
            uiMessages.slice(-4) as any,
            userWantsToTradeAnAsset,
            additionalData
          );

          console.log("🔄 Starting to consume partialObjectStream...");

          let messageId = generateUUID();
          let finalAnswer = "";
          let lastStructuredData: any = null;

          // Use the partialObjectStream from the finance agent
          for await (const partialObject of partialObjectStream) {
            console.log("📦 Partial object:", JSON.stringify(partialObject, null, 2));

            // Accumulate the final answer text
            if (partialObject.answer) {
              finalAnswer = partialObject.answer;
              console.log("📝 Current answer length:", finalAnswer.length);
            }

            // Stream structured data when it's complete
            if (partialObject.chartData && partialObject.chartData.length > 0) {
              console.log("📊 Streaming chart data:", partialObject.chartData);
              dataStream.write({
                type: "data-chartData",
                data: JSON.stringify(partialObject.chartData),
              });
            }

            if (partialObject.tickersToDisplay && partialObject.tickersToDisplay.length > 0) {
              console.log("📈 Streaming tickers:", partialObject.tickersToDisplay);
              dataStream.write({
                type: "data-tickers",
                data: JSON.stringify(partialObject.tickersToDisplay),
              });
            }

            if (partialObject.followUpQuestions && partialObject.followUpQuestions.length > 0) {
              console.log("❓ Streaming follow-up questions:", partialObject.followUpQuestions);
              dataStream.write({
                type: "data-followUpQuestions",
                data: JSON.stringify(partialObject.followUpQuestions),
              });
            }

            lastStructuredData = partialObject;
          }

          // Now write the complete text using proper streaming pattern
          if (finalAnswer) {
            console.log("📝 Writing final answer:", finalAnswer.substring(0, 200) + "...");

            // Start text stream
            dataStream.write({
              type: "text-start",
              id: messageId,
            });

            // Write text content as delta
            dataStream.write({
              type: "text-delta",
              delta: finalAnswer,
              id: messageId,
            });

            // End text stream
            dataStream.write({
              type: "text-end",
              id: messageId,
            });
          }

          // Send completion status
          dataStream.write({
            type: "data-status",
            data: JSON.stringify({
              step: "complete",
              message: "✅ Response generated successfully!",
            }),
          });

          console.log("✅ PartialObjectStream complete");
          console.log("📊 Final structured data:", JSON.stringify(lastStructuredData, null, 2));
        } catch (error) {
          console.error("❌ Error processing partialObjectStream:", error);
          dataStream.write({
            type: "error",
            errorText: "Failed to process response stream",
          });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        // Only save messages for regular users
        if (session.user.type === "regular") {
          await saveMessages({
            messages: messages.map((message) => ({
              id: message.id,
              role: message.role,
              parts: message.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });

    const streamContext = getStreamContext();
    console.log("🌊 Stream context:", streamContext ? "Available" : "Not available");
    console.log("🆔 Stream ID:", streamId);

    // Create a transform stream to log what's being sent
    const loggingTransform = new TransformStream({
      transform(chunk, controller) {
        // Handle both string and buffer types
        let chunkString: string;
        if (typeof chunk === "string") {
          chunkString = chunk;
        } else if (chunk instanceof Uint8Array) {
          chunkString = new TextDecoder().decode(chunk);
        } else {
          chunkString = String(chunk);
        }
        console.log(
          // "📡 Sending chunk to UI:",
          chunkString.substring(0, 200) + (chunkString.length > 200 ? "..." : "")
        );
        controller.enqueue(chunk);
      },
    });

    if (streamContext) {
      console.log("🔄 Using resumable stream");
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()).pipeThrough(loggingTransform)
        ),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } else {
      console.log("📤 Using direct stream");
      return new Response(
        stream.pipeThrough(new JsonToSseTransformStream()).pipeThrough(loggingTransform),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    }
  } catch (error) {
    console.error("❌ Unexpected error in POST /api/chat:", error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new ChatSDKError("bad_request:api").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await getSession();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  // For guest users, allow deletion without database checks
  if (session.user.type === "regular") {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    await deleteChatById({ id });
  }

  return Response.json({ success: true }, { status: 200 });
}
