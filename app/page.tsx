"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Message as MessageProps } from "ai/react";
import { useChat } from '@ai-sdk/react';
import Form from "@/components/form";
import Message from "@/components/message";
import cx from "@/utils/cx";
import MessageLoading from "@/components/message-loading";
import FileUpload from "@/components/file-upload";

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [streaming, setStreaming] = useState<boolean>(false);

  const { messages, input, handleInputChange, handleSubmit } =
    useChat({
      api: "/api/chat",
      initialMessages: [],
      onResponse: async (response) => {
        console.log("🔥 onResponse triggered!", response);

        setStreaming(false);
      },
    });

  useEffect(() => {
    console.log("📩 Updated Messages:", messages);
  }, [messages]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView();
    }
  }, [messages]);

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      handleSubmit(e);
      setStreaming(true);
    },
    [handleSubmit],
  );

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* Main chat area */}
      <main className="relative flex-1 p-4 md:p-6 flex flex-col min-h-svh !pb-32 md:!pb-40 overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto">
          {/* Chat messages */}
          {messages.map((message: MessageProps) => {
            return <Message key={message.id} {...message} />;
          })}
          {streaming && <MessageLoading />}

          {/* Quick messages section removed */}

          {/* bottom ref */}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          className={cx(
            "fixed z-10 bottom-0 inset-x-0",
            "flex justify-center items-center",
            "bg-white",
          )}
        >
          <span
            className="absolute bottom-full h-10 inset-x-0 from-white/0
           bg-gradient-to-b to-white pointer-events-none"
          />

          <div className="w-full max-w-3xl mx-auto rounded-xl px-4 md:px-5 py-6">
            <Form
              ref={formRef}
              onSubmit={onSubmit}
              inputProps={{
                disabled: streaming,
                value: input,
                onChange: handleInputChange,
              }}
              buttonProps={{
                disabled: streaming,
              }}
            />
          </div>
        </div>
      </main>

      {/* File upload sidebar */}
      <div className="w-80 h-svh border-l border-gray-200 hidden md:block">
        <FileUpload />
      </div>
    </div>
  );
}