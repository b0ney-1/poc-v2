import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { Index } from '@upstash/vector';
import { v4 as uuidv4 } from 'uuid';
import { extractTextFromFile } from '@/lib/embeddings/extractor';
import { processPdfIntoChunks } from '@/utils/pdf-parser';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Upstash Vector client
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

async function createEmbedding(text: string, model: string = 'text-embedding-3-large'): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: model,
      input: text
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw new Error('Failed to create embedding');
  }
}

async function processTextChunks(chunks: string[], namespace: string, filename: string, embeddingModel: string = 'text-embedding-3-large') {
  try {
    // Process chunks in batches
    const batchSize = 10;
    const results = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchPromises = batch.map(async (chunk: string, index: number) => {
        // Create embedding for the chunk
        const embedding = await createEmbedding(chunk, embeddingModel);
        
        // Generate a unique ID for the chunk
        const id = `${namespace}-${uuidv4()}`;
        
        // Upsert the chunk to the vector database
        console.log(`Upserting chunk ${i + index + 1}/${chunks.length} to namespace '${namespace}'`);
        console.log(`Chunk ID: ${id}`);
        console.log(`Embedding length: ${embedding.length}`);
        
        try {
          const result = await vectorIndex.namespace(namespace).upsert({
            id,
            vector: embedding,
            metadata: {
              text: chunk,
              index: i + index,
              total: chunks.length,
              filename,
              namespace,
            },
          });
          
          console.log(`Upsert result:`, result);
          return result;
        } catch (upsertError) {
          console.error(`Error upserting chunk ${i + index + 1}:`, upsertError);
          throw upsertError;
        }
      });
      
      // Wait for all chunks in the batch to be processed
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return {
      success: true,
      chunks: chunks.length,
      namespace,
    };
  } catch (error) {
    console.error('Error processing chunks:', error);
    throw new Error('Failed to process chunks');
  }
}

// Function to fetch and process a PDF from S3
async function fetchAndProcessPdf(s3Url: string): Promise<string[]> {
  try {
    console.log('Fetching PDF from S3:', s3Url);
    
    // Fetch the PDF from the S3 URL
    const response = await fetch(s3Url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    
    // Get the PDF as a blob
    const pdfBlob = await response.blob();
    console.log(`PDF fetched, size: ${pdfBlob.size} bytes`);
    
    // Use the existing extractor to parse the PDF
    const extractedText = await extractTextFromFile(pdfBlob);
    console.log(`PDF parsed, text length: ${extractedText.length} characters`);
    
    // Use the existing chunking utility
    const chunks = processPdfIntoChunks(extractedText);
    console.log(`Split into ${chunks.length} chunks`);
    
    return chunks;
  } catch (error) {
    console.error('Error fetching or processing PDF:', error);
    throw error;
  }
}

// Note: Server-side PDF parsing is not supported in Edge runtime
// PDF parsing should be done client-side and chunks sent to this API

/**
 * Handle POST requests to upload pre-processed text chunks
 * or process PDF from S3 URL
 */
export async function POST(request: NextRequest) {
  try {
    // Handle JSON data with pre-processed chunks or S3 URL
    const data = await request.json();
    const { 
      chunks, 
      s3Url, 
      filename, 
      namespace, 
      embeddingModel = 'text-embedding-3-large',
      isAsyncProcess = false 
    } = data;
    
    console.log('Received upload request:');
    console.log('- Filename:', filename);
    console.log('- Namespace:', namespace);
    console.log('- Embedding Model:', embeddingModel);
    console.log('- Is Async Process:', isAsyncProcess);
    
    if (!filename) {
      return NextResponse.json(
        { error: 'No filename provided' },
        { status: 400 }
      );
    }
    
    if (!namespace) {
      return NextResponse.json(
        { error: 'No namespace provided' },
        { status: 400 }
      );
    }
    
    // Process either pre-processed chunks or fetch and process from S3 URL
    let textChunks: string[] = [];
    
    // Handle pre-processed chunks
    if (chunks && Array.isArray(chunks) && chunks.length > 0) {
      console.log('- Chunks count:', chunks.length);
      console.log('- First chunk preview:', chunks[0]?.substring(0, 100) + '...');
      textChunks = chunks;
    }
    // Handle S3 URL
    else if (s3Url) {
      console.log('- S3 URL:', s3Url);
      // For async processing, return immediately and process in the background
      if (isAsyncProcess) {
        // Return immediate success response
        console.log('Starting async processing of PDF from S3...');
        
        // Start processing in background without awaiting completion
        (async () => {
          try {
            const s3Chunks = await fetchAndProcessPdf(s3Url);
            console.log(`Async processing: Fetched ${s3Chunks.length} chunks from PDF`);
            const result = await processTextChunks(s3Chunks, namespace, filename, embeddingModel);
            console.log('Async processing completed successfully:', result);
          } catch (bgError) {
            console.error('Async processing error:', bgError);
          }
        })();
        
        return NextResponse.json({
          success: true,
          message: 'Async processing initiated',
          filename,
          namespace
        });
      } 
      // For synchronous processing, wait for completion
      else {
        console.log('Processing PDF from S3 synchronously...');
        textChunks = await fetchAndProcessPdf(s3Url);
      }
    } 
    else {
      return NextResponse.json(
        { error: 'Either chunks or S3 URL must be provided' },
        { status: 400 }
      );
    }
    
    // Process the text chunks (only reached in non-async case)
    const result = await processTextChunks(textChunks, namespace, filename, embeddingModel);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error handling upload:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}