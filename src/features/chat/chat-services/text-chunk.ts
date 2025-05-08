// Updated chunking parameters for text-embedding-3-small
const chunkSize = 4096; // Increased from 1000
const chunkOverlap = 500; // Increased from 200

/**
 * Splits a document into chunks of specified size with overlap between chunks
 * Optimized for text-embedding-3-small model
 */
export function chunkDocumentWithOverlap(document: string): string[] {
  const chunks: string[] = [];

  if (document.length <= chunkSize) {
    // If the document is smaller than the desired chunk size, return it as a single chunk.
    chunks.push(document);
    return chunks;
  }

  let startIndex = 0;

  // Split the document into chunks of the desired size, with overlap.
  while (startIndex < document.length) {
    const endIndex = Math.min(startIndex + chunkSize, document.length);
    
    // Get the chunk
    let chunk = document.substring(startIndex, endIndex);
    
    // Try to end chunks at natural boundaries like paragraph or sentence endings
    if (endIndex < document.length) {
      // Look for paragraph breaks first
      const paragraphBreakIndex = chunk.lastIndexOf('\n\n');
      // Look for single line breaks
      const lineBreakIndex = chunk.lastIndexOf('\n');
      // Look for sentence endings
      const sentenceEndIndex = Math.max(
        chunk.lastIndexOf('. '),
        chunk.lastIndexOf('! '),
        chunk.lastIndexOf('? ')
      );
      
      // Choose the most appropriate break point that's not too far from the end
      // Prefer paragraph breaks, then line breaks, then sentence endings
      // Only use break points that are at least 75% into the chunk to maintain meaningful size
      const minBreakPoint = Math.floor(chunkSize * 0.75);
      
      if (paragraphBreakIndex > minBreakPoint) {
        chunk = chunk.substring(0, paragraphBreakIndex + 2); // Include the paragraph break
        startIndex += paragraphBreakIndex + 2;
      } else if (lineBreakIndex > minBreakPoint) {
        chunk = chunk.substring(0, lineBreakIndex + 1); // Include the line break
        startIndex += lineBreakIndex + 1;
      } else if (sentenceEndIndex > minBreakPoint) {
        chunk = chunk.substring(0, sentenceEndIndex + 2); // Include the sentence ending and space
        startIndex += sentenceEndIndex + 2;
      } else {
        // If no natural break point is found, use the original chunk
        startIndex = endIndex - chunkOverlap;
      }
    } else {
      // This is the last chunk
      startIndex = endIndex;
    }
    
    // Add the chunk to the list
    chunks.push(chunk);
  }

  return chunks;
}