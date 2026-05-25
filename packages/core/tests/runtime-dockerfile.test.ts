import { describe, expect, test } from "vitest";

import { composeRuntimeDockerfileWithAdapterInstallers } from "../src/index.ts";

describe("runtime Dockerfile composition", () => {
  test("restores the authored final runtime user after adapter setup", () => {
    const dockerfile = [
      "FROM debian:12",
      "RUN useradd -m app",
      "USER app",
      "WORKDIR /workspace",
      "",
    ].join("\n");

    const composed = composeRuntimeDockerfileWithAdapterInstallers(dockerfile, [{
      id: "codex",
      source: "catalog:codex",
      setup: ["npm install -g @openai/codex"],
    }]);

    expect(composed).toContain("USER root\n\n# Adapter: codex");
    expect(composed).toContain("# Restore benchmark runtime user.\nUSER app\nWORKDIR /workspace");
  });

  test("does not add a user directive when the authored Dockerfile has none", () => {
    const composed = composeRuntimeDockerfileWithAdapterInstallers("FROM debian:12\n", [{
      id: "command",
      source: "catalog:command",
      setup: ["true"],
    }]);

    expect(composed).toContain("USER root");
    expect(composed).not.toContain("# Restore benchmark runtime user.");
  });
});
