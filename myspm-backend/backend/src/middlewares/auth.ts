import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    name: string;
    email: string;
    role: "student" | "teacher" | "admin";
  };
}

/**
 * Authentication middleware - verifies JWT token and attaches user to request
 */
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Let CORS preflight pass without JWT.
    if (req.method === "OPTIONS") {
      next();
      return;
    }

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

    // Fetch user from database
    const [user] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(eq(usersTable.id, decoded.userId));

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Attach user to request with role type cast
    req.user = {
      ...user,
      role: user.role as "student" | "teacher" | "admin",
    };
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
};

/**
 * Authorization middleware - checks if user has required role(s)
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: "Insufficient permissions to access this resource",
      });
      return;
    }

    next();
  };
};
