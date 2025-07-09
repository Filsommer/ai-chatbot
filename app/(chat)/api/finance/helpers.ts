import { supabase } from "./db";
import "server-only";

export type TickerMatch = {
  ticker: string;
  name: string;
  assetType: "stock" | "etf" | "currency" | "commodity" | "index" | "crypto";
};

export type PortfolioPosition = {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  country: string;
  portfolioWeight: number;
};

export type ChatHistory = {
  role: "user" | "assistant";
  content: string;
};

export const ASSET_TYPE_MAP = {
  "1": "currency",
  "2": "commodity",
  "4": "index",
  "5": "stock",
  "6": "etf",
  "10": "crypto",
};

function filterTickerMatches(
  matches: TickerMatch[],
  assetType: "stock" | "etf" | "currency" | "commodity" | "index" | "crypto"
) {
  return matches.filter((match) => match.assetType === assetType);
}

export async function getUserPortfolio(
  username: string,
  minPortfolioWeight: number = 0.3,
  maxPositions: number = 50
) {
  if (!username) return [];
  const fetchStart = Date.now();
  const response = await fetch(`https://api.etoro.com/API/User/V1/${username}/PortfolioSummary`, {
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.ETORO_API_KEY!,
    },
  });
  const data = await response.json();
  console.log(`eToro API fetch took ${Date.now() - fetchStart}ms`);

  if (!data.positions) {
    console.log("fetching portfolio failed or portfolio is empty");
    return ["No portfolio data to analyze since portfolio is private or empty"];
  }
  const startTime = Date.now();
  const [
    { data: portfolioDataFundamentals, error: portfolioErrorFundamentals },
    { data: portfolioDataInstruments, error: portfolioErrorInstruments },
    { data: portfolioDataPopularInvestors, error: portfolioErrorPopularInvestors },
    { data: portfolioDataETFs, error: portfolioErrorETFs },
  ] = await Promise.all([
    (async () => {
      const queryStart = Date.now();
      const result = await supabase
        .from("fundamentals_view")
        .select(
          "instrumentId, ticker, name, sector, industry, countryCode, marketCapUSD, peRatio, forwardAnnualDividendYield, popularityRankingLast7d"
        )
        .in(
          "instrumentId",
          data.positions.map((position: any) => position.instrumentId)
        );
      console.log(`fundamentals_view query took ${Date.now() - queryStart}ms`);
      return result;
    })(),

    (async () => {
      const queryStart = Date.now();
      const result = await supabase
        .from("instruments")
        .select("instrumentId, tickerEtoro, assetClassId, name, popularityUniques7Day")
        .in(
          "instrumentId",
          data.positions.map((position: any) => position.instrumentId)
        );
      console.log(`instruments query took ${Date.now() - queryStart}ms`);
      return result;
    })(),

    (async () => {
      const queryStart = Date.now();
      const result = await supabase
        .from("popular_investors_fundamentals")
        .select(
          "userName, copiers, riskScore, tradesPerWeek, fullname, oneWeekPerformance, oneMonthPerformance, sixMonthsPerformance, oneYearPerformance, yearToDatePerformance, topHeldSector, topHeldSectorPct, secondTopHeldSector, secondTopHeldSectorPct, biggestHeldPositionPct, secondBiggestHeldPositionPct, topHeldAssetType, topHeldAssetTypePct, secondTopHeldAssetType, secondTopHeldAssetTypePct, topHeldCountry, topHeldCountryPct, secondTopHeldCountry, secondTopHeldCountryPct, divYield, cashPct, numOfPositions, numberOfUniqueAssetTypesHeld, numberOfUniqueCountriesHeld, biggestHeldPositionTicker, secondBiggestHeldPositionTicker"
        )
        .in(
          "userName",
          data.socialTrades.map((trade: any) => trade.parentUsername)
        );
      console.log(`popular_investors_fundamentals query took ${Date.now() - queryStart}ms`);
      return result;
    })(),

    (async () => {
      const queryStart = Date.now();
      const result = await supabase
        .from("etf_fundamentals_view")
        .select(
          "instrumentId, ticker, name, divYield, segment, return1M, return1Y, top10HoldingPct, expenseRatio, assetClass, mainRegion, mainRegionPct, mainSector, mainSectorPct, country"
        )
        .in(
          "instrumentId",
          data.positions.map((position: any) => position.instrumentId)
        );
      console.log(`etf_fundamentals_view query took ${Date.now() - queryStart}ms`);
      return result;
    })(),
  ]);
  console.log(`All queries completed in ${Date.now() - startTime}ms`);

  if (
    portfolioErrorFundamentals ||
    portfolioErrorInstruments ||
    portfolioErrorPopularInvestors ||
    portfolioErrorETFs
  ) {
    console.error("Error getting portfolio data:", {
      fundamentals: portfolioErrorFundamentals,
      instruments: portfolioErrorInstruments,
      popularInvestors: portfolioErrorPopularInvestors,
      etfs: portfolioErrorETFs,
    });
    return [];
  }

  // Merge the results, handling both positions and socialTrades
  const mergeStart = Date.now();
  const mergedPortfolioData = [
    ...data.positions.map((position: any) => {
      const fundamentalsData = portfolioDataFundamentals?.find(
        (d) => d.instrumentId === position.instrumentId
      );
      const instrumentsData = portfolioDataInstruments?.find(
        (d) => d.instrumentId === position.instrumentId
      );
      const etfsData = portfolioDataETFs?.find((d) => d.instrumentId === position.instrumentId);

      return {
        ...position,
        ...(fundamentalsData || instrumentsData || etfsData),
      };
    }),
    ...data.socialTrades.map((trade: any) => {
      const popularInvestorData = portfolioDataPopularInvestors?.find(
        (d) => d.userName === trade.parentUsername
      );

      return {
        ...trade,
        ...popularInvestorData,
      };
    }),
  ];

  const finalResult = mergedPortfolioData
    .map((instrument: any) => ({
      ...instrument,
      portfolioWeight: instrument.instrumentId
        ? data.positions.find((position: any) => position.instrumentId === instrument.instrumentId)
            ?.valuePctUnrealized
        : data.socialTrades.find((trade: any) => trade.parentUsername === instrument.parentUsername)
            ?.valuePctUnrealized,
    }))
    .filter((position) => position.portfolioWeight > minPortfolioWeight)
    .sort((a, b) => (b.portfolioWeight || 0) - (a.portfolioWeight || 0))
    .slice(0, maxPositions);
  console.log(`Portfolio data merge took ${Date.now() - mergeStart}ms`);

  return finalResult;
}

export function noClassificationApplies(classification: any) {
  return (
    !classification.isAboutUserPortfolio &&
    !classification.isAboutCurrenciesOrCommoditiesOrIndicesOrCrypto &&
    !classification.isAboutETFs &&
    !classification.isAboutStocks &&
    !classification.isAboutNews &&
    !classification.isAboutEarningsDates &&
    !classification.isAboutDividendDates &&
    !classification.isAboutInvestors
  );
}

