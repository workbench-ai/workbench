import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  PRESET_CSS_PATH,
  buildFoundationTargets,
  canonicalizeTextContent,
  loadExpectedFoundationContent,
  loadExpectedPresetArtifacts,
  loadShadcnInfo,
  runPnpm,
} from "./shadcn-foundation.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

async function writeCanonicalFile(targetPath, content) {
  await writeFile(
    path.join(packageRoot, targetPath),
    canonicalizeTextContent(content),
  )
}

async function main() {
  const expectedPreset = await loadExpectedPresetArtifacts(packageRoot)
  await writeCanonicalFile("components.json", expectedPreset.componentsJson)
  await writeCanonicalFile(PRESET_CSS_PATH, expectedPreset.presetCss)

  const info = await loadShadcnInfo(packageRoot)
  const targets = buildFoundationTargets(info)

  await Promise.all(
    targets.map(async (target) => {
      const expectedContent = await loadExpectedFoundationContent(packageRoot, {
        aliases: info.config.aliases,
        target,
      })

      await writeCanonicalFile(target.targetPath, expectedContent)
    }),
  )

  await runPnpm(packageRoot, ["exec", "node", "./scripts/verify-shadcn-foundation.mjs"])
  console.log(
    `shadcn foundation sync completed for ${targets.length} files plus ${PRESET_CSS_PATH}.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
