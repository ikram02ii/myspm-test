import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { lovCategoriesTable, lovValuesTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
import { CreateLovValueBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/lov/categories", async (_req, res) => {
  try {
    const categories = await db.select().from(lovCategoriesTable).orderBy(lovCategoriesTable.name);
    const categoriesWithCount = await Promise.all(
      categories.map(async (cat) => {
        const [valCount] = await db.select({ count: count() }).from(lovValuesTable).where(eq(lovValuesTable.categoryId, cat.id));
        return { ...cat, valueCount: valCount?.count ?? 0 };
      })
    );
    res.json(categoriesWithCount);
  } catch (error) {
    console.error("List categories error:", error);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

router.get("/lov/categories/:categoryId/values", async (req, res) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const values = await db.select().from(lovValuesTable).where(eq(lovValuesTable.categoryId, categoryId)).orderBy(lovValuesTable.sortOrder);
    res.json(values);
  } catch (error) {
    console.error("List values error:", error);
    res.status(500).json({ error: "Failed to list values" });
  }
});

router.post("/lov/categories/:categoryId/values", async (req, res) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const body = CreateLovValueBody.parse(req.body);
    const [value] = await db.insert(lovValuesTable).values({ ...body, categoryId }).returning();
    res.status(201).json(value);
  } catch (error) {
    console.error("Create value error:", error);
    res.status(500).json({ error: "Failed to create value" });
  }
});

router.put("/lov/values/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = CreateLovValueBody.parse(req.body);
    const [value] = await db.update(lovValuesTable).set(body).where(eq(lovValuesTable.id, id)).returning();
    if (!value) {
      res.status(404).json({ error: "Value not found" });
      return;
    }
    res.json(value);
  } catch (error) {
    console.error("Update value error:", error);
    res.status(500).json({ error: "Failed to update value" });
  }
});

router.post("/lov/values/:id/toggle", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [current] = await db.select().from(lovValuesTable).where(eq(lovValuesTable.id, id));
    if (!current) {
      res.status(404).json({ error: "Value not found" });
      return;
    }

    const newStatus = current.status === "active" ? "inactive" : "active";
    await db.update(lovValuesTable).set({ status: newStatus }).where(eq(lovValuesTable.id, id));
    res.json({ success: true, message: `Value ${newStatus}` });
  } catch (error) {
    console.error("Toggle value error:", error);
    res.status(500).json({ error: "Failed to toggle value" });
  }
});

export default router;
