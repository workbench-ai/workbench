import { describe, expect, test } from "vitest";

import { workbenchResponseErrorMessage } from "../src/lib/operations";

describe("Workbench response errors", () => {
  test.each([
    [new Response('{"message":"Case source is invalid."}', { status: 400 }), "Case source is invalid."],
    [new Response("gateway unavailable", { status: 502 }), "gateway unavailable"],
    [new Response("", { status: 503, statusText: "Service Unavailable" }), "Service Unavailable"],
    [new Response("", { status: 499 }), "HTTP 499"],
  ])("reads the canonical error message", async (response, expected) => {
    await expect(workbenchResponseErrorMessage(response)).resolves.toBe(expected);
  });
});
