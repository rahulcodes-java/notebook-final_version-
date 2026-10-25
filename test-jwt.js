const jwt = require("jsonwebtoken");
require("dotenv").config({ path: ".env" });

const token = process.argv[2];
if (!token) {
  console.log("No token provided");
  process.exit(1);
}

try {
  console.log("Secret:", process.env.JWT_SECRET);
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  console.log("Decoded:", decoded);
} catch (err) {
  console.error("JWT verification failed:", err.message);
}
