import { z } from "zod";

// 1st Agent Schema (Classification)
export const classificationAgentSchema = z.object({
  reasoning: z.string(),
  reasoningInSimpleLanguageAddressedAtUser: z
    .string()
    .describe(
      "Reasoning but explained to the user, with very simple language and not mentioned property names."
    ),
  isAboutUserPortfolio: z.boolean(),
  isAboutStockFundamentals: z.boolean(),
  isStockIndustryRelevant: z.boolean(),
  isAboutETFs: z.boolean(),
  isAboutCurrenciesOrCommoditiesOrIndices: z.boolean(),
  isAboutCrypto: z.boolean(),
  isAboutNews: z.boolean(),
  isAboutEarningsDates: z.boolean(),
  isAboutDividendDates: z.boolean(),
  isAboutInvestors: z.boolean(),
  isAboutSmartPortfolios: z.boolean(),
  isAboutAssetPricesOrPerformance: z
    .boolean()
    .describe("Is about an asset's price or historical price performance"),
  userWantsToTradeAnAsset: z.boolean(),
  possibleAssetNamesOrTickers: z.string().array(),
  isAboutEarningsCallsSummariesOrRevenueSegmentation: z.boolean(),
  isAboutCorporateGuidanceOrStrategicOutlook: z.boolean(),
  isAboutImportantCEOs: z.boolean(),
  previousRelevantTickers: z.string().array(),
});

export type ClassificationAgentSchema = z.infer<typeof classificationAgentSchema>;