export function isDangerousQuery(query: string) {
  return (
    query.toUpperCase().includes("INSERT") ||
    query.toUpperCase().includes("UPSERT") ||
    query.toUpperCase().includes("DROP") ||
    query.toUpperCase().includes("DELETE") ||
    query.toUpperCase().includes("ALTER") ||
    query.toUpperCase().includes("CREATE") ||
    query.toUpperCase().includes("GRANT") ||
    query.toUpperCase().includes("REVOKE") ||
    query.toUpperCase().includes("REINDEX")
  );
}

export function getStocksPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  isStockIndustryRelevant: boolean
) {
  console.log(
    "filtered",
    filterTickerMatches(mainTickerMatches, "stock")
      .map((t: TickerMatch) => `${t.ticker} (${t.name})`)
      .join(", ")
  );
  return `You are an intelligent financial assistant for eToro that converts natural language queries into PostgreSQL queries. Please generate the SQL statement to answer the User Query and ignore EXT tickers.
            **Rules & Guidelines:**
            1. *Use ONLY the following columns* in the case-sensitive "fundamentals_view" table. This table is only relevant for stocks:
            ** Instrument Identification & Basic Information:**

            *   **instrumentId**:  A unique identifier for the financial instrument. This is the primary key for the table.
            *   **ticker**:  The stock ticker symbol (e.g., AAPL for Apple).  A short, unique code used to identify the instrument on an exchange.
            *   **name**:  The full name of the company (e.g., Apple Inc.).
            *   **exchange**:  The stock exchange where the instrument is traded (e.g., Nasdaq, NYSE).
            *   **countryCode**:  The country code where the company is headquartered. (e.g. FR, GB)
            *   **currencyCode**:  The currency in which the instrument is priced and financial data is reported (e.g., USD, EUR, JPY).

            ** Company Profile & Size:**

            *   **sector**:  The broad economic sector the company belongs to (e.g., Technology, Healthcare, Industrials).
            *   **industry**:  A more specific classification of the company's business (e.g., Apparel Or Footwear, Financial Conglomerates, Electronics Or Appliance Stores).
            *   **fullTimeEmployees**:  The number of full-time employees working for the company.
            *   **marketCapUSD**:  Market capitalization in US Dollars.  Calculated as the current share price multiplied by the number of outstanding shares.  A key indicator of company size.

            ** Profitability & Financial Performance:**

            *   **ebitda**:  Earnings Before Interest, Taxes, Depreciation, and Amortization.  A measure of a company's operating profitability.
            *   **peRatio**:  Price-to-Earnings Ratio.  The ratio of a company's share price to its earnings per share.  Used to assess valuation.
            *   **pegRatio**:  Price/Earnings to Growth Ratio.  The P/E ratio divided by the earnings growth rate.  A valuation metric that considers growth.
            *   **profitMargin**:  Net Profit Margin.  Net income divided by revenue.  Indicates how much profit a company makes for each dollar of revenue.
            *   **operatingMargin**:  Operating Income divided by revenue.  Indicates how much profit a company makes from its core operations for each dollar of revenue.
            *   **returnOnAssets**:  Net Income divided by total assets.  Measures how efficiently a company is using its assets to generate profit.
            *   **returnOnEquity**:  Net Income divided by shareholder equity.  Measures how efficiently a company is using shareholder investments to generate profit.
            *   **revenueTTM**:  Revenue Trailing Twelve Months.  The total revenue generated by the company over the past 12 months.
            *   **quartelyRevenueGrowth**:  The percentage change in revenue from the same quarter in the previous year.
            *   **grossProfit**:  Revenue minus the cost of goods sold.  Represents the profit a company makes after deducting the direct costs of producing its goods or services.
            *   **quarterlyEarningsGrowth**:  The percentage change in earnings (net income) from the same quarter in the previous year.

            ** Valuation & Future Expectations:**

            *   **priceToSales**:  Price-to-Sales Ratio.  Market capitalization divided by revenue.  Used to value companies, especially those with negative earnings.
            *   **forwardAnnualDividendYield**:  The expected annual dividend payment divided by the current share price.  Indicates the return an investor can expect from dividends.
            *   **exDivDate**:  Ex-Dividend Date.  The date on or after which a buyer of a stock is not entitled to receive a declared dividend.

            ** Risk & Sentiment:**

            *   **beta**:  A measure of a stock's volatility relative to the overall market. A beta of 1 indicates the stock moves in line with the market; a beta greater than 1 indicates higher volatility.

            ** Enterprise Value Ratios:**

            *   **enterpriseValueRevenue**:  Enterprise Value divided by Revenue.  A valuation ratio that compares the total value of a company to its revenue.
            *   **enterpriseValue**:  A measure of a company's total value, including market capitalization, debt, and cash.
            *   **enterpriseValueEbitda**:  Enterprise Value divided by EBITDA.  A valuation ratio that compares the total value of a company to its operating profitability.

            ** Analyst Estimates & Consensus:**

            *   **analystConsensus**:  A summary of the overall recommendation from analysts (possible values: "Strong Buy", "Moderate Buy", "Hold", "Moderate Sell", "Strong Sell").
            *   **analystsTotal**:  The number of analysts contributing to the consensus recommendation.
            *   **analystPriceTarget**:  The average price target for the stock from analysts.

            ** Historical Data & Trends:**

            *   **fiveYearAveragePERatio**:  The average P/E ratio of the company over the past five years.  Used for historical comparison.

            ** Ownership & Sentiment:**

            *   **institutionalOwnership**:  The percentage of a company's shares owned by institutional investors (e.g., mutual funds, pension funds).  Can indicate confidence in the company.
            *   **avgNewsSentiment**:  A score representing the average sentiment (positive, negative, neutral) expressed in news articles about the company.

            ** Thematic Flags:**

            *   **isDividendAristocrat**:  A boolean flag (true/false) indicating whether the company is a dividend aristocrat (a company that has consistently increased its dividend payout for at least 25 consecutive years).
            *   **isAiRevolution**:  A boolean flag indicating whether the company is considered to be significantly involved in the AI revolution.
            *   **isNuclear**:  A boolean flag indicating whether the company is involved in the nuclear industry.
            *   **popularityRankingLast7d**: A ranking of the instrument's popularity on the eToro platform over the last 7 days, where the lowest value (1) represents the most popular asset

            ** Other**
            *   **priceToGrossProfit**:  Market capitalization divided by gross profit.  A valuation ratio that compares the total value of a company to its gross profit.

            2. **Identify any and all metric(s)** the user may be interested in and always use them in the SELECT clause. 
              Example: If the user is interested in revenue, ALWAYS use "revenueTTM" in the SELECT clause. If you use a metric in the WHERE clause, you MUST ALSO use it in the SELECT clause. 
              For example WHERE "isDividendAristocrat" = TRUE implies SELECT "isDividendAristocrat".

            3. **Determine the relevant comparison metric**, if any (e.g., sector, industry, timeframe, market cap, revenue growth, etc.). Use "industry" for competitors unless explicitly stated otherwise. Use a forwardAnnualDividendYield of bigger than 3 if the user asks for "dividend stocks" without specifying any yield.

            4. **Extract any numerical constraints**, such as "top 10" or "above 500B market cap," and map them to SQL constraints (LIMIT, WHERE, ORDER BY).

            5. **Determine the correct SQL operator** (ILIKE, =, >, <, BETWEEN). Example: "high dividend payers" implies ORDER BY forwardAnnualDividendYield DESC. Always add a NULLS LAST to each ORDER BY clause.

            6. **Ensure sector classifications are standardized**: Use only the following for sectors:
              - Real Estate, Healthcare, Energy, Utilities, Consumer Defensive, Financial Services, Communication Services, Basic Materials, Industrials, Consumer Cyclical, Technology. If user asks for industry and uses a term this list, consider it a sector.
              - All others (e.g., Aerospace & Defense) are industries, which you MUST use with the ILIKE clause. 

            7. **If the timeframe is mentioned**, map it to WHERE conditions (e.g., "next week's earnings" → WHERE revenueEstimateAvgDate BETWEEN NOW() AND NOW() + INTERVAL '7 days').

            8. **Infer missing details intelligently** from context. Example:
              - "Which stocks benefit from high interest rates?" → Industry ILIKE '%Major banks%'
              - "Who are NVDA's competitors?" → Industry ILIKE '%Semiconductors%'
              - "Show me dividend stocks" → forwardAnnualDividendYield > 3

            9. **Construct a fully formatted PostgreSQL query** using only the approved columns. Always include the ticker, name, marketCapUSD and relevant mentioned metrics in the SELECT clause. 
              **Make sure to include any columns that may be relevant for the user's question in the SELECT clause.**

            10. **Always limit the number of results to 20 if no limit is specified. If a limit is specified, use it, but never exceed 40.**

            11. **Transform regions and countries into two letter country codes.** E.g. Germany -> DE, North America -> US, CA, MX. Keep in mind that UK always GB.

            12. **Join via instrumentId with the realtime_prices_view if you need price performance data**, where you have the following columns available: **price**, **oneWeekChangePct**, **oneMonthChangePct**, **sixMonthsChangePct**, **oneYearChangePct**, **YTDChangePct**. If you use a JOIN, ALWAYS add the table in the SELECT cause, else we will have an ambiguity issue.

            13. **By default, always sort by popularityRankingLast7d ASC (unless another sorting is hinted by the user)**

            14. **Exact match tickers**  
          ${
            mainTickerMatches.length > 0
              ? `- Use the relevant tickers in the OR clause to make sure you also get results for the mentioned companies: '${filterTickerMatches(
                  mainTickerMatches,
                  "stock"
                )
                  .map((t: TickerMatch) => t.ticker)
                  .join(
                    ", "
                  )}' in the 'OR "ticker" IN' clause. For example: "Compare MSFT's div yield with its industry" -> Get yield for MSFT as well as other yields in the industry. **MSFT results should come first in the results like, as not to get cut off by the LIMIT clause.**
          `
              : ""
          }
          ${
            otherRelevantTickerMatches.length > 0
              ? `- If it makes sense, use '${filterTickerMatches(
                  otherRelevantTickerMatches,
                  "stock"
                )
                  .map((t: TickerMatch) => t.ticker)
                  .join(", ")}' in the 'WHERE "ticker" IN' clause.
          `
              : ""
          }

    15. **Infer ratios and metrics ratios from your knowledge base and common sense** Example: Low P/E ratio means a good P/E ratio, usually above 0. "Top P/E ratios" means low P/E ratios close to zero, so DON'T ORDER BY NEGATIVE P/E RATIOS please! The upper boundary can depend on the sector and industry and it's up to you to infer it. You can choose multiple properties to determine if a stock is under- or overvalued based on the industry.

    ${
      isStockIndustryRelevant &&
      "16. **List of available stock industries:** 'Electronics Distributors, Cable, Cable Or Satellite TV, Motor Vehicles, Personnel Services, Discount Stores, Specialty Telecommunications, Internet Retail, Publishing Books Or Magazines, Drugstore Chains, Electronic Production Equipment, Data Processing Services, Coal, Oilfield Services Or Equipment, Apparel Or Footwear, Financial Conglomerates, Electronics Or Appliance Stores, Forest Products, Electronic Equipment Or Instruments, Construction Materials, Managed Health Care, Food Major Diversified, Tools And Hardware, Major Banks, Hotels Or Resorts Or Cruiselines, Life Or Health Insurance, Industrial Specialties, Household Or Personal Care, Other Metals Or Minerals, Finance Or Rental Or Leasing, Department Stores, Beverages Non Alcoholic, Stocks, Engineering And Construction, Textiles, Automotive Aftermarket, Telecommunications Equipment, Steel, Metal Fabrication, Food Distributors, Home Furnishings, Real Estate Investment Trusts, Medical Distributors, Homebuilding, Oil And Gas Pipelines, Recreational Products, Miscellaneous Commercial Services, Integrated Oil, Gas Distributors, Aerospace And Defense, Tobacco, Investment Managers, Contract Drilling, Food Meat Or Fish Or Dairy, Media Conglomerates, Medical Specialties, Aluminum, Air Freight Or Couriers, Packaged Software, Insurance Brokers Or Services, Marine Shipping, Other Consumer Services, Consumer Sundries, Savings Banks, Water Utilities, Oil Refining Or Marketing, Miscellaneous Manufacturing, Industrial Conglomerates, Electric Utilities, Computer Communications, Chemicals Specialty, Apparel Or Footwear Retail, Electronic Components, Servicestothe Health Industry, Investment Trusts Or Mutual Funds, Property Or Casualty Insurance, Agricultural Commodities Or Milling, Auto Parts OEM, Pharmaceuticals Generic, Multi Line Insurance, Wholesale Distributors, Broadcasting, Pharmaceuticals Major, General Government, Hospital Or Nursing Management, Food Specialty Or Candy, Real Estate Development, Oil And Gas Production, Electrical Products, Railroads, Precious Metals, Commercial Printing Or Forms, Pulp And Paper, Internet Software Or Services, Regional Banks, Major Telecommunications, Pharmaceuticals Other, Industrial Machinery, Office Equipment Or Supplies, Wireless Telecommunications, Containers Or Packaging, Miscellaneous, Casinos Or Gaming, Restaurants, Computer Peripherals, Chemicals Agricultural, Airlines, Trucking, Specialty Insurance, Biotechnology, Advertising Or Marketing Services, Financial Publishing Or Services, Building Products, Computer Processing Hardware, Other Consumer Specialties, Home Improvement Chains, Trucks Or Construction Or Farm Machinery, Alternative Power Generation, Specialty Stores, Food Retail, Medical Or Nursing Services, Investment Banks Or Brokers, Electronics Or Appliances, Other Transportation, Information Technology Services, Publishing Newspapers, Environmental Services, Semiconductors, Movies Or Entertainment, Chemicals Major Diversified, Beverages Alcoholic'"
    }

    ${
      portfolioData &&
      `17. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings: ${JSON.stringify(
        portfolioData
      )}`
    }

    **Query history for metrics and tickers context:** ${JSON.stringify(cleanedHistory.slice(-4))}

    **User query:** ${prompt}
  `;
}

