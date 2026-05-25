import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  buildEvaluationMetricData,
  buildEvaluationTradeoffData,
  buildEvaluationTradeoffPairs,
  formatEvaluationMetricAxisValue,
  getEvaluationMetricChartColor,
  selectPrimaryEvaluationMetrics,
  type EvaluationMetricDatum,
  type EvaluationTradeoffDatum,
  type EvaluationTradeoffPair,
} from "../lib/evaluation-metrics";
import type {
  EvaluationMetricDescriptor,
  LabeledEvaluationSummary,
} from "../types";

const EVALUATION_AXIS_TICK_MAX_CHARS = 12;
const VERTICAL_BAR_CHART_THRESHOLD = 8;
const VERTICAL_BAR_ROW_HEIGHT = 34;
const VERTICAL_BAR_CHART_MIN_HEIGHT = 288;

export function EvaluationCharts({
  evaluations,
  descriptors,
}: {
  evaluations: LabeledEvaluationSummary[];
  descriptors: EvaluationMetricDescriptor[];
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
          {primaryMetrics.map((descriptor, index) => (
            <EvaluationMetricBarChart
              key={descriptor.id}
              evaluations={evaluations}
              descriptor={descriptor}
              index={index}
            />
          ))}
        </div>
      ) : null}
      {tradeoffPairs.length > 0 ? (
        <EvaluationTradeoffChart
          evaluations={evaluations}
          tradeoffPairs={tradeoffPairs}
        />
      ) : null}
    </div>
  );
}

function EvaluationMetricBarChart({
  evaluations,
  descriptor,
  index,
}: {
  evaluations: LabeledEvaluationSummary[];
  descriptor: EvaluationMetricDescriptor;
  index: number;
}) {
  const data = React.useMemo(
    () => buildEvaluationMetricData(evaluations, descriptor),
    [evaluations, descriptor],
  );
  const chartConfig = React.useMemo(
    () => ({
      value: {
        label: descriptor.label,
        color: getEvaluationMetricChartColor(descriptor, index),
      },
    }) satisfies ChartConfig,
    [descriptor, index],
  );
  const useVerticalLayout = data.length > VERTICAL_BAR_CHART_THRESHOLD;
  const chartHeight = useVerticalLayout
    ? Math.max(VERTICAL_BAR_CHART_MIN_HEIGHT, data.length * VERTICAL_BAR_ROW_HEIGHT + 72)
    : VERTICAL_BAR_CHART_MIN_HEIGHT;
  const axisDomain = evaluationMetricAxisDomain(data, descriptor);
  const tooltip = (
    <ChartTooltip
      cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
      content={(
        <ChartTooltipContent
          labelKey="evaluationLabel"
          labelFormatter={(_label, payload) => {
            const datum = payload?.[0]?.payload as EvaluationMetricDatum | undefined;
            return datum?.evaluationLabel ?? "Evaluation";
          }}
          formatter={(_value, _name, item) => {
            const payload = item.payload as EvaluationMetricDatum;
            return renderMetricTooltipLine(descriptor.label, payload.displayValue);
          }}
        />
      )}
    />
  );
  const bar = (
    <Bar
      dataKey="value"
      fill="var(--color-value)"
      isAnimationActive={false}
      radius={4}
    />
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
            {useVerticalLayout ? (
              <BarChart
                accessibilityLayer
                data={data}
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
                  dataKey="evaluationLabel"
                  tickFormatter={formatEvaluationAxisTickLabel}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={128}
                />
                {tooltip}
                {bar}
              </BarChart>
            ) : (
              <BarChart
                accessibilityLayer
                data={data}
                barCategoryGap="20%"
                margin={{
                  bottom: 18,
                  left: 8,
                  right: 48,
                  top: 4,
                }}
              >
                <CartesianGrid vertical={false} />
                <EvaluationXAxis />
                <YAxis
                  type="number"
                  name={descriptor.label}
                  domain={axisDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => formatEvaluationMetricAxisValue(descriptor, Number(value))}
                  width={54}
                />
                {tooltip}
                {bar}
              </BarChart>
            )}
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

function evaluationMetricAxisDomain(
  data: EvaluationMetricDatum[],
  descriptor: EvaluationMetricDescriptor,
): [number, number] | undefined {
  if (descriptor.kind !== "number") {
    return undefined;
  }
  return data.every((entry) => entry.value >= 0 && entry.value <= 1) ? [0, 1] : undefined;
}

function EvaluationXAxis() {
  return (
    <XAxis
      dataKey="evaluationLabel"
      interval="preserveStartEnd"
      minTickGap={16}
      padding={{ left: 24, right: 24 }}
      tickFormatter={formatEvaluationAxisTickLabel}
      tickLine={false}
      axisLine={false}
      tickMargin={10}
      height={36}
    />
  );
}

function formatEvaluationAxisTickLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const plusParts = normalized.split(/\s+\+\s+/u).filter(Boolean);
  const label = plusParts.length > 1
    ? plusParts.slice(1).join(" + ")
    : normalized;
  if (label.length <= EVALUATION_AXIS_TICK_MAX_CHARS) {
    return label;
  }
  return `${label.slice(0, EVALUATION_AXIS_TICK_MAX_CHARS - 3)}...`;
}

function EvaluationTradeoffChart({
  evaluations,
  tradeoffPairs,
}: {
  evaluations: LabeledEvaluationSummary[];
  tradeoffPairs: EvaluationTradeoffPair[];
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
    () => (pair ? buildEvaluationTradeoffData(evaluations, pair) : []),
    [evaluations, pair],
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
      <CardContent className="min-w-0">
        {data.length > 0 ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">
            No evaluations have both {pair.xMetric.label.toLowerCase()} and {pair.yMetric.label.toLowerCase()} values available.
          </p>
        )}
      </CardContent>
    </Card>
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
