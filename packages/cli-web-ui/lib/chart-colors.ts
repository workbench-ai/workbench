export const categoricalChartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

export const semanticChartColors = {
  performance: "var(--chart-performance)",
  speed: "var(--chart-speed)",
  cost: "var(--chart-cost)",
} as const;

export type SemanticChartColorRole = keyof typeof semanticChartColors;

export function getCategoricalChartColor(index: number): string {
  const normalizedIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  const wrappedIndex =
    ((normalizedIndex % categoricalChartColors.length) + categoricalChartColors.length)
    % categoricalChartColors.length;
  return categoricalChartColors[wrappedIndex]!;
}

export function getSemanticChartColor(role: SemanticChartColorRole): string {
  return semanticChartColors[role];
}
