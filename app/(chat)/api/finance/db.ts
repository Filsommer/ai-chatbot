import { GoogleAICacheManager } from "@google/generative-ai/server";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import "server-only";
import { LangsheetSpan } from "./langsheet-client";

export const cacheManager = new GoogleAICacheManager(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

// Configure your PostgreSQL connection
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : 6543,
});

function enforceCaseSensitivity(query: string) {
  const sqlKeywords = new Set([
    "SELECT",
    "FROM",
    "WHERE",
    "AND",
    "OR",
    "IN",
    "ORDER",
    "BY",
    "ASC",
    "DESC",
    "LIMIT",
    "TRUE",
    "FALSE",
    "NULL",
    "NOT",
    "LIKE",
    "ILIKE",
    "GROUP",
    "HAVING",
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "ON",
    "AS",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "INTERVAL",
    "DISTINCT",
    "BETWEEN",
    "EXISTS",
    "IS",
    "SET",
    "UPDATE",
    "DELETE",
    "INSERT",
    "VALUES",
    "CREATE",
    "ALTER",
    "DROP",
    "TABLE",
    "VIEW",
    "INDEX",
    "UNION",
    "EXCEPT",
    "INTERSECT",
    "ALL",
    "ANY",
    "SOME",
    "COALESCE",
    "GREATEST",
    "LEAST",
    "HAVING",
    "OFFSET",
    "FETCH",
    "WITH",
    "RECURSIVE",
    "WINDOW",
    "NULLS",
    "LAST",
    "CROSS",
  ]);

  const functionNames = new Set([
    "NOW",
    "CURRENT_TIMESTAMP",
    "CURRENT_DATE",
    "CURRENT_TIME",
    "DATE_PART",
    "DATE_TRUNC",
    "DATE",
    "COUNT",
    "SUM",
    "AVG",
    "MAX",
    "MIN",
    "ROUND",
    "CEIL",
    "FLOOR",
    "ABS",
    "LENGTH",
    "LOWER",
    "UPPER",
    "TRIM",
    "SUBSTRING",
    "POSITION",
    "REPLACE",
    "CHAR_LENGTH",
    "EXTRACT",
  ]);
  const enforcedQuery = query
    .replaceAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
      if (sqlKeywords.has(match.toUpperCase()) || functionNames.has(match.toUpperCase())) {
        return match; // Leave SQL keywords & functions as-is
      }
      return `"${match}"`; // Quote column & table names
    })
    .replaceAll(`'"`, "'")
    .replaceAll(`"'`, "'")
    .replaceAll('""', '"')
    .replaceAll(/%(.+?)%/g, (match) => match.replaceAll('"', ""))
    .replace(/'([^']+)'/g, (match) => match.replaceAll('"', ""));
  return enforcedQuery;
}

export async function dbQueryWithLog(
  text: string,
  params: any[],
  langsheetSpanParent: LangsheetSpan,
  name: string
) {
  const langsheetSpan = langsheetSpanParent.startChildSpan(`${name}`, {
    metadata: { input: text },
  });

  const client = await pool.connect();
  let isSuccessful = false;
  try {
    const enforcedQuery = enforceCaseSensitivity(text);
    const result = await client.query(enforcedQuery, params);
    isSuccessful = true;
    const output =
      result.rows.length === 0
        ? [
            "Above query successful but no results were returned, probably because there are no results that match the criteria",
          ]
        : result.rows;

    langsheetSpan?.end({
      metadata: { output },
    });
    return output;
  } catch (error) {
    console.error("Database query error:", error);

    langsheetSpan?.end({
      metadata: {
        output: [
          `Above query failed: An error occurred while executing the query - ${JSON.stringify(
            error
          )}`,
        ],
      },
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function dbQuery(text: string, params: any[]) {
  const client = await pool.connect();
  try {
    const enforcedQuery = enforceCaseSensitivity(text);
    console.log("enforcedQuery", enforcedQuery);
    const result = await client.query(enforcedQuery, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
