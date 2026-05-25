import type {
  EvaluationUsageStats,
  ExecutionRole,
  ExecutionUsage,
  ExecutionUsageCostSource,
  Json,
  MetricStats,
  UsageSummary,
} from "@workbench-ai/workbench-contract";

import {
  LITELLM_MODEL_PRICES,
  LITELLM_PRICING_SOURCE,
  type LiteLLMModelPrice,
} from "./model-prices-litellm.ts";
import {
  jsonRecord,
  numberValue,
  stringValue,
} from "./runtime-utils.ts";

const NUMERIC_USAGE_FIELDS = [
  "inputTokens",
  "uncachedInputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
  "costUsd",
] as const satisfies readonly (keyof ExecutionUsage)[];

const USAGE_ROLES = [
  "optimizer",
  "runner",
  "engine",
] as const satisfies readonly ExecutionRole[];

type NumericUsageField = typeof NUMERIC_USAGE_FIELDS[number];

export function extractExecutionUsageFromTrace(
  trace: unknown,
  provider: { model?: string },
  providerId: string,
  events: readonly unknown[] = [],
): UsageSummary | undefined {
  const usage = selectBestExecutionUsage([
    ...usageRecordsFromTraceSummaries(trace),
    ...usageRecordsFromTraceEntries(jsonRecord(trace).spans, "started_at"),
    ...usageRecordsFromTraceEntries(jsonRecord(trace).events, "at"),
    ...usageRecordsFromAgentEvents(events),
  ].map((record) =>
    normalizeExecutionUsage(record.usage, {
      provider: providerId,
      model: provider.model,
    }),
  ));
  return usage ? usageSummaryFromExecutionUsage(usage) : undefined;
}

export function assignUsageRole(
  role: ExecutionRole,
  usage: UsageSummary | undefined,
): UsageSummary | undefined {
  const execution = usage?.[role] ?? usage?.total;
  if (!execution) {
    return usage;
  }
  return completeUsageSummary({
    [role]: execution,
  });
}

export function usageSummaryFromExecutionUsage(
  usage: ExecutionUsage | undefined,
): UsageSummary | undefined {
  return usage ? { total: usage } : undefined;
}

export function completeUsageSummary(
  usage: UsageSummary | undefined,
): UsageSummary | undefined {
  if (!usage) {
    return undefined;
  }
  const optimizer = usage.optimizer ? normalizeExecutionUsage(usage.optimizer) : undefined;
  const runner = usage.runner ? normalizeExecutionUsage(usage.runner) : undefined;
  const engine = usage.engine ? normalizeExecutionUsage(usage.engine) : undefined;
  const roleTotal = mergeExecutionUsage([
    optimizer,
    runner,
    engine,
  ]);
  const total = roleTotal ?? normalizeExecutionUsage(usage.total);
  return compactUsageSummary({
    ...(total ? { total } : {}),
    ...(optimizer ? { optimizer } : {}),
    ...(runner ? { runner } : {}),
    ...(engine ? { engine } : {}),
  });
}

export function normalizeUsageSummary(value: unknown): UsageSummary | undefined {
  const record = jsonRecord(value);
  const total = normalizeExecutionUsage(record.total);
  const optimizer = normalizeExecutionUsage(record.optimizer);
  const runner = normalizeExecutionUsage(record.runner);
  const engine = normalizeExecutionUsage(record.engine);
  return completeUsageSummary({
    ...(total ? { total } : {}),
    ...(optimizer ? { optimizer } : {}),
    ...(runner ? { runner } : {}),
    ...(engine ? { engine } : {}),
  });
}

export function mergeUsageSummaries(
  summaries: readonly (UsageSummary | undefined)[],
): UsageSummary | undefined {
  const entries = summaries.flatMap((summary) => {
    const normalized = completeUsageSummary(summary);
    return normalized ? [normalized] : [];
  });
  if (entries.length === 0) {
    return undefined;
  }
  return compactUsageSummary({
    total: mergeExecutionUsage(entries.map((entry) => entry.total)),
    optimizer: mergeExecutionUsage(entries.map((entry) => entry.optimizer)),
    runner: mergeExecutionUsage(entries.map((entry) => entry.runner)),
    engine: mergeExecutionUsage(entries.map((entry) => entry.engine)),
  });
}

