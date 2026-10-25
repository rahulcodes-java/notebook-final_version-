const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const uploadController = require("../controllers/uploadController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/folders", uploadController.getFolders);
router.post("/upload", auth, upload.single("pdf"), uploadController.uploadPDF);

module.exports = router;
