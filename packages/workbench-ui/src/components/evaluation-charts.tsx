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
  buildEvaluationCategoryAxisLayout,
  EVALUATION_CATEGORY_AXIS_LINE_HEIGHT,
  wrapEvaluationCategoryAxisLabel,
  type EvaluationCategoryAxisLayout,
} from "../lib/evaluation-chart-labels";
import {
  buildEvaluationMetricData,
  buildEvaluationTradeoffData,
  buildEvaluationTradeoffPairs,
  formatEvaluationMetricAxisValue,
  selectPrimaryEvaluationMetrics,
  type EvaluationMetricDatum,
  type EvaluationTradeoffDatum,
  type EvaluationTradeoffPair,
} from "../lib/evaluation-metrics";
import type {
  EvaluationMetricDescriptor,
  LabeledEvaluationSummary,
} from "../types";

const VERTICAL_BAR_CHART_MIN_HEIGHT = 288;

export function EvaluationCharts({
  evaluations,
  descriptors,
  candidates,
  candidateColorById,
}: {
  evaluations: LabeledEvaluationSummary[];
  descriptors: EvaluationMetricDescriptor[];
  candidates: readonly EvaluationChartCandidate[];
  candidateColorById: ReadonlyMap<string, string>;
}) {
  const primaryMetrics = selectPrimaryEvaluationMetrics(descriptors);
  const tradeoffPairs = React.useMemo(
    () => buildEvaluationTradeoffPairs(descriptors),
    [descriptors],
  );

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3" data-testid="evaluations-visualizations">
      {primaryMetrics.length > 0 ? (
        <div
          className="grid w-full min-w-0 max-w-full grid-cols-1 gap-3"
          data-testid="evaluations-bar-chart-grid"
        >
          {primaryMetrics.map((descriptor) => (
            <EvaluationMetricBarChart
              key={descriptor.id}
              evaluations={evaluations}
              descriptor={descriptor}
              candidates={candidates}
              candidateColorById={candidateColorById}
            />
          ))}
        </div>
      ) : null}
      {tradeoffPairs.length > 0 ? (
        <EvaluationTradeoffChart
          evaluations={evaluations}
          tradeoffPairs={tradeoffPairs}
          candidates={candidates}
          candidateColorById={candidateColorById}
        />
      ) : null}
    </div>
  );
}

