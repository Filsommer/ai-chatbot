import { supabase } from "./db";
import { ASSET_TYPE_MAP, isDangerousQuery, TickerMatch } from "./helpers";
import { dbQueryWithLog } from "./db";
import { ClassificationAgentSchema } from "./schema";
import { Langsheet, LangsheetTrace } from "./langsheet-client";

export async function generateComparisonDataSqlQueriesResponse(
  langsheetTrace: LangsheetTrace,
  allQueries: {
    sqlQuery: any;
    reasoning: any;
    stepName: string;
  }[],
  writer?: { write: (data: string) => void }
) {
  const langsheetSpan = langsheetTrace.startSpan("comparisonDataSqlQueries", {});
  console.log(allQueries);

  // Run all safe queries in parallel and combine results
  const comparisonData =
    (
      await Promise.all(
        allQueries.map(async (query) => {
          if (!query.sqlQuery) {
            if (writer) {
              writer.write(
                JSON.stringify({
                  type: "stateMessage",
                  subtype: "stepFinish",
                  stepName: query.stepName,
                  success: false,
                  text: "No query to execute",
                }) + "\n"
              );
            }
            return [];
          }

          // Only execute if it's a string and not dangerous
          if (typeof query.sqlQuery !== "string" || isDangerousQuery(query.sqlQuery)) {
            if (writer) {
              writer.write(
                JSON.stringify({
                  type: "stateMessage",
                  subtype: "stepFinish",
                  stepName: query.stepName,
                  success: false,
                  text: isDangerousQuery(query.sqlQuery)
                    ? "Query is not safe to execute"
                    : "No query to execute",
                }) + "\n"
              );
            }
            return [];
          }

          const results = await dbQueryWithLog(
            query.sqlQuery,
            [],
            langsheetSpan!,
            `sqlQuery: ${query.stepName}`
          ).catch((err) => {
            console.error("Database query failed:", err);
            if (writer) {
              writer.write(
                JSON.stringify({
                  type: "stateMessage",
                  subtype: "stepFinish",
                  stepName: query.stepName,
                  success: false,
                  text: String(err?.message || err),
                }) + "\n"
              );
            }
            return [
              {
                reasoning: query.reasoning,
                errorRunningQuery: String(err?.message || err),
              },
            ];
          });

          if (writer) {
            writer.write(
              JSON.stringify({
                type: "stateMessage",
                subtype: "stepFinish",
                stepName: query.stepName,
                success: results.length > 0 && typeof results[0] === "object",
                text:
                  results.length > 0
                    ? typeof results[0] === "object"
                      ? `Data retrieved - ${results.length} results`
                      : results[0]
                    : "No data found",
              }) + "\n"
            );
          }

          // Add reasoning as a separate object at the start of each query's results
          return [{ reasoning: query.reasoning }, ...results];
        })
      )
    ).flat() || [];

  langsheetSpan?.end({
    metadata: {
      comparisonData,
    },
  });

  return comparisonData;
}

export async function generateTickersExtractionQueriesResponse(
  classification: ClassificationAgentSchema,
  wantsLogs: boolean
): Promise<TickerMatch[]> {
  if (
    classification.possibleAssetNamesOrTickers.length == 0 &&
    classification.previousRelevantTickers.length == 0 &&
    !classification.userWantsToTradeAnAsset
  ) {
    return [];
  }

  // const langsheetSpan = langsheetTrace.startSpan("generateTickersExtractionQueries");

  const query = supabase
    .from("instruments_view")
    .select("instrumentId, name, tickerEtoro, assetClassId");
  const relevantAssetTypes = [];
  if (
    classification.isAboutStockFundamentals ||
    classification.isAboutNews ||
    classification.isAboutEarningsDates ||
    classification.isAboutDividendDates
  ) {
    relevantAssetTypes.push(5);
  }
  if (classification.isAboutETFs || classification.isAboutDividendDates) {
    relevantAssetTypes.push(6);
  }
  if (classification.isAboutCurrenciesOrCommoditiesOrIndices) {
    relevantAssetTypes.push(1, 2, 4);
  }
  if (classification.isAboutCrypto || classification.isAboutNews) {
    relevantAssetTypes.push(10);
  }
  if (
    classification.userWantsToTradeAnAsset ||
    classification.isAboutAssetPricesOrPerformance ||
    classification.isAboutInvestors
  ) {
    relevantAssetTypes.push(1, 2, 4, 5, 6, 10);
  }

  query.in("assetClassId", relevantAssetTypes);
  let orString = "";
  classification.possibleAssetNamesOrTickers
    .concat(classification.previousRelevantTickers)
    .forEach((term) => {
      // try to match by ticker or name, e.g. 'ADA' is most likely Cardano, but also try to match by name for 'Mercedes'
      orString += `or(name.phfts(english).${term},tickerEtoro.phfts(english).${term}),`;
    });
  if (orString.length > 0) {
    query.or(orString.slice(0, -1));
  }
  if (wantsLogs) {
    console.log({ orString }, "phfts");
  }

  const { data: matchedInstruments, error } = await query.limit(50);
  if (wantsLogs) {
    console.log("possibleInstruments", relevantAssetTypes, error);
  }

  if (!matchedInstruments) {
    // langsheetSpan?.end({
    //   metadata: {
    //     tickersExtraction: [],
    //   },
    // });
    return [];
  }

  const tickersExtraction = matchedInstruments.map((instrument) => ({
    ticker: instrument.tickerEtoro,
    name: instrument.name,
    instrumentId: instrument.instrumentId,
    assetType: ASSET_TYPE_MAP[instrument.assetClassId as keyof typeof ASSET_TYPE_MAP] as
      | "stock"
      | "etf"
      | "currency"
      | "commodity"
      | "index"
      | "crypto",
  }));

  // langsheetSpan?.end({
  //   metadata: {
  //     tickersExtraction,
  //   },
  // });
  return tickersExtraction;
}
