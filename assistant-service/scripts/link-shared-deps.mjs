// The service imports ../src/lib/assistant/protocol.ts, which resolves its
// packages from the repo root. On a host that installs only this service
// (Render), link those packages from here; when the root is installed, do nothing.
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = ["zod"];

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootModules = path.resolve(serviceRoot, "..", "node_modules");

for (const name of SHARED) {
  const target = path.join(serviceRoot, "node_modules", name);
  const link = path.join(rootModules, name);
  if (existsSync(link) || !existsSync(target)) continue;
  mkdirSync(rootModules, { recursive: true });
  symlinkSync(target, link, "junction");
  console.log(`[link-shared-deps] ${name} -> ${path.relative(serviceRoot, target)}`);
}
