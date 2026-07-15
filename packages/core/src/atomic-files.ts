import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function writeFileAtomically(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
