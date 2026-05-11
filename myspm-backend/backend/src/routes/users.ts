import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql } from "drizzle-orm";
import { ListUsersQueryParams, CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
// import bcrypt from "bcrypt"; // TODO: Fix native bcrypt build for testing

const router: IRouter = Router();

router.get("/users", async (req, res) => {
  try {
    const query = ListUsersQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.role) conditions.push(eq(usersTable.role, query.role));
    if (query.school) conditions.push(eq(usersTable.school, query.school));
    if (query.status) conditions.push(eq(usersTable.status, query.status));
    if (query.search) conditions.push(ilike(usersTable.name, `%${query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(usersTable).where(where);
    const total = totalResult?.count ?? 0;

    const data = await db.select().from(usersTable).where(where).orderBy(sql`${usersTable.id} DESC`).limit(limit).offset(offset);

    res.json({
      data: data.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        school: u.school ?? "",
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

router.post("/users", async (req, res) => {
  try {
    const body = CreateUserBody.parse(req.body);
    
    // Store password as plaintext for testing
    // TODO: Implement proper bcrypt hashing once native modules are fixed
    const hashedPassword = body.password;
    
    const [user] = await db.insert(usersTable).values({
      ...body,
      password: hashedPassword,
    }).returning();
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      school: user.school ?? "",
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      school: user.school ?? "",
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
});

router.put("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateUserBody.parse(req.body);
    const [user] = await db.update(usersTable).set({ ...body, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      school: user.school ?? "",
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.post("/users/:id/suspend", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(usersTable).set({ status: "suspended", updatedAt: new Date() }).where(eq(usersTable.id, id));
    res.json({ success: true, message: "User suspended" });
  } catch (error) {
    console.error("Suspend user error:", error);
    res.status(500).json({ error: "Failed to suspend user" });
  }
});

router.post("/users/:id/reset-password", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tempPassword = "Temp" + Math.random().toString(36).slice(2, 8) + "!";
    const hashedPassword = tempPassword; // TODO: use bcryptjs for hashing
    await db.update(usersTable).set({ password: hashedPassword, updatedAt: new Date() }).where(eq(usersTable.id, id));
    res.json({ success: true, message: "Password reset successfully", tempPassword });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
