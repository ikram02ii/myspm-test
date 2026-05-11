import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { rolesTable, rolePermissionsTable, usersTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
import { CreateRoleBody, UpdateRolePermissionsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/roles", async (_req, res) => {
  try {
    const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
    const rolesWithCount = await Promise.all(
      roles.map(async (role) => {
        const [userCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, role.name.toLowerCase()));
        return {
          ...role,
          userCount: userCount?.count ?? 0,
          createdAt: role.createdAt.toISOString(),
        };
      })
    );
    res.json(rolesWithCount);
  } catch (error) {
    console.error("List roles error:", error);
    res.status(500).json({ error: "Failed to list roles" });
  }
});

router.post("/roles", async (req, res) => {
  try {
    const body = CreateRoleBody.parse(req.body);
    const [role] = await db.insert(rolesTable).values(body).returning();

    const modules = ["Question Bank", "Exams", "Assignments", "Users", "System Configuration"];
    for (const mod of modules) {
      await db.insert(rolePermissionsTable).values({
        roleId: role.id,
        module: mod,
        canView: false,
        canCreate: false,
        canEdit: false,
        canDelete: false,
      });
    }

    res.status(201).json({
      ...role,
      userCount: 0,
      createdAt: role.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Create role error:", error);
    res.status(500).json({ error: "Failed to create role" });
  }
});

router.get("/roles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    const permissions = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));

    res.json({
      ...role,
      createdAt: role.createdAt.toISOString(),
      permissions: permissions.map((p) => ({
        module: p.module,
        canView: p.canView,
        canCreate: p.canCreate,
        canEdit: p.canEdit,
        canDelete: p.canDelete,
      })),
    });
  } catch (error) {
    console.error("Get role error:", error);
    res.status(500).json({ error: "Failed to get role" });
  }
});

router.put("/roles/:id/permissions", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateRolePermissionsBody.parse(req.body);

    await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));

    for (const perm of body.permissions) {
      await db.insert(rolePermissionsTable).values({
        roleId: id,
        module: perm.module,
        canView: perm.canView,
        canCreate: perm.canCreate,
        canEdit: perm.canEdit,
        canDelete: perm.canDelete,
      });
    }

    res.json({ success: true, message: "Permissions updated" });
  } catch (error) {
    console.error("Update permissions error:", error);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

export default router;
