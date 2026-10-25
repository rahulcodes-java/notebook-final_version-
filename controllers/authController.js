const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dynamoService = require("../services/dynamoService");

/**
 * Handle user registration
 */
async function register(req, res) {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        error: "userId and password are required",
      });
    }

    // Check if user already exists
    const existingUser = await dynamoService.getUser(userId);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "User already exists",
      });
    }

    // Hash password with bcrypt (salt rounds = 10)
    const passwordHash = await bcrypt.hash(password, 10);

    // Save in DynamoDB 'users' table
    const createdUser = await dynamoService.createUser(userId, passwordHash);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      userId: createdUser.userId,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      error: "Registration failed due to server error",
    });
  }
}

/**
 * Handle user login
 */
async function login(req, res) {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        error: "userId and password are required",
      });
    }

    // Fetch user from database
    const user = await dynamoService.getUser(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid userId or password",
      });
    }

    // Verify bcrypt hash
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Invalid userId or password",
      });
    }

    // Generate JWT token with 7-day expiration
    const token = jwt.sign(
      { userId: user.userId },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      error: "Login failed due to server error",
    });
  }
}

module.exports = {
  register,
  login,
};
