import PDFParser from "pdf2json";
import mammoth from "mammoth";

// Custom error class for text extraction errors
class TextExtractionError extends Error {
  constructor(
    message: string,
    public readonly fileType: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TextExtractionError";
  }
}

export async function extractTextFromFile(fileBlob: Blob): Promise<string> {
  const fileType = fileBlob.type;

  if (fileType === "application/pdf") {
    return extractTextFromPdf(fileBlob);
  } else if (fileType === "text/plain") {
    return fileBlob.text();
  } else if (fileType === "text/markdown") {
    return fileBlob.text();
  } else if (
    fileType === "application/msword" ||
    fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractTextFromWord(fileBlob);
  } else {
    throw new TextExtractionError("Unsupported file type", fileType);
  }
}

async function extractTextFromPdf(pdfBlob: Blob): Promise<string> {
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new Promise<string>((resolve, reject) => {
      // Create a new PDFParser instance
      const pdfParser = new PDFParser(null, true); // Set needRawText to true

      // Set up event handlers
      pdfParser.on("pdfParser_dataError", (errData) => {
        reject(new Error(errData.parserError.message));
      });

      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          // Option 1: Use getRawTextContent if needRawText was set to true
          const rawText = pdfParser.getRawTextContent();
          if (rawText && rawText.length > 0) {
            resolve(rawText);
            return;
          }

          // Option 2: Extract text from the parsed JSON structure
          let text = "";

          if (pdfData && pdfData.Pages) {
            for (const page of pdfData.Pages) {
              if (page.Texts) {
                for (const textElement of page.Texts) {
                  if (textElement.R) {
                    for (const r of textElement.R) {
                      if (r.T) {
                        // Decode the URI-encoded text
                        text += decodeURIComponent(r.T) + " ";
                      }
                    }
                  }
                }
                text += "\n\n"; // Add spacing between pages
              }
            }
          }

          resolve(text.trim());
        } catch (error) {
          reject(error);
        }
      });

      // Parse the PDF buffer
      pdfParser.parseBuffer(buffer);
    });
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new TextExtractionError(
      `Failed to extract text from PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      "application/pdf",
      error
    );
  }
}

async function extractTextFromWord(wordBlob: Blob): Promise<string> {
  try {
    const arrayBuffer = await wordBlob.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error("Error extracting text from Word document:", error);
    throw new TextExtractionError(
      `Failed to extract text from Word document: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      error
    );
  }
}
