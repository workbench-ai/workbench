import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  FOUNDATION_CACHE_VERSION,
  FOUNDATION_METADATA_PATH,
  PRESET_CSS_PATH,
  buildFoundationTargets,
  canonicalizeTextContent,
  canonicalizeFoundationContent,
  loadExpectedFoundationContent,
  loadExpectedPresetArtifacts,
  loadShadcnInfo,
  readActualUiComponentNames,
  summarizeFirstDifference,
} from "./shadcn-foundation.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cachePath = path.join(
  packageRoot,
  "node_modules",
  ".cache",
  "shadcn-foundation",
  "verify.json"
)

function computeSignature(parts) {
  const hash = createHash("sha256")
  for (const part of parts) {
    hash.update(part)
    hash.update("\n--part--\n")
  }
  return hash.digest("hex")
}

async function readCache() {
  try {
    const raw = await readFile(cachePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeCache(signature, fileCount) {
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(
    cachePath,
    JSON.stringify(
      {
        signature,
        fileCount,
        cachedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}

function formatInventoryErrors({ actualNames, installedNames }) {
  const actualSet = new Set(actualNames)
  const installedSet = new Set(installedNames)
  const missing = installedNames.filter((name) => !actualSet.has(name))
  const extra = actualNames.filter((name) => !installedSet.has(name))
  return { missing, extra }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )

  return results
}

async function main() {
  const componentsJson = await readFile(path.join(packageRoot, "components.json"), "utf8")
  const actualComponentsJson = canonicalizeTextContent(componentsJson)
  const actualUiComponentNames = await readActualUiComponentNames(packageRoot)
  const cacheTargets = buildFoundationTargets({ components: actualUiComponentNames })

  const foundationMetadata = await readFile(
    path.join(packageRoot, FOUNDATION_METADATA_PATH),
    "utf8"
  )
  const packageJson = await readFile(path.join(packageRoot, "package.json"), "utf8")
  const presetCss = await readFile(path.join(packageRoot, PRESET_CSS_PATH), "utf8")
  const currentContents = await Promise.all(
    cacheTargets.map((target) =>
      readFile(path.join(packageRoot, target.targetPath), "utf8").then((content) => ({
        target,
        content,
      }))
    )
  )

  const signature = computeSignature([
    FOUNDATION_CACHE_VERSION,
    foundationMetadata,
    actualComponentsJson,
    packageJson,
    presetCss,
    JSON.stringify(cacheTargets),
    ...currentContents.map(({ target, content }) => `${target.targetPath}\n${content}`),
  ])
  const cached = await readCache()
  if (cached?.signature === signature) {
    console.log(
      `shadcn foundation check passed for ${cacheTargets.length} files (cached).`
    )
    return
  }

  const expectedPreset = await loadExpectedPresetArtifacts(packageRoot)
  if (actualComponentsJson !== expectedPreset.componentsJson) {
    throw new Error(
      [
        "shadcn foundation config drift detected.",
        `- components.json: ${summarizeFirstDifference(expectedPreset.componentsJson, actualComponentsJson)}. Regenerate with \`pnpm --dir products/cli-web-ui foundation:sync\`.`,
      ].join("\n")
    )
  }

  const info = await loadShadcnInfo(packageRoot)
  const targets = buildFoundationTargets(info)
  const installedComponentNames = [...info.components].sort()
  const inventoryErrors = formatInventoryErrors({
    actualNames: actualUiComponentNames,
    installedNames: installedComponentNames,
  })

  if (inventoryErrors.missing.length > 0 || inventoryErrors.extra.length > 0) {
    const parts = ["shadcn foundation inventory drift detected."]
    if (inventoryErrors.missing.length > 0) {
      parts.push(
        `Missing component files: ${inventoryErrors.missing
          .map((name) => `components/ui/${name}.tsx`)
          .join(", ")}`
      )
    }
    if (inventoryErrors.extra.length > 0) {
      parts.push(
        `Unexpected component files: ${inventoryErrors.extra
          .map((name) => `components/ui/${name}.tsx`)
          .join(", ")}`
      )
    }
    throw new Error(parts.join("\n"))
  }

  const actualPresetCss = canonicalizeTextContent(presetCss)
  if (actualPresetCss !== expectedPreset.presetCss) {
    throw new Error(
      [
        "shadcn foundation drift detected.",
        "These files no longer match the generated foundation after the sanctioned import-path rewrite:",
        `- ${PRESET_CSS_PATH}: ${summarizeFirstDifference(expectedPreset.presetCss, actualPresetCss)}. Regenerate with \`pnpm --dir products/cli-web-ui foundation:sync\`.`,
        "Keep repo-specific behavior in styles/extensions.css or styles/base.css instead of the preset-owned CSS file.",
      ].join("\n")
    )
  }

  const mismatches = await mapLimit(targets, 6, async (target) => {
    const currentContent = currentContents.find(
      (entry) => entry.target.targetPath === target.targetPath
    )?.content
    if (currentContent == null) {
      return {
        target,
        summary: "file is missing from the working tree",
      }
    }

    const expectedContent = await loadExpectedFoundationContent(packageRoot, {
      aliases: info.config.aliases,
      target,
    })
    const actualContent = canonicalizeFoundationContent(currentContent)

    if (actualContent === expectedContent) {
      return null
    }

    return {
      target,
      summary: summarizeFirstDifference(expectedContent, actualContent),
      remedy: `pnpm exec shadcn add ${target.item} --diff ${target.targetPath}`,
    }
  })

  const drift = mismatches.filter(Boolean)
  if (drift.length > 0) {
    const message = [
      "shadcn foundation drift detected.",
      "These files no longer match the generated foundation after the sanctioned import-path rewrite:",
      ...drift.map(
        ({ target, summary, remedy }) =>
          `- ${target.targetPath}: ${summary}. Inspect with \`${remedy}\`.`
      ),
      "Keep product-specific behavior in wrappers or shared compositions, not in components/ui or hooks/use-mobile.ts.",
    ].join("\n")
    throw new Error(message)
  }

  await writeCache(signature, targets.length)
  console.log(
    `shadcn foundation check passed for ${targets.length} files plus ${PRESET_CSS_PATH}.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
