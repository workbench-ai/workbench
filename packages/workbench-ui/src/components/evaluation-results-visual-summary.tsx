import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "@workbench-ai/cli-web-ui/lib/recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workbench-ai/cli-web-ui/components/ui/chart";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workbench-ai/cli-web-ui/components/ui/toggle-group";
import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  buildComparisonCategoryAxisLayout,
  COMPARISON_CATEGORY_AXIS_LINE_HEIGHT,
  wrapComparisonCategoryAxisLabel,
  type ComparisonCategoryAxisLayout,
} from "../lib/comparison-chart-labels";
import {
  buildComparisonMetricData,
  buildComparisonMetricDescriptors,
  buildComparisonTradeoffData,
  buildComparisonTradeoffPairs,
  comparisonMetricDisplayLabel,
  comparisonMetricTestId,
  comparisonMetricValueLabel,
  formatComparisonMetricValue,
  resultVersionGroupId,
  selectPrimaryComparisonMetrics,
  type ComparisonEvidenceRow,
  type ComparisonGroupPresentation,
  type ComparisonMetricDatum,
  type ComparisonMetricDescriptor,
  type ComparisonTradeoffDatum,
  type ComparisonTradeoffPair,
} from "../lib/comparison-metrics";

const BAR_CHART_MIN_HEIGHT = 220;
const BAR_CHART_MAX_HEIGHT = 520;
const TRADEOFF_CHART_HEIGHT = 320;
const DENSE_TRADEOFF_CHART_HEIGHT = 210;

export function EvaluationResultsVisualSummary({
  rows,
  dense = false,
  defaultTradeoffMetricId,
  metricIds,
  showBarCharts = true,
  showTradeoff = true,
}: {
  rows: ComparisonEvidenceRow[];
  /**
   * Compact layout for constrained surfaces: smaller metric charts so the
   * summary fits without scrolling.
   */
  dense?: boolean;
  /** Prefer this X-axis metric for the initial tradeoff chart tab. */
  defaultTradeoffMetricId?: string;
  /**
   * Restrict the rendered metric charts to this set of ids. When omitted,
   * all primary metrics are shown.
   */
  metricIds?: readonly string[];
  /** Render the per-metric bar charts. Defaults to true. */
  showBarCharts?: boolean;
  /** Render the metric tradeoff scatter chart. Defaults to true. */
  showTradeoff?: boolean;
}) {
  const groups = React.useMemo(() => buildVisualSummaryGroups(rows), [rows]);
  const groupColorById = React.useMemo(
    () => new Map(groups.map((group) => [group.id, group.color])),
    [groups],
  );
  const metricDescriptors = React.useMemo(() => {
    const primary = selectPrimaryComparisonMetrics(buildComparisonMetricDescriptors(rows));
    return metricIds
      ? primary.filter((descriptor) => metricIds.includes(descriptor.id))
      : primary;
  }, [metricIds, rows]);
  const chartDescriptors = React.useMemo(
    () => metricDescriptors.filter((descriptor) =>
      buildComparisonMetricData(rows, descriptor, groupColorById).length >= 2
    ),
    [groupColorById, metricDescriptors, rows],
  );
  const tradeoffPairs = React.useMemo(
    () => buildComparisonTradeoffPairs(chartDescriptors).filter((pair) =>
      buildComparisonTradeoffData(rows, pair, groupColorById).length >= 2
    ),
    [chartDescriptors, groupColorById, rows],
  );

  if (chartDescriptors.length === 0 && tradeoffPairs.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Evaluation visual summary"
      className="grid min-w-0 gap-3"
      data-testid="evaluation-results-visual-summary"
    >
      <div className="grid min-w-0 gap-3">
        {showBarCharts && chartDescriptors.length > 0 ? (
          <div className="grid min-w-0 gap-3">
            {chartDescriptors.map((descriptor) => (
              <EvaluationMetricBarChart
                key={descriptor.id}
                dense={dense}
                descriptor={descriptor}
                groups={groups}
                groupColorById={groupColorById}
                rows={rows}
              />
            ))}
          </div>
        ) : null}
        {showTradeoff && tradeoffPairs.length > 0 ? (
          <EvaluationTradeoffChart
            dense={dense}
            defaultMetricId={defaultTradeoffMetricId}
            groupColorById={groupColorById}
            groups={groups}
            rows={rows}
            tradeoffPairs={tradeoffPairs}
          />
        ) : null}
      </div>
    </section>
  );
}