export function mergeUsageRoles(
  roles: Partial<Record<ExecutionRole, UsageSummary | undefined>>,
): UsageSummary | undefined {
  const optimizer = completeUsageSummary(roles.optimizer);
  const runner = completeUsageSummary(roles.runner);
  const engine = completeUsageSummary(roles.engine);
  return completeUsageSummary({
    optimizer: optimizer?.optimizer ?? optimizer?.total,
    runner: runner?.runner ?? runner?.total,
    engine: engine?.engine ?? engine?.total,
  });
}

export function usageStats(
  summaries: readonly UsageSummary[],
): EvaluationUsageStats | undefined {
  const roles = Object.fromEntries(
    (["total", ...USAGE_ROLES] as const).flatMap((role) => {
      const stats = executionUsageStats(summaries.map((summary) => summary[role]));
      return stats ? [[role, stats]] : [];
    }),
  ) as EvaluationUsageStats;
  return Object.keys(roles).length > 0 ? roles : undefined;
}

function normalizeExecutionUsage(
  value: unknown,
  defaults: { provider?: string; model?: string } = {},
): ExecutionUsage | undefined {
  const record = jsonRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const providerName = stringValue(record.provider) ?? defaults.provider;
  const model = stringValue(record.model) ?? defaults.model;
  const usage: ExecutionUsage = {
    ...(providerName ? { provider: providerName } : {}),
    ...(model ? { model } : {}),
    ...numberField(record, "inputTokens", "input_tokens"),
    ...numberField(record, "uncachedInputTokens", "uncached_input_tokens"),
    ...numberField(record, "cachedInputTokens", "cached_input_tokens"),
    ...numberField(record, "cacheCreationInputTokens", "cache_creation_input_tokens"),
    ...numberField(record, "cacheReadInputTokens", "cache_read_input_tokens"),
    ...numberField(record, "outputTokens", "output_tokens"),
    ...numberField(record, "reasoningOutputTokens", "reasoning_output_tokens"),
    ...numberField(record, "totalTokens", "total_tokens"),
    ...numberField(record, "costUsd", "total_cost_usd", "totalCostUsd"),
  };
  const totalTokens = usage.totalTokens ?? inferredTotalTokens(usage);
  const providerCost = numberValue(record.total_cost_usd);
  const existingCost = usage.costUsd;
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  if (existingCost === undefined) {
    const estimate = estimateExecutionCost(usage);
    if (estimate) {
      usage.costUsd = estimate.costUsd;
      usage.costSource = "estimated";
      usage.pricingSource = estimate.pricingSource;
    }
  } else if (providerCost !== undefined) {
    usage.costSource = "provider";
    usage.pricingSource = stringValue(record.pricing_source)
      ?? stringValue(record.pricingSource)
      ?? "provider";
  } else {
    const costSource = normalizeCostSource(record.costSource ?? record.cost_source);
    if (costSource) {
      usage.costSource = costSource;
    }
    const pricingSource = stringValue(record.pricingSource) ?? stringValue(record.pricing_source);
    if (pricingSource) {
      usage.pricingSource = pricingSource;
    }
  }
  if (!hasUsageSignal(usage)) {
    return undefined;
  }
  return usage;
}

function mergeExecutionUsage(
  entries: readonly (ExecutionUsage | undefined)[],
): ExecutionUsage | undefined {
  const usages = entries.flatMap((entry) => {
    const normalized = normalizeExecutionUsage(entry);
    return normalized ? [normalized] : [];
  });
  if (usages.length === 0) {
    return undefined;
  }
  const merged: ExecutionUsage = {
    ...mergeIdentity(usages),
    ...Object.fromEntries(
      NUMERIC_USAGE_FIELDS.flatMap((field) => {
        const value = sumFinite(usages.map((usage) => usage[field]));
        return value === undefined ? [] : [[field, value]];
      }),
    ),
  };
  const costSource = mergeCostSource(usages.map((usage) => usage.costSource));
  if (costSource) {
    merged.costSource = costSource;
  }
  const pricingSource = uniqueString(usages.map((usage) => usage.pricingSource));
  if (pricingSource) {
    merged.pricingSource = pricingSource;
  }
  return hasUsageSignal(merged) ? merged : undefined;
}

function executionUsageStats(
  entries: readonly (ExecutionUsage | undefined)[],
): EvaluationUsageStats["total"] | undefined {
  const usages = entries.flatMap((entry) => {
    const normalized = normalizeExecutionUsage(entry);
    return normalized ? [normalized] : [];
  });
  if (usages.length === 0) {
    return undefined;
  }
  const stats = Object.fromEntries(
    NUMERIC_USAGE_FIELDS.flatMap((field) => {
      const values = usages.flatMap((usage) => {
        const value = usage[field];
        return typeof value === "number" && Number.isFinite(value) ? [value] : [];
      });
      return values.length > 0 ? [[field, metricStats(values)]] : [];
    }),
  ) as EvaluationUsageStats["total"];
  return stats && Object.keys(stats).length > 0 ? stats : undefined;
}

