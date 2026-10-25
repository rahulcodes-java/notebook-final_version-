const express = require("express");
const auth = require("../middleware/auth");
const fileController = require("../controllers/fileController");

const router = express.Router();

router.get("/files", auth, fileController.getFiles);
router.get("/files/public", fileController.getPublicFiles);
router.get("/files/download", fileController.downloadFile);

module.exports = router;
