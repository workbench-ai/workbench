import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const productRoot = path.resolve(packageRoot, "..", "..");
export const workspaceRoot = path.resolve(productRoot, "..", "..");
export const builtCliEntryPath = path.join(packageRoot, "dist", "workbench.js");
