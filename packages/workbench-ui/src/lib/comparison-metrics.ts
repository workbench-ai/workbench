import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import type {
  WorkbenchAgent,
  WorkbenchAgentSnapshot,
  WorkbenchComparison,
  WorkbenchComparisonCell,
  WorkbenchEvalSnapshot,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchRun,
  WorkbenchSkillBundleSnapshot,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

import {
  agentConfigString,
  agentNetworkLabel,
  agentTimeoutLabel,
  formatCost,
  formatDurationMs,
  formatScore,
  formatTimestamp,
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
  scoreAdapter: string;
}

export interface ComparisonGroup {
  id: string;
  label: string;
  skillName: string;
  setupRank: number;
  cells: ComparisonResolvedCell[];
}

export interface ComparisonResolvedCell {
  cell: WorkbenchComparisonCell;
  version: WorkbenchVersion;
  skill: WorkbenchSkillBundleSnapshot;
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

export function comparisonForSnapshot(snapshot: WorkbenchInspectionSnapshot): WorkbenchComparison {
  return snapshot.comparison ?? {
    versions: snapshot.versions,
    skills: snapshot.skillBundles,
    agents: snapshot.agents,
    cells: [],
  };
}

export function comparisonForActiveSkillVersions(snapshot: WorkbenchInspectionSnapshot): WorkbenchComparison {
  const skillName = activeSkillName(snapshot);
  return comparisonForRuns(
    snapshot,
    snapshot.runs.filter((run) => run.kind === "eval" && run.skillName === skillName),
  );
}

export function comparisonForScorecard(snapshot: WorkbenchInspectionSnapshot): WorkbenchComparison {
  const canonical = comparisonForSnapshot(snapshot);
  const current = comparisonForCurrentVersionRuns(snapshot);
  const history = comparisonForActiveSkillVersions(snapshot);
  const cells = [...canonical.cells];
  const seenCells = new Set(cells.map(comparisonCellKey));

  for (const source of [current, history]) {
    for (const cell of source.cells) {
      const key = comparisonCellKey(cell);
      if (seenCells.has(key)) {
        continue;
      }
      seenCells.add(key);
      cells.push(cell);
    }
  }

  const versionIds = new Set(cells.map((cell) => cell.versionId));
  const skillBundleHashes = new Set(cells.map((cell) => cell.skillBundleHash));
  const agentHashes = new Set(cells.map((cell) => cell.agentHash));
  const evalHashes = new Set(cells.map((cell) => cell.evalHash));
  const [onlyEvalHash] = [...evalHashes];

  return {
    ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
    versions: unionById(
      [...canonical.versions, ...current.versions, ...history.versions, ...snapshot.versions],
      (version) => version.id,
    ).filter((version) => versionIds.has(version.id)),
    skills: unionById(
      [...canonical.skills, ...current.skills, ...history.skills, ...snapshot.skillBundles],
      (skill) => skill.hash,
    ).filter((skill) => skillBundleHashes.has(skill.hash)),
    agents: unionById(
      [...canonical.agents, ...current.agents, ...history.agents, ...snapshot.agents],
      (agent) => agent.hash,
    ).filter((agent) => agentHashes.has(agent.hash)),
    cells,
  };
}

export function evaluationOptionsForScorecard(
  snapshot: WorkbenchInspectionSnapshot,
  comparison: WorkbenchComparison,
): ComparisonEvaluationOption[] {
  const comparisonEvalHashes = new Set(comparison.cells.map((cell) => cell.evalHash));
  const orderedEvals = orderEvaluationSnapshots(snapshot.evals);
  const ordinalByHash = new Map(orderedEvals.map((evalSnapshot, index) => [evalSnapshot.hash, index + 1]));
  const optionEvals = orderedEvals.filter((evalSnapshot) => comparisonEvalHashes.has(evalSnapshot.hash));
  const latestEvalHash = optionEvals.at(-1)?.hash ?? null;
  return optionEvals.map((evalSnapshot) => {
    const scoreAdapter = evalScoreAdapter(evalSnapshot);
    const detail = evaluationDetail(evalSnapshot, scoreAdapter);
    const isLatest = evalSnapshot.hash === latestEvalHash;
    const ordinal = ordinalByHash.get(evalSnapshot.hash) ?? 0;
    return {
      id: evalSnapshot.hash,
      label: `Evaluation ${ordinal}`,
      detail,
      subtitle: evaluationOptionSubtitle(evalSnapshot.createdAt, detail, isLatest),
      ordinal,
      isLatest,
      createdAt: evalSnapshot.createdAt,
      updatedAt: evalSnapshot.updatedAt,
      caseCount: evalSnapshot.caseCount,
      scoreAdapter,
    };
  });
}

export function defaultEvaluationIdForScorecard(
  options: readonly ComparisonEvaluationOption[],
): string | null {
  return options.find((option) => option.isLatest)?.id ?? null;
}

function comparisonForCurrentVersionRuns(snapshot: WorkbenchInspectionSnapshot): WorkbenchComparison {
  const currentVersionId = snapshot.status.currentVersionId ?? snapshot.refs.current;
  if (!currentVersionId) {
    return comparisonForSnapshot(snapshot);
  }
  const currentRuns = snapshot.runs.filter((run) => run.kind === "eval" && run.versionId === currentVersionId);
  if (currentRuns.length === 0) {
    return comparisonForSnapshot(snapshot);
  }
  const latestEvalHash = latestEvalHashForRuns(currentRuns);
  return comparisonForRuns(
    snapshot,
    latestEvalHash ? currentRuns.filter((run) => run.evalHash === latestEvalHash) : currentRuns,
  );
}

function comparisonForRuns(
  snapshot: WorkbenchInspectionSnapshot,
  sourceRuns: readonly WorkbenchRun[],
): WorkbenchComparison {
  const bestRunByKey = new Map<string, WorkbenchRun>();
  for (const run of sourceRuns) {
    const key = comparisonRunKey(run);
    const previous = bestRunByKey.get(key);
    if (!previous || compareRunsByEvidenceStrength(previous, run, snapshot.jobs) < 0) {
      bestRunByKey.set(key, run);
    }
  }

  const runs = [...bestRunByKey.values()].sort(compareRunsForComparison);
  const versionIds = new Set(runs.map((run) => run.versionId));
  const skillBundleHashes = new Set(runs.map((run) => run.skillBundleHash));
  const agentHashes = new Set(runs.map((run) => run.agentHash));
  const evalHashes = new Set(runs.map((run) => run.evalHash));
  const [onlyEvalHash] = [...evalHashes];

  return {
    ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
    versions: snapshot.versions.filter((version) => versionIds.has(version.id)),
    skills: snapshot.skillBundles.filter((bundle) => skillBundleHashes.has(bundle.hash)),
    agents: snapshot.agents.filter((agent) => agentHashes.has(agent.hash)),
    cells: runs.map((run) => comparisonCellForRun(run, snapshot.jobs)),
  };
}

function latestEvalHashForRuns(runs: readonly WorkbenchRun[]): string | null {
  const latest = runs.slice().sort((left, right) => compareRunRecency(right, left))[0];
  return latest?.evalHash ?? null;
}

function comparisonCellForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): WorkbenchComparisonCell {
  const samples = comparisonRunSamples(run, jobs);
  const latencyMs = run.latencyMs !== undefined && samples > 1
    ? Math.round(run.latencyMs / samples)
    : run.latencyMs;
  return {
    versionId: run.versionId,
    skillName: run.skillName,
    skillBundleHash: run.skillBundleHash,
    evalHash: run.evalHash,
    agentName: run.agentName,
    agentHash: run.agentHash,
    runId: run.id,
    status: run.status,
    ...(run.status === "succeeded" && run.score !== undefined ? { score: run.score } : {}),
    ...(samples > 0 ? { samples } : {}),
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

export function buildComparisonGroups(
  comparison: WorkbenchComparison,
  context: ComparisonLabelContext = {},
): ComparisonGroup[] {
  const versionsById = new Map(comparison.versions.map((version) => [version.id, version]));
  const skillsByHash = new Map(comparison.skills.map((skill) => [skill.hash, skill]));
  const cellsByGroup = new Map<string, ComparisonResolvedCell[]>();
  for (const cell of comparison.cells) {
    const version = versionsById.get(cell.versionId);
    const skill = skillsByHash.get(cell.skillBundleHash);
    if (!version || !skill) {
      continue;
    }
    const key = comparisonGroupKey(cell, context);
    const cells = cellsByGroup.get(key);
    const resolvedCell = { cell, version, skill };
    if (cells) {
      cells.push(resolvedCell);
    } else {
      cellsByGroup.set(key, [resolvedCell]);
    }
  }

  return [...cellsByGroup.entries()].flatMap(([key, cells]): ComparisonGroup[] => {
    const first = cells[0];
    if (!first) {
      return [];
    }
    const label = formatSkillDisplayName(first.skill.skillName, context);
    return [{
      id: key,
      label,
      skillName: first.skill.skillName,
      setupRank: comparisonSetupRank(first.skill.skillName, context),
      cells: cells.sort((left, right) => compareResolvedCells(left, right, context)),
    }];
  }).sort((left, right) =>
    compareComparisonGroups(left, right, context)
  );
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
  return evaluationDetail(evalSnapshot, evalSnapshot ? evalScoreAdapter(evalSnapshot) : undefined);
}

function isActiveSkillName(skillName: string, defaultSkill: string | undefined): boolean {
  if (!defaultSkill || defaultSkill === "all") {
    return skillName === "primary";
  }
  return skillName === defaultSkill;
}

function versionLabel(version: WorkbenchVersion, versions: readonly WorkbenchVersion[]): string {
  return `Version ${versionOrdinal(version, versions)}`;
}

function versionBadges(version: WorkbenchVersion, context: ComparisonLabelContext): string[] {
  const badges: string[] = [];
  if (version.id === context.currentVersionId) {
    badges.push("Current");
  }
  if (version.id === context.publishedVersionId) {
    badges.push("Published");
  }
  return badges;
}

function readableSkillName(value: string): string {
  if (value === "primary") {
    return "Primary skill";
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

function versionOrdinal(version: WorkbenchVersion, versions: readonly WorkbenchVersion[]): number {
  const sorted = versions.slice().sort(compareVersionsByCreatedAt);
  const index = sorted.findIndex((entry) => entry.id === version.id);
  return index >= 0 ? index + 1 : 1;
}

function compareComparisonGroups(
  left: ComparisonGroup,
  right: ComparisonGroup,
  _context: ComparisonLabelContext,
): number {
  return left.setupRank - right.setupRank ||
    left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.id.localeCompare(right.id);
}

function compareResolvedCells(
  left: ComparisonResolvedCell,
  right: ComparisonResolvedCell,
  context: ComparisonLabelContext,
): number {
  return versionRoleRank(left.version, context) - versionRoleRank(right.version, context) ||
    compareVersionsByCreatedAt(right.version, left.version) ||
    left.cell.agentName.localeCompare(right.cell.agentName, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.cell.agentHash.localeCompare(right.cell.agentHash);
}

function versionRoleRank(version: WorkbenchVersion, context: ComparisonLabelContext): number {
  return version.id === context.currentVersionId ? 0 : 1;
}

function compareVersionsByCreatedAt(left: WorkbenchVersion, right: WorkbenchVersion): number {
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || compareVersionLabels(left.id, right.id);
}

export function buildComparisonEvidenceRows({
  agents,
  context = {},
  groups,
  runs,
}: {
  agents: WorkbenchAgentSnapshot[];
  context?: ComparisonLabelContext;
  groups: ComparisonGroup[];
  runs: WorkbenchRun[];
}): ComparisonEvidenceRow[] {
  const agentsByHash = new Map(agents.map((entry) => [entry.hash, entry]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const labelVersions = context.allVersions ?? versionsFromGroups(groups);
  const rows = groups.flatMap((group) =>
    group.cells.map(({ cell, version, skill }) => {
      const run = cell.runId ? runsById.get(cell.runId) ?? null : null;
      const agent = agentsByHash.get(cell.agentHash)?.agent;
      const score = finiteNumber(cell.score ?? run?.score);
      const latencyMs = finiteNumber(cell.latencyMs ?? run?.latencyMs);
      const costUsd = finiteNumber(cell.costUsd ?? run?.costUsd);
      const samples = finiteNumber(cell.samples);
      const status = run?.status ?? cell.status;
      const error = run?.error ?? cell.error;
      return {
        rowId: [
          group.id,
          cell.versionId,
          cell.skillBundleHash,
          cell.evalHash,
          cell.agentHash,
        ].map(encodeComparisonGroupPart).join("/"),
        groupId: group.id,
        groupLabel: group.label,
        setupLabel: group.label,
        setupRank: group.setupRank,
        versionId: version.id,
        versionLabel: versionLabel(version, labelVersions),
        versionOrdinal: versionOrdinal(version, labelVersions),
        versionBadges: versionBadges(version, context),
        skillName: skill.skillName,
        evalHash: cell.evalHash,
        agentName: cell.agentName,
        agentHash: cell.agentHash,
        agentDetail: formatAgentConfiguration(agent),
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
    return [{
      rowId: row.rowId,
      rowLabel: `${row.setupLabel} / ${row.versionLabel} / ${row.agentName}`,
      groupId: row.groupId,
      groupLabel: row.groupLabel,
      configurationLabel: `${row.versionLabel} / ${row.agentName}`,
      color: resolveComparisonGroupChartColor(row, groupColorById, index),
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
    return [{
      rowId: row.rowId,
      rowLabel: `${row.setupLabel} / ${row.versionLabel} / ${row.agentName}`,
      groupId: row.groupId,
      groupLabel: row.groupLabel,
      color: resolveComparisonGroupChartColor(row, groupColorById, index),
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
  row: ComparisonEvidenceRow,
  groupColorById: ReadonlyMap<string, string> | undefined,
  fallbackIndex: number,
): string {
  return groupColorById?.get(row.groupId) ?? getCategoricalChartColor(fallbackIndex);
}

function comparisonGroupKey(
  cell: WorkbenchComparisonCell,
  context: ComparisonLabelContext,
): string {
  const setupKey = isActiveSkillName(cell.skillName.trim(), context.defaultSkill?.trim())
    ? "active"
    : cell.skillName.trim() || "skill";
  return ["setup", setupKey].map(encodeComparisonGroupPart).join("/");
}

function comparisonCellKey(cell: WorkbenchComparisonCell): string {
  return [
    cell.versionId,
    cell.skillName,
    cell.skillBundleHash,
    cell.evalHash,
    cell.agentHash,
  ].map(encodeComparisonGroupPart).join("/");
}

function comparisonRunKey(run: WorkbenchRun): string {
  return [
    run.versionId,
    run.skillName,
    run.skillBundleHash,
    run.evalHash,
    run.agentHash,
  ].map(encodeComparisonGroupPart).join("/");
}

function encodeComparisonGroupPart(value: string): string {
  return encodeURIComponent(value);
}

function comparisonSetupRank(skillName: string, context: ComparisonLabelContext): number {
  const normalized = skillName.trim();
  if (isActiveSkillName(normalized, context.defaultSkill?.trim())) {
    return 0;
  }
  if (normalized === "no-skill") {
    return 1;
  }
  return 2;
}

function versionsFromGroups(groups: readonly ComparisonGroup[]): WorkbenchVersion[] {
  return unionById(
    groups.flatMap((group) => group.cells.map((entry) => entry.version)),
    (version) => version.id,
  );
}

function unionById<T>(entries: readonly T[], keyFor: (entry: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const entry of entries) {
    const key = keyFor(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function orderEvaluationSnapshots(evals: readonly WorkbenchEvalSnapshot[]): WorkbenchEvalSnapshot[] {
  return [...evals].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.hash.localeCompare(right.hash)
  );
}

function evaluationDetail(evalSnapshot: WorkbenchEvalSnapshot | undefined, scoreAdapter: string | undefined): string {
  const parts = [
    evalSnapshot ? formatEvalCaseCount(evalSnapshot.caseCount) : null,
    scoreAdapter ? formatScoreAdapter(scoreAdapter) : null,
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
    : `Created ${formatTimestamp(createdAt)}`;
  return [context, detail].join(" / ");
}

function formatEvalCaseCount(caseCount: number): string {
  return `${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
}

function evalScoreAdapter(evalSnapshot: WorkbenchEvalSnapshot): string {
  return normalizeScoreAdapter(evalSnapshot.scoreAdapter) ?? "tests";
}

function normalizeScoreAdapter(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function formatScoreAdapter(adapter: string): string {
  if (adapter === "tests") {
    return "test grader";
  }
  if (adapter === "rubric") {
    return "rubric grader";
  }
  return `${sentenceCaseReadable(adapter, "Custom")} grader`;
}

function activeSkillName(snapshot: WorkbenchInspectionSnapshot): string {
  const defaultSkill = snapshot.status.defaultSkill?.trim();
  return !defaultSkill || defaultSkill === "all" ? "primary" : defaultSkill;
}

function compareRunsForComparison(left: WorkbenchRun, right: WorkbenchRun): number {
  return compareVersionLabels(left.versionId, right.versionId) ||
    left.skillName.localeCompare(right.skillName) ||
    left.agentName.localeCompare(right.agentName) ||
    left.agentHash.localeCompare(right.agentHash) ||
    left.evalHash.localeCompare(right.evalHash);
}

function compareRunsByEvidenceStrength(
  left: WorkbenchRun,
  right: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): number {
  const leftTerminal = isTerminalRun(left);
  const rightTerminal = isTerminalRun(right);
  if (leftTerminal !== rightTerminal) {
    return leftTerminal ? 1 : -1;
  }
  if (leftTerminal && rightTerminal) {
    const samples = comparisonRunSamples(left, jobs) - comparisonRunSamples(right, jobs);
    if (samples !== 0) {
      return samples;
    }
  }
  return compareRunRecency(left, right);
}

function comparisonRunSamples(run: WorkbenchRun, jobs: readonly WorkbenchJob[]): number {
  const runJobs = jobs.filter((job) => job.runId === run.id && job.caseId !== "current");
  if (runJobs.length > 0) {
    return new Set(runJobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
  }
  return run.jobIds?.length ?? 0;
}

function isTerminalRun(run: WorkbenchRun): boolean {
  return run.status !== "queued" && run.status !== "running";
}

function compareRunRecency(left: WorkbenchRun, right: WorkbenchRun): number {
  return (left.finishedAt ?? left.createdAt).localeCompare(right.finishedAt ?? right.createdAt) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id);
}

function formatAgentConfiguration(agent: WorkbenchAgent | undefined): string {
  if (!agent) {
    return "Recorded configuration";
  }
  const parts = [
    agent.adapter,
    agent.model,
    agentNetworkLabel(agent) !== "default" ? `network ${agentNetworkLabel(agent)}` : null,
    agentTimeoutLabel(agent) !== "default" ? agentTimeoutLabel(agent) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : "Default configuration";
}

function collapseUnmeasuredComparisonRows(rows: readonly ComparisonEvidenceRow[]): ComparisonEvidenceRow[] {
  const rowsByGroup = new Map<string, ComparisonEvidenceRow[]>();
  for (const row of rows) {
    const groupRows = rowsByGroup.get(row.groupId);
    if (groupRows) {
      groupRows.push(row);
    } else {
      rowsByGroup.set(row.groupId, [row]);
    }
  }

  const visibleRows: ComparisonEvidenceRow[] = [];
  for (const groupRows of rowsByGroup.values()) {
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
      rowId: `${first.groupId}/no-scorecard`,
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
    ? `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
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
