export type FlagKind = "boolean" | "nonnegative-integer" | "string" | "positive-integer" | "port" | "repeat-string";
export type FlagSpec = Readonly<Record<string, FlagKind>>;

interface WorkbenchCommandReference {
  id: string;
  summary: string;
  usage: readonly string[];
  example?: string;
  quickHelpGroup?: "taught";
  docGroup: string;
  flags?: FlagSpec;
  subcommands?: { flags: Record<string, FlagSpec> };
}

const COMMON = { json: "boolean", help: "boolean" } as const satisfies FlagSpec;
const PROJECT = { ...COMMON, dir: "string" } as const satisfies FlagSpec;
const EVAL_OPERATION = {
  ...PROJECT,
  agents: "string",
  cases: "string",
  cloud: "boolean",
  "dry-run": "boolean",
  rerun: "boolean",
  versions: "string",
} as const satisfies FlagSpec;

const commands: readonly WorkbenchCommandReference[] = [
  {
    id: "source",
    summary: "Connects, syncs, analyzes, and reviews private evidence Sources.",
    usage: [
      "workbench source add NAME --adapter ID [--namespace OWNER] [--json]",
      "workbench source list [--cursor CURSOR --limit N] [--namespace OWNER] [--json]",
      "workbench source show SOURCE_ID [--analysis ANALYSIS_ID] [--page PAGE] [--node NODE_ID|--insight INSIGHT_ID|--workflow WORKFLOW_ID] [--decision kept|dismissed] [--cursor CURSOR --limit N] [--namespace OWNER] [--json]",
      "workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID [--namespace OWNER] [--json]",
      "workbench source sync SOURCE_ID [--json]",
      "workbench source analyze SOURCE_ID (--record-limit N [--record-offset N] | --all-records) [--map] [--snapshot SNAPSHOT_ID] [--namespace OWNER] [--confirm --max-cost USD --preflight-token TOKEN] [--json]",
      "workbench source review SOURCE_ID ANALYSIS_ID --input PATH|- [--namespace OWNER] [--json]",
      "workbench source delete SOURCE_ID --yes [--namespace OWNER] [--json]",
    ],
    example: "workbench source add 'Local Codex' --adapter codex",
    quickHelpGroup: "taught",
    docGroup: "Sources",
    subcommands: { flags: {
      add: { ...COMMON, adapter: "string", namespace: "string" },
      list: { ...COMMON, cursor: "string", limit: "positive-integer", namespace: "string" },
      show: { ...COMMON, analysis: "string", cursor: "string", decision: "string", insight: "string", limit: "positive-integer", namespace: "string", node: "string", page: "string", workflow: "string" },
      evidence: { ...COMMON, namespace: "string" },
      sync: { ...COMMON },
      analyze: { ...COMMON, "all-records": "boolean", confirm: "boolean", map: "boolean", "max-cost": "string", namespace: "string", "preflight-token": "string", "record-limit": "positive-integer", "record-offset": "nonnegative-integer", snapshot: "string" },
      review: { ...COMMON, input: "string", namespace: "string" },
      delete: { ...COMMON, namespace: "string", yes: "boolean" },
    } },
  },
  {
    id: "eval",
    summary: "Authors, runs, grades, and inspects Evals.",
    usage: [
      "workbench eval list [--dir DIR] [--json]",
      "workbench eval show REF[:PATH] [--dir DIR] [--json]",
      "workbench eval draft --source SOURCE_ID --analysis ANALYSIS_ID --review-version N --review-hash HASH --workflows IDS --objective TEXT --destination local|OWNER/SKILL[/EVAL] [--namespace OWNER] [--dir DIR] [--confirm --max-cost USD --preflight-token TOKEN] [--json]",
      "workbench eval apply DRAFT_ID [--dir DIR] --yes [--json]",
      "workbench eval discard DRAFT_ID --yes [--json]",
      "workbench eval run [--versions LIST] [--agents LIST] [--cases LIST] [-n N] [--rerun] [--cloud] [--dir DIR] [--json]",
      "workbench eval grade [--versions LIST] [--agents LIST] [--cases LIST] [--rerun] [--cloud] [--dir DIR] [--json]",
      "workbench eval results [--versions LIST] [--eval current|all|EVAL] [--agents LIST] [--dir DIR] [--json]",
      "workbench eval case draft [ID] [--grader ADAPTER] [--dir DIR] [--json]",
      "workbench eval grader [set ADAPTER] [--authoring key=value]... [--dir DIR] [--json]",
      "workbench eval agent list|add|rm [ARGS] [--dir DIR] [--json]",
    ],
    example: "workbench eval run -n 3",
    quickHelpGroup: "taught",
    docGroup: "Evals",
    subcommands: { flags: {
      list: { ...PROJECT },
      show: { ...PROJECT },
      draft: {
        ...PROJECT,
        analysis: "string",
        confirm: "boolean",
        destination: "string",
        "max-cost": "string",
        namespace: "string",
        objective: "string",
        "preflight-token": "string",
        "review-hash": "string",
        "review-version": "positive-integer",
        source: "string",
        workflows: "string",
      },
      apply: { ...PROJECT, yes: "boolean" },
      discard: { ...COMMON, yes: "boolean" },
      run: { ...EVAL_OPERATION, samples: "positive-integer" },
      grade: { ...EVAL_OPERATION },
      results: { ...PROJECT, agents: "string", eval: "string", versions: "string" },
      case: { ...PROJECT, grader: "string" },
      grader: { ...PROJECT, authoring: "repeat-string", "authoring-file": "string", "authoring-json": "string" },
      agent: { ...PROJECT, adapter: "string", model: "string", with: "repeat-string" },
    } },
  },
  {
    id: "skill",
    summary: "Creates, improves, versions, syncs, and publishes Skills.",
    usage: [
      "workbench skill new DIR [--agent ADAPTER] [--model MODEL] [--json]",
      "workbench skill init [--agent ADAPTER] [--model MODEL] [--json]",
      "workbench skill clone OWNER/SKILL[@VERSION]|URL DIR [--json]",
      "workbench skill list [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]",
      "workbench skill show [REF[:PATH]] [--dir DIR] [--json]",
      "workbench skill install SOURCE [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]",
      "workbench skill improve [--versions LIST] [--agents LIST] [--budget N] [-n N] [--cloud] [--dir DIR] [--json]",
      "workbench skill versions [--dir DIR] [--json]",
      "workbench skill diff [A..B] [--dir DIR] [--json]",
      "workbench skill switch VERSION [--dry-run] [--yes] [--dir DIR] [--json]",
      "workbench skill sync [REMOTE] [--dry-run] [--dir DIR] [--json]",
      "workbench skill publish [VERSION] --as OWNER/SKILL [--private|--team|--public] [--dir DIR] [--json]",
      "workbench skill unpublish VERSION [--dry-run] [--dir DIR] [--json]",
      "workbench skill delete OWNER/SKILL|URL --yes [--json]",
    ],
    example: "workbench skill new earnings-prep",
    quickHelpGroup: "taught",
    docGroup: "Skills",
    subcommands: { flags: {
      new: { ...COMMON, agent: "string", auth: "string", model: "string" },
      init: { ...COMMON, agent: "string", auth: "string", model: "string" },
      clone: { ...COMMON },
      list: { ...PROJECT, scope: "string", target: "string" },
      show: { ...PROJECT },
      install: { ...PROJECT, "dry-run": "boolean", scope: "string", target: "string", yes: "boolean" },
      improve: { ...PROJECT, agents: "string", budget: "positive-integer", cloud: "boolean", "dry-run": "boolean", samples: "positive-integer", versions: "string" },
      versions: { ...PROJECT },
      diff: { ...PROJECT },
      switch: { ...PROJECT, "dry-run": "boolean", yes: "boolean" },
      sync: { ...PROJECT, "dry-run": "boolean" },
      publish: { ...PROJECT, as: "string", "dry-run": "boolean", private: "boolean", public: "boolean", team: "boolean" },
      unpublish: { ...PROJECT, "dry-run": "boolean" },
      delete: { ...COMMON, "dry-run": "boolean", yes: "boolean" },
    } },
  },
  {
    id: "open",
    summary: "Serves the local Workbench UI.",
    usage: ["workbench open [--host HOST] [--port PORT] [--dir DIR] [--no-open]"],
    docGroup: "Operations and auth",
    flags: { dir: "string", help: "boolean", host: "string", "no-open": "boolean", port: "port" },
  },
  ...([
    ["watch", "Watches"],
    ["retry", "Retries"],
    ["cancel", "Cancels"],
  ] as const).map(([id, verb]) => ({
    id,
    summary: `${verb} an existing operation.`,
    usage: [`workbench ${id} OPERATION_ID${id === "retry" ? " [--confirm --max-cost USD --preflight-token TOKEN]" : ""} [--dir DIR] [--json]`],
    docGroup: "Operations and auth",
    flags: { ...PROJECT, ...(id === "retry" ? { confirm: "boolean" as const, "max-cost": "string" as const, "preflight-token": "string" as const } : {}) },
  })),
  {
    id: "login",
    summary: "Connects the CLI to Workbench Cloud or captures provider auth.",
    usage: ["workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--base-url URL] [--json]"],
    docGroup: "Operations and auth",
    flags: {
      ...COMMON,
      "base-url": "string",
      "local-only": "boolean",
      method: "string",
      "no-open": "boolean",
      profile: "string",
      "profile-root": "string",
      "start-only": "boolean",
      timeout: "positive-integer",
      wait: "boolean",
    },
  },
  {
    id: "logout",
    summary: "Logs out of Workbench Cloud or removes local provider auth.",
    usage: ["workbench logout [PROVIDER] [--json]"],
    docGroup: "Operations and auth",
    flags: { ...COMMON },
  },
  {
    id: "help",
    summary: "Prints default, full, or command-specific help.",
    usage: ["workbench help [source|eval|skill] [--all]"],
    docGroup: "Operations and auth",
    flags: { ...COMMON, all: "boolean" },
  },
  {
    id: "version",
    summary: "Prints the installed Workbench CLI version.",
    usage: ["workbench version", "workbench --version"],
    docGroup: "Operations and auth",
    flags: { json: "boolean", version: "boolean" },
  },
];

