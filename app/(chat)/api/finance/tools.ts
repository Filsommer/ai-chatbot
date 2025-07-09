import { tool } from "ai";
import { z } from "zod";

interface Candle {
  instrumentID: number;
  fromDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleDanny {
  InstrumentID: number;
  FromDate: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

interface CandleResponse {
  instrumentId: number;
  candles: Candle[];
  rangeOpen: number;
  rangeClose: number;
  rangeHigh: number;
  rangeLow: number;
  volume: number;
}

export const getSingleDayPriceTool = tool({
  description:
    "Get the price data for a specific date for a financial instrument. Automatically calculates the required number of candles based on the date difference. Returns the OHLC price data for the requested date, or the closest date to the target date if it was a non trading day for that instrument",
  inputSchema: z.object({
    instrumentId: z
      .number()
      .int()
      .describe("Unique identifier of the financial instrument to retrieve candles for."),
    date: z
      .string()
      .describe('The date to get the price for, in ISO format (e.g., "2025-06-03T00:00:00Z")'),
  }),
  execute: async ({ instrumentId, date }) => {
    console.log("Fetching single day price for:", { instrumentId, date });

    // Calculate days between today and target date
    const today = new Date();
    const targetDate = new Date(date);
    const diffTime = Math.abs(today.getTime() - targetDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    console.log("diff", diffDays);
    // Add some buffer days to ensure we get the data
    const candlesCount = Math.min(diffDays + 5, 1000);

    const response = await fetch(
      `https://www.etoro.com/sapi/candles/candles/asc.json/OneDay/${candlesCount}/${instrumentId}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.ETORO_API_KEY!,
        },
      }
    );
    const data = await response.json();

    // Find the candle closest to our target date
    const targetDateStr = date.split("T")[0]; // Get just the date part
    const candles = data.Candles?.[0]?.Candles || [];
    const targetCandle = candles.find(
      (candle: CandleDanny) => candle.FromDate.split("T")[0] === targetDateStr
    );

    // If no exact match found, look for a candle within 3 days in the past (for weekends and hoidays)
    if (!targetCandle) {
      const targetDateObj = new Date(targetDateStr);
      const threeDaysAgo = new Date(targetDateObj);
      threeDaysAgo.setDate(targetDateObj.getDate() - 3);

      // Find the closest candle within the last 3 days
      const closestCandle = candles
        .filter((candle: CandleDanny) => {
          const candleDate = new Date(candle.FromDate.split("T")[0]);
          return candleDate >= threeDaysAgo && candleDate <= targetDateObj;
        })
        .sort((a: CandleDanny, b: CandleDanny) => {
          const dateA = new Date(a.FromDate);
          const dateB = new Date(b.FromDate);
          return dateB.getTime() - dateA.getTime(); // Sort descending to get most recent
        })[0];

      return closestCandle || null;
    }

    return targetCandle;
  },
});

export const getInstrumentAllTimeHighTool = tool({
  description:
    "Get the all-time high price for a financial instrument by fetching the last 1000 weekly candles. It also returns the date (as the week) when it ocurred.",
  inputSchema: z.object({
    instrumentId: z
      .number()
      .int()
      .describe("Unique identifier of the financial instrument to retrieve candles for."),
  }),
  execute: async ({ instrumentId }) => {
    console.log("Fetching all-time high for instrument:", instrumentId);

    const response = await fetch(
      `https://www.etoro.com/sapi/candles/candles/asc.json/OneWeek/1000/${instrumentId}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.ETORO_API_KEY!,
        },
      }
    );
    const data = await response.json();

    const candles: CandleDanny[] = data.Candles?.[0]?.Candles || [];
    if (candles.length === 0) return null;

    // Find the highest price and its date by iterating through candles
    let allTimeHigh = candles[0].High;
    let highDate = candles[0].FromDate;

    for (const candle of candles) {
      if (candle.High > allTimeHigh) {
        allTimeHigh = candle.High;
        highDate = candle.FromDate;
      }
    }

    // Calculate the start date of the week (6 days before the end date)
    const endDate = new Date(highDate);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);

    return {
      allTimeHigh,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };
  },
});