function EvaluationMetricBarChart({
  dense,
  descriptor,
  groups,
  groupColorById,
  rows,
}: {
  dense: boolean;
  descriptor: ComparisonMetricDescriptor;
  groups: readonly ComparisonGroupPresentation[];
  groupColorById: ReadonlyMap<string, string>;
  rows: ComparisonEvidenceRow[];
}) {
  const data = React.useMemo(
    () => buildComparisonMetricData(rows, descriptor, groupColorById),
    [descriptor, groupColorById, rows],
  );
  const chartRows = React.useMemo(
    () => buildComparisonMetricChartRows(data, groups),
    [data, groups],
  );
  const chartRowsByKey = React.useMemo(
    () => new Map(chartRows.map((row) => [row.rowKey, row])),
    [chartRows],
  );
  const categoryAxisLayout = React.useMemo(
    () => buildComparisonCategoryAxisLayout(chartRows.map((entry) => entry.label)),
    [chartRows],
  );
  const chartConfig = React.useMemo(
    () => ({
      value: {
        label: comparisonMetricValueLabel(descriptor),
      },
    }) satisfies ChartConfig,
    [descriptor],
  );
  const chartHeight = dense
    ? clamp(chartRows.length * categoryAxisLayout.rowHeight + 24, 128, 172)
    : clamp(
        chartRows.length * categoryAxisLayout.rowHeight + 64,
        BAR_CHART_MIN_HEIGHT,
        BAR_CHART_MAX_HEIGHT,
      );
  const axisDomain = comparisonMetricAxisDomain(data, descriptor);
  const displayLabel = comparisonMetricDisplayLabel(descriptor);

  return (
    <section
      aria-label={displayLabel}
      className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-background px-3 py-3"
      data-testid={`evaluation-${comparisonMetricTestId(descriptor)}-chart`}
    >
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{displayLabel}</h3>
        <span className="text-xs text-muted-foreground">{bestDirectionLabel(descriptor)}</span>
      </header>
      <ChartContainer
        config={chartConfig}
        className="w-full min-w-0 !aspect-auto"
        style={{ aspectRatio: "auto", height: chartHeight }}
      >
        <BarChart
          accessibilityLayer
          barCategoryGap="22%"
          data={chartRows}
          layout="vertical"
          margin={{
            bottom: 14,
            left: 6,
            right: 24,
            top: 2,
          }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            axisLine={false}
            domain={axisDomain}
            name={displayLabel}
            tickFormatter={(value) => formatComparisonMetricValue(descriptor, Number(value))}
            tickLine={false}
            tickMargin={8}
            type="number"
          />
          <YAxis
            axisLine={false}
            dataKey="rowKey"
            interval={0}
            tick={(
              <ComparisonGroupedAxisTick
                layout={categoryAxisLayout}
                rowsByKey={chartRowsByKey}
              />
            )}
            tickLine={false}
            tickMargin={8}
            type="category"
            width={categoryAxisLayout.yAxisWidth}
          />
          <ChartTooltip
            animationDuration={0}
            content={(
              <ChartTooltipContent
                labelFormatter={(_label, payload) => {
                  const datum = payload?.[0]?.payload as ComparisonMetricChartRow | undefined;
                  return datum?.kind === "row" ? datum.rowLabel : "Evaluation";
                }}
                formatter={(_value, _name, item) => {
                  const payload = item.payload as ComparisonMetricChartRow;
                  return payload.kind === "row"
                    ? renderMetricTooltipLine(displayLabel, payload.displayValue)
                    : null;
                }}
              />
            )}
            cursor={{ fill: "var(--muted)", fillOpacity: 0.45 }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="value"
            fill="transparent"
            isAnimationActive={false}
            radius={4}
          >
            {chartRows.map((entry) => (
              <Cell
                fill={entry.kind === "row" ? entry.color : "transparent"}
                key={entry.rowKey}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </section>
  );
}

function EvaluationTradeoffChart({
  dense,
  defaultMetricId,
  groupColorById,
  groups,
  rows,
  tradeoffPairs,
}: {
  dense: boolean;
  defaultMetricId?: string;
  groupColorById: ReadonlyMap<string, string>;
  groups: readonly ComparisonGroupPresentation[];
  rows: ComparisonEvidenceRow[];
  tradeoffPairs: ComparisonTradeoffPair[];
}) {
  const defaultPairKey = React.useMemo(
    () => defaultTradeoffPairKey(tradeoffPairs, defaultMetricId),
    [defaultMetricId, tradeoffPairs],
  );
  const [pairKey, setPairKey] = React.useState(defaultPairKey);
  const pair = tradeoffPairs.find((entry) => entry.key === pairKey) ?? tradeoffPairs[0];
  React.useEffect(() => {
    if (!pair) {
      if (pairKey) {
        setPairKey("");
      }
      return;
    }
    if (pair.key !== pairKey && defaultPairKey !== pairKey) {
      setPairKey(defaultPairKey);
    }
  }, [defaultPairKey, pair, pairKey]);

  const data = React.useMemo(
    () => (pair ? buildComparisonTradeoffData(rows, pair, groupColorById) : []),
    [groupColorById, pair, rows],
  );
  const legendItems = React.useMemo(
    () => buildGroupLegendItems(groups, data),
    [data, groups],
  );
  const chartConfig = React.useMemo(
    () => ({
      runs: {
        label: "Runs",
      },
    }) satisfies ChartConfig,
    [],
  );

  if (!pair || data.length < 2) {
    return null;
  }

  const title = tradeoffPairLabel(pair);
  const chartHeight = dense ? DENSE_TRADEOFF_CHART_HEIGHT : TRADEOFF_CHART_HEIGHT;
  return (
    <section
      aria-label={title}
      className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-background px-3 py-3"
      data-testid="evaluation-tradeoff-chart"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {tradeoffPairs.length > 1 ? (
          <ToggleGroup
            aria-label="Tradeoff dimensions"
            className="flex-wrap"
            onValueChange={(value: string) => {
              if (value) {
                React.startTransition(() => setPairKey(value));
              }
            }}
            size="sm"
            type="single"
            value={pair.key}
            variant="outline"
          >
            {tradeoffPairs.map((entry) => (
              <ToggleGroupItem key={entry.key} value={entry.key}>
                {tradeoffTabLabel(entry)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </header>
      <GroupColorKey items={legendItems} />
      <ChartContainer
        config={chartConfig}
        className="w-full min-w-0 !aspect-auto"
        data-testid="evaluation-tradeoff-plot"
        style={{ aspectRatio: "auto", height: chartHeight }}
      >
        <ScatterChart
          accessibilityLayer
          margin={{
            bottom: 22,
            left: 10,
            right: 20,
            top: 10,
          }}
        >
          <CartesianGrid />
          <XAxis
            axisLine={false}
            dataKey="x"
            name={comparisonMetricValueLabel(pair.xMetric)}
            tickFormatter={(value) => formatComparisonMetricValue(pair.xMetric, Number(value))}
            tickLine={false}
            tickMargin={8}
            type="number"
          />
          <YAxis
            axisLine={false}
            dataKey="y"
            domain={pair.yMetric.kind === "number" ? [0, 1] : undefined}
            name={comparisonMetricValueLabel(pair.yMetric)}
            tickFormatter={(value) => formatComparisonMetricValue(pair.yMetric, Number(value))}
            tickLine={false}
            tickMargin={8}
            type="number"
          />
          <ChartTooltip
            animationDuration={0}
            content={(
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_label, payload) => {
                  const datum = payload?.[0]?.payload as ComparisonTradeoffDatum | undefined;
                  return datum?.rowLabel ?? "Evaluation";
                }}
                formatter={(_value, _name, item) => {
                  const datum = item.payload as ComparisonTradeoffDatum;
                  if (item.dataKey === "x") {
                    return renderMetricTooltipLine(comparisonMetricValueLabel(pair.xMetric), datum.xDisplay);
                  }
                  if (item.dataKey === "y") {
                    return renderMetricTooltipLine(comparisonMetricValueLabel(pair.yMetric), datum.yDisplay);
                  }
                  return null;
                }}
              />
            )}
            cursor={{ strokeDasharray: "3 3" }}
            isAnimationActive={false}
          />
          <Scatter
            dataKey="y"
            data={data}
            fill="var(--chart-1)"
            isAnimationActive={false}
            name="Runs"
          >
            {data.map((datum) => (
              <Cell fill={datum.color} key={datum.rowId} />
            ))}
          </Scatter>
        </ScatterChart>
      </ChartContainer>
    </section>
  );
}

type ComparisonMetricChartRow =
  | {
      kind: "group";
      rowKey: string;
      groupId: string;
      label: string;
      value?: undefined;
    }
  | (ComparisonMetricDatum & {
      kind: "row";
      rowKey: string;
      label: string;
    });

function buildComparisonMetricChartRows(
  data: readonly ComparisonMetricDatum[],
  groups: readonly ComparisonGroupPresentation[],
): ComparisonMetricChartRow[] {
  const rowsByGroup = new Map<string, ComparisonMetricDatum[]>();
  for (const row of data) {
    const entries = rowsByGroup.get(row.groupId);
    if (entries) {
      entries.push(row);
    } else {
      rowsByGroup.set(row.groupId, [row]);
    }
  }

  const chartRows: ComparisonMetricChartRow[] = [];
  for (const group of groups) {
    const rows = rowsByGroup.get(group.id);
    if (!rows?.length) {
      continue;
    }
    chartRows.push({
      kind: "group",
      rowKey: `group:${group.id}`,
      groupId: group.id,
      label: group.label,
    });
    chartRows.push(...rows.map(toComparisonMetricChartRow));
    rowsByGroup.delete(group.id);
  }

  for (const rows of rowsByGroup.values()) {
    const firstRow = rows[0];
    if (!firstRow) {
      continue;
    }
    chartRows.push({
      kind: "group",
      rowKey: `group:${firstRow.groupId}`,
      groupId: firstRow.groupId,
      label: firstRow.groupLabel,
    });
    chartRows.push(...rows.map(toComparisonMetricChartRow));
  }

  return chartRows;
}

function toComparisonMetricChartRow(row: ComparisonMetricDatum): ComparisonMetricChartRow {
  return {
    ...row,
    kind: "row",
    rowKey: `row:${row.rowId}`,
    label: row.configurationLabel,
  };
}

function ComparisonGroupedAxisTick({
  layout,
  payload,
  rowsByKey,
  x = 0,
  y = 0,
}: {
  layout: ComparisonCategoryAxisLayout;
  payload?: { value?: number | string };
  rowsByKey: ReadonlyMap<string, ComparisonMetricChartRow>;
  x?: number;
  y?: number;
}) {
  const row = rowsByKey.get(String(payload?.value ?? ""));
  if (!row) {
    return null;
  }

  const isGroup = row.kind === "group";
  const maxCharsPerLine = isGroup
    ? layout.yAxisMaxCharsPerLine
    : Math.max(8, layout.yAxisMaxCharsPerLine - 3);
  const lines = wrapComparisonCategoryAxisLabel(row.label, maxCharsPerLine);
  const firstLineY = -((lines.length - 1) * COMPARISON_CATEGORY_AXIS_LINE_HEIGHT) / 2;
  const leftEdge = -layout.yAxisWidth + (isGroup ? 8 : 24);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        className={isGroup ? "fill-foreground font-medium" : "fill-muted-foreground"}
        textAnchor="start"
      >
        {lines.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={leftEdge}
            y={firstLineY + index * COMPARISON_CATEGORY_AXIS_LINE_HEIGHT}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function buildVisualSummaryGroups(rows: readonly ComparisonEvidenceRow[]): ComparisonGroupPresentation[] {
  const groupsById = new Map<string, Omit<ComparisonGroupPresentation, "color"> & { versionOrdinal: number }>();
  for (const row of rows) {
    const groupId = resultVersionGroupId(row);
    if (!groupsById.has(groupId)) {
      groupsById.set(groupId, {
        id: groupId,
        label: row.versionLabel,
        versionOrdinal: row.versionOrdinal,
      });
    }
  }
  return [...groupsById.values()]
    .sort((left, right) =>
      left.versionOrdinal - right.versionOrdinal ||
      left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
    )
    .map((group, index) => ({
      id: group.id,
      label: group.label,
      color: getCategoricalChartColor(index),
    }));
}

function comparisonMetricAxisDomain(
  data: ComparisonMetricDatum[],
  descriptor: ComparisonMetricDescriptor,
): [number, number] | undefined {
  if (descriptor.kind !== "number") {
    return undefined;
  }
  return data.every((entry) => entry.value >= 0 && entry.value <= 1) ? [0, 1] : undefined;
}

function buildGroupLegendItems(
  groups: readonly ComparisonGroupPresentation[],
  data: readonly ComparisonTradeoffDatum[],
): ComparisonGroupPresentation[] {
  const groupIdsInData = new Set(data.map((datum) => datum.groupId));
  return groups.filter((group) => groupIdsInData.has(group.id));
}

function GroupColorKey({
  items,
}: {
  items: readonly ComparisonGroupPresentation[];
}) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      data-testid="evaluation-tradeoff-legend"
    >
      {items.map((item) => (
        <span key={item.id} className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full ring-1 ring-border"
            style={{ backgroundColor: item.color }}
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function renderMetricTooltipLine(label: string, displayValue: string) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground tabular-nums">{displayValue}</span>
    </div>
  );
}

function bestDirectionLabel(descriptor: ComparisonMetricDescriptor): string {
  return descriptor.direction === "lower" ? "Lower is better" : "Higher is better";
}

function tradeoffPairLabel(pair: ComparisonTradeoffPair): string {
  return pair.label;
}

function tradeoffTabLabel(pair: ComparisonTradeoffPair): string {
  return pair.label;
}

function defaultTradeoffPairKey(
  pairs: readonly ComparisonTradeoffPair[],
  metricId: string | undefined,
): string {
  return (metricId ? pairs.find((pair) => pair.xMetric.id === metricId) : undefined)?.key
    ?? pairs[0]?.key
    ?? "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