export function getETFsPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string
) {
  return `# Intelligent Financial Assistant for ETFs

    ## Rules & Guidelines

    1. **Use ONLY the following columns** in the case-sensitive "etf_fundamentals_view" table:
      - "instrumentId", "ticker", "name", "country" - which means the ETF's domicile in ISO 3166-2 format, "divYield", "internalExchangeName" - which is one of [LSE, Chicago Board Options Exchange, Extended Hours Trading, Nasdaq, NYSE, Xetra ETFs], "low52W", "high52W", "currentPrice", "segment", "return1M", "return3M", "return6M", "return1Y", "return3Y", "return5Y", "AUM", "top10HoldingPct", "holdingsCount", "expenseRatio", "ratioPPE", "ratioPS", "ratioPFCF", "isUCITS", "assetClass", "mainRegion", "mainRegionPct", "mainSector", "mainSectorPct", "return10Y", "returnYTD", "isBuyEnabled", "bst_top10HoldingPct", "bst_holdingsCount", "type", "currencyCode", "popularityUniques7Day" - which is the ranking of the ETF's popularity in eToro, where 1 is the most popular.

    2. **Identify the main financial metric(s)** the user is interested in and always use them in the 'SELECT' clause.  
      - Example: If the user is interested in "best dividend ETFs," include '"divYield"' in the query.

    3. **Determine the relevant comparison metric**, if any (e.g., asset class, segment, AUM, region, sector, etc.).  
      - Use "segment" to compare ETFs within a specific investment category unless explicitly stated otherwise.

    4. **Extract any numerical constraints**, such as "top 10" or "AUM above $1B," and map them to SQL constraints ('LIMIT', 'WHERE', 'ORDER BY').

    5. **Determine the correct SQL operator** ('ILIKE', '=', '>', '<', 'BETWEEN').  
      - Example: "low expense ratio ETFs" implies 'ORDER BY expenseRatio ASC'.  
      - Always add a 'NULLS LAST' to each 'ORDER BY' clause.

    6. **Ensure asset classifications are standardized**:  
      - Use only the following asset classes:  
        - 'Commodities', 'Bond', 'Inverse', 'Real Estate', 'Diversified', 'Equity', 'Alternative', 'Other'.  
      - If an asset class isn't specified, infer it based on the user's intent.

    7. **If a timeframe is mentioned**, map it to 'WHERE' conditions.  
      - Example: "top-performing ETFs over the last 5 years" → 'ORDER BY return5Y DESC'.

    8. **Infer missing details intelligently** from context.  
      - Example:  
        - "Best US equity ETFs" → 'WHERE mainRegion ILIKE 'North America' AND assetClass ILIKE 'Equity''  
        - "High-growth ETFs" → 'ORDER BY return1Y DESC'
        - "Gold ETFs" -> WHERE name ILIKE %Gold% OR segment ILIKE %Precious Metals%
        - "Most popular ETFs" -> ORDER BY popularityUniques7Day ASC

    9. **Construct a fully formatted PostgreSQL query** using only the approved columns.  
      - Always include 'ticker', 'name', 'AUM', and relevant mentioned metrics in the 'SELECT' clause.

    10. **Limit the number of results to 15 if no limit is specified.**  
        - If a limit is specified, use it, but never exceed 50.

    11. **Use mainRegion for questions about regional ETFs:**  
        Here are the available regions:
        World, Asia Emerging, United Kingdom, Asia Developed, Australasia, North America, Africa/Middle East, Latin America, Japan, Europe Emerging, Europe Developed.

    12. **Exact match tickers**  
    ${
      mainTickerMatches.length > 0
        ? `- If it makes sense, use '${filterTickerMatches(mainTickerMatches, "etf")
            .map((t: TickerMatch) => t.ticker)
            .join(", ")}' in the 'WHERE "ticker"' clause.  
    `
        : ""
    }
        ${
          otherRelevantTickerMatches.length > 0
            ? `- If it makes sense, use these less relevant tickers '${filterTickerMatches(
                otherRelevantTickerMatches,
                "etf"
              )
                .map((t: TickerMatch) => t.ticker)
                .join(", ")}' in the 'WHERE "ticker" IN' clause.
        `
            : ""
        }

    14. **Interpret ratios and valuation metrics smartly**  
        - Example:  
          - A low '"expenseRatio"' means a cost-efficient ETF.  
          - A high '"return5Y"' signals long-term performance strength.

    15. **List of available ETF segments:**  
        'Financial, Sector Equity Utilities, Japan Stock, USD Corporate Bond - Short Term, Digital Assets, Defined Outcome, Intermediate Core-Plus Bond, Property - Indirect Europe, USD High Yield Bond, Trading - Leveraged/Inverse Equity, Other, RMB Bond - Onshore, Mid-Cap Value, Latin America Stock, Europe ex-UK Equity, Infrastructure, Latin America Equity, Property - Indirect Global, Energy Limited Partnership, Europe Large-Cap Blend Equity, Technology, Moderately Conservative Allocation, Japan Large-Cap Equity, Eurozone Large-Cap Equity, Equity Energy, Sector Equity Alternative Energy, Utilities, Commodities - Energy, Preferred Stock, Global Large-Cap Value Equity, Global Large-Cap Blend Equity, Commodities Broad Basket, Global Corporate Bond, Sector Equity Infrastructure, Other Equity, Global Emerging Markets Bond - Local Currency, Short-Term Bond, Global Bond, China Equity, EUR High Yield Bond, Global Real Estate, Global Emerging Markets Corporate Bond, Trading--Inverse Debt, Commodities - Industrial & Broad Metals, Inflation-Protected Bond, France Equity, Equity Precious Metals, US Flex-Cap Equity, Fixed Term Bond, Sector Equity Healthcare, Global Government Bond, Ultrashort Bond, Vietnam Equity, EUR Ultra Short-Term Bond, Global High Yield Bond, Europe Stock, Miscellaneous Sector, Mid-Cap Blend, Small Growth, Other Bond, Sector Equity Energy, Commodities - Other, Intermediate Government, UK Large-Cap Equity, Global Bond-USD Hedged, Convertibles, Asia Bond - Local Currency, Long Government, Trading--Leveraged Commodities, Health, Miscellaneous Region, High Yield Muni, Emerging Markets Bond, US Small-Cap Equity, Mid-Cap Growth, Global Flex-Cap Equity, EUR Corporate Bond, Foreign Large Value, Short Government, Money Market - Other, Industrials, Global Emerging Markets Bond, Short-Term Inflation-Protected Bond, Sector Equity Water, Diversified Emerging Mkts, USD Government Bond, Pacific ex-Japan Equity, Trading--Inverse Equity, Real Estate, Korea Equity, Netherlands Equity, Sector Equity Natural Resources, Sector Equity Financial Services, USD Corporate Bond, Brazil Equity, Moderate Allocation, Consumer Defensive, Pacific/Asia ex-Japan Stk, EUR Government Bond, Australia & New Zealand Equity, Global Small/Mid-Cap Equity, Small Value, EUR Inflation-Linked Bond, EUR Corporate Bond - Short Term, Alternative Other, Eurozone Mid-Cap Equity, Global Corporate Bond - EUR Hedged, USD Ultra Short-Term Bond, Consumer Cyclical, USD Inflation-Linked Bond, Global Emerging Markets Equity, GBP Government Bond, US Equity Income, Long-Short Equity, High Yield Bond, US Large-Cap Blend Equity, Global Equity Income, Nontraditional Bond, EUR Bond - Long Term, Commodities - Broad Basket, EUR Flexible Bond, Global Small/Mid Stock, Asia-Pacific Equity, Trading--Inverse Commodities, USD Moderate Allocation, US Large-Cap Growth Equity, China Equity - A Shares, Trading--Miscellaneous, Event Driven, Bank Loan, Intermediate Core Bond, Sector Equity Private Equity, Large Blend, Target Maturity, Europe Large-Cap Value Equity, Foreign Large Growth, Trading--Leveraged Debt, Natural Resources, USD Diversified Bond, Global Diversified Bond - EUR Hedged, Sector Equity Agriculture, US Mid-Cap Equity, Diversified Pacific/Asia, Italy Equity, China Region, Foreign Large Blend, Canada Equity, Small Blend, Global Large-Stock Blend, Sector Equity Consumer Goods & Services, Large Value, Muni National Interm, Muni National Long, Trading--Leveraged Equity, Communications, USD Government Bond - Short Term, Large Growth, Property - Indirect Other, Taiwan Large-Cap Equity, Commodities Focused, UK Mid-Cap Equity, Global Allocation, Sector Equity Technology, Commodities - Precious Metals, India Equity, Global Large-Cap Growth Equity, Sector Equity Precious Metals, Asia ex-Japan Equity, Derivative Income, Corporate Bond, Foreign Small/Mid Blend, Long-Term Bond, US Large-Cap Value Equity, Muni National Short'.
    
    ${
      portfolioData &&
      `16. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings: ${JSON.stringify(
        portfolioData
      )}`
    }
    ---

    ### **Query history for metrics and tickers context:**  
    ${JSON.stringify(cleanedHistory.slice(-4))}

    ### **User query:**  
    '${prompt}'
`;
}

