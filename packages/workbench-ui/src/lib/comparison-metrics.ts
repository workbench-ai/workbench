import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import type {
  WorkbenchAgentVersion,
  WorkbenchEvalSnapshot,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchResultCell,
  WorkbenchResultEvaluation,
  WorkbenchResults,
  WorkbenchRun,
  WorkbenchSkillVersion,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

import {
  formatCost,
  formatDurationMs,
  formatScore,
  formatTimestamp,
  runScore,
  shortId,
} from "./format";

export type ComparisonMetricKind = "number" | "duration_ms" | "currency_usd";
export type ComparisonMetricDirection = "higher" | "lower";
export type ComparisonMetricSemanticRole = "performance" | "speed" | "cost";

export interface ComparisonMetricDescriptor {
  id: string;
  label: string;
  direction: ComparisonMetricDirection;
  kind: ComparisonMetricKind;
  semanticRole?: ComparisonMetricSemanticRole;
  primary: boolean;
}

export interface ComparisonEvidenceRow {
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
  evalHash: string;
  agentName: string;
  agentHash: string;
  agentDetail: string;
  status?: WorkbenchRun["status"];
  statusLabel: string;
  evidenceLabel: string;
  runId: string | null;
  error?: string;
  samples?: number;
  score?: number;
  latencyMs?: number;
  costUsd?: number;
}

export interface ComparisonGroupPresentation {
  id: string;
  label: string;
  color: string;
}

export interface ComparisonEvaluationOption {
  id: string;
  label: string;
  detail: string;
  subtitle: string;
  ordinal: number;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
  caseCount: number;
  gradeAdapter: string;
}

export interface ComparisonGroup {
  id: string;
  label: string;
  skillName: string;
  setupRank: number;
  cells: ComparisonResolvedCell[];
}

export interface ComparisonResolvedCell {
  cell: WorkbenchResultCell;
  version: WorkbenchSkillVersion;
  agent?: WorkbenchAgentVersion;
  evaluation?: WorkbenchResultEvaluation;
}

export interface ComparisonMetricDatum {
  rowId: string;
  rowLabel: string;
  groupId: string;
  groupLabel: string;
  configurationLabel: string;
  color: string;
  value: number;
  displayValue: string;
}

export interface ComparisonTradeoffPair {
  key: string;
  label: string;
  xMetric: ComparisonMetricDescriptor;
  yMetric: ComparisonMetricDescriptor;
}

export interface ComparisonTradeoffDatum {
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

export interface ComparisonLabelContext {
  allVersions?: readonly WorkbenchVersion[];
  currentVersionId?: string | null;
  defaultSkill?: string | null;
  publishedVersionId?: string | null;
}

const METRIC_DESCRIPTORS: ComparisonMetricDescriptor[] = [
  {
    id: "score",
    label: "Score",
    direction: "higher",
    kind: "number",
    semanticRole: "performance",
    primary: true,
  },
  {
    id: "latencyMs",
    label: "Latency",
    direction: "lower",
    kind: "duration_ms",
    semanticRole: "speed",
    primary: true,
  },
  {
    id: "costUsd",
    label: "Cost",
    direction: "lower",
    kind: "currency_usd",
    semanticRole: "cost",
    primary: true,
  },
];

export function comparisonForSnapshot(snapshot: WorkbenchInspectionSnapshot): WorkbenchResults {
  return snapshot.results ?? { versions: [], evaluations: [], agents: [], cells: [] };
}

export function comparisonForScorecard(snapshot: WorkbenchInspectionSnapshot): WorkbenchResults {
  return comparisonForSnapshot(snapshot);
}

export function evaluationOptionsForScorecard(
  snapshot: WorkbenchInspectionSnapshot,
  results: WorkbenchResults,
): ComparisonEvaluationOption[] {
  const resultEvaluationIds = new Set(results.cells.map((cell) => cell.evaluationId));
  const resultEvaluationById = new Map(results.evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const orderedSnapshotEvals = orderEvaluationSnapshots(snapshot.evals).filter((evaluation) =>
    resultEvaluationIds.has(evaluation.hash)
  );
  const optionRecords: Array<{
    id: string;
    label?: string;
    caseCount?: number;
    gradeAdapter?: string;
    createdAt?: string;
    updatedAt?: string;
    snapshot?: WorkbenchEvalSnapshot;
  }> = orderedSnapshotEvals.map((snapshotEval) => {
    const resultEvaluation = resultEvaluationById.get(snapshotEval.hash);
    return {
      id: snapshotEval.hash,
      label: resultEvaluation?.label,
      caseCount: resultEvaluation?.caseCount ?? snapshotEval.caseCount,
      gradeAdapter: resultEvaluation?.gradeAdapter ?? snapshotEval.gradeAdapter,
      createdAt: resultEvaluation?.createdAt ?? snapshotEval.createdAt,
      updatedAt: resultEvaluation?.updatedAt ?? snapshotEval.updatedAt,
      snapshot: snapshotEval,
    };
  });

  const seen = new Set(optionRecords.map((record) => record.id));
  for (const evaluation of results.evaluations) {
    if (!resultEvaluationIds.has(evaluation.id) || seen.has(evaluation.id)) {
      continue;
    }
    seen.add(evaluation.id);
    optionRecords.push(evaluation);
  }

  optionRecords.sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.id.localeCompare(right.id)
  );

  const latestEvaluationId = optionRecords.at(-1)?.id ?? null;
  return optionRecords.map((evaluation, index) => {
    const gradeAdapter = normalizeGradeAdapter(evaluation.gradeAdapter) ?? "tests";
    const detail = evaluationDetail({
      caseCount: evaluation.caseCount,
      gradeAdapter,
    });
    const isLatest = evaluation.id === latestEvaluationId;
    const label = evaluation.label?.trim() || `Evaluation ${index + 1}`;
    const createdAt = evaluation.createdAt ?? "";
    return {
      id: evaluation.id,
      label,
      detail,
      subtitle: evaluationOptionSubtitle(createdAt, detail, isLatest),
      ordinal: index + 1,
      isLatest,
      createdAt,
      updatedAt: evaluation.updatedAt ?? createdAt,
      caseCount: evaluation.caseCount ?? 0,
      gradeAdapter,
    };
  });
}

export function defaultEvaluationIdForScorecard(
  options: readonly ComparisonEvaluationOption[],
): string | null {
  return options.find((option) => option.isLatest)?.id ?? null;
}

export function buildComparisonGroups(
  results: WorkbenchResults,
  _context: ComparisonLabelContext = {},
): ComparisonGroup[] {
  const versionsById = new Map(results.versions.map((version) => [version.id, version]));
  const agentsById = new Map(results.agents.map((agent) => [agent.id, agent]));
  const evaluationsById = new Map(results.evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const cellsByGroup = new Map<string, ComparisonResolvedCell[]>();

  for (const cell of results.cells) {
    const version = versionsById.get(cell.skillVersionId);
    if (!version) {
      continue;
    }
    const key = resultGroupId(version);
    const resolvedCell: ComparisonResolvedCell = {
      cell,
      version,
      ...(agentsById.get(cell.agentVersionId) ? { agent: agentsById.get(cell.agentVersionId) } : {}),
      ...(evaluationsById.get(cell.evaluationId) ? { evaluation: evaluationsById.get(cell.evaluationId) } : {}),
    };
    const cells = cellsByGroup.get(key);
    if (cells) {
      cells.push(resolvedCell);
    } else {
      cellsByGroup.set(key, [resolvedCell]);
    }
  }

  const versionOrdinalById = resultVersionOrdinals(results.versions);
  return [...cellsByGroup.entries()].flatMap(([key, cells]): ComparisonGroup[] => {
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
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
  );
}

export function buildComparisonEvidenceRows({
  agents,
  groups,
  jobs = [],
  runs,
}: {
  agents: WorkbenchAgentVersion[];
  context?: ComparisonLabelContext;
  groups: ComparisonGroup[];
  jobs?: readonly WorkbenchJob[];
  runs: WorkbenchRun[];
}): ComparisonEvidenceRow[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const versionOrdinalById = resultVersionOrdinals(groups.flatMap((group) => group.cells.map((entry) => entry.version)));
  const rows = groups.flatMap((group) =>
    group.cells.map(({ agent: resolvedAgent, cell, version }) => {
      const run = cell.runId ? runsById.get(cell.runId) ?? null : null;
      const agent = resolvedAgent ?? agentsById.get(cell.agentVersionId);
      const score = finiteNumber(cell.quality ?? (run ? runScore(run, jobs) : undefined));
      const latencyMs = finiteNumber(cell.latencyMs ?? run?.latencyMs);
      const costUsd = finiteNumber(cell.costUsd ?? run?.costUsd);
      const samples = finiteNumber(cell.samples);
      const status = cell.status ?? run?.status;
      const error = cell.error ?? run?.error;
      const ordinal = versionOrdinalById.get(version.id) ?? 1;
      return {
        rowId: [
          group.id,
          cell.skillVersionId,
          cell.evaluationId,
          cell.agentVersionId,
        ].map(encodeComparisonGroupPart).join("/"),
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
        evalHash: cell.evaluationId,
        agentName: agent?.name ?? cell.agentVersionId,
        agentHash: cell.agentVersionId,
        agentDetail: formatAgentVersion(agent),
        ...(status ? { status } : {}),
        statusLabel: status ? formatRunStatusLabel(status) : "Not tested",
        evidenceLabel: formatEvidenceLabel(Boolean(run?.id ?? cell.runId), error),
        runId: run?.id ?? cell.runId ?? null,
        ...(error ? { error } : {}),
        ...(samples !== undefined ? { samples } : {}),
        ...(score !== undefined ? { score } : {}),
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      };
    })
  );
  return collapseUnmeasuredComparisonRows(rows);
}

export function formatVersionDisplayName(
  versionId: string,
  versions: readonly WorkbenchVersion[],
  _context: ComparisonLabelContext = {},
): string {
  const version = versions.find((entry) => entry.id === versionId);
  if (!version) {
    return shortId(versionId);
  }
  return versionLabel(version, versions);
}

export function formatSkillDisplayName(
  skillName: string,
  context: ComparisonLabelContext = {},
): string {
  const normalized = skillName.trim();
  if (isActiveSkillName(normalized, context.defaultSkill?.trim())) {
    return "Active skill";
  }
  if (normalized === "no-skill") {
    return "No skill baseline";
  }
  return readableSkillName(normalized);
}

export function formatEvaluationDisplayName(
  evalHash: string,
  evals: readonly WorkbenchEvalSnapshot[],
): string {
  const index = orderEvaluationSnapshots(evals).findIndex((evalSnapshot) => evalSnapshot.hash === evalHash);
  return index >= 0 ? `Evaluation ${index + 1}` : "Recorded evaluation";
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

export function buildComparisonMetricDescriptors(
  rows: readonly ComparisonEvidenceRow[],
): ComparisonMetricDescriptor[] {
  return METRIC_DESCRIPTORS.filter((descriptor) =>
    rows.some((row) => getComparisonMetricValue(row, descriptor) !== undefined)
  );
}

export function buildComparisonTableMetricDescriptors(
  rows?: readonly ComparisonEvidenceRow[],
): ComparisonMetricDescriptor[] {
  const descriptors = METRIC_DESCRIPTORS.filter((descriptor) => descriptor.primary);
  if (!rows) {
    return descriptors;
  }
  return descriptors.filter((descriptor) =>
    descriptor.id !== "costUsd" ||
    rows.some((row) => getComparisonMetricValue(row, descriptor) !== undefined)
  );
}

export function selectPrimaryComparisonMetrics(
  descriptors: ComparisonMetricDescriptor[] | undefined,
): ComparisonMetricDescriptor[] {
  const available = descriptors ?? [];
  const primary = available.filter((descriptor) => descriptor.primary);
  if (primary.length > 0) {
    return primary;
  }
  return available.slice(0, 3);
}

export function buildComparisonMetricData(
  rows: readonly ComparisonEvidenceRow[],
  descriptor: ComparisonMetricDescriptor,
  groupColorById?: ReadonlyMap<string, string>,
): ComparisonMetricDatum[] {
  return rows.flatMap((row, index) => {
    const value = getComparisonMetricValue(row, descriptor);
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
      color: resolveComparisonGroupChartColor(groupId, groupColorById, index),
      value,
      displayValue: formatComparisonMetricValue(descriptor, value),
    }];
  }).sort((left, right) => compareMetricRows(left, right, descriptor));
}

export function buildComparisonTradeoffPairs(
  descriptors: ComparisonMetricDescriptor[] | undefined,
): ComparisonTradeoffPair[] {
  const primary = selectPrimaryComparisonMetrics(descriptors);
  if (primary.length < 2) {
    return [];
  }

  const performanceMetric = primary.find((descriptor) => descriptor.semanticRole === "performance") ?? primary[0]!;
  return primary
    .filter((descriptor) => descriptor.id !== performanceMetric.id)
    .map((descriptor) => ({
      key: `${performanceMetric.id}::${descriptor.id}`,
      label: `${performanceMetric.label} vs ${descriptor.label}`,
      xMetric: descriptor,
      yMetric: performanceMetric,
    }));
}

export function buildComparisonTradeoffData(
  rows: readonly ComparisonEvidenceRow[],
  pair: ComparisonTradeoffPair,
  groupColorById?: ReadonlyMap<string, string>,
): ComparisonTradeoffDatum[] {
  return rows.flatMap((row, index) => {
    const x = getComparisonMetricValue(row, pair.xMetric);
    const y = getComparisonMetricValue(row, pair.yMetric);
    if (x === undefined || y === undefined) {
      return [];
    }
    const groupId = resultVersionGroupId(row);
    return [{
      rowId: row.rowId,
      rowLabel: `${row.versionLabel} / ${row.agentDetail}`,
      groupId,
      groupLabel: row.versionLabel,
      color: resolveComparisonGroupChartColor(groupId, groupColorById, index),
      x,
      y,
      xDisplay: formatComparisonMetricValue(pair.xMetric, x),
      yDisplay: formatComparisonMetricValue(pair.yMetric, y),
    }];
  });
}

export function formatComparisonMetricValue(
  descriptor: ComparisonMetricDescriptor,
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

export function formatComparisonTableMetricValue(
  row: ComparisonEvidenceRow,
  descriptor: ComparisonMetricDescriptor,
): string {
  const value = getComparisonMetricValue(row, descriptor);
  if (descriptor.id === "costUsd" && value === undefined) {
    return missingCostLabelForStatus(row.statusLabel, Boolean(row.runId));
  }
  return formatComparisonMetricValue(descriptor, value);
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

export function getComparisonMetricValue(
  row: ComparisonEvidenceRow,
  descriptor: ComparisonMetricDescriptor,
): number | undefined {
  if (descriptor.id === "score") {
    return finiteNumber(row.score);
  }
  if (descriptor.id === "latencyMs") {
    return finiteNumber(row.latencyMs);
  }
  if (descriptor.id === "costUsd") {
    return finiteNumber(row.costUsd);
  }
  return undefined;
}

export function resolveComparisonGroupChartColor(
  groupId: string,
  groupColorById: ReadonlyMap<string, string> | undefined,
  fallbackIndex: number,
): string {
  return groupColorById?.get(groupId) ?? getCategoricalChartColor(fallbackIndex);
}

export function resultVersionGroupId(row: ComparisonEvidenceRow): string {
  if (row.versionDetail === "local:.") {
    return row.versionId;
  }
  return `${row.versionLabel}\0${row.versionDetail}`;
}

function resultGroupId(version: WorkbenchSkillVersion): string {
  return ["version", version.id].map(encodeComparisonGroupPart).join("/");
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
  return resultVersionSortKey(left).localeCompare(resultVersionSortKey(right), undefined, {
    numeric: true,
    sensitivity: "base",
  }) || left.label.localeCompare(right.label, undefined, {
    numeric: true,
    sensitivity: "base",
  }) || left.id.localeCompare(right.id);
}

function resultVersionSortKey(version: WorkbenchSkillVersion): string {
  return version.projectVersionId ?? version.id;
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
  left: ComparisonResolvedCell,
  right: ComparisonResolvedCell,
  versionOrdinalById: ReadonlyMap<string, number>,
): number {
  return (versionOrdinalById.get(right.version.id) ?? 0) - (versionOrdinalById.get(left.version.id) ?? 0) ||
    agentLabel(left.agent).localeCompare(agentLabel(right.agent), undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.cell.evaluationId.localeCompare(right.cell.evaluationId) ||
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
  return created || compareVersionLabels(left.id, right.id);
}

function isActiveSkillName(skillName: string, defaultSkill: string | undefined): boolean {
  if (!defaultSkill || defaultSkill === "all") {
    return skillName === "current";
  }
  return skillName === defaultSkill;
}

function readableSkillName(value: string): string {
  if (value === "current") {
    return "Current skill";
  }
  if (value === "no-skill") {
    return "No skill baseline";
  }
  return sentenceCaseReadable(value, "Skill");
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

function encodeComparisonGroupPart(value: string): string {
  return encodeURIComponent(value);
}

function orderEvaluationSnapshots(evals: readonly WorkbenchEvalSnapshot[]): WorkbenchEvalSnapshot[] {
  return [...evals].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.hash.localeCompare(right.hash)
  );
}

function evaluationDetail(
  evaluation: Pick<WorkbenchResultEvaluation, "caseCount" | "gradeAdapter"> | undefined,
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
  isLatest: boolean,
): string {
  const context = isLatest
    ? "Latest"
    : createdAt
      ? `Created ${formatTimestamp(createdAt)}`
      : "Recorded";
  return [context, detail].join(" / ");
}

function formatEvalCaseCount(caseCount: number): string {
  return `${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
}

function evalGradeAdapter(evalSnapshot: WorkbenchEvalSnapshot): string {
  return normalizeGradeAdapter(evalSnapshot.gradeAdapter) ?? "tests";
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
    return "rubric grader";
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

function collapseUnmeasuredComparisonRows(rows: readonly ComparisonEvidenceRow[]): ComparisonEvidenceRow[] {
  const rowsByVersion = new Map<string, ComparisonEvidenceRow[]>();
  for (const row of rows) {
    const groupRows = rowsByVersion.get(row.versionId);
    if (groupRows) {
      groupRows.push(row);
    } else {
      rowsByVersion.set(row.versionId, [row]);
    }
  }

  const visibleRows: ComparisonEvidenceRow[] = [];
  for (const groupRows of rowsByVersion.values()) {
    const measuredRows = groupRows.filter((row) =>
      row.runId ||
      row.score !== undefined ||
      row.latencyMs !== undefined ||
      row.costUsd !== undefined
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

function compareVersionLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareMetricRows(
  left: ComparisonMetricDatum,
  right: ComparisonMetricDatum,
  descriptor: ComparisonMetricDescriptor,
): number {
  const valueOrder = descriptor.direction === "higher"
    ? right.value - left.value
    : left.value - right.value;
  if (valueOrder !== 0) {
    return valueOrder;
  }
  return left.rowLabel.localeCompare(right.rowLabel, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
