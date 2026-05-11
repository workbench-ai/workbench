import { describe, expect, test } from "vitest";

import { formatWorkbenchTitle } from "../lib/workbench-title";

describe("workbench title formatter", () => {
  test("joins the workbench product title with non-empty sections", () => {
    expect(
      formatWorkbenchTitle({
        product: "Workbench",
        sections: ["Archive", "Overview"],
      }),
    ).toBe("Workbench · Archive · Overview");
  });

  test("drops empty sections so products can pass optional route labels", () => {
    expect(
      formatWorkbenchTitle({
        product: "Flow",
        sections: ["", null, "Executions", undefined, false],
      }),
    ).toBe("Workbench Flow · Executions");
  });
});
