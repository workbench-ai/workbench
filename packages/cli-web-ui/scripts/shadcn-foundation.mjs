import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
export const FOUNDATION_CACHE_VERSION = "2026-04-19.1"
export const FOUNDATION_METADATA_PATH = "shadcn.foundation.json"
export const PRESET_CSS_PATH = "styles/preset.css"
export const EXTRA_FOUNDATION_TARGETS = [
  { item: "use-mobile", targetPath: "hooks/use-mobile.ts" },
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep)
}

export function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n")
}

export function canonicalizeTextContent(value) {
  return `${normalizeNewlines(value).trimEnd()}\n`
}

export function stripOptionalUseClientDirective(value) {
  return normalizeNewlines(value).replace(/^(["'])use client\1\n\n/, "")
}

export function canonicalizeFoundationContent(value) {
  return canonicalizeTextContent(stripOptionalUseClientDirective(value))
}

export function buildFoundationTargets(info) {
  return [
    ...[...info.components].sort().map((item) => ({
      item,
      targetPath: `components/ui/${item}.tsx`,
    })),
    ...EXTRA_FOUNDATION_TARGETS,
  ]
}

export async function readActualUiComponentNames(packageRoot) {
  const uiDirectory = path.join(packageRoot, "components", "ui")
  const entries = await readdir(uiDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.replace(/\.tsx$/, ""))
    .sort()
}

export function rewriteConfiguredAliasesToRelative(content, { targetPath, aliases }) {
  const targetDirectory = path.posix.dirname(toPosixPath(targetPath))
  const aliasEntries = Object.values(aliases)
    .map((aliasPath) => ({
      aliasPath,
      repoRelativePath: aliasPath.replace(/^@\//, ""),
    }))
    .sort((left, right) => right.aliasPath.length - left.aliasPath.length)

  return aliasEntries.reduce((rewritten, { aliasPath, repoRelativePath }) => {
    const matcher = new RegExp(`(["'])${escapeRegExp(aliasPath)}([^"'\\n]*)\\1`, "g")
    return rewritten.replace(matcher, (fullMatch, quote, suffix = "") => {
      const suffixPath = suffix.replace(/^\/+/, "")
      const repoTarget = suffixPath
        ? path.posix.join(repoRelativePath, suffixPath)
        : repoRelativePath
      const relativeTarget = path.posix.relative(targetDirectory, repoTarget)
      const importPath = relativeTarget.startsWith(".")
        ? relativeTarget
        : `./${relativeTarget}`
      return `${quote}${importPath}${quote}`
    })
  }, normalizeNewlines(content))
}

export function extractShadcnAddViewBody(output) {
  const lines = normalizeNewlines(output).split("\n")
  const bodyStart = lines.findIndex((line) => line.startsWith("│ ┌"))
  const bodyEnd = lines.findIndex(
    (line, index) => index > bodyStart && line.startsWith("│ └")
  )

  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) {
    throw new Error("Could not locate shadcn view body in CLI output.")
  }

  return lines
    .slice(bodyStart + 1, bodyEnd)
    .map((line) => {
      const match = line.match(/^│ │ ?(.*)$/)
      if (!match) {
        throw new Error(`Unexpected shadcn view line: ${JSON.stringify(line)}`)
      }
      return match[1]
    })
    .join("\n")
}

export async function runPnpm(packageRoot, args) {
  const { stdout } = await execFileAsync(PNPM_BIN, args, {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

export async function loadShadcnInfo(packageRoot) {
  const stdout = await runPnpm(packageRoot, ["exec", "shadcn", "info", "--json"])
  return JSON.parse(stdout)
}

export async function loadFoundationMetadata(packageRoot) {
  const raw = await readFile(path.join(packageRoot, FOUNDATION_METADATA_PATH), "utf8")
  return JSON.parse(raw)
}

export async function loadExpectedPresetArtifacts(packageRoot) {
  const metadata = await loadFoundationMetadata(packageRoot)
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "workbench-shadcn-foundation-")
  )
  const scaffoldName = "preset-scaffold"
  const scaffoldRoot = path.join(temporaryRoot, scaffoldName)

  try {
    await runPnpm(packageRoot, [
      "exec",
      "shadcn",
      "init",
      "--preset",
      metadata.preset,
      "--template",
      metadata.template,
      "--name",
      scaffoldName,
      "--yes",
      "--silent",
      "--cwd",
      temporaryRoot,
    ])

    const scaffoldComponentsJson = JSON.parse(
      await readFile(path.join(scaffoldRoot, "components.json"), "utf8")
    )
    scaffoldComponentsJson.tailwind.css = PRESET_CSS_PATH

    const presetCss = await readFile(path.join(scaffoldRoot, "src", "index.css"), "utf8")

    return {
      componentsJson: canonicalizeTextContent(
        JSON.stringify(scaffoldComponentsJson, null, 2)
      ),
      presetCss: canonicalizeTextContent(presetCss),
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export async function loadGeneratedFoundationContent(packageRoot, target) {
  const output = await runPnpm(packageRoot, [
    "exec",
    "shadcn",
    "add",
    target.item,
    "--view",
    target.targetPath,
    "--silent",
  ])
  return extractShadcnAddViewBody(output)
}

export async function loadExpectedFoundationContent(packageRoot, { aliases, target }) {
  const generated = await loadGeneratedFoundationContent(packageRoot, target)
  return canonicalizeFoundationContent(
    rewriteConfiguredAliasesToRelative(generated, {
      targetPath: target.targetPath,
      aliases,
    })
  )
}

export function summarizeFirstDifference(expected, actual) {
  const expectedLines = normalizeNewlines(expected).split("\n")
  const actualLines = normalizeNewlines(actual).split("\n")
  const lineCount = Math.max(expectedLines.length, actualLines.length)

  for (let index = 0; index < lineCount; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `line ${index + 1}: expected ${JSON.stringify(expectedLines[index] ?? "<eof>")} but found ${JSON.stringify(actualLines[index] ?? "<eof>")}`
    }
  }

  return "contents differ"
}
