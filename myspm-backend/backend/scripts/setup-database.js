import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, "..", ".env") });

const DATABASE_URL = process.env.DATABASE_URL;

async function setupDatabase() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log("Connecting to database...");
    const client = await pool.connect();
    console.log("Connected successfully.");

    const sqlDir = join(__dirname, "..", "sql");

    console.log("Creating database views...");
    const viewsSql = readFileSync(join(sqlDir, "create-views.sql"), "utf8");
    await client.query(viewsSql);
    console.log("Views created successfully.");

    console.log("Seeding database with sample data...");
    const seedSql = readFileSync(join(sqlDir, "seed-database.sql"), "utf8");
    await client.query(seedSql);
    console.log("Database seeded successfully.");

    client.release();
    console.log("Database setup completed.");
  } catch (error) {
    console.error("Error setting up database:", error.message);
    if (error.detail) {
      console.error("Details:", error.detail);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
