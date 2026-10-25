/**
 * Splits input text into smaller overlapping chunks.
 * @param {string} text - The input plain text
 * @param {number} size - Maximum characters per chunk (default 1000)
 * @param {number} overlap - Overlapping characters between consecutive chunks (default 200)
 * @returns {string[]} - Array of text chunks
 */
function chunkText(text, size = 1000, overlap = 200) {
  if (!text || typeof text !== "string") {
    return [];
  }

  // Normalize all whitespaces and newlines
  const cleanedText = text.replace(/\s+/g, " ").trim();

  const chunks = [];
  let index = 0;

  while (index < cleanedText.length) {
    // Slice a block of text of the specified size
    const chunk = cleanedText.substring(index, index + size);
    chunks.push(chunk);

    // Slide window forward by (size - overlap)
    index += (size - overlap);
  }

  return chunks;
}

/**
 * Splits array of page objects [{ page, text }] into chunks preserving page metadata.
 * @param {Array<{ page: number, text: string }>} pages - Array of page objects
 * @param {number} size - Maximum characters per chunk (default 1000)
 * @param {number} overlap - Overlap between consecutive chunks on the same page (default 200)
 * @returns {Array<{ text: string, page: number }>} - Array of chunk objects with page number
 */
function chunkPages(pages, size = 1000, overlap = 200) {
  if (!pages || !Array.isArray(pages)) {
    return [];
  }

  const results = [];
  for (const pageObj of pages) {
    const pageNum = pageObj.page || 1;
    const pageText = (pageObj.text || "").replace(/\s+/g, " ").trim();
    if (!pageText) continue;

    if (pageText.length <= size) {
      results.push({ text: pageText, page: pageNum });
    } else {
      const pageChunks = chunkText(pageText, size, overlap);
      for (const ch of pageChunks) {
        results.push({ text: ch, page: pageNum });
      }
    }
  }

  return results;
}

chunkText.chunkText = chunkText;
chunkText.chunkPages = chunkPages;

module.exports = chunkText;
