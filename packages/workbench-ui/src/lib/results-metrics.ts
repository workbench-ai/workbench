import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  compareWorkbenchNaturalText,
  workbenchJobReportMetricBreakdown,
  workbenchSkillVersionIdentity,
  type WorkbenchAgentVersion,
  type WorkbenchEvalVersionSummary,
  type WorkbenchEvalSnapshot,
  type WorkbenchInspectionSnapshot,
  type WorkbenchJob,
  type WorkbenchJobReport,
  type WorkbenchResultCell,
  type WorkbenchResults,
  type WorkbenchRun,
  type WorkbenchSampleCoverage,
  type WorkbenchSkillVersion,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

import {
  formatCost,
  formatDurationMs,
  formatScore,
  formatTimestamp,
  runScore,
  shortId,
} from "./format";

type ResultMetricKind = "number" | "duration_ms" | "currency_usd";
type ResultMetricDirection = "higher" | "lower";
type ResultMetricSemanticRole = "performance" | "speed" | "cost";

export interface ResultMetricDescriptor {
  id: string;
  label: string;
  displayLabel?: string;
  valueLabel?: string;
  testId?: string;
  direction: ResultMetricDirection;
  kind: ResultMetricKind;
  semanticRole?: ResultMetricSemanticRole;
  primary: boolean;
}

export interface ResultEvidenceRow {
  rowId: string;
  groupId: string;
  groupLabel: string;
  setupLabel: string;
  setupRank: number;
  versionId: string;
  versionLabel: string;
  versionDetail: string;
  versionOrdinal: number;
  versionBadges: string[];
  skillName: string;
  evalVersionId: string;
  agentName: string;
  agentHash: string;
  agentDetail: string;
  status?: WorkbenchRun["status"];
  statusLabel: string;
  evidenceLabel: string;
  runId: string | null;
  error?: string;
  coverage?: WorkbenchSampleCoverage;
  score?: number;
  report?: WorkbenchJobReport;
  latencyPerSampleMs?: number;
  costPerSampleUsd?: number;
}

export interface ResultGroupPresentation {
  id: string;
  label: string;
  color: string;
}

export interface ResultEvalVersionOption {
  id: string;
  label: string;
  detail: string;
  subtitle: string;
  ordinal: number;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  caseCount: number;
  gradeAdapter: string;
}

interface ResultGroup {
  id: string;
  label: string;
  skillName: string;
  setupRank: number;
  cells: ResultResolvedCell[];
}

interface ResultResolvedCell {
  cell: WorkbenchResultCell;
  version: WorkbenchSkillVersion;
  agent?: WorkbenchAgentVersion;
  evaluation?: WorkbenchEvalVersionSummary;
}

export interface ResultMetricDatum {
  rowId: string;
  rowLabel: string;
  groupId: string;
  groupLabel: string;
  configurationLabel: string;
  color: string;
  value: number;
  displayValue: string;
}

export interface ResultTradeoffPair {
  key: string;
  label: string;
  xMetric: ResultMetricDescriptor;
  yMetric: ResultMetricDescriptor;
}

export interface ResultTradeoffDatum {
  rowId: string;
  rowLabel: string;
  groupId: string;
  groupLabel: string;
  color: string;
  x: number;
  y: number;
  xDisplay: string;
  yDisplay: string;
}

const RESULT_METRIC_DESCRIPTORS: readonly ResultMetricDescriptor[] = [
  {
    id: "score",
    label: "Score",
    displayLabel: "Quality",
    testId: "quality",
    direction: "higher",
    kind: "number",
    semanticRole: "performance",
    primary: true,
  },
  {
    id: "latencyPerSampleMs",
    label: "Latency per sample",
    displayLabel: "Latency",
    valueLabel: "Run latency per sample",
    testId: "latency",
    direction: "lower",
    kind: "duration_ms",
    semanticRole: "speed",
    primary: true,
  },
  {
    id: "costPerSampleUsd",
    label: "Cost per sample",
    displayLabel: "Cost",
    valueLabel: "Run cost per sample",
    testId: "cost",
    direction: "lower",
    kind: "currency_usd",
    semanticRole: "cost",
    primary: true,
  },
];

