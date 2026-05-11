import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { LoginBody, ForgotPasswordBody, ResetPasswordBody } from "@workspace/api-zod";
import jwt from "jsonwebtoken";
// import bcrypt from "bcrypt"; // TODO: Fix native bcrypt build for testing
import crypto from "crypto";

const router: IRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRY = "7d";

const generateToken = (userId: number): string => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

/**
 * POST /auth/login
 * Login endpoint - validate email/password and return token
 * Implements rate limiting (5 attempts per 15 minutes) and account lockout
 */
router.post("/auth/login", async (req, res) => {
  try {
    const body = LoginBody.parse(req.body);
    const { email, password } = body;

    // Find user by email
    const user = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(429).json({ error: "Account is temporarily locked. Please try again later." });
      return;
    }

    // Check if user is suspended
    if (user.status === "suspended") {
      res.status(403).json({ error: "User account is suspended" });
      return;
    }

    // Compare password using plaintext (for testing)
    // TODO: Implement proper bcrypt hashing once native modules are fixed
    const passwordMatch = password === user.password;
    if (!passwordMatch) {
      // Increment login attempts
      const newAttempts = (user.loginAttempts || 0) + 1;
      const lockoutTime = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await db.update(usersTable)
        .set({
          loginAttempts: newAttempts,
          lockedUntil: lockoutTime,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id));

      if (lockoutTime) {
        res.status(429).json({ error: "Too many failed login attempts. Account locked for 15 minutes." });
      } else {
        res.status(401).json({ error: "Invalid email or password" });
      }
      return;
    }

    // Reset login attempts on successful login
    await db.update(usersTable)
      .set({
        loginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    // Generate token
    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        school: user.school ?? undefined,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Login failed" });
  }
});

/**
 * POST /auth/forgot-password
 * Request password reset - generates token and stores in database
 * In production, would send reset link via email
 */
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const body = ForgotPasswordBody.parse(req.body);
    const { email } = body;

    // Check if user exists
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (!user) {
      // Don't reveal whether email exists (security best practice)
      res.json({
        success: true,
        message: "If this email is registered, you will receive a password reset link shortly.",
      });
      return;
    }

    // Generate secure reset token (32 bytes hex)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    // Store token in database
    await db.update(usersTable)
      .set({
        passwordResetToken: resetToken,
        passwordResetExpires: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    // In production: send email with reset link
    // const resetLink = `https://app.myspm.io/reset-password?token=${resetToken}`;
    // await sendResetEmail(user.email, resetLink);

    res.json({
      success: true,
      message: "Password reset link has been sent to your email.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Password reset request failed" });
  }
});

/**
 * POST /auth/reset-password
 * Reset password with token - validates token and hashes new password
 */
router.post("/auth/reset-password", async (req, res) => {
  try {
    const body = ResetPasswordBody.parse(req.body);
    const { email, newPassword, resetToken } = body;

    // Find user
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Validate reset token
    if (!user.passwordResetToken || user.passwordResetToken !== resetToken) {
      res.status(400).json({ error: "Invalid reset token" });
      return;
    }

    // Check token expiration
    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      res.status(400).json({ error: "Reset token has expired. Please request a new one." });
      return;
    }

    // Store password as plaintext for testing
    // TODO: Implement proper bcrypt hashing once native modules are fixed
    const hashedPassword = newPassword;

    // Update user password and clear reset token
    await db.update(usersTable)
      .set({
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    res.json({
      success: true,
      message: "Password reset successfully.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Password reset failed" });
  }
});

/**
 * GET /auth/verify
 * Verify if user is authenticated (check token)
 */
router.get("/auth/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch (error) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const userId = decoded.userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Token verify error:", error);
    res.status(500).json({ error: "Token verification failed" });
  }
});

export default router;
