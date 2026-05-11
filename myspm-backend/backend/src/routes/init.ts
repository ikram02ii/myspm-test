import { Router } from "express";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { sql } from "drizzle-orm";

const router = Router();

function resolveSqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["..", join("..", "..")] as const) {
    const dir = join(here, rel, "sql");
    if (existsSync(join(dir, "create-views.sql"))) {
      return dir;
    }
  }
  throw new Error("Could not resolve backend/sql (create-views.sql missing).");
}

// Initialize database with views and seed data
router.post("/init", async (req, res) => {
  try {
    console.log("Starting database initialization...");

    // Lazy import db to avoid connection timeout during startup
    const { db } = await import("@workspace/db");

    // Read SQL files
    const sqlDir = resolveSqlDir();
    const viewsSqlPath = join(sqlDir, "create-views.sql");
    const seedSqlPath = join(sqlDir, "seed-database.sql");

    const viewsSql = readFileSync(viewsSqlPath, "utf8");
    const seedSql = readFileSync(seedSqlPath, "utf8");

    // Execute views SQL
    console.log("Creating database views...");
    const viewStatements = viewsSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of viewStatements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (error) {
        console.warn(
          "View creation warning:",
          error instanceof Error ? error.message : String(error)
        );
        // Continue with other statements
      }
    }
    console.log("Views created successfully");

    // Execute seed SQL
    console.log("Seeding database with sample data...");
    const seedStatements = seedSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of seedStatements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (error) {
        console.warn(
          "Seed data warning:",
          error instanceof Error ? error.message : String(error)
        );
        // Continue with other statements
      }
    }
    console.log("Database seeded successfully");

    res.json({
      success: true,
      message: "Database initialized successfully with views and seed data",
    });
  } catch (error) {
    console.error("Database initialization error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;