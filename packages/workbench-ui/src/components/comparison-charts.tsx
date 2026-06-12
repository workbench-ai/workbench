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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";
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

import {
  buildComparisonCategoryAxisLayout,
  COMPARISON_CATEGORY_AXIS_LINE_HEIGHT,
  wrapComparisonCategoryAxisLabel,
  type ComparisonCategoryAxisLayout,
} from "../lib/comparison-chart-labels";
import {
  buildComparisonMetricData,
  buildComparisonTradeoffData,
  buildComparisonTradeoffPairs,
  formatComparisonMetricValue,
  selectPrimaryComparisonMetrics,
  type ComparisonEvidenceRow,
  type ComparisonGroupPresentation,
  type ComparisonMetricDatum,
  type ComparisonMetricDescriptor,
  type ComparisonTradeoffDatum,
  type ComparisonTradeoffPair,
} from "../lib/comparison-metrics";

const VERTICAL_BAR_CHART_MIN_HEIGHT = 288;

export function ComparisonCharts({
  rows,
  descriptors,
  groups,
  groupColorById,
}: {
  rows: ComparisonEvidenceRow[];
  descriptors: ComparisonMetricDescriptor[];
  groups: readonly ComparisonGroupPresentation[];
  groupColorById: ReadonlyMap<string, string>;
}) {
  const primaryMetrics = selectPrimaryComparisonMetrics(descriptors);
  const tradeoffPairs = React.useMemo(
    () => buildComparisonTradeoffPairs(descriptors),
    [descriptors],
  );

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3" data-testid="comparison-visualizations">
      {primaryMetrics.length > 0 ? (
        <div
          className="grid w-full min-w-0 max-w-full grid-cols-1 gap-3"
          data-testid="comparison-bar-chart-grid"
        >
          {primaryMetrics.map((descriptor) => (
            <ComparisonMetricBarChart
              key={descriptor.id}
              rows={rows}
              descriptor={descriptor}
              groups={groups}
              groupColorById={groupColorById}
            />
          ))}
        </div>
      ) : null}
      {tradeoffPairs.length > 0 ? (
        <ComparisonTradeoffChart
          rows={rows}
          tradeoffPairs={tradeoffPairs}
          groups={groups}
          groupColorById={groupColorById}
        />
      ) : null}
    </div>
  );
}

