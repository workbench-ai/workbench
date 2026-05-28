import { describe, expect, test } from "vitest";

import {
  buildEvaluationCategoryAxisLayout,
  wrapEvaluationCategoryAxisLabel,
} from "../src/lib/evaluation-chart-labels";

describe("evaluation chart labels", () => {
  test("wraps long labels without truncating candidate names", () => {
    const label = "Claude Code w/ Opus 4.6 (Skill v3)";
    const lines = wrapEvaluationCategoryAxisLabel(label, 16);

    expect(lines.join(" ")).toBe(label);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).not.toContain("...");
  });

  test("sizes the category axis from the full labels", () => {
    const layout = buildEvaluationCategoryAxisLayout([
      "Codex w/ GPT-5.4 (Skill v3)",
      "Claude Code w/ Opus 4.6 (Skill v3)",
    ]);

    expect(layout.yAxisWidth).toBeGreaterThan(128);
    expect(layout.yAxisMaxCharsPerLine).toBeGreaterThanOrEqual(
      "Claude Code w/ Opus 4.6 (Skill v3)".length,
    );
  });
});
