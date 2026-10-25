const pdf = require("pdf-parse");
const mammoth = require("mammoth");

/**
 * Extracts plain text from a raw PDF, DOCX, or TXT file buffer.
 * @param {Buffer} fileBuffer - Binary buffer of the file
 * @returns {Promise<string>} - Extracted text contents
 */
async function extractText(fileBuffer) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error("Invalid file buffer provided");
  }

  // Check magic bytes for PDF format (%PDF)
  const isPdf = fileBuffer.toString("utf-8", 0, 4) === "%PDF";
  
  // Check magic bytes for ZIP/DOCX format (PK\x03\x04)
  const isDocx = fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B && fileBuffer[2] === 0x03 && fileBuffer[3] === 0x04;

  if (isPdf) {
    try {
      const data = await pdf(fileBuffer);
      return data.text || "";
    } catch (error) {
      console.error("Failed to parse PDF buffer:", error);
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  } else if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value || "";
    } catch (error) {
      console.error("Failed to parse Word document buffer:", error);
      throw new Error(`Word document parsing failed: ${error.message}`);
    }
  } else {
    // Treat as plain text
    try {
      return fileBuffer.toString("utf-8");
    } catch (error) {
      console.error("Failed to parse text buffer:", error);
      throw new Error(`Text parsing failed: ${error.message}`);
    }
  }
}

/**
 * Extracts text page-by-page from a PDF buffer, returning array of { page, text }.
 * For non-PDF files, returns a single page with all text.
 * @param {Buffer} fileBuffer - Binary buffer of the file
 * @returns {Promise<Array<{ page: number, text: string }>>} - Extracted pages with 1-based page numbers
 */
async function extractPages(fileBuffer) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error("Invalid file buffer provided");
  }

  const isPdf = fileBuffer.toString("utf-8", 0, 4) === "%PDF";

  if (isPdf) {
    try {
      const pages = [];
      await pdf(fileBuffer, {
        pagerender: (pageData) => {
          return pageData.getTextContent().then((textContent) => {
            const pageText = textContent.items.map((item) => item.str).join(" ");
            pages.push({
              page: pageData.pageIndex + 1,
              text: pageText.trim(),
            });
            return pageText;
          });
        },
      });

      pages.sort((a, b) => a.page - b.page);
      const filtered = pages.filter((p) => p.text.length > 0);
      if (filtered.length > 0) {
        return filtered;
      }
    } catch (error) {
      console.warn("[pdfExtractor] Page-by-page extraction failed, falling back to full text:", error.message);
    }
  }

  // Fallback or non-PDF: extract full text and treat as single page 1
  const fullText = await extractText(fileBuffer);
  return [{ page: 1, text: fullText }];
}

module.exports = {
  extractText,
  extractPages,
};