export function getLatestNewsPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  defaultLimit: number = 15
) {
  return `  # Intelligent Financial Assistant for Latest News Queries
      ## Rules & Guidelines

      1. **Use ONLY the following columns** in the case-sensitive **"latestnews_view"** table:  
        - **etoroTicker**, **instrumentId**, **source**, **title**, **description**, **publishTime**, **cityfalconScore**.

      2. **Identify the main filtering criteria** the user is interested in and apply them in the "WHERE" clause.  
        - Example: If the user asks for **"latest news on AAPL"**, use "WHERE etoroTicker ILIKE 'AAPL'".  
        - If this list has tickers, make sure you use it: ${JSON.stringify(mainTickerMatches)}.
        - If no ticker is mentioned, return general market news.

      3. **Extract any time constraints**, such as **"news from the last 24 hours"** or **"this week's news"**, and convert them into a "WHERE" clause using **publishTime**.  
        - Example:  
          - **"latest news"** → "ORDER BY publishTime DESC LIMIT ${defaultLimit}".  
          - **"news from the past week"** → "WHERE publishTime >= NOW() - INTERVAL '7 days'".

      4. **Determine the correct SQL operator** ("=", "ILIKE", ">", "<", "BETWEEN").  
        - Example: **"highly rated news"** implies "ORDER BY cityfalconScore DESC".
        - Always add a 'NULLS LAST' to each 'ORDER BY' clause.

      5. **Rank news articles based on relevance and credibility**:  
        - Use "ORDER BY cityfalconScore DESC, publishTime DESC" to prioritize high-quality and recent news.

      6. **Ensure sector classifications are standardized**: Use only the following for sectors:
            - Real Estate, Healthcare, Energy, Utilities, Consumer Defensive, Financial Services, Communication Services, Basic Materials, Industrials, Consumer Cyclical, Technology.
            - All others (e.g., Aerospace & Defense) are industries, which you MUST use with the ILIKE clause.

      7. **Extract the source of the news** if specified.  
        - Example: **"latest news from Bloomberg"** → "WHERE source ILIKE '%Bloomberg%'".

      8. **Limit the number of results to ${defaultLimit} if no limit is specified.**  
        - If a limit is specified, use it, but never exceed 30.

      9. **Include only relevant columns** in the "SELECT" clause based on the user's intent.  
        - Example: If the user asks for **"summaries"**, include "title" and "description".  

      10. **Infer missing details intelligently** from context.  
        - Example:  
          - **"Trending tech news"** → You need to join with the "fundamentals_view".sector column via instrumentId WHERE "fundamentals_view"."sector" = 'Technology' ORDER BY "cityfalconScore" DESC. If you use a JOIN, ALWAYS add the table in the SELECT cause, else we will have an ambiguity issue.
          - **"Breaking news"** → "WHERE publishTime >= NOW() - INTERVAL '1 hour' ORDER BY publishTime DESC".

      11. **Timely articles only**  
        - Only include news that was published in the last 7 days. Always include the publishTime in the SELECT clause to be used later.

      ${
        portfolioData &&
        `12. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings: ${JSON.stringify(
          portfolioData
        )}`
      }
      ---

      ### **Query history for news context:**  
      ${JSON.stringify(cleanedHistory.slice(-4))}"

      ### **User query:**  
      ${prompt}
`;
}

