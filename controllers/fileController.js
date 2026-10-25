const dynamoService = require("../services/dynamoService");
const s3Service = require("../services/s3Service");
const jwt = require("jsonwebtoken");

/**
 * Get all uploaded files list (accessible to owner/authenticated user)
 */
async function getFiles(req, res) {
  try {
    try {
      const files = await dynamoService.getAllFiles();
      
      // Filter out files that are private and not owned by the current user
      const allowedFiles = files.filter((file) => {
        const isFilePublic = file.isPublic !== false; // Default to public for legacy files
        const isOwner = file.uploadedBy === req.user.userId;
        return isFilePublic || isOwner;
      });

      // Map files to output the requested format
      const formattedFiles = allowedFiles.map((file) => ({
        filename: file.filename,
        folder: file.folder,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
        s3Key: file.s3Key,
        hash: file.hash,
        isPublic: file.isPublic !== false,
      }));

      return res.json(formattedFiles);
    } catch (dbError) {
      // If access is denied for scan on DynamoDB, fall back to listing objects via S3
      if (dbError.name === "AccessDeniedException" || dbError.code === "AccessDeniedException" || dbError.message.includes("is not authorized to perform")) {
        console.warn("DynamoDB Scan permission denied. Falling back to S3 object listing.");
        const publicFiles = await s3Service.listAllFiles("public/");
        let privateFiles = [];
        try {
          privateFiles = await s3Service.listAllFiles(`private/${req.user.userId}/`);
        } catch (s3Error) {
          console.warn(`S3 listing failed for private/${req.user.userId}/:`, s3Error.message);
        }
        return res.json([...publicFiles, ...privateFiles]);
      }
      throw dbError; // Rethrow other errors
    }
  } catch (error) {
    console.error("Error retrieving files list:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch files list",
    });
  }
}

/**
 * Get public files list (accessible without auth)
 */
async function getPublicFiles(req, res) {
  try {
    try {
      const files = await dynamoService.getAllFiles();
      const publicFiles = files.filter((file) => file.isPublic !== false);

      const formattedFiles = publicFiles.map((file) => ({
        filename: file.filename,
        folder: file.folder,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
        s3Key: file.s3Key,
        hash: file.hash,
        isPublic: true,
      }));

      return res.json(formattedFiles);
    } catch (dbError) {
      if (dbError.name === "AccessDeniedException" || dbError.code === "AccessDeniedException" || dbError.message.includes("is not authorized to perform")) {
        console.warn("DynamoDB Scan permission denied. Falling back to S3 public listing.");
        const publicFiles = await s3Service.listAllFiles("public/");
        return res.json(publicFiles);
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Error retrieving public files:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch public files",
    });
  }
}

/**
 * Download a file from S3 (checks auth dynamically if the file is private)
 */
async function downloadFile(req, res) {
  try {
    const { key, hash } = req.query;
    if (!key && !hash) {
      return res.status(400).json({
        success: false,
        error: "Missing 'key' or 'hash' parameter",
      });
    }

    let s3Key = key;
    let isPublic = false;
    let ownerId = null;
    let filename = "document.pdf";

    if (hash) {
      const file = await dynamoService.getFileByHash(hash);
      if (!file) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }
      s3Key = file.s3Key;
      isPublic = file.isPublic !== false;
      ownerId = file.uploadedBy;
      filename = file.filename;
    } else {
      if (s3Key.startsWith("public/")) {
        isPublic = true;
      } else if (s3Key.startsWith("private/")) {
        const parts = s3Key.split("/");
        ownerId = parts[1];
      }
      filename = s3Key.split("/").pop().replace(/^\d+-/, "");
    }

    // Auth check for private files
    if (!isPublic) {
      let tokenValue = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        tokenValue = authHeader.split(" ")[1];
      } else if (req.query.token) {
        tokenValue = req.query.token;
      }

      if (!tokenValue) {
        return res.status(401).json({
          success: false,
          error: "Authentication required for private files",
        });
      }

      try {
        const decoded = jwt.verify(tokenValue, process.env.JWT_SECRET);
        if (ownerId && decoded.userId !== ownerId) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this private file",
          });
        }
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: "Invalid or expired authorization token",
        });
      }
    }

    const buffer = await s3Service.downloadFile(s3Key);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Content-Type", "application/pdf");
    return res.send(buffer);
  } catch (error) {
    console.error("Error downloading file:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to download file",
    });
  }
}

module.exports = {
  getFiles,
  getPublicFiles,
  downloadFile,
};
