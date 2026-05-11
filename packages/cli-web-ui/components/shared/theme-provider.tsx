import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes"
export { useTheme } from "next-themes"

export function ThemeProvider({
  children,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="workbench-ui-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
