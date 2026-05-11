import { describe, expect, test } from "vitest";

import {
  categoricalChartColors,
  getCategoricalChartColor,
  getSemanticChartColor,
  semanticChartColors,
} from "../lib/chart-colors";

describe("chart color helpers", () => {
  test("exposes the full categorical palette in order", () => {
    expect(categoricalChartColors).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-6)",
    ]);
  });

  test("wraps categorical chart colors safely", () => {
    expect(getCategoricalChartColor(0)).toBe("var(--chart-1)");
    expect(getCategoricalChartColor(5)).toBe("var(--chart-6)");
    expect(getCategoricalChartColor(6)).toBe("var(--chart-1)");
    expect(getCategoricalChartColor(-1)).toBe("var(--chart-6)");
    expect(getCategoricalChartColor(Number.NaN)).toBe("var(--chart-1)");
  });

  test("maps semantic roles to shared chart aliases", () => {
    expect(semanticChartColors).toEqual({
      performance: "var(--chart-performance)",
      speed: "var(--chart-speed)",
      cost: "var(--chart-cost)",
    });
    expect(getSemanticChartColor("performance")).toBe("var(--chart-performance)");
    expect(getSemanticChartColor("speed")).toBe("var(--chart-speed)");
    expect(getSemanticChartColor("cost")).toBe("var(--chart-cost)");
  });
});
