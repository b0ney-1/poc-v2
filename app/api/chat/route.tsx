/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { streamText } from "ai";
import { AIMessage, ChatMessage, HumanMessage } from "@langchain/core/messages";
import { OpenAIEmbeddings } from "@langchain/openai";
import { UpstashVectorStore } from "@/app/vectorstore/UpstashVectorStore";
import { openai } from '@ai-sdk/openai';

export const runtime = "edge";

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(1, "1 s"),
});

const convertVercelMessageToLangChainMessage = (message: { role: string; content: string }) => {
    if (message.role === "user") {
        return new HumanMessage(message.content);
    } else if (message.role === "assistant") {
        return new AIMessage(message.content);
    } else {
        return new ChatMessage(message.content, message.role);
    }
};

export async function POST(req: NextRequest) {
    try {
        // Start timer for total response time
        const totalStartTime = performance.now();
        const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
        const { success } = await ratelimit.limit(ip);

        if (!success) {
            const customString =
                "Oops! It seems you've reached the rate limit. Please try again later.";

            return NextResponse.json({ error: customString }, { status: 429 });
            //return new StreamingTextResponse(transformStream);
        }

        const body = await req.json();
        const messages = (body.messages ?? []).filter(
            (message: { role: string; content: string }) => message.role === "user" || message.role === "assistant"
        );
        const previousMessages = messages.slice(0, -1).map(convertVercelMessageToLangChainMessage);
        const currentMessageContent = messages[messages.length - 1].content;

        const model = openai('gpt-4o');

        // Initialize vector store without specifying a namespace to search across all namespaces
        const vectorstore = new UpstashVectorStore(new OpenAIEmbeddings({
            // model: "text-embedding-ada-002",
            model: "text-embedding-3-small",
            // model: "text-embedding-3-large",
        }));
        
        console.log('Performing similarity search across all namespaces');
        
        // Start timer for vector search
        const vectorSearchStartTime = performance.now();
        
        const documents = await vectorstore.similaritySearch(currentMessageContent, 15);
        
        // End timer for vector search
        const vectorSearchEndTime = performance.now();
        const vectorSearchTime = vectorSearchEndTime - vectorSearchStartTime;
        
        console.log(`Vector search completed in ${vectorSearchTime.toFixed(2)}ms`);
        console.log(`Retrieved ${documents.length} documents from vector store`);
        
        // Format documents to include source namespace information
        // Log document details
        console.log('Vector search results:');
        documents.forEach((doc, index) => {
            try {
                const metadata = JSON.parse(doc.pageContent);
                console.log(`Document ${index + 1}:`);
                console.log(`- Source: ${metadata.source_namespace || 'Unknown'}`);
                console.log(`- Score: ${doc.metadata?.score || 'N/A'}`);
                console.log(`- Text preview: ${(metadata.text || '').substring(0, 100)}...`);
            } catch (e) {
                console.log(`Document ${index + 1}: Unable to parse metadata`);
            }
        });
        
        const formattedDocuments = documents.map(doc => {
            // Extract namespace from metadata if available
            let source = '';
            try {
                const metadata = JSON.parse(doc.pageContent);
                source = metadata.source_namespace ? `[Source: ${metadata.source_namespace}] ` : '';
                // Use the text from metadata as the actual content
                return {
                    ...doc,
                    pageContent: `${source}${metadata.text || doc.pageContent}`
                };
            } catch (e) {
                // If parsing fails, use the original content
                return doc;
            }
        });
        
        const context = (formattedDocuments.map((doc) => doc.pageContent)).join("\n");

        const AGENT_SYSTEM_TEMPLATE = `
      You are an artificial intelligence assistant.

      First, determine if the user query requires specific information or context. 
      - For simple greetings, casual conversation, or general questions, respond naturally without mentioning or using the retrieved context.
      - For specific questions that require information, use the provided context if relevant and cite sources.

      Your responses should be precise and factual. Provide URLs from the context only when they are relevant to the query.

      Don't repeat yourself in responses, and if an answer is unavailable in the retrieved content, state that you don't know.

      Now, answer the message below:
      ${currentMessageContent}

      Context (only use if needed for the specific query):
      ${context}

      Previous messages:
      ${previousMessages.map((message: ChatMessage) => message.content).join("\n")}
    `;
        console.log('Agent system template:', AGENT_SYSTEM_TEMPLATE);
        // Start timer for LLM response
        const llmStartTime = performance.now();
        
        const result = await streamText({
            model: model,
            prompt: AGENT_SYSTEM_TEMPLATE,
        });
        
        // End timer for LLM response
        const llmEndTime = performance.now();
        const llmResponseTime = llmEndTime - llmStartTime;
        
        // End timer for total response
        const totalEndTime = performance.now();
        const totalResponseTime = totalEndTime - totalStartTime;
        
        // Log performance metrics
        console.log('\nPerformance Metrics:');
        console.log(`- Vector Search Time: ${vectorSearchTime.toFixed(2)}ms`);
        console.log(`- LLM Response Time: ${llmResponseTime.toFixed(2)}ms`);
        console.log(`- Total Response Time: ${totalResponseTime.toFixed(2)}ms`);
        console.log(`- Vector Search percentage: ${((vectorSearchTime / totalResponseTime) * 100).toFixed(2)}%`);

        return result.toDataStreamResponse();

    } catch (e) {
        if (e instanceof Error) {
            console.error(e.message);
        } else {
            console.error(String(e));
        }
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
