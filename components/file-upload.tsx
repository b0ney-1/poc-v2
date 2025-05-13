import React, { useState, useCallback, useEffect } from 'react';
import { IconUpload, IconFile, IconX, IconCheck, IconLoader2, IconChevronDown } from '@tabler/icons-react';
import cx from '@/utils/cx';

// File status types
type FileStatus = 'idle' | 'parsing' | 'uploading' | 'processing' | 'completed' | 'error';

// File item interface
interface FileItem {
  id: string;
  name: string;
  size: number;
  status: FileStatus;
  error?: string;
  progress?: number;
  chunks?: number;
  processedChunks?: number;
}

// Available embedding models
type EmbeddingModel = 'text-embedding-3-large' | 'text-embedding-3-small' | 'text-embedding-ada-002';

const FileUpload: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState<EmbeddingModel>('text-embedding-3-small');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Fetch the list of uploaded files when the component mounts
  useEffect(() => {
    const fetchUploadedFiles = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/fetch');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch files: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.files) {
          console.log(`Loaded ${data.files.length} previously uploaded files`);
          setFiles(data.files);
        }
      } catch (error) {
        console.error('Error fetching uploaded files:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchUploadedFiles();
  }, []);

  // No need for client-side chunking as we're using server-side parsing

  // Process file with chunking
  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    // Create file items with initial status
    const newFiles = Array.from(selectedFiles)
      .filter(file => file.type === 'application/pdf')
      .map(file => ({
        id: Math.random().toString(36).substring(2, 9),
        name: file.name,
        size: file.size,
        status: 'idle' as FileStatus,
      }));

    setFiles(prev => [...prev, ...newFiles]);

    // Process each file
    for (const fileItem of newFiles) {
      await processFile(fileItem, Array.from(selectedFiles).find(f => f.name === fileItem.name)!);
    }
  }, []);

  // Process file with chunking
  const processFile = async (fileItem: FileItem, file: File) => {
    try {
      // Update status to parsing
      setFiles(prev => 
        prev.map(f => f.id === fileItem.id ? { ...f, status: 'parsing' as FileStatus, progress: 10 } : f)
      );
      
      // Always use server-side parsing for consistency
      console.log(`Processing PDF file: ${file.name}`);
      
      // Process with server-side parsing
      console.log('Using server-side PDF processing with parse-pdf API');
      
      try {
        // Step 1: Parse the PDF using the parse-pdf API
        const formData = new FormData();
        formData.append('file', file);
        
        const parseResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: formData,
        });

        if (!parseResponse.ok) {
          const errorData = await parseResponse.json();
          throw new Error(errorData.error || `PDF parsing failed: ${parseResponse.statusText}`);
        }

        // Get the parsed chunks
        const parseData = await parseResponse.json();
        const { chunks, namespace } = parseData;
        
        if (!chunks || chunks.length === 0) {
          throw new Error('No text chunks were extracted from the PDF');
        }
        
        // Update progress
        setFiles(prev => 
          prev.map(f => f.id === fileItem.id ? { 
            ...f, 
            status: 'uploading' as FileStatus, 
            progress: 50,
            chunks: chunks.length,
            processedChunks: 0 
          } : f)
        );
        
        // Step 2: Send the chunks to the upload API
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chunks,
            filename: file.name,
            namespace,
            embeddingModel,
          }),
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json();
          throw new Error(errorData.error || `Upload failed: ${uploadResponse.statusText}`);
        }

        // Update status to completed for server-side processing
        setFiles(prev => 
          prev.map(f => f.id === fileItem.id ? { ...f, status: 'completed' as FileStatus, progress: 100 } : f)
        );
      } catch (error: unknown) {
        const serverError = error instanceof Error ? error : new Error(String(error));
        console.error('Server-side processing failed:', serverError);
        throw new Error(`Server-side processing failed: ${serverError.message}`);
      }

    } catch (error) {
      console.error('Error processing file:', error);
      
      // Update status to error
      setFiles(prev => 
        prev.map(f => 
          f.id === fileItem.id 
            ? { ...f, status: 'error' as FileStatus, error: error instanceof Error ? error.message : 'Unknown error' } 
            : f
        )
      );
    }
  };

  // Remove file
  const removeFile = async (fileId: string, fileName: string) => {
    try {
      // For files loaded from the API, the fileId is already the namespace
      // For newly uploaded files, we need to create the namespace from the filename
      const namespace = fileId.includes('-') ? fileId : fileName.replace(/\.pdf$/i, '').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      
      console.log(`Removing file with namespace: ${namespace}`);
      console.log(`File ID: ${fileId}, File name: ${fileName}`);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'processing' as FileStatus } : f));
      
      // Remove from server using the remove API
      const removeUrl = `/api/remove?namespace=${encodeURIComponent(namespace)}`;
      console.log(`Sending DELETE request to: ${removeUrl}`);
      
      const response = await fetch(removeUrl, {
        method: 'DELETE',
      });

      console.log(`Remove API response status: ${response.status} ${response.statusText}`);
      
      const responseText = await response.text();
      console.log(`Raw response: ${responseText}`);
      
      let result;
      try {
        // Try to parse the response as JSON
        result = JSON.parse(responseText);
        console.log('Parsed response:', result);
      } catch (parseError) {
        console.error('Error parsing response as JSON:', parseError);
        console.log('Response was not valid JSON');
        
        if (!response.ok) {
          throw new Error(`Failed to remove file: ${response.status} ${response.statusText}`);
        }
      }
      
      if (!response.ok) {
        console.error('Error removing file from server:', result?.error || response.statusText);
        throw new Error(result?.error || `Failed to remove file: ${response.statusText}`);
      }
      
      console.log('File removed successfully:', result);
      
      // Remove from state on success
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (error) {
      console.error('Error removing file:', error);
      // Update status to error
      setFiles(prev => 
        prev.map(f => 
          f.id === fileId 
            ? { ...f, status: 'error' as FileStatus, error: error instanceof Error ? error.message : 'Unknown error' } 
            : f
        )
      );
    }
  };

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  // Render status icon based on file status
  const renderStatusIcon = (status: FileStatus) => {
    switch (status) {
      case 'parsing':
      case 'uploading':
      case 'processing':
        return <IconLoader2 className="animate-spin" size={16} />;
      case 'completed':
        return <IconCheck size={16} className="text-green-500" />;
      case 'error':
        return <IconX size={16} className="text-red-500" />;
      default:
        return <IconFile size={16} />;
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-white border-l border-gray-200">
      <div className="p-4 border-b border-gray-200">
        {/* Embedding model selector */}
        <div className="mb-4 relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">Embedding Model</label>
          <div className="relative">
            <button
              type="button"
              className="w-full bg-white border border-gray-300 rounded-md py-2 px-3 text-left text-sm flex justify-between items-center focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <span>{embeddingModel}</span>
              <IconChevronDown size={16} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md py-1 text-sm ring-1 ring-black ring-opacity-5 focus:outline-none">
                <button
                  className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${embeddingModel === 'text-embedding-3-large' ? 'bg-blue-50 text-blue-700' : ''}`}
                  onClick={() => {
                    setEmbeddingModel('text-embedding-3-large');
                    setDropdownOpen(false);
                  }}
                >
                  text-embedding-3-large
                </button>
                <button
                  className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${embeddingModel === 'text-embedding-3-large' ? 'bg-blue-50 text-blue-700' : ''}`}
                  onClick={() => {
                    setEmbeddingModel('text-embedding-3-large');
                    setDropdownOpen(false);
                  }}
                >
                  text-embedding-3-small
                </button>
                <button
                  className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${embeddingModel === 'text-embedding-ada-002' ? 'bg-blue-50 text-blue-700' : ''}`}
                  onClick={() => {
                    setEmbeddingModel('text-embedding-ada-002');
                    setDropdownOpen(false);
                  }}
                >
                  text-embedding-ada-002
                </button>
              </div>
            )}
          </div>
        </div>
        <h2 className="text-lg font-semibold">Document Library</h2>
        <p className="text-sm text-gray-500">Upload PDF files to enhance your chat experience</p>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center mb-4 p-4 bg-gray-50 rounded-lg">
          <IconLoader2 className="animate-spin mr-2" />
          <span>Loading previously uploaded files...</span>
        </div>
      )}

      {/* Upload area */}
      <div 
        className={cx(
          "m-4 p-4 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer",
          isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = 'application/pdf';
          input.onchange = (e) => handleFileSelect((e.target as HTMLInputElement).files);
          input.click();
        }}
      >
        <IconUpload className="text-gray-400 mb-2" size={24} />
        <p className="text-sm font-medium">Drag & drop PDF files here</p>
        <p className="text-xs text-gray-500">or click to browse</p>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-sm font-medium mb-2">Uploaded Files</h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-500">No files uploaded yet</p>
        ) : (
          <ul className="space-y-2">
            {files.map(file => (
              <li key={file.id} className="p-3 bg-gray-50 rounded-lg text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {renderStatusIcon(file.status)}
                    <span className="font-medium truncate max-w-[150px]">{file.name}</span>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.id, file.name);
                    }}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <IconX size={16} />
                  </button>
                </div>
                {file.status === 'error' && (
                  <p className="text-xs text-red-500 mt-1">{file.error}</p>
                )}
                {['parsing', 'uploading', 'processing'].includes(file.status) && (
                  <div className="mt-2">
                    {file.chunks && file.processedChunks !== undefined && (
                      <p className="text-xs text-gray-600 mb-1">
                        Processing chunks: {file.processedChunks}/{file.chunks}
                      </p>
                    )}
                    <div className="w-full h-1 bg-gray-200 rounded-full">
                      <div 
                        className={cx(
                          "h-full rounded-full transition-all duration-300",
                          file.status === 'parsing' ? "bg-yellow-500" : 
                          file.status === 'uploading' ? "bg-blue-500" : "bg-green-500"
                        )}
                        style={{ width: `${file.progress || 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FileUpload;