function ComparisonMetricBarChart({
  rows,
  descriptor,
  groups,
  groupColorById,
}: {
  rows: ComparisonEvidenceRow[];
  descriptor: ComparisonMetricDescriptor;
  groups: readonly ComparisonGroupPresentation[];
  groupColorById: ReadonlyMap<string, string>;
}) {
  const data = React.useMemo(
    () => buildComparisonMetricData(rows, descriptor, groupColorById),
    [rows, descriptor, groupColorById],
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
        label: descriptor.label,
      },
    }) satisfies ChartConfig,
    [descriptor],
  );
  const chartHeight = Math.max(
    VERTICAL_BAR_CHART_MIN_HEIGHT,
    chartRows.length * categoryAxisLayout.rowHeight + 72,
  );
  const axisDomain = comparisonMetricAxisDomain(data, descriptor);

  return (
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid={`comparison-${descriptor.id}-chart`}>
      <CardHeader>
        <CardTitle>{descriptor.label}</CardTitle>
        <CardDescription>
          {descriptor.direction === "lower" ? "Lower is better." : "Higher is better."}
        </CardDescription>
      </CardHeader>
      <CardContent className="w-full min-w-0 max-w-full">
        {data.length > 0 ? (
          <ChartContainer
            config={chartConfig}
            className="w-full min-w-0 !aspect-auto"
            style={{ aspectRatio: "auto", height: chartHeight }}
          >
            <BarChart
              accessibilityLayer
              data={chartRows}
              layout="vertical"
              barCategoryGap="20%"
              margin={{
                bottom: 18,
                left: 8,
                right: 32,
                top: 4,
              }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                name={descriptor.label}
                domain={axisDomain}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => formatComparisonMetricValue(descriptor, Number(value))}
              />
              <YAxis
                type="category"
                dataKey="rowKey"
                interval={0}
                tick={(
                  <ComparisonGroupedAxisTick
                    layout={categoryAxisLayout}
                    rowsByKey={chartRowsByKey}
                  />
                )}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={categoryAxisLayout.yAxisWidth}
              />
              <ChartTooltip
                isAnimationActive={false}
                animationDuration={0}
                cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                content={(
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) => {
                      const datum = payload?.[0]?.payload as ComparisonMetricChartRow | undefined;
                      return datum?.kind === "row" ? datum.rowLabel : "Comparison";
                    }}
                    formatter={(_value, _name, item) => {
                      const payload = item.payload as ComparisonMetricChartRow;
                      return payload.kind === "row"
                        ? renderMetricTooltipLine(descriptor.label, payload.displayValue)
                        : null;
                    }}
                  />
                )}
              />
              <Bar
                dataKey="value"
                fill="transparent"
                isAnimationActive={false}
                radius={4}
              >
                {chartRows.map((entry) => (
                  <Cell
                    key={entry.rowKey}
                    fill={entry.kind === "row" ? entry.color : "transparent"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recorded {descriptor.label.toLowerCase()} values are available for these runs.
          </p>
        )}
      </CardContent>
    </Card>
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
    const firstRow = rows[0]!;
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

function toComparisonMetricChartRow(
  row: ComparisonMetricDatum,
): ComparisonMetricChartRow {
  return {
    ...row,
    kind: "row",
    rowKey: `row:${row.rowId}`,
    label: row.configurationLabel,
  };
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

function ComparisonTradeoffChart({
  rows,
  tradeoffPairs,
  groups,
  groupColorById,
}: {
  rows: ComparisonEvidenceRow[];
  tradeoffPairs: ComparisonTradeoffPair[];
  groups: readonly ComparisonGroupPresentation[];
  groupColorById: ReadonlyMap<string, string>;
}) {
  const [pairKey, setPairKey] = React.useState(tradeoffPairs[0]?.key ?? "");
  const pair = tradeoffPairs.find((entry) => entry.key === pairKey) ?? tradeoffPairs[0];
  React.useEffect(() => {
    if (!pair) {
      if (pairKey) {
        setPairKey("");
      }
      return;
    }
    if (pair.key !== pairKey) {
      setPairKey(pair.key);
    }
  }, [pair, pairKey]);
  const data = React.useMemo(
    () => (pair ? buildComparisonTradeoffData(rows, pair, groupColorById) : []),
    [rows, pair, groupColorById],
  );
  const legendItems = React.useMemo(
    () => buildGroupLegendItems(groups, data),
    [groups, data],
  );
  const chartConfig = React.useMemo(
    () => ({
      runs: {
        label: "Runs",
      },
    }) satisfies ChartConfig,
    [],
  );

  if (!pair) {
    return null;
  }

  return (
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid="comparison-tradeoff-chart">
      <CardHeader className="gap-3">
        <div className="grid gap-2">
          <CardTitle>{pair.yMetric.label} vs {pair.xMetric.label}</CardTitle>
        </div>
        {tradeoffPairs.length > 1 ? (
          <ToggleGroup
            type="single"
            value={pairKey}
            onValueChange={(value: string) => {
              if (value) {
                React.startTransition(() => {
                  setPairKey(value);
                });
              }
            }}
            variant="outline"
            size="sm"
            className="flex-wrap"
            aria-label="Tradeoff dimensions"
          >
            {tradeoffPairs.map((entry) => (
              <ToggleGroupItem key={entry.key} value={entry.key}>
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {data.length > 0 ? (
          <>
            <GroupColorKey items={legendItems} />
            <ChartContainer
              config={chartConfig}
              className="h-80 w-full min-w-0 !aspect-auto"
              style={{ aspectRatio: "auto" }}
            >
              <ScatterChart
                accessibilityLayer
                margin={{
                  bottom: 24,
                  left: 12,
                  right: 24,
                  top: 12,
                }}
              >
                <CartesianGrid />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={pair.xMetric.label}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => formatComparisonMetricValue(pair.xMetric, Number(value))}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={pair.yMetric.label}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => formatComparisonMetricValue(pair.yMetric, Number(value))}
                />
                <ChartTooltip
                  isAnimationActive={false}
                  animationDuration={0}
                  cursor={{ strokeDasharray: "3 3" }}
                  content={(
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_label, payload) => {
                        const datum = payload?.[0]?.payload as ComparisonTradeoffDatum | undefined;
                        return datum?.rowLabel ?? "Run";
                      }}
                      formatter={(_value, _name, item) => {
                        const datum = item.payload as ComparisonTradeoffDatum;
                        return (
                          <div className="grid gap-1">
                            {renderMetricTooltipLine(pair.xMetric.label, datum.xDisplay)}
                            {renderMetricTooltipLine(pair.yMetric.label, datum.yDisplay)}
                          </div>
                        );
                      }}
                    />
                  )}
                />
                {data.map((datum) => (
                  <Scatter
                    key={datum.rowId}
                    data={[datum]}
                    fill={datum.color}
                    isAnimationActive={false}
                    name={datum.rowLabel}
                  />
                ))}
              </ScatterChart>
            </ChartContainer>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No runs have both {pair.xMetric.label.toLowerCase()} and {pair.yMetric.label.toLowerCase()} values available.
          </p>
        )}
      </CardContent>
    </Card>
  );
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
      data-testid="comparison-tradeoff-legend"
    >
      {items.map((item) => (
        <span key={item.id} className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className="size-2.5 flex-none rounded-full ring-1 ring-border"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function renderMetricTooltipLine(
  label: string,
  displayValue: string,
) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground tabular-nums">
        {displayValue}
      </span>
    </div>
  );
}
