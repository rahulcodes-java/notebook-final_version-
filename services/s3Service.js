const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

// Ensure uploads directory exists
if (!fsSync.existsSync(UPLOADS_DIR)) {
  fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Upload a file buffer to local storage
 * @param {string} key - Object key (path)
 * @param {Buffer} buffer - File buffer to upload
 * @param {string} mimetype - Content type of the file
 * @returns {Promise<Object>} - Success response
 */
async function uploadFile(key, buffer, mimetype) {
  const fullPath = path.join(UPLOADS_DIR, key);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return { success: true, key };
}

/**
 * List prefixes (folders) under a path in local storage
 * @param {string} prefix - The parent prefix folder (default "public/")
 * @returns {Promise<string[]>} - Array of folder names
 */
async function listFolders(prefix = "public/") {
  const dirPath = path.join(UPLOADS_DIR, prefix);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    return [];
  }
}

/**
 * List all objects under a prefix from local storage, parsed into file metadata
 * @param {string} prefix
 * @returns {Promise<Object[]>}
 */
async function listAllFiles(prefix = "public/") {
  const dirPath = path.join(UPLOADS_DIR, prefix);
  const items = [];
  
  async function scan(currentDir, currentPrefix) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const resPath = path.join(currentDir, entry.name);
        // Reconstruct the key with forward slashes for cross-platform consistency
        const resKey = currentPrefix + entry.name;
        
        if (entry.isDirectory()) {
          await scan(resPath, resKey + "/");
        } else {
          const stat = await fs.stat(resPath);
          const parts = resKey.split("/");
          let folder = "unknown";
          let filename = resKey;
          let uploadedAt = stat.mtime ? stat.mtime.toISOString() : new Date().toISOString();
          let uploadedBy = "unknown";

          if (parts.length >= 3) {
            folder = parts[1];
            if (parts[0] === "private") {
              uploadedBy = parts[1];
            }
            const filePart = parts[2];
            const hyphenIdx = filePart.indexOf("-");
            if (hyphenIdx !== -1) {
              const timestampStr = filePart.substring(0, hyphenIdx);
              const parsedTime = Number(timestampStr);
              if (!isNaN(parsedTime)) {
                uploadedAt = new Date(parsedTime).toISOString();
              }
              filename = filePart.substring(hyphenIdx + 1);
            } else {
              filename = filePart;
            }
          }

          items.push({
            filename,
            folder,
            uploadedBy,
            uploadedAt,
            s3Key: resKey,
          });
        }
      }
    } catch (err) {
      // Ignore if directory doesn't exist
    }
  }
  
  await scan(dirPath, prefix);
  return items;
}

/**
 * Downloads a file from local storage as a binary buffer
 * @param {string} key - Object key
 * @returns {Promise<Buffer>} - File buffer
 */
async function downloadFile(key) {
  const fullPath = path.join(UPLOADS_DIR, key);
  return fs.readFile(fullPath);
}

module.exports = {
  uploadFile,
  listFolders,
  listAllFiles,
  downloadFile,
};