export function resultMetricDisplayLabel(descriptor: ResultMetricDescriptor): string {
  return descriptor.displayLabel ?? descriptor.label;
}

export function resultMetricValueLabel(descriptor: ResultMetricDescriptor): string {
  return descriptor.valueLabel ?? resultMetricDisplayLabel(descriptor);
}

export function resultMetricTestId(descriptor: ResultMetricDescriptor): string {
  return descriptor.testId ?? descriptor.id.replace(/[^a-z0-9]+/giu, "-").toLowerCase();
}

export function resultsForScorecard(snapshot: WorkbenchInspectionSnapshot): WorkbenchResults {
  return snapshot.results ?? { skillVersions: [], evalVersions: [], agentVersions: [], cells: [] };
}

export function evalVersionOptionsForResults(
  snapshot: WorkbenchInspectionSnapshot,
): ResultEvalVersionOption[] {
  return [...snapshot.evalVersions]
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map((evaluation) => {
      const gradeAdapter = normalizeGradeAdapter(evaluation.gradeAdapter) ?? "none";
      const detail = evaluationDetail({
        caseCount: evaluation.caseCount,
        gradeAdapter,
      });
      const createdAt = evaluation.createdAt;
      return {
        id: evaluation.id,
        label: evaluation.label,
        detail,
        subtitle: evaluationOptionSubtitle(createdAt, detail, evaluation.current),
        ordinal: evaluation.ordinal,
        isCurrent: evaluation.current,
        createdAt,
        updatedAt: evaluation.updatedAt,
        caseCount: evaluation.caseCount,
        gradeAdapter,
      };
    });
}

export function defaultEvalVersionIdForResults(
  options: readonly ResultEvalVersionOption[],
): string | null {
  return options.find((option) => option.isCurrent)?.id ?? options.at(-1)?.id ?? null;
}

export function buildResultGroups(
  results: WorkbenchResults,
): ResultGroup[] {
  const versionsById = new Map(results.skillVersions.map((version) => [version.id, version]));
  const agentsById = new Map(results.agentVersions.map((agent) => [agent.id, agent]));
  const evaluationsById = new Map(results.evalVersions.map((evaluation) => [evaluation.id, evaluation]));
  const cellsByGroup = new Map<string, ResultResolvedCell[]>();

  for (const cell of results.cells) {
    const version = versionsById.get(cell.skillVersionId);
    if (!version) {
      continue;
    }
    const key = resultGroupId(version);
    const resolvedCell: ResultResolvedCell = {
      cell,
      version,
      ...(agentsById.get(cell.agentVersionId) ? { agent: agentsById.get(cell.agentVersionId) } : {}),
      ...(evaluationsById.get(cell.evalVersionId) ? { evaluation: evaluationsById.get(cell.evalVersionId) } : {}),
    };
    const cells = cellsByGroup.get(key);
    if (cells) {
      cells.push(resolvedCell);
    } else {
      cellsByGroup.set(key, [resolvedCell]);
    }
  }

  const versionOrdinalById = resultVersionOrdinals(results.skillVersions);
  return [...cellsByGroup.entries()].flatMap(([key, cells]): ResultGroup[] => {
    const first = cells[0];
    if (!first) {
      return [];
    }
    return [{
      id: key,
      label: first.version.label,
      skillName: first.version.id,
      setupRank: resultVersionSetupRank(first.version),
      cells: cells.sort((left, right) => compareResolvedCells(left, right, versionOrdinalById)),
    }];
  }).sort((left, right) =>
    left.setupRank - right.setupRank ||
    compareWorkbenchNaturalText(left.label, right.label) ||
    left.id.localeCompare(right.id)
  );
}

