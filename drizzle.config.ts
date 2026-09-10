import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Match Next.js precedence for local CLI use; never overwrite exported variables.
const environment = process.env.NODE_ENV ?? "development";
config({
  path: [
    `.env.${environment}.local`,
    ...(environment === "test" ? [] : [".env.local"]),
    `.env.${environment}`,
    ".env",
  ],
});

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required. Configure .env.local before running Drizzle (see README.md).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url },
});
