import { describe, expect, test } from "vitest";

import {
  humanFormatOptions,
  renderTable,
  stripAnsi,
  styleStatus,
} from "../src/human-format.ts";

describe("Workbench CLI human formatting", () => {
  test("renders borderless aligned tables", () => {
    const table = renderTable([
      { name: "earnings", status: "succeeded", score: "1.000" },
      { name: "longer-skill", status: "failed", score: "0.250" },
    ], [
      { header: "name", cell: (row) => row.name },
      { header: "status", cell: (row) => row.status },
      { header: "score", align: "right", cell: (row) => row.score },
    ]);

    expect(table).toBe([
      "name          status     score",
      "earnings      succeeded  1.000",
      "longer-skill  failed     0.250",
    ].join("\n"));
  });

  test("colors only when terminal color is enabled", () => {
    const previousNoColor = process.env.NO_COLOR;
    const previousForceColor = process.env.FORCE_COLOR;
    try {
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;
      expect(styleStatus("failed", humanFormatOptions({ isTTY: false }))).toBe("failed");

      process.env.FORCE_COLOR = "1";
      const colored = styleStatus("failed", humanFormatOptions({ isTTY: false }));
      expect(colored).not.toBe("failed");
      expect(stripAnsi(colored)).toBe("failed");

      process.env.NO_COLOR = "1";
      expect(styleStatus("failed", humanFormatOptions({ isTTY: true }))).toBe("failed");
    } finally {
      restoreEnv("NO_COLOR", previousNoColor);
      restoreEnv("FORCE_COLOR", previousForceColor);
    }
  });
});

function restoreEnv(name: "NO_COLOR" | "FORCE_COLOR", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
