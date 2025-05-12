import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { Index } from '@upstash/vector';
import { v4 as uuidv4 } from 'uuid';

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

// Note: Server-side PDF parsing is not supported in Edge runtime
// PDF parsing should be done client-side and chunks sent to this API

/**
 * Handle POST requests to upload pre-processed text chunks
 */
export async function POST(request: NextRequest) {
  try {
    // Handle JSON data with pre-processed chunks
    const data = await request.json();
    const { chunks, filename, namespace, embeddingModel = 'text-embedding-3-large' } = data;
    
    console.log('Received upload request:');
    console.log('- Filename:', filename);
    console.log('- Namespace:', namespace);
    console.log('- Embedding Model:', embeddingModel);
    console.log('- Chunks count:', chunks?.length || 0);
    console.log('- First chunk preview:', chunks?.[0]?.substring(0, 100) + '...');
    
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json(
        { error: 'No text chunks provided' },
        { status: 400 }
      );
    }
    
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
    
    // Process the text chunks
    const result = await processTextChunks(chunks, namespace, filename, embeddingModel);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error handling upload:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}