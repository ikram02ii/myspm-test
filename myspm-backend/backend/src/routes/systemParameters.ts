import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { systemParametersTable } from "@workspace/db/schema";
import { eq, ilike, and } from "drizzle-orm";
import { UpdateSystemParameterBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/system-parameters", async (req, res) => {
  try {
    const conditions = [];
    if (req.query.category) conditions.push(eq(systemParametersTable.category, req.query.category as string));
    if (req.query.search) conditions.push(ilike(systemParametersTable.name, `%${req.query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db.select().from(systemParametersTable).where(where).orderBy(systemParametersTable.category, systemParametersTable.name);

    res.json(
      data.map((p) => ({
        ...p,
        updatedAt: p.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("List parameters error:", error);
    res.status(500).json({ error: "Failed to list parameters" });
  }
});

router.put("/system-parameters/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateSystemParameterBody.parse(req.body);
    const [param] = await db
      .update(systemParametersTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(systemParametersTable.id, id))
      .returning();

    if (!param) {
      res.status(404).json({ error: "Parameter not found" });
      return;
    }

    res.json({ ...param, updatedAt: param.updatedAt.toISOString() });
  } catch (error) {
    console.error("Update parameter error:", error);
    res.status(500).json({ error: "Failed to update parameter" });
  }
});

export default router;
