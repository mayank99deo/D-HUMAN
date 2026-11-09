import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./lib/db/url.mjs";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl() ?? "" },
});
