import { describe, expect, test } from "vitest";

import type { WorkbenchInspectionSnapshot } from "@workbench-ai/workbench-contract";

import {
  defaultPackageVersionId,
  orderedVersions,
  publishedVersionId,
} from "../src/lib/version-selection";

describe("package version selection", () => {
  test("uses an explicit route version before snapshot defaults", () => {
    expect(defaultPackageVersionId(snapshot({ currentVersionId: "v002", publishedVersionId: "v002" }), "v001"))
      .toBe("v001");
  });

  test("uses the project current version before publication metadata", () => {
    expect(defaultPackageVersionId(snapshot({ currentVersionId: "v001", publishedVersionId: "v002" })))
      .toBe("v001");
  });

  test("uses the current published version when no project current ref exists", () => {
    expect(defaultPackageVersionId(snapshot({ publishedVersionId: "v002" }))).toBe("v002");
  });

  test("falls back to the newest known version instead of the first stored version", () => {
    expect(defaultPackageVersionId(snapshot({}))).toBe("v002");
  });

  test("ignores invalid selected refs before falling back", () => {
    expect(defaultPackageVersionId(snapshot({ currentVersionId: "missing-current", publishedVersionId: "missing-published" }), "missing-route"))
      .toBe("v002");
  });

  test("orders versions newest first by created time with stable id tie-breaks", () => {
    expect(orderedVersions(snapshot({
      versions: [
        version("v002", "2026-06-06T00:05:00.000Z"),
        version("v003", "2026-06-06T00:05:00.000Z"),
        version("v001", "2026-06-06T00:00:00.000Z"),
      ],
    })).map((entry) => entry.id)).toEqual(["v002", "v003", "v001"]);
  });
});

function snapshot(input: {
  currentVersionId?: string;
  publishedVersionId?: string;
  refs?: Record<string, string>;
  versions?: WorkbenchInspectionSnapshot["versions"];
}): WorkbenchInspectionSnapshot {
  const versions = input.versions ?? [
    version("v001", "2026-06-06T00:00:00.000Z"),
    version("v002", "2026-06-06T00:05:00.000Z"),
  ];
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      ...(input.currentVersionId ? { currentVersionId: input.currentVersionId } : {}),
      runCount: 0,
    },
    versions,
    skillSources: [],
    skillBundles: [],
    evals: [],
    evalVersions: [],
    agents: [],
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
    remotes: [],
    refs: input.refs ?? {},
    ...(input.publishedVersionId
      ? {
          publication: {
            currentVersionId: input.publishedVersionId,
            publishedVersionIds: [input.publishedVersionId],
            installHandle: "acme/earnings",
          },
        }
      : {}),
  };
}

function version(id: string, createdAt: string): WorkbenchInspectionSnapshot["versions"][number] {
  return {
    id,
    hash: `hash_${id}`,
    message: id,
    parentIds: [],
    createdAt,
    files: [],
  };
}
