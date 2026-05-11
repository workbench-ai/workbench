import { describe, expect, it } from "vitest"

import {
  canonicalizeFoundationContent,
  extractShadcnAddViewBody,
  rewriteConfiguredAliasesToRelative,
} from "../scripts/shadcn-foundation.mjs"

describe("extractShadcnAddViewBody", () => {
  it("extracts the boxed source body from shadcn add --view output", () => {
    const output = `┌ shadcn add tabs (dry run)
│
├ components/ui/tabs.tsx (overwrite) 5 lines
│ ┌──────────────────────────────────────────────
│ │ import { cn } from "@/lib/utils"
│ │ import { Button } from "@/components/ui/button"
│ │
│ │ export { Button }
│ └──────────────────────────────────────────────
│
└ Run without --dry-run to apply.
`

    expect(extractShadcnAddViewBody(output)).toBe(
      `import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export { Button }`
    )
  })
})

describe("rewriteConfiguredAliasesToRelative", () => {
  const aliases = {
    components: "@/components",
    utils: "@/lib/utils",
    ui: "@/components/ui",
    lib: "@/lib",
    hooks: "@/hooks",
  }

  it("prefers the longest configured alias and rewrites imports relative to ui files", () => {
    const content = `import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
`

    expect(
      rewriteConfiguredAliasesToRelative(content, {
        targetPath: "components/ui/sidebar.tsx",
        aliases,
      })
    ).toBe(`import { cn } from "../../lib/utils"
import { Button } from "./button"
import { useIsMobile } from "../../hooks/use-mobile"
`)
  })
})

describe("canonicalizeFoundationContent", () => {
  it("strips a top-level use client directive and normalizes trailing newline", () => {
    expect(
      canonicalizeFoundationContent(`"use client"\n\nexport const value = 1`)
    ).toBe(`export const value = 1\n`)
  })
})
