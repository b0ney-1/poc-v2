import { NextRequest, NextResponse } from 'next/server';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { z } from 'zod';

// Configure AWS S3 client using environment variables
const s3Client = new S3Client({
  region: process.env.AWS_REGION || '',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 100 * 1024 * 1024, {
      message: 'File size should be less than 100MB',
    })
    // Update to only accept PDF files
    .refine((file) => ['application/pdf'].includes(file.type), {
      message: 'File type should be PDF',
    }),
});

export async function POST(request: NextRequest) {
  // Check if environment variables are configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.S3_BUCKET_NAME || !process.env.AWS_REGION) {
    console.error('Missing AWS environment variables');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (request.body === null) {
    return NextResponse.json({ error: 'Request body is empty' }, { status: 400 });
  }

  try {
    // Process the form data or chunked upload
    const formData = await request.formData();
    const file = formData.get('file') as Blob;
    const filename = formData.get('filename') as string || (formData.get('file') as File)?.name || 'unknown.pdf';
    const contentType = file.type || 'application/pdf';
    
    // Validate the file
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(', ');

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Generate a unique key for the file in the 'PoC' folder
    const key = `PoC/${Date.now()}-${filename}`;

    try {
      // Convert the file to ArrayBuffer
      const fileBuffer = await file.arrayBuffer();
      
      // Use the Upload utility for multipart uploads (handles large files)
      const parallelUpload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: key,
          Body: Buffer.from(fileBuffer),
          ContentType: contentType,
        },
        // Configure multipart upload parameters
        queueSize: 4, // Number of concurrent uploads
        partSize: 5 * 1024 * 1024, // 5MB part size (minimum for S3)
      });

      // Optional: Track progress
      parallelUpload.on('httpUploadProgress', (progress) => {
        console.log(`Upload progress: ${JSON.stringify(progress)}`);
      });

      // Complete the upload
      const result = await parallelUpload.done();

      // Construct the S3 URL for direct access to the file
      // Format: https://<bucket-name>.s3.<region>.amazonaws.com/<object-key>
      const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      
      console.log('S3 upload complete. File accessible at:', s3Url);
      
      // Return success response with file details including the direct S3 URL
      return NextResponse.json({
        success: true,
        key: key,
        bucket: process.env.S3_BUCKET_NAME,
        filename: filename,
        etag: result.ETag,
        location: result.Location,
        url: s3Url, // Direct URL to access the file
      });
      
    } catch (error) {
      console.error('S3 upload failed:', error);
      return NextResponse.json({ error: 'Upload to S3 failed' }, { status: 500 });
    }
  } catch (error) {
    console.error('Request processing error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}

// For handling large file uploads with chunking
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Content-Range, X-Content-Length',
    },
  });
}

// For handling very large files that exceed the API route size limit
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};