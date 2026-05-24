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
const { ragPool, isRagDatabaseConfigured } = await import("./lib/ragDb");
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

const ragDbOptional = process.env["RAG_DB_OPTIONAL"] === "true";
if (isRagDatabaseConfigured() && ragPool) {
  try {
    await ragPool.query("SELECT 1");
    await ensureRagSchema();
    console.info("RAG database connected");
  } catch (error) {
    if (ragDbOptional) {
      console.warn(
        "RAG database unavailable — continuing without it. " +
          "Textbook/RAG generate needs a working RAG_DATABASE_URL or local Postgres on port 5432.",
      );
    } else {
      console.error("RAG database connection failed:", error);
      throw error;
    }
  }
} else if (ragDbOptional) {
  console.info(
    "RAG database not configured — skipping. Set RAG_DATABASE_URL in .env to enable textbook/RAG features.",
  );
} else {
  throw new Error(
    "RAG database is required. Set RAG_DATABASE_URL or RAG_DB_USER/RAG_DB_PASSWORD in .env, or set RAG_DB_OPTIONAL=true for dev.",
  );
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

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other process (e.g. taskkill /PID <pid> /F) or change PORT in .env.`,
    );
    process.exit(1);
  }
  console.error("Server error:", error);
  process.exit(1);
});
