import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env");
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
  console.error("Error loading .env file:", dotenvResult.error);
}

const { default: app } = await import("./app");
const { pool } = await import("@workspace/db");
const { ragPool } = await import("./lib/ragDb");
const { ensureRagSchema } = await import("./database/initRagDatabase");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await pool.query("SELECT 1");
  console.info("Database connected");
} catch (error) {
  console.error("Database connection failed:", error);
  throw error;
}

try {
  await ragPool.query("SELECT 1");
  await ensureRagSchema();
  console.info("RAG database connected");
} catch (error) {
  console.error("RAG database connection failed:", error);
  throw error;
}

const server = app.listen(port, () => {
  console.info(`Server listening on port ${port}`);
});

// Handle errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
