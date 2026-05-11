export function sharedWebManualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (id.includes("pdfjs-dist")) {
    return "pdf-preview";
  }

  if (id.includes("react-router") || id.includes("@tanstack/react-query")) {
    return "app-routing";
  }

  if (id.includes("@xyflow")) {
    return "graph-vendor";
  }

  if (id.includes("recharts") || id.includes("d3-")) {
    return "chart-vendor";
  }

  if (id.includes("react") || id.includes("scheduler")) {
    return "react-vendor";
  }

  if (
    id.includes("class-variance-authority") ||
    id.includes("clsx") ||
    id.includes("tailwind-merge")
  ) {
    return "ui-vendor";
  }

  return undefined;
}
