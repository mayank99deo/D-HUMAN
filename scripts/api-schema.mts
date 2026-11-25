// Writes the apps' contract, docs/api/openapi.json, from the zod schemas (lib/api/openapi.ts).
// Run it after changing lib/api/schemas.ts or the route table, and bump CONTRACT_VERSION when
// a client could see the change: tests/app-contract.test.ts fails until the file matches.
//   node scripts/api-schema.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openapi } from "../lib/api/openapi.ts";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/api/openapi.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(openapi(), null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
