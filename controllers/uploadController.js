const crypto = require("crypto");
const s3Service = require("../services/s3Service");
const dynamoService = require("../services/dynamoService");

/**
 * Get all subject folders from the S3 bucket
 */
async function getFolders(req, res) {
  try {
    const folders = await s3Service.listFolders("public/");
    return res.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch folders",
    });
  }
}

/**
 * Handle PDF uploading with authentication, duplicate hash checking, S3 storage, and metadata recording
 */
async function uploadPDF(req, res) {
  try {
    const file = req.file;
    const folder = req.body.folder;
    const userId = req.user.userId;
    const isPublic = req.body.isPublic === undefined || req.body.isPublic === "true" || req.body.isPublic === true;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    if (isPublic && !folder) {
      return res.status(400).json({
        success: false,
        error: "Folder is required for public files",
      });
    }

    // Generate SHA256 hash of the uploaded PDF file
    const hash = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex");

    // Check notebook-files table for duplicates
    const existingFile = await dynamoService.getFileByHash(hash);
    if (existingFile) {
      return res.status(200).json({
        success: false,
        message: "Duplicate PDF already exists",
      });
    }

    // Construct the unique file Key and folder
    const timestamp = Date.now();
    let key;
    let finalFolder;

    if (isPublic) {
      finalFolder = folder;
      key = `public/${finalFolder}/${timestamp}-${file.originalname}`;
    } else {
      finalFolder = userId;
      key = `private/${userId}/${timestamp}-${file.originalname}`;
    }

    // Upload to local storage
    await s3Service.uploadFile(key, file.buffer, file.mimetype);

    // Save metadata in database
    const metadata = {
      hash,
      filename: file.originalname,
      folder: finalFolder,
      uploadedBy: userId,
      uploadedAt: new Date().toISOString(),
      s3Key: key,
      isPublic: isPublic,
    };
    await dynamoService.saveFileMetadata(metadata);

    return res.status(201).json({
      success: true,
      message: "Upload successful",
      data: metadata,
    });
  } catch (error) {
    console.error("PDF Upload error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to upload file due to server error",
    });
  }
}

module.exports = {
  getFolders,
  uploadPDF,
};
