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
  buildResultMetricData,
  buildResultTradeoffData,
  buildResultTradeoffPairs,
  formatResultMetricAxisValue,
  getResultMetricChartColor,
  selectPrimaryResultMetrics,
  type ResultMetricDatum,
  type ResultTradeoffDatum,
  type ResultTradeoffPair,
} from "../lib/result-metrics";
import type {
  ResultMetricDescriptor,
  LabeledEvaluationResultRecord,
} from "../types";

const RESULT_AXIS_TICK_MAX_CHARS = 12;
const VERTICAL_BAR_CHART_THRESHOLD = 8;
const VERTICAL_BAR_ROW_HEIGHT = 34;
const VERTICAL_BAR_CHART_MIN_HEIGHT = 288;

export function ResultCharts({
  results,
  descriptors,
}: {
  results: LabeledEvaluationResultRecord[];
  descriptors: ResultMetricDescriptor[];
}) {
  const primaryMetrics = selectPrimaryResultMetrics(descriptors);
  const tradeoffPairs = React.useMemo(
    () => buildResultTradeoffPairs(descriptors),
    [descriptors],
  );

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3" data-testid="results-visualizations">
      {primaryMetrics.length > 0 ? (
        <div
          className="grid w-full min-w-0 max-w-full grid-cols-1 gap-3"
          data-testid="results-bar-chart-grid"
        >
          {primaryMetrics.map((descriptor, index) => (
            <ResultMetricBarChart
              key={descriptor.id}
              results={results}
              descriptor={descriptor}
              index={index}
            />
          ))}
        </div>
      ) : null}
      {tradeoffPairs.length > 0 ? (
        <ResultTradeoffChart
          results={results}
          tradeoffPairs={tradeoffPairs}
        />
      ) : null}
    </div>
  );
}

function ResultMetricBarChart({
  results,
  descriptor,
  index,
}: {
  results: LabeledEvaluationResultRecord[];
  descriptor: ResultMetricDescriptor;
  index: number;
}) {
  const data = React.useMemo(
    () => buildResultMetricData(results, descriptor),
    [results, descriptor],
  );
  const chartConfig = React.useMemo(
    () => ({
      value: {
        label: descriptor.label,
        color: getResultMetricChartColor(descriptor, index),
      },
    }) satisfies ChartConfig,
    [descriptor, index],
  );
  const useVerticalLayout = data.length > VERTICAL_BAR_CHART_THRESHOLD;
  const chartHeight = useVerticalLayout
    ? Math.max(VERTICAL_BAR_CHART_MIN_HEIGHT, data.length * VERTICAL_BAR_ROW_HEIGHT + 72)
    : VERTICAL_BAR_CHART_MIN_HEIGHT;
  const axisDomain = resultMetricAxisDomain(data, descriptor);
  const tooltip = (
    <ChartTooltip
      cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
      content={(
        <ChartTooltipContent
          labelKey="resultLabel"
          labelFormatter={(_label, payload) => {
            const datum = payload?.[0]?.payload as ResultMetricDatum | undefined;
            return datum?.resultLabel ?? "Result";
          }}
          formatter={(_value, _name, item) => {
            const payload = item.payload as ResultMetricDatum;
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
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid={`results-${descriptor.id}-chart`}>
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
                  tickFormatter={(value) => formatResultMetricAxisValue(descriptor, Number(value))}
                />
                <YAxis
                  type="category"
                  dataKey="resultLabel"
                  tickFormatter={formatResultAxisTickLabel}
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
                <ResultXAxis />
                <YAxis
                  type="number"
                  name={descriptor.label}
                  domain={axisDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => formatResultMetricAxisValue(descriptor, Number(value))}
                  width={54}
                />
                {tooltip}
                {bar}
              </BarChart>
            )}
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recorded {descriptor.label.toLowerCase()} values are available for this result set.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function resultMetricAxisDomain(
  data: ResultMetricDatum[],
  descriptor: ResultMetricDescriptor,
): [number, number] | undefined {
  if (descriptor.kind !== "number") {
    return undefined;
  }
  return data.every((entry) => entry.value >= 0 && entry.value <= 1) ? [0, 1] : undefined;
}

function ResultXAxis() {
  return (
    <XAxis
      dataKey="resultLabel"
      interval="preserveStartEnd"
      minTickGap={16}
      padding={{ left: 24, right: 24 }}
      tickFormatter={formatResultAxisTickLabel}
      tickLine={false}
      axisLine={false}
      tickMargin={10}
      height={36}
    />
  );
}

function formatResultAxisTickLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const plusParts = normalized.split(/\s+\+\s+/u).filter(Boolean);
  const label = plusParts.length > 1
    ? plusParts.slice(1).join(" + ")
    : normalized;
  if (label.length <= RESULT_AXIS_TICK_MAX_CHARS) {
    return label;
  }
  return `${label.slice(0, RESULT_AXIS_TICK_MAX_CHARS - 3)}...`;
}

function ResultTradeoffChart({
  results,
  tradeoffPairs,
}: {
  results: LabeledEvaluationResultRecord[];
  tradeoffPairs: ResultTradeoffPair[];
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
    () => (pair ? buildResultTradeoffData(results, pair) : []),
    [results, pair],
  );
  const chartConfig = React.useMemo(
    () => ({
      results: {
        label: "Results",
      },
    }) satisfies ChartConfig,
    [],
  );

  if (!pair) {
    return null;
  }

  return (
    <Card size="sm" className="w-full min-w-0 max-w-full" data-testid="results-tradeoff-chart">
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
                tickFormatter={(value) => formatResultMetricAxisValue(pair.xMetric, Number(value))}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={pair.yMetric.label}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => formatResultMetricAxisValue(pair.yMetric, Number(value))}
              />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={(
                  <ChartTooltipContent
                    hideIndicator
                    labelFormatter={(_label, payload) => {
                      const datum = payload?.[0]?.payload as ResultTradeoffDatum | undefined;
                      return datum?.resultLabel ?? "Result";
                    }}
                    formatter={(_value, _name, item) => {
                      const datum = item.payload as ResultTradeoffDatum;
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
                  key={datum.resultId}
                  data={[datum]}
                  fill={datum.color}
                  isAnimationActive={false}
                  name={datum.resultLabel}
                />
              ))}
            </ScatterChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            No results have both {pair.xMetric.label.toLowerCase()} and {pair.yMetric.label.toLowerCase()} values available.
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