export function getEarningsDatesPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  defaultLimit: number = 15
) {
  return `
      # Intelligent Financial Assistant for Earnings Dates and Reports Queries

      ## Rules & Guidelines

      1. **Use ONLY the following columns** in the case-sensitive **"earningsdates_view"** table:  
        - **instrumentId**, **ticker**, **earningsDate**, **beforeOrAfterMarket**, **epsActual**, **epsEstimate**, **name**, **nextEarningsVerifiedOrTentative**.

      2. **Identify the main filtering criteria** the user is interested in and apply them in the WHERE clause.  
        - Use this list of relevant tickers: ${JSON.stringify(
          otherRelevantTickerMatches
        )} and ${JSON.stringify(mainTickerMatches)}.
        - Example: If the user asks for **"AAPL's next earnings date"**, use WHERE "ticker" ILIKE 'AAPL'.  
        - If no ticker is mentioned, return general upcoming earnings data.

      3. **Extract any time constraints**, such as **"next week's earnings"** or **"earnings from last quarter"**, and convert them into a WHERE clause using **earningsDate**.  
        - Example:  
          - **"next earnings reports"** → WHERE "earningsDate" >= NOW() ORDER BY "earningsDate" ASC LIMIT ${defaultLimit}.  
          - **"last quarter earnings"** → WHERE "earningsDate" BETWEEN DATE_TRUNC('quarter', NOW()) - INTERVAL '3 months' AND DATE_TRUNC('quarter', NOW()).

      4. **Determine the correct SQL operator** (ILIKE, =, >, <, BETWEEN).  
        - Example: **"highest EPS surprise"** implies ORDER BY ("epsActual" - "epsEstimate") DESC.
        - Always add a 'NULLS LAST' to each 'ORDER BY' clause.
      5. **Extract pre-market or after-hours earnings reports** based on **beforeOrAfterMarket**.  
        - Example: **"Pre-market earnings today"** → WHERE "beforeOrAfterMarket" = 'Before Market' AND "earningsDate" = CURRENT_DATE.

      6. **Rank earnings results based on performance**:  
        - Use ORDER BY "earningsDate" DESC, ("epsActual" - "epsEstimate") DESC to prioritize recent and high-surprise earnings.

      7. **Limit the number of results to ${defaultLimit} if no limit is specified.**  
        - If a limit is specified, use it, but never exceed 50.

      8. **Include only relevant columns** in the SELECT clause based on the user's intent.  
        - Example: If the user asks for **"earnings dates only"**, include "ticker" and "earningsDate".  
        - If they ask for **"earnings beats"**, include "ticker", "earningsDate", "epsActual", and "epsEstimate".

      9. **Infer missing details intelligently** from context.  
        - Example:  
          - **"Biggest tech earnings this week"** → You need to join with the "fundamentals_view".sector column via instrumentId WHERE "fundamentals_view"."sector" = 'Technology' BETWEEN NOW() AND NOW() + INTERVAL '7 days' ORDER BY "marketCapUSD" DESC. If you use a JOIN, ALWAYS add the table in the SELECT cause, else we will have an ambiguity issue.
          - **"Stocks with prices above 100 that have earnings this week → You need to join with the "realtime_prices_view".instrumentId column and get the "realtime_prices_view".price column.
          - **"Companies with the largest EPS beats"** → ORDER BY ("epsActual" - "epsEstimate") DESC LIMIT ${defaultLimit}.

      ${
        portfolioData &&
        `10. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings: ${JSON.stringify(
          portfolioData
        )}`
      }
      ---

      ### **Query history for earnings context:**  
      ${JSON.stringify(cleanedHistory.slice(-4))}

      ### **User query:**  
      ${prompt}
  `;
}

