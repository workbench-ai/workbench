import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, test, vi } from "vitest";
import { requestWorkbenchCloudJson } from "../src/cloud-json.ts";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Workbench Cloud JSON requests", () => {
  test("retries PUT transport and server failures with one byte-stable gzip body", async () => {
    vi.useFakeTimers();
    const bodies: Buffer[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(Buffer.from(init?.body as ArrayBuffer));
      if (bodies.length === 1) throw new Error("ECONNRESET");
      if (bodies.length === 2) return new Response("unavailable", { status: 503 });
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetch);
    const request = cloudRequest("PUT", { text: "x".repeat(1024 * 1024) });
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(JSON.parse(gunzipSync(bodies[0]!).toString("utf8"))).toEqual({ text: "x".repeat(1024 * 1024) });
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>)["content-encoding"]).toBe("gzip");
  });
  test.each([
    ["POST", 503],
    ["PUT", 400],
  ])("does not retry %s after a non-retryable HTTP %i", async (method, status) => {
    const fetch = vi.fn(async () => new Response("rejected", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(cloudRequest(method, { value: 1 })).rejects.toThrow(String(status));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
function cloudRequest(method: string, body: unknown) {
  return requestWorkbenchCloudJson<{ ok: boolean }>("https://cloud.test", "/api/workbench/test", {
    method,
    body,
    mapHttpError: ({ status }) => new Error(String(status)),
    mapTransportError: (error) => error as Error,
  });
}