export const WORKBENCH_COMMAND_SURFACE = {
  remoteUrls: [
    "https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote",
    "file:///absolute/path            local file remote for explicit sync",
  ],
  commands,
} as const satisfies {
  remoteUrls: readonly string[];
  commands: readonly WorkbenchCommandReference[];
};

export function renderWorkbenchHelp(): string {
  return [
    "Usage:",
    "  workbench <source|eval|skill> <command> [options]",
    "  workbench <open|watch|retry|cancel|login|logout|help|version> [options]",
    "",
    "Workbench organizes private evidence as Sources, human-authored tests as Evals, and portable packages as Skills.",
    "",
    ...quickHelpUsage().map((usage) => `  ${usage}`),
    "",
    "More:",
    "  workbench help --all",
  ].join("\n");
}

export function renderWorkbenchHelpAll(): string {
  const lines = ["Usage:", "  workbench <command> [options]", ""];
  for (const group of ["Sources", "Evals", "Skills", "Operations and auth"]) {
    lines.push(`${group}:`);
    lines.push(...commands.filter((command) => command.docGroup === group).flatMap((command) => command.usage).map((usage) => `  ${usage}`));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderWorkbenchCommandHelp(command: string): string {
  const entry = commandById(command);
  if (!entry || command === "help" || command === "version") return renderWorkbenchHelp();
  return [
    "Usage:",
    ...entry.usage.map((usage) => `  ${usage}`),
    "",
    entry.summary,
    "",
    "Example:",
    `  ${entry.example ?? entry.usage[0]}`,
  ].join("\n");
}

export function allowedFlagsForWorkbenchCommand(positionals: readonly string[], command: string): FlagSpec | undefined {
  const entry = commandById(command);
  if (!entry) return undefined;
  if (!entry.subcommands) return entry.flags;
  const subcommand = positionals[1];
  return subcommand ? entry.subcommands.flags[subcommand] ?? COMMON : COMMON;
}

export function renderWorkbenchCliReference(): string {
  const lines = [
    "## Command surface",
    "",
    "Generated from the same command metadata that renders `workbench help` and validates accepted flags.",
    "",
  ];
  for (const group of ["Sources", "Evals", "Skills", "Operations and auth"]) {
    lines.push(`### ${group}`, "");
    for (const command of commands.filter((entry) => entry.docGroup === group && entry.id !== "help" && entry.id !== "version")) {
      lines.push(`#### \`workbench ${command.id}\``, "", command.summary, "", "Usage:", "", "```bash", ...command.usage, "```", "");
      const flags = command.subcommands
        ? Object.entries(command.subcommands.flags).map(([subcommand, spec]) => `- \`${subcommand}\`: ${formatFlagNames(spec)}`)
        : command.flags ? [formatFlagNames(command.flags)] : [];
      if (flags.length > 0) lines.push("Flags:", "", ...flags, "");
    }
  }
  lines.push("### Remote URLs", "", ...WORKBENCH_COMMAND_SURFACE.remoteUrls.map((url) => `- \`${url}\``), "");
  return lines.join("\n").trimEnd();
}

function commandById(id: string): WorkbenchCommandReference | undefined {
  return commands.find((command) => command.id === id);
}

function quickHelpUsage(): string[] {
  return commands.filter((command) => command.quickHelpGroup === "taught").map((command) => command.usage[0]!);
}

function formatFlagNames(flags: FlagSpec): string {
  return Object.entries(flags).map(([name, kind]) => {
    const suffix = kind === "boolean" ? "" : kind === "nonnegative-integer" || kind === "positive-integer" || kind === "port" ? " N" : " VALUE";
    return `\`--${name}${suffix}\``;
  }).join(", ");
}