export function getDividendDatesPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  defaultLimit: number = 15
) {
  return `
      # Intelligent Financial Assistant for Dividend Data Queries

      ## Rules & Guidelines

      1. **Use ONLY the following columns** in the case-sensitive **"dividenddates_view"** table:  
        - **instrumentId**, **ticker**, **exDivDate**, **payDate**, **amount**, **currency**, **name**, **frequency**, **type**.

      2. **Identify the main filtering criteria** the user is interested in and apply them in the WHERE clause.  
        - Example: If the user asks for **"AAPL's next dividend date"**, use WHERE "ticker" ILIKE 'AAPL'.  
        - If no ticker is mentioned, return general upcoming dividend data.
        - Use this list of relevant tickers: ${JSON.stringify(
          otherRelevantTickerMatches
        )} and ${JSON.stringify(mainTickerMatches)}.

      3. **Extract any time constraints**, such as **"next dividend payouts"** or **"dividends from last quarter"**, and convert them into a WHERE clause using "exDivDate" or "payDate".  
        - Example:  
          - **"upcoming dividends"** → WHERE "exDivDate" >= NOW() ORDER BY "exDivDate" ASC LIMIT ${defaultLimit}.  
          - **"dividends paid last month"** → WHERE "payDate" BETWEEN NOW() - INTERVAL '1 month' AND NOW().

      4. **Determine the correct SQL operator** (ILIKE, =, >, <, BETWEEN).  
        - Example: **"highest dividend payouts"** implies ORDER BY "amount" DESC.
        - Always add a 'NULLS LAST' to each 'ORDER BY' clause.

      5. **Filter based on dividend frequency if specified**:  
        - Example: **"quarterly dividend stocks"** → WHERE "frequency" ILIKE 'Quarterly'. Other options are 'Semiannual', 'Annual', or 'Other'.

      6. **Filter based on dividend type if specified**:
        - Example: **"special dividends only"** → WHERE "type" NOT ILIKE '%OrdinaryDividend%'.

      7. **Rank dividend-paying stocks based on yield or "amount"**:  
        - Use ORDER BY "amount" DESC, "exDivDate" DESC to prioritize high-payout and recent dividend stocks.

      8. **Limit the number of results to ${defaultLimit} if no limit is specified.**  
        - If a limit is specified, use it, but never exceed 50.

      9. **Include only relevant columns** in the SELECT clause based on the user's intent.  
        - Example: If the user asks for **"dividend ex-dates only"**, include "ticker" and "exDivDate".  
        - If they ask for **"highest dividends"**, include "ticker", "amount", "exDivDate", and "payDate".

      10. **Infer missing details intelligently** from context.  
        - Example:  
          - **"Best dividend stocks this year"** → ORDER BY "amount" DESC LIMIT 20.  
          - **"Upcoming dividend-paying stocks"** → WHERE "exDivDate" >= NOW() ORDER BY "exDivDate" ASC.

      ${
        portfolioData &&
        `11. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings: ${JSON.stringify(
          portfolioData
        )}`
      }

      ---

      ### **Query history for dividend context:**     
      ${JSON.stringify(cleanedHistory.slice(-4))}

      ### **User query:**  
      ${prompt}
  `;
}

