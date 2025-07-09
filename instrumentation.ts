import { registerOTel } from "@vercel/otel";

export function register() {
  // Only register telemetry in production to avoid dev spam
  if (process.env.NODE_ENV === "production") {
    registerOTel({ serviceName: "ai-chatbot" });
  }
}
