import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";

const router: IRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");
const JWT_EXPIRY = "7d";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const generateToken = (userId: number): string => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

/** Students without school_id need post-login onboarding; teachers/admins skip. */
function studentNeedsMobileOnboarding(user: { role: string; school: number | null }): boolean {
  if (user.role !== "student") return false;
  return user.school == null;
}

const MobileSignUpBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
  school: z.string().optional(),
});

const MobileGoogleSignUpBody = z.object({
  idToken: z.string().min(1),
  school: z.string().optional(),
});

router.post("/auth/login", async (req, res) => {
  try {
    const body = LoginBody.parse(req.body);
    const { email, password } = body;

    const user = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(429).json({ error: "Account is temporarily locked. Please try again later." });
      return;
    }

    if (user.status === "suspended") {
      res.status(403).json({ error: "User account is suspended" });
      return;
    }

    const passwordMatch = password === user.password;
    if (!passwordMatch) {
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

    await db.update(usersTable)
      .set({
        loginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    const token = generateToken(user.id);

    res.json({
      token,
      needsOnboarding: studentNeedsMobileOnboarding(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        school: user.school ?? undefined,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/signup", async (req, res) => {
  try {
    const body = MobileSignUpBody.parse(req.body);
    const email = body.email.trim().toLowerCase();

    const existingUser = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
    if (existingUser) {
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    const inserted = await db
      .insert(usersTable)
      .values({
        name: body.name.trim(),
        email,
        password: body.password,
        role: "student",
        school: body.school?.trim() || null,
        status: "active",
      })
      .returning();

    const createdUser = inserted[0];
    const token = generateToken(createdUser.id);

    res.status(201).json({
      token,
      needsOnboarding: studentNeedsMobileOnboarding(createdUser),
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
        school: createdUser.school ?? undefined,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/google", async (req, res) => {
  try {
    const body = MobileGoogleSignUpBody.parse(req.body);
    if (!GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: "Google OAuth is not configured" });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: body.idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      res.status(400).json({ error: "Invalid Google identity payload" });
      return;
    }

    const oauthId = payload.sub.trim();
    const email = payload.email.trim().toLowerCase();
    const name = (payload.name ?? payload.email).trim();

    const existingGoogleUser = (
      await db.select().from(usersTable).where(
        and(eq(usersTable.oauthProvider, "google"), eq(usersTable.oauthId, oauthId))
      )
    )[0];

    if (existingGoogleUser) {
      await db.update(usersTable)
        .set({
          lastLogin: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingGoogleUser.id));

      const token = generateToken(existingGoogleUser.id);
      res.json({
        token,
        needsOnboarding: studentNeedsMobileOnboarding(existingGoogleUser),
        user: {
          id: existingGoogleUser.id,
          name: existingGoogleUser.name,
          email: existingGoogleUser.email,
          role: existingGoogleUser.role,
          school: existingGoogleUser.school ?? undefined,
        },
      });
      return;
    }

    const existingEmailUser = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
    if (existingEmailUser) {
      await db.update(usersTable)
        .set({
          name,
          oauthProvider: "google",
          oauthId,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          lastLogin: new Date(),
          loginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingEmailUser.id));

      const token = generateToken(existingEmailUser.id);
      res.json({
        token,
        needsOnboarding: studentNeedsMobileOnboarding(existingEmailUser),
        user: {
          id: existingEmailUser.id,
          name,
          email: existingEmailUser.email,
          role: existingEmailUser.role,
          school: existingEmailUser.school ?? undefined,
        },
      });
      return;
    }

    const inserted = await db
      .insert(usersTable)
      .values({
        name,
        email,
        password: "",
        role: "student",
        school: body.school?.trim() || null,
        status: "active",
        oauthProvider: "google",
        oauthId,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      })
      .returning();

    const createdUser = inserted[0];
    const token = generateToken(createdUser.id);

    res.status(201).json({
      token,
      needsOnboarding: studentNeedsMobileOnboarding(createdUser),
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
        school: createdUser.school ?? undefined,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
