import {
  generateClassificationAgentResponse,
  generateGoogleSearchAgentResponse,
  generatePortfolioAnalysisResponse,
  generateSQLAgentResponse,
  generateStreamFinalAgentResponse,
  getAdditionalDataResponse,
} from "./agent-request";

import { ChatHistory, getUserPortfolio, isDangerousQuery, PortfolioPosition } from "./helpers";
import "server-only";
import { headers } from "next/headers";
import {
  generateComparisonDataSqlQueriesResponse,
  generateTickersExtractionQueriesResponse,
} from "./sql-request";
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";
import { classificationAgentSchema } from "./schema";
import { Langsheet, LangsheetTrace } from "./langsheet-client";
import { waitUntil } from "@vercel/functions";

const langsheet = new Langsheet();

const currentEnvironment = process.env.NODE_ENV;

class ValidateRequestResult {
  response: Response;
  isValid: boolean;
  userIdForTrace?: string;

  constructor(response: Response, userIdForTrace?: string) {
    this.response = response;
    this.isValid = response.status == 200;
    this.userIdForTrace = userIdForTrace;
  }
}

async function executeTasksLangfuse(
  writer: WritableStreamDefaultWriter<String>,
  prompt: string,
  user_name: string | undefined,
  userIdForTrace: string | undefined,
  executeTasks: (langsheetTrace: LangsheetTrace) => Promise<void>
) {
  const langsheetTrace = await langsheet.newTrace({
    name: "chat-app-session",
    metadata: { user: user_name || "undefined" },
    tags: [currentEnvironment], //TODO how to know each environment?
    input: prompt,
  });

  const startTimer = performance.now();
  await executeTasks(langsheetTrace!);
  writer.close();
  console.log(`Time taken: ${performance.now() - startTimer} milliseconds`);
}

async function validateRequest(request: Request): Promise<ValidateRequestResult> {
  const ratelimit = new Ratelimit({
    redis: kv,
    // X requests from the same IP in Y seconds
    limiter: Ratelimit.slidingWindow(3000, "60 s"),
  });
  const ip = (await headers()).get("x-forwarded-for") || "127.0.0.1";
  const { success } = await ratelimit.limit(ip); //, pending, limit, reset, remaining } =
  if (!success) {
    console.log("ABUSE!", ip);
    return new ValidateRequestResult(
      new Response("Too many requests. Please wait a moment and try again.", {
        status: 429,
      })
    );
  }

  // read header bearer token
  const token = request.headers.get("Authorization")?.split(" ")[1];
  if (!token) {
    return new ValidateRequestResult(new Response("No auth bearer provided", { status: 401 }));
  }
  // const validTokens = new Set<string>([process.env.VALID_TOKEN_1!, process.env.VALID_TOKEN_2!, process.env.VALID_TOKEN_3!, process.env.VALID_TOKEN_4!])
  // if (!validTokens.has(token)) {
  let userIdForTrace: string | undefined = undefined;

  if (
    token !== process.env.VALID_TOKEN_1 &&
    token !== process.env.VALID_TOKEN_2 &&
    token !== process.env.VALID_TOKEN_3 &&
    token !== process.env.VALID_TOKEN_4
  ) {
    return new ValidateRequestResult(new Response("Invalid auth bearer", { status: 401 }));
  }
  if (token === process.env.VALID_TOKEN_3) {
    userIdForTrace = "eToro Token";
  } else {
    userIdForTrace = "Internal Token";
  }

  return new ValidateRequestResult(new Response("", { status: 200 }), userIdForTrace);
}