export function getPopularInvestorsPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  defaultLimit: number = 15
) {
  return `
    # 🎯 SQL Generation Agent: Popular Investors & SmartPortfolios

    This agent's task is to generate **a valid PostgreSQL query** targeting the case-sensitive table **"popular_investors_fundamentals"**. The query will be executed, and its output will be passed to another agent, which will assume the data is optimal and accurate. Your SQL must reflect that.

    ---

    1. **Use ONLY the following columns** in the case-sensitive ** "popular_investors_fundamentals"** table:  
      - **userName**, **isPopularInvestor**, **isFund**, **copiers**, **highLeveragePct**, **mediumLeveragePct**, **lowLeveragePct**, **maxDailyRiskScore**, **riskScore**, **dailyDD**, **weeklyDD**, **peakToValley**, **tradesPerWeek**, **investorCountryCode**, **fullname**, **piLevel**, **oneWeekPerformance**, **oneMonthPerformance**, **sixMonthsPerformance**, **oneYearPerformance**, **yearToDatePerformance**, **topHeldSector**, **topHeldSectorPct**, **secondTopHeldSector**, **secondTopHeldSectorPct**, **biggestHeldPositionPct**, **secondBiggestHeldPositionPct**, **topHeldAssetType**, **topHeldAssetTypePct**, **secondTopHeldAssetType**, **secondTopHeldAssetTypePct**, **topHeldCountry**, **topHeldCountryPct**, **secondTopHeldCountry**, **secondTopHeldCountryPct**, **divYield**, **cashPct**, **numOfPositions**, **numberOfUniqueAssetTypesHeld**, **numberOfUniqueCountriesHeld**, **biggestHeldPositionTicker**, **secondBiggestHeldPositionTicker**, positionsHHI, sectorsHHI, countriesHHI, assetTypesHHI, biggestSectorsHeld (jsonb "{sector}":value), biggestAssetTypesHeld (jsonb "{assetType}":value), biggestPositionsHeld (jsonb "{ticker}":value), biggestCountriesHeld (jsonb "{country}":value).
      
    2. **Identify the main filtering criteria** the user is interested in and apply them in the WHERE clause.  
      - If you use a metric in the WHERE clause, you MUST ALSO use it in the SELECT clause. Example: WHERE "copiers" > 500 implies SELECT "copiers".
      - Example: If the user asks for **"top popular investors"**, use WHERE "isPopularInvestor" = TRUE ORDER BY "copiers" DESC LIMIT ${defaultLimit}.
      - By default you should always include WHERE "isPopularInvestor" = TRUE for queries, unless the user is explicitly asking about SmartPortfolios, in which case you'd use WHERE "isPopularInvestor" = FALSE
      - If no specific filter is mentioned, return general rankings of popular investors, for which you should use WHERE "isPopularInvestor" = TRUE.
      - If the question is **clearly** about hedge funds or famous investors outside etoro, don't write any sql query
      - If needed, use this list of relevant tickers: ${JSON.stringify(
        otherRelevantTickerMatches
      )} and ${JSON.stringify(mainTickerMatches)}.

    3. **Extract any risk constraints**, such as **"low-risk investors"** or **"investors with a risk score below 5"**, and apply them to **riskScore** or **maxDailyRiskScore**.  
      - Example:  
        - **"low-risk investors"** → WHERE "riskScore" <= 4 AND maxDailyRiskScore <=4 ORDER BY "riskScore" ASC.  
        - **"most volatile investors"** → ORDER BY "peakToValley" DESC.

    4. **Determine the correct SQL operator** (ILIKE, =, >, <, BETWEEN).  
      - Example: **"Investors with most positions"** implies ORDER BY "numOfPositions" DESC.
      - Always add a 'NULLS LAST' to each 'ORDER BY' clause.

    5. **Filter based on leverage strategy if specified**:  
      - Example: **"Best commodity investors"** → WHERE "topHeldAssetType" ILIKE 'Commodities'. The possible asset types are: 'ETFs', 'Commodities', 'Stocks', 'Indices', 'Currencies', 'Crypto'.
      - Example: **"investors using low leverage"** → WHERE "lowLeveragePct" > 80.

    6. **Rank investors based on popularity, performance, or strategy**:  
      - Use ORDER BY "copiers" DESC for popularity-based queries.  
      - Use ORDER BY "divYield" DESC for dividend-focused investors.  
      - Use ORDER BY "cashPct" DESC for cash-heavy investors.

    7. **Limit the number of results to ${defaultLimit} if no limit is specified.**  
      - If a limit is specified, use it, but never exceed 30.

    8. **Include only relevant columns** in the SELECT clause based on the user's intent.  
      - Example: If the user asks for **"top dividend investors"**, include "userName", "fullname", "divYield", and "numOfPositions".  
      - If they ask for **"most copied investors"**, include "userName", "copiers", and "riskScore".

    9. **Infer missing details intelligently** from context.  
      - Example: 
        - **"Best investors in Technology"** → WHERE "topHeldSector" ILIKE 'Technology' ORDER BY "copiers" DESC.  
        - **"Popular investors with low risk"** → WHERE "isPopularInvestor" = TRUE AND "riskScore" <= 4 ORDER BY "copiers" DESC.
        - **"Similar investors like "jaynemesis"** → WHERE "userName" ILIKE 'jaynemesis' OR ("userName" NOT ILIKE 'jaynemesis' AND "topHeldSector" = (SELECT "topHeldSector" FROM popular_investors_fundamentals WHERE "userName" ILIKE 'jaynemesis') AND "topHeldAssetType" = (SELECT "topHeldAssetType" FROM popular_investors_fundamentals WHERE "userName" ILIKE 'jaynemesis')) ORDER BY CASE WHEN "userName" ILIKE 'jaynemesis' THEN 0 ELSE 1 END

    10. **Construct a fully formatted PostgreSQL query** using only the allowed columns. Be careful not to use wrong column names.  
      - Always include 'userName', 'copiers' and 'piLevel', and relevant mentioned metrics in the 'SELECT' clause.
      - After include an ORDER BY 'copiers' DESC. If you have other 'ORDER BY' clauses, add this one afterwards.

    11: **In a diversification or risk related query, your job is to try and diversify the user's sector, country and asset type allocation. Get all parameters that could be relevant**
      - **It is mandatory that you take the user's current portfolio asset type, sector and country diversification into account when building the SQL query, if you have it available**
      - **If you have the user's portfolio, build a query that excludes the user's topHeldSector and topHeldCountry which you can infer from the portfolioData and respective portfolioWeights**
      - The following properties are all useful to evaluate an investor's diversification:
      riskScore, topHeldSector, topHeldSectorPct, secondTopHeldSector, secondTopHeldSectorPct, biggestHeldPositionPct, secondBiggestHeldPositionPct, 
      topHeldAssetType, topHeldAssetTypePct, secondTopHeldAssetType, secondTopHeldAssetTypePct, topHeldCountry, 
      topHeldCountryPct, secondTopHeldCountry, secondTopHeldCountryPct, divYield, cashPct, numOfPositions, 
      numberOfUniqueAssetTypesHeld, numberOfUniqueCountriesHeld, biggestHeldPositionTicker, secondBiggestHeldPositionTicker,
      , positionsHHI, sectorsHHI, countriesHHI, assetTypesHHI, biggestSectorsHeld, biggestAssetTypesHeld, biggestPositionsHeld, biggestCountriesHeld.
      - HHI refers to the Herfindahl-Hirschman Index, from 1-10000, where a lower value indicates a higher diversification. If you use HHI metrics you must filter for HHI values that are bigger than 200, in addition to a maximum risk score of 5, to avoid bad data.

    12. **Try to find the user name in the userName column.**
      - Example: If the user asks for **"Can I trade John Smith?"**, include "username" ILIKE '%JohnSmith%' OR "fullname" ILIKE '%John Smith%' in the WHERE clause.
      - Example: If the user asks for **"Can I trade superUser42?"**, include "username" ILIKE '%superUser42%' OR "fullname" ILIKE '%super User 42%' in the WHERE clause.

    13. **Transform regions and countries into two letter country codes.** E.g. Germany -> DE, North America -> US, CA, MX.

    ${
      portfolioData &&
      `14. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. This is an object with the user's biggest holdings, where portfolioWeight represents the relative size of the position from 0 to 100%: ${JSON.stringify(
        portfolioData
      )}`
    }

    ---

    ### **Query history for investor context:**  
    ${JSON.stringify(cleanedHistory.slice(-4))}

    ### **User query:**  
    ${prompt}
  `;
}