function usageRecordsFromTraceSummaries(trace: unknown): Array<{ at: string; usage: Record<string, Json> }> {
  const summaries = jsonRecord(trace).summaries;
  if (!Array.isArray(summaries)) {
    return [];
  }
  return summaries.flatMap((entry) => {
    const record = jsonRecord(entry);
    const usage = jsonRecord(record.usage);
    return Object.keys(usage).length > 0
      ? [{
          at: stringValue(record.ended_at) ?? stringValue(record.started_at) ?? "",
          usage,
        }]
      : [];
  });
}

function usageRecordsFromTraceEntries(
  value: unknown,
  timestampKey: "at" | "started_at",
): Array<{ at: string; usage: Record<string, Json> }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = jsonRecord(entry);
    if (record.kind !== "usage") {
      return [];
    }
    const usage = usageRecordFromAttributes(jsonRecord(record.attributes));
    return usage
      ? [{
          at: stringValue(record[timestampKey]) ?? "",
          usage,
        }]
      : [];
  });
}

function usageRecordsFromAgentEvents(events: readonly unknown[]): Array<{ at: string; usage: Record<string, Json> }> {
  return events.flatMap((event) => {
    const record = jsonRecord(event);
    if (record.name !== "thread/tokenUsage/updated" && record.method !== "thread/tokenUsage/updated") {
      return [];
    }
    const tokenUsage = jsonRecord(jsonRecord(record.payload).tokenUsage);
    const total = jsonRecord(tokenUsage.total);
    if (Object.keys(total).length === 0) {
      return [];
    }
    const totalTokens = numberValue(total.totalTokens);
    const inputTokens = numberValue(total.inputTokens);
    const outputTokens = numberValue(total.outputTokens);
    const cachedInputTokens = numberValue(total.cachedInputTokens);
    const reasoningOutputTokens = numberValue(total.reasoningOutputTokens);
    const usage = {
      ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { cached_input_tokens: cachedInputTokens } : {}),
      ...(reasoningOutputTokens !== undefined ? { reasoning_output_tokens: reasoningOutputTokens } : {}),
    } satisfies Record<string, Json>;
    return hasUsageRecordSignal(usage)
      ? [{
          at: stringValue(record.at) ?? "",
          usage,
        }]
      : [];
  });
}

function usageRecordFromAttributes(attributes: Record<string, Json>): Record<string, Json> | undefined {
  const usage = {
    ...copyNumber(attributes, "input_tokens"),
    ...copyNumber(attributes, "uncached_input_tokens"),
    ...copyNumber(attributes, "cached_input_tokens"),
    ...copyNumber(attributes, "cache_creation_input_tokens"),
    ...copyNumber(attributes, "cache_read_input_tokens"),
    ...copyNumber(attributes, "output_tokens"),
    ...copyNumber(attributes, "reasoning_output_tokens"),
    ...copyNumber(attributes, "total_tokens"),
    ...copyNumber(attributes, "total_cost_usd"),
    ...(stringValue(attributes.cost_source) ? { cost_source: stringValue(attributes.cost_source)! } : {}),
    ...(stringValue(attributes.pricing_source) ? { pricing_source: stringValue(attributes.pricing_source)! } : {}),
  } satisfies Record<string, Json>;
  return hasUsageRecordSignal(usage) ? usage : undefined;
}

