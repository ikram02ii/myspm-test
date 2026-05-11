import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file manually
const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.readFileSync(envPath, "utf-8");

const newEnv = Object.assign({}, process.env);

envContent.split("\n").forEach((line) => {
  if (line && !line.startsWith("#")) {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").trim();
      newEnv[key.trim()] = value;
    }
  }
});

console.log("Environment loaded");
console.log("DATABASE_URL:", newEnv.DATABASE_URL);

try {
  console.log("Running Drizzle migrations...");
  execSync(
    "npx drizzle-kit push --config drizzle.config.ts",
    {
      cwd: path.join(__dirname, "..", "packages", "db"),
      stdio: "inherit",
      env: newEnv,
    }
  );
  console.log("All tables created successfully.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exit(1);
}
