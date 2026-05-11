import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import { sql } from "drizzle-orm";
import * as schema from "../packages/db/src/schema/index.ts";

config();

const { Pool } = pkg;

async function createTables() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL not set in environment");
  }

  console.log("Connecting to database...");
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    const db = drizzle(pool);

    // Get all tables from schema
    const tables = Object.values(schema).filter(
      (val) => val && typeof val === "object" && val._ && val._.name
    );

    console.log(`Found ${tables.length} tables to create`);

    // Create each table
    for (const table of tables) {
      try {
        console.log(`Creating table: ${table._.name}`);
        await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ${table._.name} ()`);
      } catch (err) {
        console.error(`Error creating table ${table._.name}:`, err.message);
      }
    }

    console.log("Tables created successfully.");
  } finally {
    await pool.end();
  }
}

createTables().catch(console.error);
