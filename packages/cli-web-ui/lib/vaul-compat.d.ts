import * as React from "react"
import type { Portal as DialogPortal } from "@radix-ui/react-dialog"

declare module "vaul" {
  export function Portal(
    props: React.ComponentPropsWithoutRef<typeof DialogPortal> & {
      children?: React.ReactNode
    }
  ): React.JSX.Element
}
