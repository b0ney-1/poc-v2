import { NextResponse } from 'next/server';
import { Index } from '@upstash/vector';

// Initialize Upstash Vector client
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

/**
 * Get information about all namespaces (uploaded files)
 */
export async function GET() {
  try {
    console.log('Fetching all namespaces from Upstash Vector');
    
    // Get list of all namespaces
    const namespaces = await vectorIndex.listNamespaces();
    console.log(`Found ${namespaces.length} namespaces:`, namespaces);
    
    // Get detailed information for each namespace
    const indexInfo = await vectorIndex.info();
    console.log('Index info:', indexInfo);
    
    // Format the response to include file information
    const files = namespaces.map(namespace => {
      // Skip the default namespace (empty string)
      if (namespace === '') return null;
      
      // Get vector count for this namespace if available
      const namespaceInfo = indexInfo?.namespaces?.[namespace];
      const vectorCount = namespaceInfo?.vectorCount || 0;
      
      // Convert namespace back to filename (remove hyphens, add .pdf extension)
      const filename = namespace + '.pdf';
      
      return {
        id: namespace, // Use namespace as ID
        name: filename,
        status: 'completed' as const,
        chunks: vectorCount,
        uploadedAt: new Date().toISOString(), // We don't have the actual upload time
      };
    }).filter(Boolean); // Remove null entries (default namespace)
    
    return NextResponse.json({
      success: true,
      files,
      totalFiles: files.length,
    });
  } catch (error) {
    console.error('Error fetching namespaces:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}