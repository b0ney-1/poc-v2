import { NextRequest, NextResponse } from 'next/server';
import { Index } from '@upstash/vector';

// Initialize Upstash Vector client
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

// Log Upstash Vector configuration for debugging
console.log('[remove/route.ts] Upstash Vector configuration:');
console.log('- URL:', process.env.UPSTASH_VECTOR_REST_URL);
console.log('- Token (first 10 chars):', process.env.UPSTASH_VECTOR_REST_TOKEN?.substring(0, 10) + '...');

/**
 * Handle DELETE requests to remove documents by namespace
 */
export async function DELETE(request: NextRequest) {
  console.log('[remove/route.ts] Received DELETE request');
  console.log('- Request URL:', request.url);
  
  try {
    // Get the namespace from the query parameters
    const { searchParams } = new URL(request.url);
    const namespace = searchParams.get('namespace');
    
    console.log('[remove/route.ts] Parsed request parameters:');
    console.log('- Namespace:', namespace);
    console.log('- All search params:', Object.fromEntries(searchParams.entries()));
    
    if (!namespace) {
      console.log('[remove/route.ts] Error: No namespace provided');
      return NextResponse.json(
        { error: 'No namespace provided' },
        { status: 400 }
      );
    }
    
    // Attempt to delete the namespace directly using the deleteNamespace method
    console.log(`[remove/route.ts] Attempting to delete namespace: ${namespace}`);
    
    try {
      // Use the deleteNamespace method which is the proper way to remove a namespace
      const result = await vectorIndex.deleteNamespace(namespace);
      console.log('[remove/route.ts] Delete namespace operation result:', result);
      
      // Verify if the namespace was actually deleted
      try {
        const namespaces = await vectorIndex.listNamespaces();
        console.log('[remove/route.ts] Namespaces after deletion:', namespaces);
        console.log('[remove/route.ts] Namespace still exists:', namespaces.includes(namespace));
      } catch (listError) {
        console.error('[remove/route.ts] Error checking namespaces after deletion:', listError);
      }
    
      return NextResponse.json({
        success: true,
        namespace,
        result,
      });
    } catch (deleteError) {
      console.error('[remove/route.ts] Error during delete operation:', deleteError);
      return NextResponse.json(
        { error: deleteError instanceof Error ? deleteError.message : 'Error deleting namespace' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[remove/route.ts] Error removing document:', error);
    console.error('[remove/route.ts] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', details: String(error) },
      { status: 500 }
    );
  }
}