export function normalizeWorkbenchSourcePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Workbench source paths must be non-empty relative paths.");
  }
  if (normalized.startsWith("/")) {
    throw new Error(`Unsafe Workbench source path: ${filePath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe Workbench source path: ${filePath}`);
  }
  return normalized;
}