function selectBestExecutionUsage(
  entries: readonly (ExecutionUsage | undefined)[],
): ExecutionUsage | undefined {
  return entries
    .flatMap((entry) => {
      const normalized = normalizeExecutionUsage(entry);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => usageDetailScore(left) - usageDetailScore(right))
    .at(-1);
}

function usageDetailScore(usage: ExecutionUsage): number {
  const costScore = usage.costUsd !== undefined ? 100 : 0;
  const tokenScore = NUMERIC_USAGE_FIELDS.filter((field) => usage[field] !== undefined).length;
  const totalScore = usage.totalTokens ?? 0;
  return costScore + tokenScore + Math.min(totalScore / 1_000_000_000, 1);
}

function estimateExecutionCost(
  usage: ExecutionUsage,
): { costUsd: number; pricingSource: string } | undefined {
  if (!usage.model) {
    return undefined;
  }
  const price = LITELLM_MODEL_PRICES[usage.model as keyof typeof LITELLM_MODEL_PRICES] as LiteLLMModelPrice | undefined;
  if (!price) {
    return undefined;
  }
  const inputPrice = price.input_cost_per_token;
  const outputPrice = price.output_cost_per_token;
  if (typeof inputPrice !== "number" && typeof outputPrice !== "number") {
    return undefined;
  }
  const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadInputTokens
    ?? (usage.cachedInputTokens !== undefined
      ? Math.max(usage.cachedInputTokens - cacheCreationTokens, 0)
      : 0);
  const uncachedInputTokens = usage.uncachedInputTokens
    ?? (usage.inputTokens !== undefined
      ? Math.max(usage.inputTokens - cacheReadTokens - cacheCreationTokens, 0)
      : 0);
  const outputTokens = usage.outputTokens ?? 0;
  if (uncachedInputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0 && outputTokens === 0) {
    return undefined;
  }
  const costUsd =
    (uncachedInputTokens * (inputPrice ?? 0)) +
    (cacheReadTokens * (price.cache_read_input_token_cost ?? inputPrice ?? 0)) +
    (cacheCreationTokens * (price.cache_creation_input_token_cost ?? inputPrice ?? 0)) +
    (outputTokens * (outputPrice ?? 0));
  return Number.isFinite(costUsd) && costUsd > 0
    ? {
        costUsd: roundUsageNumber(costUsd),
        pricingSource: LITELLM_PRICING_SOURCE,
      }
    : undefined;
}

function inferredTotalTokens(usage: ExecutionUsage): number | undefined {
  const inputTokens = usage.inputTokens ?? usage.cachedInputTokens;
  if (inputTokens === undefined && usage.outputTokens === undefined) {
    return undefined;
  }
  return sumFinite([
    inputTokens,
    usage.outputTokens,
  ]);
}

function numberField(
  record: Record<string, Json>,
  camelKey: NumericUsageField,
  ...snakeKeys: string[]
): Partial<ExecutionUsage> {
  const value = numberValue(record[camelKey])
    ?? snakeKeys.map((key) => numberValue(record[key])).find((entry) => entry !== undefined);
  return value === undefined ? {} : { [camelKey]: value };
}

function copyNumber(
  record: Record<string, Json>,
  key: string,
): Record<string, Json> {
  const value = numberValue(record[key]);
  return value === undefined ? {} : { [key]: value };
}

function hasUsageRecordSignal(record: Record<string, Json>): boolean {
  return [
    "input_tokens",
    "uncached_input_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "total_cost_usd",
  ].some((key) => numberValue(record[key]) !== undefined);
}

function hasUsageSignal(usage: ExecutionUsage): boolean {
  return NUMERIC_USAGE_FIELDS.some((field) => usage[field] !== undefined);
}

function compactUsageSummary(usage: UsageSummary): UsageSummary | undefined {
  const output = Object.fromEntries(
    (["total", ...USAGE_ROLES] as const).flatMap((role) => usage[role] ? [[role, usage[role]]] : []),
  ) as UsageSummary;
  return Object.keys(output).length > 0 ? output : undefined;
}

function mergeIdentity(usages: readonly ExecutionUsage[]): Partial<Pick<ExecutionUsage, "provider" | "model">> {
  const provider = uniqueString(usages.map((usage) => usage.provider));
  const model = uniqueString(usages.map((usage) => usage.model));
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}

function mergeCostSource(
  values: readonly (ExecutionUsageCostSource | undefined)[],
): ExecutionUsageCostSource | undefined {
  const unique = [...new Set(values.filter((value): value is ExecutionUsageCostSource => Boolean(value)))];
  if (unique.length === 0) {
    return undefined;
  }
  return unique.length === 1 ? unique[0] : "mixed";
}

function normalizeCostSource(value: unknown): ExecutionUsageCostSource | undefined {
  return value === "provider" || value === "estimated" || value === "mixed"
    ? value
    : undefined;
}

function sumFinite(values: readonly unknown[]): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) {
    return undefined;
  }
  return roundUsageNumber(finite.reduce((sum, value) => sum + value, 0));
}

function roundUsageNumber(value: number): number {
  return Number(value.toFixed(6));
}

function uniqueString(values: readonly unknown[]): string | undefined {
  const unique = [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
  return unique.length === 1 ? unique[0] : undefined;
}

function metricStats(values: number[]): MetricStats {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      variance: 0,
      stddev: 0,
      min: 0,
      max: 0,
    };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  return {
    count,
    mean,
    variance,
    stddev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