export function buildResultEvidenceRows({
  agents,
  groups,
  jobs = [],
  runs,
}: {
  agents: WorkbenchAgentVersion[];
  groups: ResultGroup[];
  jobs?: readonly WorkbenchJob[];
  runs: WorkbenchRun[];
}): ResultEvidenceRow[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const versionOrdinalById = resultVersionOrdinals(groups.flatMap((group) => group.cells.map((entry) => entry.version)));
  const rows = groups.flatMap((group) =>
    group.cells.map(({ agent: resolvedAgent, cell, version }) => {
      const run = cell.runId ? runsById.get(cell.runId) ?? null : null;
      const agent = resolvedAgent ?? agentsById.get(cell.agentVersionId);
      const score = finiteNumber(cell.quality ?? (run ? runScore(run, jobs) : undefined));
      const report = cell.report;
      const latency = workbenchJobReportMetricBreakdown(report, "latency").primary?.value;
      const cost = workbenchJobReportMetricBreakdown(report, "cost").primary?.value;
      const status = cell.status ?? run?.status;
      const error = cell.error ?? run?.error;
      const ordinal = versionOrdinalById.get(version.id) ?? 1;
      return {
        rowId: [
          group.id,
          cell.skillVersionId,
          cell.evalVersionId,
          cell.agentVersionId,
        ].map(encodeResultGroupPart).join("/"),
        groupId: group.id,
        groupLabel: group.label,
        setupLabel: group.label,
        setupRank: group.setupRank,
        versionId: version.id,
        versionLabel: version.label,
        versionDetail: resultVersionDetail(version),
        versionOrdinal: ordinal,
        versionBadges: resultVersionBadges(version),
        skillName: version.id,
        evalVersionId: cell.evalVersionId,
        agentName: agent?.name ?? cell.agentVersionId,
        agentHash: cell.agentVersionId,
        agentDetail: formatAgentVersion(agent),
        ...(status ? { status } : {}),
        statusLabel: status ? formatRunStatusLabel(status) : "Not tested",
        evidenceLabel: formatEvidenceLabel(Boolean(run?.id ?? cell.runId), error),
        runId: run?.id ?? cell.runId ?? null,
        ...(error ? { error } : {}),
        ...(cell.coverage ? { coverage: cell.coverage } : {}),
        ...(score !== undefined ? { score } : {}),
        ...(report ? { report } : {}),
        ...(finiteNumber(latency?.perSample) !== undefined ? { latencyPerSampleMs: finiteNumber(latency?.perSample) } : {}),
        ...(finiteNumber(cost?.perSample) !== undefined ? { costPerSampleUsd: finiteNumber(cost?.perSample) } : {}),
      };
    })
  );
  return collapseUnmeasuredResultRows(rows);
}

export function formatVersionDisplayName(
  versionId: string,
  versions: readonly WorkbenchVersion[],
): string {
  const version = versions.find((entry) => entry.id === versionId);
  if (!version) {
    return shortId(versionId);
  }
  return versionLabel(version, versions);
}

export function formatEvaluationDisplayName(
  evalHash: string,
  evals: readonly WorkbenchEvalSnapshot[],
): string {
  const index = orderEvaluationSnapshots(evals).findIndex((evalSnapshot) => evalSnapshot.hash === evalHash);
  return index >= 0 ? `Eval v${index + 1}` : "Recorded eval";
}

export function formatEvaluationDisplayDetail(
  evalHash: string,
  evals: readonly WorkbenchEvalSnapshot[],
): string {
  const evalSnapshot = evals.find((entry) => entry.hash === evalHash);
  return evaluationDetail(evalSnapshot
    ? { caseCount: evalSnapshot.caseCount, gradeAdapter: evalGradeAdapter(evalSnapshot) }
    : undefined);
}

export function buildResultMetricDescriptors(
  rows: readonly ResultEvidenceRow[],
): ResultMetricDescriptor[] {
  return RESULT_METRIC_DESCRIPTORS.filter((descriptor) =>
    rows.some((row) => getResultMetricValue(row, descriptor) !== undefined)
  );
}

export function selectPrimaryResultMetrics(
  descriptors: ResultMetricDescriptor[] | undefined,
): ResultMetricDescriptor[] {
  const available = descriptors ?? [];
  const primary = available.filter((descriptor) => descriptor.primary);
  if (primary.length > 0) {
    return primary;
  }
  return available.slice(0, 3);
}

