import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const scriptPath = path.resolve(import.meta.dirname, "../scripts/verify-shadcn-consumers.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture(name: string, source: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "shadcn-consumer-audit-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  writeFileSync(filePath, source);
  return filePath;
}

describe("shared shadcn consumer audit", () => {
  test("accepts shared controls with required item groups", () => {
    const filePath = fixture("valid.tsx", `
      export function Valid() {
        return (
          <Field>
            <FieldLabel htmlFor="kind">Kind</FieldLabel>
            <Select>
              <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="one">One</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
        );
      }
    `);

    const output = execFileSync(process.execPath, [scriptPath, "--files", filePath], { encoding: "utf8" });
    expect(output).toContain("Shared shadcn consumer audit passed");
  });

  test("rejects native controls, manual pressed state, and ungrouped items", () => {
    const filePath = fixture("invalid.tsx", `
      export function Invalid() {
        return <><select><option>One</option></select><Button aria-pressed /><SelectItem value="one">One</SelectItem></>;
      }
    `);

    const result = spawnSync(process.execPath, [scriptPath, "--files", filePath], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("shared shadcn Select component instead of <select>");
    expect(result.stderr).toContain("shared shadcn SelectItem component instead of <option>");
    expect(result.stderr).toContain("Toggle or ToggleGroup");
    expect(result.stderr).toContain("SelectItem must be nested inside SelectGroup");
  });
});
