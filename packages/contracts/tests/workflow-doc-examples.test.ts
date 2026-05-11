import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  formatWorkflowValidationDiagnostics,
  stringifyWorkflowYaml,
  validateWorkflowSources,
} from "../src/index.js";

describe("workflow documentation examples", () => {
  test("validate checked-in workflow examples", async () => {
    const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/examples/workflows");
    const fileNames = (await fs.readdir(examplesRoot)).filter((name) => name.endsWith(".yaml")).sort();

    expect(fileNames.length).toBeGreaterThan(0);
    const inputs = await Promise.all(
      fileNames.map(async (fileName) => {
        const filePath = path.join(examplesRoot, fileName);
        return {
          file_path: filePath,
          source_yaml: await fs.readFile(filePath, "utf8"),
        };
      }),
    );
    const result = validateWorkflowSources(inputs);
    const fileFailures = result.files
      .filter((file) => !file.valid)
      .map((file) => `${path.basename(file.file_path ?? "<unknown>")}: ${formatWorkflowValidationDiagnostics(file.diagnostics)}`);
    const collectionFailures =
      result.diagnostics.length > 0 ? [formatWorkflowValidationDiagnostics(result.diagnostics)] : [];

    expect(result.valid, [...fileFailures, ...collectionFailures].join("\n")).toBe(true);
  });

  test("keep checked-in workflow examples in canonical YAML form", async () => {
    const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/examples/workflows");
    const fileNames = (await fs.readdir(examplesRoot)).filter((name) => name.endsWith(".yaml")).sort();
    const failures: string[] = [];

    for (const fileName of fileNames) {
      const filePath = path.join(examplesRoot, fileName);
      const sourceYaml = await fs.readFile(filePath, "utf8");
      const result = validateWorkflowSources([
        {
          file_path: filePath,
          source_yaml: sourceYaml,
        },
      ]);
      const fileResult = result.files[0];

      if (!result.valid || !fileResult?.valid || fileResult.document == null) {
        failures.push(`${fileName} must stay structurally valid before canonicalization checks run.`);
        continue;
      }

      const canonicalYaml = stringifyWorkflowYaml(fileResult.document);

      if (sourceYaml !== canonicalYaml) {
        failures.push(`${fileName} is not canonical.\n--- expected ---\n${canonicalYaml}\n--- actual ---\n${sourceYaml}`);
      }
    }

    expect(failures, failures.join("\n\n")).toEqual([]);
  });
});
