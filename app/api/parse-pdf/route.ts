import { NextRequest, NextResponse } from 'next/server';
import { processPdfIntoChunks } from '@/utils/pdf-parser';
import { extractTextFromFile } from '@/lib/embeddings/extractor';

// This API route uses the Node.js runtime, not Edge runtime
export const config = {
  runtime: 'nodejs'
};

/**
 * Handle POST requests to parse PDF files
 */
export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check if the file is a PDF
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'File must be a PDF' },
        { status: 400 }
      );
    }

    // Create a namespace from the filename
    const namespace = file.name
      .replace(/\.pdf$/i, '')
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase();

    // Create a blob from the file
    const fileBlob = new Blob([await file.arrayBuffer()], { type: file.type });

    // Use the extractor to parse the PDF file
    const extractedText = await extractTextFromFile(fileBlob);

    // Chunk the text
    const chunks = processPdfIntoChunks(extractedText);

    return NextResponse.json({
      success: true,
      filename: file.name,
      namespace,
      chunks,
      totalChunks: chunks.length,
    });
  } catch (error) {
    console.error('Error parsing PDF:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
