/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages: number;
    info: Record<string, any>;
    metadata: Record<string, any>;
  }

  function parse(dataBuffer: Buffer | ArrayBuffer, options?: Record<string, any>): Promise<PDFData>;
  
  export = parse;
}