export function buildResultMetricData(
  rows: readonly ResultEvidenceRow[],
  descriptor: ResultMetricDescriptor,
  groupColorById?: ReadonlyMap<string, string>,
): ResultMetricDatum[] {
  return rows.flatMap((row, index) => {
    const value = getResultMetricValue(row, descriptor);
    if (value === undefined) {
      return [];
    }
    const groupId = resultVersionGroupId(row);
    return [{
      rowId: row.rowId,
      rowLabel: `${row.versionLabel} / ${row.agentDetail}`,
      groupId,
      groupLabel: row.versionLabel,
      configurationLabel: row.agentDetail,
      color: resolveResultGroupChartColor(groupId, groupColorById, index),
      value,
      displayValue: formatResultMetricValue(descriptor, value),
    }];
  }).sort((left, right) => compareMetricRows(left, right, descriptor));
}

export function buildResultTradeoffPairs(
  descriptors: ResultMetricDescriptor[] | undefined,
): ResultTradeoffPair[] {
  const primary = selectPrimaryResultMetrics(descriptors);
  if (primary.length < 2) {
    return [];
  }

  const performanceMetric = primary.find((descriptor) => descriptor.semanticRole === "performance") ?? primary[0]!;
  return primary
    .filter((descriptor) => descriptor.id !== performanceMetric.id)
    .map((descriptor) => ({
      key: `${performanceMetric.id}::${descriptor.id}`,
      label: `${resultMetricDisplayLabel(performanceMetric)} vs ${resultMetricDisplayLabel(descriptor)}`,
      xMetric: descriptor,
      yMetric: performanceMetric,
    }));
}

export function buildResultTradeoffData(
  rows: readonly ResultEvidenceRow[],
  pair: ResultTradeoffPair,
  groupColorById?: ReadonlyMap<string, string>,
): ResultTradeoffDatum[] {
  return rows.flatMap((row, index) => {
    const x = getResultMetricValue(row, pair.xMetric);
    const y = getResultMetricValue(row, pair.yMetric);
    if (x === undefined || y === undefined) {
      return [];
    }
    const groupId = resultVersionGroupId(row);
    return [{
      rowId: row.rowId,
      rowLabel: `${row.versionLabel} / ${row.agentDetail}`,
      groupId,
      groupLabel: row.versionLabel,
      color: resolveResultGroupChartColor(groupId, groupColorById, index),
      x,
      y,
      xDisplay: formatResultMetricValue(pair.xMetric, x),
      yDisplay: formatResultMetricValue(pair.yMetric, y),
    }];
  });
}

export function formatResultMetricValue(
  descriptor: ResultMetricDescriptor,
  value: number | undefined,
): string {
  if (value === undefined) {
    return "n/a";
  }
  if (descriptor.kind === "duration_ms") {
    return formatDurationMs(value);
  }
  if (descriptor.kind === "currency_usd") {
    return formatCost(value);
  }
  return formatScore(value);
}

export function missingCostLabelForStatus(statusLabel: string | null | undefined, hasRun: boolean): string {
  if (!hasRun) {
    return "Not tested";
  }
  const normalized = statusLabel?.trim().toLowerCase();
  if (normalized === "failed" || normalized === "canceled") {
    return "Failed before usage";
  }
  return "Not reported";
}

function getResultMetricValue(
  row: ResultEvidenceRow,
  descriptor: ResultMetricDescriptor,
): number | undefined {
  if (descriptor.id === "score") {
    return finiteNumber(row.score);
  }
  if (descriptor.id === "latencyPerSampleMs") {
    return finiteNumber(row.latencyPerSampleMs);
  }
  if (descriptor.id === "costPerSampleUsd") {
    return finiteNumber(row.costPerSampleUsd);
  }
  return undefined;
}

function resolveResultGroupChartColor(
  groupId: string,
  groupColorById: ReadonlyMap<string, string> | undefined,
  fallbackIndex: number,
): string {
  return groupColorById?.get(groupId) ?? getCategoricalChartColor(fallbackIndex);
}

