import pg from "pg";
import * as dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new Client({ connectionString });

client
  .connect()
  .then(() => {
    console.log("Connected to database.");
    return client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  })
  .then((res) => {
    if (res.rows.length === 0) {
      console.log("No tables found in database.");
    } else {
      console.log("Tables:");
      res.rows.forEach((row) => console.log(`  - ${row.table_name}`));
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
