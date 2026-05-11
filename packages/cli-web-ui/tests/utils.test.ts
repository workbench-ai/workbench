import { describe, expect, test } from "vitest";

import { cn } from "../lib/utils";

describe("cn", () => {
  test("merges tailwind classes with later values winning", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4");
  });
});