export function resultVersionGroupId(row: ResultEvidenceRow): string {
  if (row.versionDetail === "local:.") {
    return row.versionId;
  }
  return `${row.versionLabel}\0${row.versionDetail}`;
}

function resultGroupId(version: WorkbenchSkillVersion): string {
  return ["version", version.id].map(encodeResultGroupPart).join("/");
}

function resultVersionOrdinals(versions: readonly WorkbenchSkillVersion[]): Map<string, number> {
  const unique = new Map<string, WorkbenchSkillVersion>();
  for (const version of versions) {
    unique.set(version.id, version);
  }
  const sorted = [...unique.values()].sort(compareResultVersions);
  return new Map(sorted.map((version, index) => [version.id, index + 1]));
}

function compareResultVersions(left: WorkbenchSkillVersion, right: WorkbenchSkillVersion): number {
  return compareWorkbenchNaturalText(workbenchSkillVersionIdentity(left), workbenchSkillVersionIdentity(right)) ||
    compareWorkbenchNaturalText(left.label, right.label) ||
    left.id.localeCompare(right.id);
}

function resultVersionSetupRank(version: WorkbenchSkillVersion): number {
  if (version.current) {
    return 0;
  }
  if (version.source === "none" || version.sourceKind === "none") {
    return 1;
  }
  return 2;
}

function compareResolvedCells(
  left: ResultResolvedCell,
  right: ResultResolvedCell,
  versionOrdinalById: ReadonlyMap<string, number>,
): number {
  return (versionOrdinalById.get(right.version.id) ?? 0) - (versionOrdinalById.get(left.version.id) ?? 0) ||
    compareWorkbenchNaturalText(agentLabel(left.agent), agentLabel(right.agent)) ||
    left.cell.evalVersionId.localeCompare(right.cell.evalVersionId) ||
    left.cell.agentVersionId.localeCompare(right.cell.agentVersionId);
}

function resultVersionDetail(version: WorkbenchSkillVersion): string {
  return version.source ?? (version.contentHash ? shortId(version.contentHash) : shortId(version.id));
}

function resultVersionBadges(version: WorkbenchSkillVersion): string[] {
  const badges: string[] = [];
  if (version.current) {
    badges.push("Current");
  }
  if (version.published) {
    badges.push("Published");
  }
  return badges;
}

function versionLabel(version: WorkbenchVersion, versions: readonly WorkbenchVersion[]): string {
  return `Version ${versionOrdinal(version, versions)}`;
}

function versionOrdinal(version: WorkbenchVersion, versions: readonly WorkbenchVersion[]): number {
  const sorted = versions.slice().sort(compareVersionsByCreatedAt);
  const index = sorted.findIndex((entry) => entry.id === version.id);
  return index >= 0 ? index + 1 : 1;
}

function compareVersionsByCreatedAt(left: WorkbenchVersion, right: WorkbenchVersion): number {
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || compareWorkbenchNaturalText(left.id, right.id);
}

function sentenceCaseReadable(value: string, fallback: string): string {
  const words = value
    .replace(/^v_/u, "")
    .replaceAll(/[_/-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) {
    return fallback;
  }
  return words
    .map((word, index) => readableWord(word, index))
    .join(" ");
}

function readableWord(word: string, index: number): string {
  if (/^[A-Z0-9]+$/u.test(word)) {
    return word;
  }
  const lower = word.toLowerCase();
  return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
}

function encodeResultGroupPart(value: string): string {
  return encodeURIComponent(value);
}

function orderEvaluationSnapshots(evals: readonly WorkbenchEvalSnapshot[]): WorkbenchEvalSnapshot[] {
  return [...evals].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.hash.localeCompare(right.hash)
  );
}

