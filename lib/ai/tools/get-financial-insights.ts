import { tool } from "ai";
import { z } from "zod";

export const getFinancialInsights = tool({
  description:
    "Get real-time financial insights, market data, stock analysis, company information, economic trends, and investment research. Use this tool for ANY questions about stocks (like NVDA, AAPL, TSLA), market performance, financial news, economic indicators, or investment advice. Always use this tool when users ask about specific stock tickers, company financial performance, or market conditions.",
  inputSchema: z.object({
    prompt: z
      .string()
      .describe("The financial question, stock symbol, company name, or market topic to analyze"),
  }),
  execute: async ({ prompt }) => {
    try {
      const response = await fetch("https://chat.bullsheet.me/api/discovery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer Slgb14MeQ2f61ZVWv3fZ",
        },
        body: JSON.stringify({
          prompt,
          history: [],
          streaming: true,
          username: "FilipeSommer",
        }),
      });

      if (!response.ok) {
        throw new Error(`Financial API request failed: ${response.status} ${response.statusText}`);
      }

      const financialData = await response.json();
      return financialData;
    } catch (error) {
      console.error("Financial insights error:", error);
      return {
        error: "Failed to retrieve financial insights",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
