import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.readFileSync(envPath, "utf-8");

const env = {};
envContent.split("\n").forEach((line) => {
  if (line && !line.startsWith("#")) {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join("=").trim();
    }
  }
});

const pgPath = path.join(
  __dirname,
  "..",
  "packages",
  "db",
  "node_modules",
  "pg",
  "esm",
  "index.mjs",
);
const pgUrl = new URL(`file:///${pgPath.replace(/\\/g, "/")}`).href;
const pgModule = await import(pgUrl);
const { Pool } = pgModule;

const url = new URL(env.DATABASE_URL);
const dbName = url.pathname.substring(1);
const adminUrl = new URL(env.DATABASE_URL);
adminUrl.pathname = "/postgres";

async function runMigration() {
  let adminPool;
  let pool;

  try {
    console.log("Connecting to PostgreSQL server...");
    adminPool = new Pool({
      connectionString: adminUrl.toString(),
    });

    const adminClient = await adminPool.connect();

    console.log(`Checking if database '${dbName}' exists...`);
    const dbExists = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName],
    );

    if (dbExists.rows.length === 0) {
      console.log(`Creating database '${dbName}'...`);
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created.`);
    } else {
      console.log(`Database '${dbName}' already exists.`);
    }

    adminClient.release();

    console.log(`Connecting to database '${dbName}'...`);
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });

    const client = await pool.connect();
    console.log("Connected successfully.");

    console.log("Creating tables...");

    const sqlFile = path.join(__dirname, "..", "sql", "create-schema.sql");
    const sql = fs.readFileSync(sqlFile, "utf-8");

    await client.query(sql);

    console.log("All tables created successfully.");

    const result = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`,
    );

    console.log("Created tables:");
    result.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    client.release();
  } catch (error) {
    console.error("Error:", error.message);
    if (error.detail) console.error("Details:", error.detail);
    process.exit(1);
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch {
        // ignore
      }
    }
    if (adminPool) {
      try {
        await adminPool.end();
      } catch {
        // ignore
      }
    }
  }
}

runMigration();