export async function POST(request: Request) {
  // Validate most request params
  const validationResult = await validateRequest(request);
  if (!validationResult.isValid) {
    return validationResult.response;
  }
  const jsonParams = await request.json();
  const { history, prompt, user_name } = jsonParams;
  if (!history || !prompt) {
    return new Response("No prompt provided", { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  executeTasksLangfuse(
    writer,
    prompt,
    user_name,
    validationResult?.userIdForTrace,
    (langsheetTrace) => {
      return agentTaskPipeline(writer, langsheetTrace, jsonParams);
    }
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function agentTaskPipeline(
  writer: WritableStreamDefaultWriter<String>,
  langsheetTrace: LangsheetTrace,
  jsonParams: any
) {
  const wantsLogs = true;

  const { history, prompt, generateChatTitle, generateFollowUpQuestions, user_name } = jsonParams;

  // History format that LLMs can consume
  const cleanedHistory = history.map((chat: ChatHistory) => ({
    role: chat.role,
    content: chat.content,
  }));

  if (wantsLogs) {
  }

  writer.write(
    JSON.stringify({
      type: "stateMessage",
      subtype: "classificationStateMessage",
      text: "Identifying what data I need...",
    }) + "\n"
  );

  // 1st agent: Classify the query type
  let startTimer = performance.now();
  const classification = await generateClassificationAgentResponse(
    langsheetTrace,
    cleanedHistory.slice(-4),
    prompt
  );
  console.log(`generateClassificationAgentResponse took ${performance.now() - startTimer}ms`);

  // Check if all boolean classification properties are false, and add tag to langfuse if so
  let booleanClassificationKeys = Object.entries(classificationAgentSchema.shape)
    .filter(([_, value]) => value._def.typeName === "ZodBoolean")
    .map(([key]) => key);
  // Exclude 'userWantsToTradeAnAsset' from the check
  booleanClassificationKeys = booleanClassificationKeys.filter(
    (key) => key !== "userWantsToTradeAnAsset"
  );
  const allFalse = booleanClassificationKeys.every(
    (key) => !classification[key as keyof typeof classification]
  );
  if (allFalse) {
    //langsheetTrace.update({ tags: [currentEnvironment, "unclassified"] });
  }

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
  } = classification;

  writer.write(
    JSON.stringify({
      type: "stateMessage",
      subtype: "classificationReasoningStateMessage",
      text: classification.reasoningInSimpleLanguageAddressedAtUser,
    }) + "\n"
  );
  if (wantsLogs) {
    console.log("classification", classification);
  }

  // Mid step: If it's about the user's portfolio, we need to fetch it first
  let portfolioData: PortfolioPosition[] = [];
  let portfolioAnalysisContent: string = "";
  if (isAboutUserPortfolio) {
    writer.write(
      JSON.stringify({
        type: "stateMessage",
        subtype: "stepStart",
        stepName: "Portfolio Data",
        text: "Getting your portfolio data",
      }) + "\n"
    );

    startTimer = performance.now(); // Reset timer for portfolio fetch
    const span = langsheetTrace.startSpan("getUserPortfolio");
    portfolioData = await getUserPortfolio(user_name);
    span?.end();
    // Logging total time for getUserPortfolio (API + DB queries + processing)
    console.log(`getUserPortfolio (total) took ${performance.now() - startTimer}ms`);
    writer.write(
      JSON.stringify({
        type: "stateMessage",
        subtype: "stepFinish",
        stepName: "Portfolio Data",
        success:
          portfolioData.length > 0 && typeof portfolioData[0] === "object" ? "true" : "false",
        text: "Finished getting your portfolio data",
      }) + "\n"
    );
  }

  // 2nd agent (SQL agent): Extract relevant tickers
  startTimer = performance.now();
  const mainTickerMatches = await generateTickersExtractionQueriesResponse(
    classification,
    wantsLogs
  );
  console.log(`generateTickersExtractionQueriesResponse took ${performance.now() - startTimer}ms`);
  if (wantsLogs) {
    console.log("tickersExtraction", mainTickerMatches);
  }

  writer.write(
    JSON.stringify({
      type: "stateMessage",
      subtype: "sqlStepStateMessage",
      text: "Fetching all relevant data for your question...",
    }) + "\n"
  );

  // Run portfolio analysis, SQL queries, and Google search in parallel
  startTimer = performance.now();
  const [portfolioAnalysis, queryResults, googleSearchResult, additionalData] = await Promise.all([
    // Only run portfolio analysis if it's about user portfolio
    isAboutUserPortfolio
      ? generatePortfolioAnalysisResponse(
          langsheetTrace,
          classification,
          prompt,
          cleanedHistory,
          portfolioData,
          writer
        )
      : Promise.resolve(null),

    // SQL agent response
    generateSQLAgentResponse(
      langsheetTrace,
      classification,
      prompt,
      mainTickerMatches,
      [],
      cleanedHistory,
      portfolioData,
      writer
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
          langsheetTrace,
          prompt,
          wantsLogs,
          cleanedHistory,
          portfolioData,
          writer
        )
      : Promise.resolve(null),

    isAboutAssetPricesOrPerformance
      ? await getAdditionalDataResponse(
          langsheetTrace,
          prompt,
          wantsLogs,
          cleanedHistory,
          portfolioData,
          mainTickerMatches,
          writer
        )
      : Promise.resolve(null),
  ]);
  console.log(`Parallel agents (portfolio, SQL, Google) took ${performance.now() - startTimer}ms`);

  if (portfolioAnalysis) {
    portfolioAnalysisContent = portfolioAnalysis.object.content;
  }

  // Extract all SQL queries from the results and remove the dangerous ones
  const allQueries = queryResults
    .filter((result) => result !== false)
    .map((result: any) => ({
      sqlQuery: result.object.sqlQuery,
      reasoning: result.object.reasoning,
      stepName: result.object.stepName,
    }));
  if (wantsLogs) {
    console.log(
      "classifications:",
      allQueries.map((r) => r.reasoning + " --- " + r.sqlQuery),
      "isDangerousQueries:",
      allQueries.some((r) => r.sqlQuery !== null && isDangerousQuery(r.sqlQuery))
    );
  }

  // 2nd agent (SQL agent): Run all safe queries in parallel and combine results
  startTimer = performance.now();
  let comparisonData = await generateComparisonDataSqlQueriesResponse(
    langsheetTrace,
    allQueries,
    writer
  );
  console.log(`generateComparisonDataSqlQueriesResponse took ${performance.now() - startTimer}ms`);
  if (!comparisonData || comparisonData.length === 0) {
    comparisonData = [...comparisonData, ...mainTickerMatches];
  }

  if (wantsLogs) {
    console.log("------- dbQueryResult", comparisonData);
    console.log("------- portfolioData", portfolioData);
    console.log("------- prompt", prompt, generateChatTitle, generateFollowUpQuestions);
    // {portfolioAnalysis && console.log('----- portfolioAnalysis', portfolioAnalysis.object.content)}
    {
      googleSearchResult && console.log("------- googleSearchResult", googleSearchResult);
    }
  }

  if (additionalData) {
    console.log("Additional data - ", additionalData);
  }

  writer.write(
    JSON.stringify({
      type: "stateMessage",
      subtype: "lastStateMessage",
      text: "Stitching together a response...",
    }) + "\n"
  );
  // 4th and final Agent + Stream
  startTimer = performance.now();
  const { textStream, finishPromise } = await generateStreamFinalAgentResponse(
    langsheetTrace,
    generateFollowUpQuestions,
    prompt,
    generateChatTitle,
    googleSearchResult,
    comparisonData,
    portfolioData,
    portfolioAnalysisContent,
    cleanedHistory,
    userWantsToTradeAnAsset,
    additionalData
  );
  console.log(
    `generateStreamFinalAgentResponse (initiation) took ${performance.now() - startTimer}ms`
  ); // Note: Total stream duration is logged separately

  //TODO should we create short circuit logic?
  const reader = textStream.getReader();
  startTimer = performance.now(); // Timer for stream reading
  while (true) {
    let { done, value } = await reader.read();
    if (done) {
      break;
    }

    writer.write(value);
  }
  if (finishPromise) await finishPromise;
  console.log(`Stream reading loop took ${performance.now() - startTimer}ms`);
}
