"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ChatHeader } from "@/components/chat-header";
import type { Vote } from "@/lib/db/schema";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { MultimodalInput } from "./multimodal-input";
import { Messages } from "./messages";
import type { VisibilityType } from "./visibility-selector";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { unstable_serialize } from "swr/infinite";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { AuthSession } from "@/lib/auth/server";
import { useSearchParams } from "next/navigation";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
import { useDataStream } from "./data-stream-provider";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: AuthSession;
  autoResume: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");

  // State for structured finance data
  const [financeData, setFinanceData] = useState<{
    chartData?: any[];
    tickersToDisplay?: string[];
    followUpQuestions?: string[];
    chatTitle?: string;
  }>({});

  // State for status messages
  const [statusMessages, setStatusMessages] = useState<
    Array<{ step: string; message: string; timestamp: number }>
  >([]);

  const {
    messages,
    setMessages,
    sendMessage: originalSendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      console.log("🎭 Frontend received data part:", dataPart);
      console.log("🎭 Data part type:", dataPart.type);
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));

      // Handle structured data from finance agent
      if (dataPart.type === "data-status") {
        const statusData = JSON.parse(dataPart.data);
        console.log("📊 Received status:", statusData);
        setStatusMessages((prev) => [...prev, { ...statusData, timestamp: Date.now() }]);
      } else if (dataPart.type === "data-chartData") {
        const chartData = JSON.parse(dataPart.data);
        console.log("📊 Received chart data:", chartData);
        setFinanceData((prev) => ({ ...prev, chartData }));
      } else if (dataPart.type === "data-tickers") {
        const tickersToDisplay = JSON.parse(dataPart.data);
        console.log("📈 Received tickers:", tickersToDisplay);
        setFinanceData((prev) => ({ ...prev, tickersToDisplay }));
      } else if (dataPart.type === "data-followUpQuestions") {
        const followUpQuestions = JSON.parse(dataPart.data);
        console.log("❓ Received follow-up questions:", followUpQuestions);
        setFinanceData((prev) => ({ ...prev, followUpQuestions }));
      }
    },
    onFinish: () => {
      console.log("🏁 Frontend stream finished");
      console.log("📊 Final finance data:", financeData);
      // Clear status messages after completion
      setTimeout(() => setStatusMessages([]), 3000);
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      console.error("❌ Frontend stream error:", error);
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
        });
      }
    },
  });

  // Wrapper function to clear status messages before sending
  const sendMessage = (message: any) => {
    setStatusMessages([]);
    setFinanceData({});
    return originalSendMessage(message);
  };

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  // Debug message updates
  useEffect(() => {
    console.log("📝 Messages updated:", messages.length, "Status:", status);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      console.log("📄 Last message:", {
        id: lastMessage.id,
        role: lastMessage.role,
        partsCount: lastMessage.parts.length,
        firstPartPreview:
          lastMessage.parts[0]?.type === "text"
            ? lastMessage.parts[0].text.substring(0, 100) + "..."
            : `${lastMessage.parts[0]?.type} part`,
      });
    }
  }, [messages, status]);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={id}
          selectedModelId={initialChatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          session={session}
        />

        <Messages
          chatId={id}
          status={status}
          votes={votes}
          messages={messages}
          setMessages={setMessages}
          regenerate={regenerate}
          isReadonly={isReadonly}
          isArtifactVisible={isArtifactVisible}
        />

        {/* Display status messages during processing */}
        {statusMessages.length > 0 && status === "streaming" && (
          <div className="mx-auto px-4 w-full md:max-w-3xl mb-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <h3 className="font-medium text-sm text-blue-700 dark:text-blue-300 mb-3 flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Processing your request...
              </h3>
              <div className="space-y-2">
                {statusMessages.map((statusMsg, index) => (
                  <div
                    key={`${statusMsg.step}-${statusMsg.timestamp}`}
                    className={`text-sm transition-all duration-300 ${
                      index === statusMessages.length - 1
                        ? "text-blue-700 dark:text-blue-300 font-medium"
                        : "text-blue-600 dark:text-blue-400"
                    }`}
                  >
                    {statusMsg.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Display finance data when available */}
        {((financeData.chartData?.length ?? 0) > 0 ||
          (financeData.tickersToDisplay?.length ?? 0) > 0 ||
          (financeData.followUpQuestions?.length ?? 0) > 0) && (
          <div className="mx-auto px-4 w-full md:max-w-3xl">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
              <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300">
                📊 Financial Data
              </h3>

              {financeData.chartData && financeData.chartData.length > 0 && (
                <div>
                  <h4 className="font-medium text-xs text-gray-600 dark:text-gray-400 mb-2">
                    Chart Data:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {financeData.chartData.map((item: any, index: number) => (
                      <div key={index} className="bg-white dark:bg-gray-700 p-2 rounded">
                        <div className="font-medium">{item.ticker}</div>
                        <div className="text-gray-600 dark:text-gray-400">{item.chartXValue}</div>
                        <div className="text-green-600 dark:text-green-400">
                          {item.chartYLabel}: ${item.chartYValue.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {financeData.tickersToDisplay && financeData.tickersToDisplay.length > 0 && (
                <div>
                  <h4 className="font-medium text-xs text-gray-600 dark:text-gray-400 mb-2">
                    Related Tickers:
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {financeData.tickersToDisplay.map((ticker: string, index: number) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs"
                      >
                        {ticker}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {financeData.followUpQuestions && financeData.followUpQuestions.length > 0 && (
                <div>
                  <h4 className="font-medium text-xs text-gray-600 dark:text-gray-400 mb-2">
                    Follow-up Questions:
                  </h4>
                  <button
                    className="space-y-1 text-left"
                    onClick={() => {
                      sendMessage({
                        role: "user" as const,
                        parts: [{ type: "text", text: financeData.followUpQuestions[0] }],
                      });
                    }}
                  >
                    {financeData.followUpQuestions.map((question: string, index: number) => (
                      <div
                        key={index}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        • {question}
                      </div>
                    ))}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
          {!isReadonly && (
            <MultimodalInput
              chatId={id}
              input={input}
              setInput={setInput}
              status={status}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              sendMessage={sendMessage}
              selectedVisibilityType={visibilityType}
            />
          )}
        </form>
      </div>

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        status={status}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        sendMessage={sendMessage}
        messages={messages}
        setMessages={setMessages}
        regenerate={regenerate}
        votes={votes}
        isReadonly={isReadonly}
        selectedVisibilityType={visibilityType}
      />
    </>
  );
}