function evaluationDetail(
  evaluation: Pick<WorkbenchEvalVersionSummary, "caseCount" | "gradeAdapter"> | undefined,
): string {
  const parts = [
    evaluation?.caseCount !== undefined ? formatEvalCaseCount(evaluation.caseCount) : null,
    evaluation?.gradeAdapter ? formatGradeAdapter(evaluation.gradeAdapter) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : "Recorded evaluation";
}

function evaluationOptionSubtitle(
  createdAt: string,
  detail: string,
  isCurrent: boolean,
): string {
  const context = isCurrent
    ? "Current"
    : createdAt
      ? `Created ${formatTimestamp(createdAt)}`
      : "Recorded";
  return [context, detail].join(" / ");
}

function formatEvalCaseCount(caseCount: number): string {
  return `${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
}

function evalGradeAdapter(evalSnapshot: WorkbenchEvalSnapshot): string {
  return normalizeGradeAdapter(evalSnapshot.grade.adapter) ?? "none";
}

function normalizeGradeAdapter(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function formatGradeAdapter(adapter: string): string {
  if (adapter === "tests") {
    return "test grader";
  }
  if (adapter === "rubric") {
    return "criteria grader";
  }
  return `${sentenceCaseReadable(adapter, "Custom")} grader`;
}

function formatAgentVersion(agent: WorkbenchAgentVersion | undefined): string {
  if (!agent) {
    return "Recorded configuration";
  }
  return agent.label || [agent.adapter, agent.model].filter(Boolean).join(" / ") || agent.name;
}

function agentLabel(agent: WorkbenchAgentVersion | undefined): string {
  return formatAgentVersion(agent);
}

function collapseUnmeasuredResultRows(rows: readonly ResultEvidenceRow[]): ResultEvidenceRow[] {
  const rowsByVersion = new Map<string, ResultEvidenceRow[]>();
  for (const row of rows) {
    const groupRows = rowsByVersion.get(row.versionId);
    if (groupRows) {
      groupRows.push(row);
    } else {
      rowsByVersion.set(row.versionId, [row]);
    }
  }

  const visibleRows: ResultEvidenceRow[] = [];
  for (const groupRows of rowsByVersion.values()) {
    const measuredRows = groupRows.filter((row) =>
      row.runId ||
      row.score !== undefined ||
      row.latencyPerSampleMs !== undefined ||
      row.costPerSampleUsd !== undefined ||
      row.report !== undefined
    );
    if (measuredRows.length > 0) {
      visibleRows.push(...measuredRows);
      continue;
    }
    const first = groupRows[0];
    if (!first) {
      continue;
    }
    visibleRows.push({
      ...first,
      rowId: `${first.versionId}/no-scorecard`,
      agentName: "No scorecard yet",
      agentHash: "no-scorecard",
      agentDetail: "Run an eval to compare this version.",
      statusLabel: "Not tested",
      evidenceLabel: "No run yet",
      runId: null,
    });
  }
  return visibleRows;
}

function formatRunStatusLabel(status: WorkbenchRun["status"]): string {
  if (status === "succeeded") {
    return "Succeeded";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "canceled") {
    return "Canceled";
  }
  return "Running";
}

function formatEvidenceLabel(hasRun: boolean, error: string | undefined): string {
  if (!hasRun) {
    return "No run yet";
  }
  if (error?.trim()) {
    return truncateText(summarizeRunError(error), 96);
  }
  return "View details";
}

function summarizeRunError(error: string): string {
  const normalized = singleLine(error);
  const message = extractEmbeddedErrorMessage(normalized);
  if (message) {
    return message;
  }
  return normalized.replace(/\s+at\s+\S.*$/u, "").trim();
}

function extractEmbeddedErrorMessage(value: string): string | null {
  const match = /(?:\\?")message(?:\\?")\s*:\s*(?:\\?")([^"\\]*(?:\\.[^"\\]*)*)(?:\\?")/u.exec(value);
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\").trim() || null;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
    : value;
}

function compareMetricRows(
  left: ResultMetricDatum,
  right: ResultMetricDatum,
  descriptor: ResultMetricDescriptor,
): number {
  const valueOrder = descriptor.direction === "higher"
    ? right.value - left.value
    : left.value - right.value;
  if (valueOrder !== 0) {
    return valueOrder;
  }
  return compareWorkbenchNaturalText(left.rowLabel, right.rowLabel);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
