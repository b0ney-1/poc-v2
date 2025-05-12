/**
 * This file contains functions for PDF parsing.
 * Client-side parsing uses PDF.js with dynamic imports.
 * Server-side parsing uses pdf2json.
 */

// Type guard to check if we're in a browser environment
const isBrowser = () => typeof window !== 'undefined';



/**
 * Extract text from a PDF file (client-side)
 * @param file PDF file to extract text from
 * @returns Promise resolving to the extracted text
 */
export async function extractPdfTextClient(file: File): Promise<string> {
  if (!isBrowser()) {
    throw new Error('This function can only be used in a browser environment');
  }

  try {
    // Dynamically import PDF.js to avoid server-side rendering issues
    const pdfjsLib = await import('pdfjs-dist');
    
    // Set up the worker
    const workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    
    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    // Process each page
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Extract text from the page
      const pageText = textContent.items
        .map((item) => {
          // Check if the item has a 'str' property (TextItem)
          return 'str' in item ? (item as { str: string }).str : '';
        })
        .join(' ');
      
      fullText += pageText + '\n\n';
    }
    
    // Clean up the text
    fullText = fullText
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
    
    return fullText;
  } catch (error) {
    console.error('Error extracting text from PDF (client-side):', error);
    throw new Error('Failed to extract text from PDF');
  }
}

// For backward compatibility with existing code
export const extractPdfText = extractPdfTextClient;

// Note: Server-side PDF parsing with pdf2json is not compatible with Edge runtime
// For server-side PDF parsing, use a separate API route that runs in Node.js runtime

/**
 * Process a PDF file into chunks
 * @param text Text to chunk
 * @param chunkSize Size of each chunk (default: 1000)
 * @param overlap Overlap between chunks (default: 200)
 * @returns Array of text chunks
 */
export function processPdfIntoChunks(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  
  // Clean up the text first
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  while (i < text.length) {
    const start = i === 0 ? 0 : Math.max(0, i - overlap);
    const end = Math.min(start + chunkSize, text.length);
    
    let actualEnd = end;
    if (end < text.length) {
      // Try to end at a sentence boundary
      const sentenceEnd = text.lastIndexOf('.', end);
      const questionEnd = text.lastIndexOf('?', end);
      const exclamationEnd = text.lastIndexOf('!', end);
      
      const lastPunctuation = Math.max(sentenceEnd, questionEnd, exclamationEnd);
      
      if (lastPunctuation > start + chunkSize / 2) {
        actualEnd = lastPunctuation + 1;
      }
    }
    
    const chunk = text.slice(start, actualEnd).trim();
    if (chunk.length > 50) { // Only include chunks with meaningful content
      chunks.push(chunk);
    }
    
    i = actualEnd;
  }
  
  return chunks;
}