function EvaluationMetricBarChart({
  evaluations,
  descriptor,
  candidates,
  candidateColorById,
}: {
  evaluations: LabeledEvaluationSummary[];
  descriptor: EvaluationMetricDescriptor;
  candidates: readonly EvaluationChartCandidate[];
  candidateColorById: ReadonlyMap<string, string>;
}) {
  const data = React.useMemo(
    () => buildEvaluationMetricData(evaluations, descriptor, candidateColorById),
    [evaluations, descriptor, candidateColorById],
  );
  const chartRows = React.useMemo(
    () => buildEvaluationMetricChartRows(data, candidates),
    [data, candidates],
  );
  const chartRowsByKey = React.useMemo(
    () => new Map(chartRows.map((row) => [row.rowKey, row])),
    [chartRows],
  );
  const categoryAxisLayout = React.useMemo(
    () => buildEvaluationCategoryAxisLayout(chartRows.map((entry) => entry.label)),
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
  const axisDomain = evaluationMetricAxisDomain(data, descriptor);
  const tooltip = (
    <ChartTooltip
      isAnimationActive={false}
      animationDuration={0}
      cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
      content={(
        <ChartTooltipContent
          labelKey="evaluationLabel"
          labelFormatter={(_label, payload) => {
            const datum = payload?.[0]?.payload as EvaluationMetricChartRow | undefined;
            return datum?.kind === "evaluation" ? datum.evaluationLabel : "Evaluation";
          }}
          formatter={(_value, _name, item) => {
            const payload = item.payload as EvaluationMetricChartRow;
            return payload.kind === "evaluation"
              ? renderMetricTooltipLine(descriptor.label, payload.displayValue)
              : null;
          }}
        />
      )}
    />
  );
  const bar = (
    <Bar
      dataKey="value"
      fill="transparent"
      isAnimationActive={false}
      radius={4}
    >
      {chartRows.map((entry) => (
        <Cell
          key={entry.rowKey}
          fill={entry.kind === "evaluation" ? entry.color : "transparent"}
        />
      ))}
    </Bar>
  );
  return (
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid={`evaluations-${descriptor.id}-chart`}>
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
                tickFormatter={(value) => formatEvaluationMetricAxisValue(descriptor, Number(value))}
              />
              <YAxis
                type="category"
                dataKey="rowKey"
                interval={0}
                tick={(
                  <EvaluationGroupedAxisTick
                    layout={categoryAxisLayout}
                    rowsByKey={chartRowsByKey}
                  />
                )}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={categoryAxisLayout.yAxisWidth}
              />
              {tooltip}
              {bar}
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recorded {descriptor.label.toLowerCase()} values are available for these evaluations.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type EvaluationMetricChartRow =
  | {
      kind: "candidate";
      rowKey: string;
      candidateId: string;
      label: string;
      value?: undefined;
    }
  | (EvaluationMetricDatum & {
      kind: "evaluation";
      rowKey: string;
      label: string;
    });

function buildEvaluationMetricChartRows(
  data: readonly EvaluationMetricDatum[],
  candidates: readonly EvaluationChartCandidate[],
): EvaluationMetricChartRow[] {
  const rowsByCandidate = new Map<string, EvaluationMetricDatum[]>();
  for (const row of data) {
    appendChartRow(rowsByCandidate, row.candidateId, row);
  }

  const chartRows: EvaluationMetricChartRow[] = [];
  for (const candidate of candidates) {
    const rows = rowsByCandidate.get(candidate.id);
    if (!rows?.length) {
      continue;
    }
    chartRows.push({
      kind: "candidate",
      rowKey: `candidate:${candidate.id}`,
      candidateId: candidate.id,
      label: candidate.label,
    });
    chartRows.push(...rows.map(toEvaluationMetricChartRow));
    rowsByCandidate.delete(candidate.id);
  }

  for (const rows of rowsByCandidate.values()) {
    const firstRow = rows[0]!;
    chartRows.push({
      kind: "candidate",
      rowKey: `candidate:${firstRow.candidateId}`,
      candidateId: firstRow.candidateId,
      label: firstRow.candidateLabel,
    });
    chartRows.push(...rows.map(toEvaluationMetricChartRow));
  }

  return chartRows;
}

function appendChartRow(
  map: Map<string, EvaluationMetricDatum[]>,
  candidateId: string,
  row: EvaluationMetricDatum,
): void {
  const rows = map.get(candidateId);
  if (rows) {
    rows.push(row);
  } else {
    map.set(candidateId, [row]);
  }
}

function toEvaluationMetricChartRow(
  row: EvaluationMetricDatum,
): EvaluationMetricChartRow {
  return {
    ...row,
    kind: "evaluation",
    rowKey: `evaluation:${row.evaluationId}`,
    label: row.configurationLabel,
  };
}

function evaluationMetricAxisDomain(
  data: EvaluationMetricDatum[],
  descriptor: EvaluationMetricDescriptor,
): [number, number] | undefined {
  if (descriptor.kind !== "number") {
    return undefined;
  }
  return data.every((entry) => entry.value >= 0 && entry.value <= 1) ? [0, 1] : undefined;
}

function EvaluationGroupedAxisTick({
  layout,
  payload,
  rowsByKey,
  x = 0,
  y = 0,
}: {
  layout: EvaluationCategoryAxisLayout;
  payload?: { value?: number | string };
  rowsByKey: ReadonlyMap<string, EvaluationMetricChartRow>;
  x?: number;
  y?: number;
}) {
  const row = rowsByKey.get(String(payload?.value ?? ""));
  if (!row) {
    return null;
  }

  const isCandidate = row.kind === "candidate";
  const maxCharsPerLine = isCandidate
    ? layout.yAxisMaxCharsPerLine
    : Math.max(8, layout.yAxisMaxCharsPerLine - 3);
  const lines = wrapEvaluationCategoryAxisLabel(row.label, maxCharsPerLine);
  const firstLineY = -((lines.length - 1) * EVALUATION_CATEGORY_AXIS_LINE_HEIGHT) / 2;
  const leftEdge = -layout.yAxisWidth + (isCandidate ? 8 : 24);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        className={isCandidate ? "fill-foreground font-medium" : "fill-muted-foreground"}
        textAnchor="start"
      >
        {lines.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={leftEdge}
            y={firstLineY + index * EVALUATION_CATEGORY_AXIS_LINE_HEIGHT}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function EvaluationTradeoffChart({
  evaluations,
  tradeoffPairs,
  candidates,
  candidateColorById,
}: {
  evaluations: LabeledEvaluationSummary[];
  tradeoffPairs: EvaluationTradeoffPair[];
  candidates: readonly EvaluationChartCandidate[];
  candidateColorById: ReadonlyMap<string, string>;
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
    () => (pair ? buildEvaluationTradeoffData(evaluations, pair, candidateColorById) : []),
    [evaluations, pair, candidateColorById],
  );
  const legendItems = React.useMemo(
    () => buildCandidateLegendItems(candidates, data),
    [candidates, data],
  );
  const chartConfig = React.useMemo(
    () => ({
      evaluations: {
        label: "Evaluations",
      },
    }) satisfies ChartConfig,
    [],
  );

  if (!pair) {
    return null;
  }

  return (
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid="evaluations-tradeoff-chart">
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
            <CandidateColorKey items={legendItems} />
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
                  tickFormatter={(value) => formatEvaluationMetricAxisValue(pair.xMetric, Number(value))}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={pair.yMetric.label}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => formatEvaluationMetricAxisValue(pair.yMetric, Number(value))}
                />
                <ChartTooltip
                  isAnimationActive={false}
                  animationDuration={0}
                  cursor={{ strokeDasharray: "3 3" }}
                  content={(
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_label, payload) => {
                        const datum = payload?.[0]?.payload as EvaluationTradeoffDatum | undefined;
                        return datum?.evaluationLabel ?? "Evaluation";
                      }}
                      formatter={(_value, _name, item) => {
                        const datum = item.payload as EvaluationTradeoffDatum;
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
                    key={datum.evaluationId}
                    data={[datum]}
                    fill={datum.color}
                    isAnimationActive={false}
                    name={datum.evaluationLabel}
                  />
                ))}
              </ScatterChart>
            </ChartContainer>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No evaluations have both {pair.xMetric.label.toLowerCase()} and {pair.yMetric.label.toLowerCase()} values available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface EvaluationChartCandidate {
  id: string;
  label: string;
  color: string;
}

function buildCandidateLegendItems(
  candidates: readonly EvaluationChartCandidate[],
  data: readonly EvaluationTradeoffDatum[],
): EvaluationChartCandidate[] {
  const candidateIdsInData = new Set(data.map((datum) => datum.candidateId));
  return candidates.filter((candidate) => candidateIdsInData.has(candidate.id));
}

function CandidateColorKey({
  items,
}: {
  items: readonly EvaluationChartCandidate[];
}) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      data-testid="evaluations-tradeoff-legend"
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