export const getInstrumentHighOrLowOnPeriodTool = tool({
  description:
    "Get the highest or lowest price for a financial instrument within a specific date range.",
  inputSchema: z.object({
    instrumentId: z
      .number()
      .int()
      .describe("Unique identifier of the financial instrument to retrieve candles for."),
    startDate: z
      .string()
      .describe('Start date of the period in ISO format (e.g., "2025-06-03T00:00:00Z")'),
    endDate: z
      .string()
      .describe('End date of the period in ISO format (e.g., "2025-06-03T00:00:00Z")'),
    direction: z
      .enum(["high", "low"])
      .describe("Whether to get the highest or lowest price in the period"),
  }),
  execute: async ({ instrumentId, startDate, endDate, direction }) => {
    console.log("Fetching period", direction, "for instrument:", {
      instrumentId,
      startDate,
      endDate,
      direction,
    });

    // Calculate days between today and start date
    const today = new Date();
    const start = new Date(startDate);
    const diffTime = Math.abs(today.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Add some buffer days to ensure we get the data
    const candlesCount = Math.min(diffDays + 5, 1000);
    console.log("candles", candlesCount);

    const response = await fetch(
      `https://www.etoro.com/sapi/candles/candles/asc.json/OneDay/${candlesCount}/${instrumentId}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.ETORO_API_KEY!,
        },
      }
    );
    const data = await response.json();
    console.log(data.Candles[0].Candles[2]);
    const candles = data.Candles?.[0]?.Candles || [];
    if (candles.length === 0) return null;
    // Filter candles within the date range
    const startDateStr = startDate.split("T")[0];
    const endDateStr = endDate.split("T")[0];
    const periodCandles = candles.filter((candle: CandleDanny) => {
      const candleDate = candle.FromDate.split("T")[0];
      return candleDate >= startDateStr && candleDate <= endDateStr;
    });

    if (periodCandles.length === 0) return null;

    // Find the highest or lowest price in the period
    const price =
      direction === "high"
        ? Math.max(...periodCandles.map((c: CandleDanny) => c.High))
        : Math.min(...periodCandles.map((c: CandleDanny) => c.Low));

    const candle = periodCandles.find((c: CandleDanny) =>
      direction === "high" ? c.High === price : c.Low === price
    );

    console.log(price, candle?.FromDate);

    return {
      price,
      date: candle?.FromDate,
    };
  },
});

export const getInstrumentPerformanceInRangeTool = tool({
  description:
    "Get the performance (percentage change) of a financial instrument between two dates. Automatically handles weekends and non-trading days by using the closest available trading days.",
  inputSchema: z.object({
    instrumentId: z
      .number()
      .int()
      .describe("Unique identifier of the financial instrument to retrieve candles for."),
    startDate: z
      .string()
      .describe('Start date of the period in ISO format (e.g., "2025-06-03T00:00:00Z")'),
    endDate: z
      .string()
      .describe('End date of the period in ISO format (e.g., "2025-06-03T00:00:00Z")'),
  }),
  execute: async ({ instrumentId, startDate, endDate }) => {
    console.log("Fetching performance for instrument:", {
      instrumentId,
      startDate,
      endDate,
    });

    // Calculate days between today and start date
    const today = new Date();
    const start = new Date(startDate);
    const diffTime = Math.abs(today.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Add some buffer days to ensure we get the data
    const candlesCount = Math.min(diffDays + 5, 1000);

    const response = await fetch(
      `https://www.etoro.com/sapi/candles/candles/asc.json/OneDay/${candlesCount}/${instrumentId}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.ETORO_API_KEY!,
        },
      }
    );
    const data = await response.json();
    const candles = data.Candles?.[0]?.Candles || [];
    if (candles.length === 0) return null;

    // Convert dates to YYYY-MM-DD format for comparison
    const startDateStr = startDate.split("T")[0];
    const endDateStr = endDate.split("T")[0];

    // Find the closest available trading days
    const findClosestTradingDay = (
      targetDate: string,
      candles: CandleDanny[],
      lookBackDays: number = 3
    ) => {
      const targetDateObj = new Date(targetDate);
      const lookBackDate = new Date(targetDateObj);
      lookBackDate.setDate(targetDateObj.getDate() - lookBackDays);

      return candles
        .filter((candle: CandleDanny) => {
          const candleDate = new Date(candle.FromDate.split("T")[0]);
          return candleDate >= lookBackDate && candleDate <= targetDateObj;
        })
        .sort((a: CandleDanny, b: CandleDanny) => {
          const dateA = new Date(a.FromDate);
          const dateB = new Date(b.FromDate);
          return dateB.getTime() - dateA.getTime(); // Sort descending to get most recent
        })[0];
    };

    const startCandle = findClosestTradingDay(startDateStr, candles);
    const endCandle = findClosestTradingDay(endDateStr, candles);

    if (!startCandle || !endCandle) {
      return null;
    }

    // Calculate performance
    const startPrice = startCandle.Close;
    const endPrice = endCandle.Close;
    const performance = ((endPrice - startPrice) / startPrice) * 100;

    return {
      performance,
      startDate: startCandle.FromDate,
      endDate: endCandle.FromDate,
      startPrice,
      endPrice,
      period: {
        start: startCandle.FromDate,
        end: endCandle.FromDate,
      },
    };
  },
});
