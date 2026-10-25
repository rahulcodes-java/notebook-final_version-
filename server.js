const path = require("path");
// Ensure environment variables are loaded relative to server.js
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const fileRoutes = require("./routes/fileRoutes");
const chatRoutes = require("./routes/chatRoutes");
const chromaService = require("./services/chromaService");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable Cross-Origin Resource Sharing
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Register routers
app.use("/", authRoutes);
app.use("/", uploadRoutes);
app.use("/", fileRoutes);
app.use("/", chatRoutes);

// Fallback home page redirect or direct message
app.get("/api-status", (req, res) => {
  res.json({ status: "running", timestamp: new Date().toISOString() });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({
    success: false,
    error: "An unexpected internal server error occurred",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to view the application.`);
  
  // Asynchronously synchronize files from local storage to local fallback database on server start
  setTimeout(() => {
    chromaService.syncExistingFiles().catch((err) => {
      console.error("[Startup Sync] Fallback database synchronization failed:", err.message);
    });
  }, 1000);
});