export function getAssetPricesPrompt(
  mainTickerMatches: TickerMatch[],
  otherRelevantTickerMatches: TickerMatch[],
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string,
  defaultLimit: number = 15
) {
  return `
      # Intelligent Financial Assistant for Asset Performance and Realtime Prices

      ## Rules & Guidelines

      0. Today's date is ${new Date().toISOString().split("T")[0]}.

      1. **Use ONLY the following columns** in the case-sensitive **"realtime_prices_view"** table:  
        - **instrumentId**, **ticker**, **isMarketOpen**, **price** which represents the current price, **pricePercentage** which represents the percentage change in price from the previous day, **oneWeekAgoPrice**, **oneMonthAgoPrice**, **sixMonthsAgoPrice**, **oneYearAgoPrice**, **YTDAgoPrice**, **oneWeekChangePct**, **oneMonthChangePct**, **sixMonthsChangePct**, **oneYearChangePct**, **YTDChangePct**.

      2. **Identify the main filtering criteria** the user is interested in and apply them in the WHERE clause. If you use a metric in the WHERE clause, you MUST ALSO use it in the SELECT clause. For example WHERE "isMarketOpen" = TRUE implies SELECT "isMarketOpen".
        - Example: If the user asks for **"AAPL's current price"**, use WHERE ticker = 'AAPL'.  
        - If this list has tickers, make sure you use it: ${JSON.stringify(
          mainTickerMatches
        )} and these less relevant ones: ${JSON.stringify(otherRelevantTickerMatches)}.

      3. **Extract any timeframe constraints**, such as **"performance over the last year"** or **"YTD performance"**, and apply them to the respective columns.  
        - Example:  
          - **"biggest gainers this month"** → ORDER BY oneMonthChangePct DESC LIMIT ${defaultLimit}.  
          - **"top performers this year"** → ORDER BY YTDChangePct DESC LIMIT ${defaultLimit}.

      4. **Determine the correct SQL operator** (ILIKE, =, >, <, BETWEEN).  
        - Example: **"stocks that dropped more than 10% this month"** implies WHERE oneMonthChangePct <= -10.
        - Always add a 'NULLS LAST' to each 'ORDER BY' clause.
        - Do NOT use JSON_TABLE.
      
      5. **Filter based on market status if specified**:  
        - Example: **"stocks currently trading"** → WHERE isMarketOpen = TRUE.

      6. **Rank assets based on performance metrics**:  
        - Use ORDER BY pricePercentage DESC for percentage-based daily performance.  
        - Use ORDER BY oneYearChangePct DESC for long-term performance.

      7. **Limit the number of results to ${defaultLimit} if no limit is specified.**  
        - If a limit is specified, use it, but never exceed 50.

      8. **Include only relevant columns** in the SELECT clause based on the user's intent.  
        - Example: If the user asks for **"stocks with the biggest gains this week"**, include ticker, oneWeekChangePct.  
        - If they ask for **"real-time prices"**, include ticker, price, and isMarketOpen.

      9. **Infer missing details intelligently** from context.  
        - Example:  
          - **"Tech stocks with best YTD performance"** → You need to join with the "fundamentals_view".sector column via instrumentId WHERE "fundamentals_view"."sector" = 'Technology' ORDER BY YTDChangePct DESC. Don't forget it include the joined metric in the SELECT clause. If you use a JOIN, ALWAYS add the table in the SELECT cause, else we will have an ambiguity issue.
          - **"Most volatile stocks this month"** → ORDER BY ABS(oneMonthChangePct) DESC LIMIT ${defaultLimit}.

      10. **Join with other tables for missing data**
        - The "fundamentals_view" table has "sector", "industry", and "countryCode". Join with the fundamentals_view if you need "sector", "industry", or "countryCode" in your query.
        - The "instruments_view" table does not have the properties mentioned above, but has "assetClassId" which represents the various asset types, with the following mapping: 1 - Forex, 2 - Commodities, 4 - Indices, 5 - Stocks, 6 - ETFs, 10 - Cryptocurrencies
        Example:
          - **"Best performing ETFs"** -> You need to join with the "instruments_view".instrumentId via instrumentId WHERE "instruments_view"."assetClassId" = 6.
      
      11. **Ensure sector classifications are standardized**: Use only the following for sectors:
        - Real Estate, Healthcare, Energy, Utilities, Consumer Defensive, Financial Services, Communication Services, Basic Materials, Industrials, Consumer Cyclical, Technology.
        - All others (e.g., Aerospace & Defense) are industries, which you MUST use with the ILIKE clause.

      12. **Remember your limitations**:
        - You do not have access to prices of a specific day, month or year, unless it was today's **price**, the **oneWeekAgoPrice**, **oneMonthAgoPrice**, **sixMonthsAgoPrice**, **oneYearAgoPrice**, **YTDAgoPrice** (YTDAgoPrice is the price at the start of the year)
        - You do not have access to historical percentage movements on a specific day, except today's. You only have access to the **oneWeekChangePct**, **oneMonthChangePct**, **sixMonthsChangePct**, **oneYearChangePct**, **YTDChangePct**
        - You do not have access to average daily moves, since you only have access to the above datapoints.

      13. If the user asks whether a filter or metric is possible or available (e.g., “Can I filter by X?” or “Do you support Y?”), and it is in fact possible with your data, try to generate a sample SQL query using that filter, considering your other instructions.

      ${
        portfolioData &&
        `14. ** User portfolio data ** - Use the user's portfolio data if relevant for the user's query. 
        - For performance questions related to the user's portfolio, use the underlying holdings to provide information. Example: "What was my portfolio's performance today?" should be answered by analyzing the individual holdings' performance.
        This is an object with the user's biggest holdings: ${JSON.stringify(portfolioData)}`
      }

      ---

      ### **Query history for asset performance context:**  
      ${JSON.stringify(cleanedHistory.slice(-4))}

      ### **User query:**  
      ${prompt}
  `;
}

export function getPortfolioAnalysisPrompt(
  portfolioData: PortfolioPosition[],
  cleanedHistory: any,
  prompt: string
) {
  return `
      You are a veteran financial expert with 20 years of experience working at Hedge Funds, and you're helping a user understand their investment portfolio.

      Analyze the user's portfolio based on the following data:

      Portfolio positions - the portfolioWeight property (0-100) is the percentage of each position in the user's portfolio, and the "isBuy" property indicates if it is a long position:
      ${JSON.stringify(portfolioData, null, 2)}

      Provide a short, succint, clear, valuable and simple explanation of the portfolio's structure and diversification (or lack thereof). 
      Your analysis must include:

      1. **Portfolio Composition** - Analyze the asset types (e.g., Stocks, ETF, Copytrader, Commodities, etc), sector allocation (highlighting any over/underexposures using your knowledge of S&P500 as benchmark), and geographic distribution across countries/regions with potential implications.
      2. **Summary** - Evaluate the portfolio's diversification across holdings/sectors/geography and assess the risk profile, including concentrated positions and exposure to volatile sectors.

      Be specific, but avoid jargon and weasel words. Summarize findings in a positive tone that feels like a thoughtful, helpful analysis — not too technical, but still insightful.
      Assume that the user is emotionally attached to their portfolio, so ponder the negative stuff that you say. Refer to copied traders by username, and remember that copying traders is generally good.
      **You are not technically allowed to offer investment advice, so your wording must take that into consideration.** - Avoid using any judgmental words, advisory phrasing or implied recommendations, in order for your analysis to be purely factual and descriptive. However, your language should be natural and engaging as if you're talking to a 35 year old person, not robotic.
      **Always generate your answer in markdown, and in the user question's language (default is English).**

      ### **Query history if relevant for context:**  
      ${JSON.stringify(cleanedHistory.slice(-4))}

      Use the following user prompt for context if it is relevant:
      "${prompt}"
`;
}
