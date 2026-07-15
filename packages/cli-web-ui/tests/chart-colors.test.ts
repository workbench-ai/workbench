import { describe, expect, test } from "vitest";

import {
  categoricalChartColors,
  getCategoricalChartColor,
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

});
