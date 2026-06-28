export type FlagKind = "boolean" | "string" | "positive-integer" | "port" | "repeat-string";

export type FlagSpec = Readonly<Record<string, FlagKind>>;

interface SubcommandFlagSpec {
  defaultSubcommand?: string;
  flags: Record<string, FlagSpec>;
}

interface WorkbenchCommandReference {
  id: string;
  title: string;
  summary: string;
  usage: readonly string[];
  example?: string;
  quickHelpGroup?: "taught" | "other";
  fullHelpGroup?: "usage" | "inspect" | "configure" | "share-auth";
  docGroup: string;
  flags?: FlagSpec;
  subcommands?: SubcommandFlagSpec;
}

const COMMON_FLAGS = {
  json: "boolean",
} as const satisfies FlagSpec;

const DIR_FLAG = {
  dir: "string",
} as const satisfies FlagSpec;

const PROJECT_FLAGS = {
  ...COMMON_FLAGS,
  ...DIR_FLAG,
} as const satisfies FlagSpec;

const HELP_FLAG = {
  help: "boolean",
} as const satisfies FlagSpec;

const VERSION_FLAG = {
  version: "boolean",
} as const satisfies FlagSpec;

const DEFAULT_HELP_FLAGS = {
  ...COMMON_FLAGS,
  ...HELP_FLAG,
} as const satisfies FlagSpec;

const lifecycleDocGroup = "Lifecycle";
const inspectDocGroup = "Inspect";
const configureDocGroup = "Configure";
const shareDocGroup = "Share and auth";
const DOC_GROUP_ORDER = [lifecycleDocGroup, inspectDocGroup, configureDocGroup, shareDocGroup] as const;
const QUICK_HELP_ORDER = {
  taught: ["new", "init", "record", "run", "grade", "eval", "improve", "results", "traces", "publish", "skills", "install"],
  other: ["clone", "watch", "cancel", "retry", "versions", "case", "trace", "delete"],
} as const;

const WORKBENCH_COMMANDS: readonly WorkbenchCommandReference[] = [
    {
      id: "new",
      title: "New",
      summary: "Creates a Workbench skill project.",
      usage: ["workbench new DIR [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]"],
      example: "workbench new earnings-prep",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG, agent: "string", auth: "string", model: "string" },
    },
    {
      id: "init",
      title: "Init",
      summary: "Adds Workbench controls to the current skill directory without rewriting SKILL.md.",
      usage: ["workbench init [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]"],
      example: "workbench init",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG, agent: "string", auth: "string", model: "string" },
    },
    {
      id: "clone",
      title: "Clone",
      summary: "Creates editable Workbench source from a published skill.",
      usage: ["workbench clone OWNER/SKILL[@VERSION]|URL DIR [--json]"],
      example: "workbench clone test/workbench-smoke smoke",
      quickHelpGroup: "other",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG },
    },
    {
      id: "run",
      title: "Run",
      summary: "Runs selected cases without grading them.",
      usage: ["workbench run [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench run -n 3",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: operationFlags(),
    },
    {
      id: "grade",
      title: "Grade",
      summary: "Grades existing execution output without rerunning the skill.",
      usage: ["workbench grade [--versions all|LIST] [--agents all|LIST] [--cases LIST] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench grade",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: operationFlags({ samples: false }),
    },
    {
      id: "eval",
      title: "Eval",
      summary: "Runs execution and grading for selected skill versions and agents. Omitted selectors use manifest defaults.",
      usage: ["workbench eval [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench eval -n 5",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: operationFlags(),
    },
    {
      id: "results",
      title: "Results",
      summary: "Shows recorded eval results for selected skill, eval, and agent versions.",
      usage: ["workbench results [--versions all|LIST] [--eval current|all|EVAL] [--agents all|LIST] [--dir DIR] [--json]"],
      example: "workbench results --eval all --agents all",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, agents: "string", eval: "string", versions: "string" },
    },
    {
      id: "evals",
      title: "Evals",
      summary: "Lists eval versions created from eval source changes.",
      usage: ["workbench evals [--dir DIR] [--json]"],
      example: "workbench evals",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "record",
      title: "Record",
      summary: "Turns native live trace capture plugins on, off, or reports status.",
      usage: ["workbench record on|off|status [--hosts codex,claude] [--json]"],
      example: "workbench record on",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG, hosts: "string" },
    },
    {
      id: "traces",
      title: "Traces",
      summary: "Lists low-level trace records for review and case promotion.",
      usage: ["workbench traces [--dir DIR] [--json]"],
      example: "workbench traces",
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "improve",
      title: "Improve",
      summary: "Creates one improved skill version from evidence. Select exactly one version and one agent.",
      usage: ["workbench improve [--versions LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench improve --budget 1 -n 1",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: {
        ...PROJECT_FLAGS,
        ...HELP_FLAG,
        agents: "string",
        budget: "positive-integer",
        cloud: "boolean",
        "dry-run": "boolean",
        samples: "positive-integer",
        versions: "string",
      },
    },
    {
      id: "publish",
      title: "Publish",
      summary: "Publishes installable skill source to Workbench Cloud. Use --as to set the linked OWNER/SKILL handle.",
      usage: ["workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench publish --as OWNER/SKILL --dry-run",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: shareDocGroup,
      flags: {
        ...PROJECT_FLAGS,
        ...HELP_FLAG,
        as: "string",
        "dry-run": "boolean",
        private: "boolean",
        public: "boolean",
        team: "boolean",
      },
    },
    {
      id: "unpublish",
      title: "Unpublish",
      summary: "Removes source availability for a non-current published version.",
      usage: ["workbench unpublish VERSION [--dry-run] [--dir DIR] [--json]"],
      example: "workbench unpublish v_abc123 --dry-run",
      fullHelpGroup: "usage",
      docGroup: shareDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean" },
    },
    {
      id: "delete",
      title: "Delete",
      summary: "Deletes an entire Workbench Cloud skill project. Use unpublish for one package version.",
      usage: ["workbench delete OWNER/SKILL|URL [--dry-run] [--yes] [--json]"],
      example: "workbench delete test/disposable-skill --dry-run",
      quickHelpGroup: "other",
      fullHelpGroup: "usage",
      docGroup: shareDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG, "dry-run": "boolean", yes: "boolean" },
    },
    {
      id: "skills",
      title: "Skills",
      summary: "Lists local skills available to Codex and Claude across folder and global scopes.",
      usage: ["workbench skills [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]"],
      example: "workbench skills",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, scope: "string", target: "string" },
    },
    {
      id: "install",
      title: "Install",
      summary: "Installs a Workbench Cloud source when available, or delegates external Agent Skill sources to skills add.",
      usage: ["workbench install SOURCE [--target codex|claude] [--scope folder|global] [--dir DIR] [--yes] [--dry-run] [--json] [-- SKILLS_ARGS...]"],
      example: "workbench install test/workbench-smoke",
      quickHelpGroup: "taught",
      fullHelpGroup: "usage",
      docGroup: lifecycleDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean", scope: "string", target: "string", yes: "boolean" },
    },
    {
      id: "status",
      title: "Status",
      summary: "Reports project, worktree, run, sync, publication, and auth state. Use --json for the workbench.status.v1 dashboard.",
      usage: ["workbench status [--dir DIR] [--json]"],
      example: "workbench status --json",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "watch",
      title: "Watch",
      summary: "Follows progress for an existing run.",
      usage: ["workbench watch RUN_ID [--dir DIR] [--json]"],
      example: "workbench watch run_abc12345",
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "cancel",
      title: "Cancel",
      summary: "Requests cancellation for an active or detached run.",
      usage: ["workbench cancel RUN_ID [--dir DIR] [--json]"],
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "retry",
      title: "Retry",
      summary: "Starts a new attempt from the stored operation plan for a run.",
      usage: ["workbench retry RUN_ID [--dir DIR] [--json]"],
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "log",
      title: "Log",
      summary: "Shows recent versions and runs.",
      usage: ["workbench log [--runs|--versions] [--dir DIR] [--json]"],
      example: "workbench log --runs",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, runs: "boolean", versions: "boolean" },
    },
    {
      id: "versions",
      title: "Versions",
      summary: "Lists recorded Workbench package versions.",
      usage: ["workbench versions [--dir DIR] [--json]"],
      example: "workbench versions",
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "show",
      title: "Show",
      summary: "Shows a Workbench object, lists files for file-backed objects, or prints one file.",
      usage: ["workbench show REF [--dir DIR] [--json]", "workbench show REF:PATH [--dir DIR] [--json]"],
      example: "workbench show run_abc12345:result.json",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "diff",
      title: "Diff",
      summary: "Shows changed files between two Workbench package versions.",
      usage: ["workbench diff [A..B] [--dir DIR] [--json]"],
      example: "workbench diff 26059f9a..eac5699c",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
    {
      id: "switch",
      title: "Switch",
      summary: "Switches the working skill source to a recorded Workbench version.",
      usage: ["workbench switch VERSION [--dry-run] [--yes] [--dir DIR] [--json]"],
      example: "workbench switch 26059f9a",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean", yes: "boolean" },
    },
    {
      id: "case",
      title: "Case",
      summary: "Creates draft eval cases or promotes captured terminal trace evidence with input into a normal case.",
      usage: ["workbench case draft [ID] [--dir DIR] [--json]", "workbench case promote TRACE_ID --id CASE_ID [--dir DIR] [--json]"],
      example: "workbench case promote tr_123 --id ignored-format",
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: configureDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, id: "string" },
    },
    {
      id: "trace",
      title: "Trace",
      summary: "Reviews trace evidence; failed and deferred reviews require --expected before promotion.",
      usage: ["workbench trace review TRACE_ID --pass|--fail|--defer [--note TEXT] [--tag TAG]... [--expected TEXT] [--dir DIR] [--json]"],
      example: "workbench trace review tr_123 --fail --tag formatting",
      quickHelpGroup: "other",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, pass: "boolean", fail: "boolean", defer: "boolean", note: "string", tag: "repeat-string", expected: "string" },
    },
    {
      id: "open",
      title: "Open",
      summary: "Serves the local Workbench UI.",
      usage: ["workbench open [--host HOST] [--port PORT] [--dir DIR] [--no-open]"],
      example: "workbench open --no-open",
      fullHelpGroup: "inspect",
      docGroup: inspectDocGroup,
      flags: { ...DIR_FLAG, ...HELP_FLAG, host: "string", "no-open": "boolean", port: "port" },
    },
    {
      id: "agent",
      title: "Agent",
      summary: "Lists, adds, or removes eval agent configurations.",
      usage: [
        "workbench agent list [--dir DIR] [--json]",
        "workbench agent add NAME --adapter X [--model M] [--with k=v]... [--dir DIR] [--json]",
        "workbench agent rm NAME [--dir DIR] [--json]",
      ],
      example: "workbench agent add claude --adapter claude --model sonnet",
      fullHelpGroup: "configure",
      docGroup: configureDocGroup,
      subcommands: {
        flags: {
          list: { ...PROJECT_FLAGS, ...HELP_FLAG },
          add: { ...PROJECT_FLAGS, ...HELP_FLAG, adapter: "string", model: "string", with: "repeat-string" },
          rm: { ...PROJECT_FLAGS, ...HELP_FLAG },
        },
      },
    },
    {
      id: "login",
      title: "Login",
      summary: "Connects the CLI to Workbench Cloud or captures provider auth.",
      usage: [
        "workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]",
        "workbench logout [PROVIDER] [--json]",
      ],
      example: "workbench login --start-only --no-open",
      fullHelpGroup: "share-auth",
      docGroup: shareDocGroup,
      flags: {
        ...COMMON_FLAGS,
        ...HELP_FLAG,
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
      title: "Logout",
      summary: "Logs out of Workbench Cloud or removes local provider auth.",
      usage: ["workbench logout [PROVIDER] [--json]"],
      example: "workbench logout claude",
      fullHelpGroup: "share-auth",
      docGroup: shareDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG },
    },
    {
      id: "sync",
      title: "Sync",
      summary: "Synchronizes local evidence and version objects with a Workbench remote.",
      usage: ["workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]"],
      example: "workbench sync cloud --dry-run",
      fullHelpGroup: "share-auth",
      docGroup: shareDocGroup,
      flags: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean" },
    },
    {
      id: "help",
      title: "Help",
      summary: "Prints default help, full help, or command-specific help.",
      usage: ["workbench help [COMMAND] [--all] [--json]"],
      docGroup: inspectDocGroup,
      flags: { ...COMMON_FLAGS, ...HELP_FLAG, all: "boolean" },
    },
    {
      id: "version",
      title: "Version",
      summary: "Prints the installed Workbench CLI version.",
      usage: ["workbench --version", "workbench version"],
      docGroup: inspectDocGroup,
      flags: { ...COMMON_FLAGS, ...VERSION_FLAG },
    },
];

export const WORKBENCH_COMMAND_SURFACE = {
  quickExamples: [
    "workbench new ./earnings-prep --agent local",
    "workbench case draft case-001 --dir ./earnings-prep",
    "workbench eval --dir ./earnings-prep --json",
    "workbench install test/workbench-smoke --target codex --scope folder",
  ],
  allExamples: [
    "workbench new ./earnings-prep --agent local",
    "workbench case draft case-001 --dir ./earnings-prep",
    "workbench eval --dir ./earnings-prep --json",
    "workbench publish --as OWNER/SKILL --private",
    "workbench install OWNER/SKILL --target codex --scope folder",
  ],
  remoteUrls: [
    "https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote",
    "file:///absolute/path            local file remote for explicit sync",
  ],
  commands: WORKBENCH_COMMANDS,
} as const satisfies {
  quickExamples: readonly string[];
  allExamples: readonly string[];
  remoteUrls: readonly string[];
  commands: readonly WorkbenchCommandReference[];
};

export function renderWorkbenchHelp(): string {
  return [
    "Usage:",
    "  workbench [--json]",
    "  workbench <command> [options]",
    "",
    "Bare workbench prints project status and the next useful command.",
    "",
    "Taught lifecycle commands:",
    ...quickHelpUsage("taught").map((usage) => `  ${usage}`),
    "",
    "Other common commands:",
    ...quickHelpUsage("other").map((usage) => `  ${usage}`),
    "",
    "More:",
    "  workbench help --all",
    "",
    "Examples:",
    ...WORKBENCH_COMMAND_SURFACE.quickExamples.map((example) => `  ${example}`),
  ].join("\n");
}

export function renderWorkbenchHelpAll(): string {
  return [
    "Usage:",
    "  workbench                          # = workbench status",
    ...allHelpUsage("usage").map((usage) => `  ${usage}`),
    "",
    "Inspect:",
    ...allHelpUsage("inspect").map((usage) => `  ${usage}`),
    "",
    "Configure:",
    ...allHelpUsage("configure").map((usage) => `  ${usage}`),
    "",
    "Share and auth:",
    ...allHelpUsage("share-auth").map((usage) => `  ${usage}`),
    "",
    "Remote URLs:",
    ...WORKBENCH_COMMAND_SURFACE.remoteUrls.map((url) => `  ${url}`),
    "",
    "Examples:",
    ...WORKBENCH_COMMAND_SURFACE.allExamples.map((example) => `  ${example}`),
  ].join("\n");
}

export function renderWorkbenchCommandHelp(command: string): string {
  const entry = commandById(command);
  if (!entry || command === "help" || command === "version") {
    return renderWorkbenchHelp();
  }
  return [
    "Usage:",
    ...entry.usage.map((usage) => `  ${usage}`),
    "",
    ...commandHelpDescription(entry),
    "",
    "Example:",
    `  ${entry.example ?? entry.usage[0]}`,
  ].join("\n");
}

export function allowedFlagsForWorkbenchCommand(
  positionals: readonly string[],
  command: string,
): FlagSpec | undefined {
  const entry = commandById(command);
  if (!entry) {
    return undefined;
  }
  const subcommands = entry.subcommands;
  if (!subcommands) {
    return entry.flags;
  }
  const subcommand = positionals[1] ?? subcommands.defaultSubcommand;
  return subcommand ? subcommands.flags[subcommand] ?? DEFAULT_HELP_FLAGS : DEFAULT_HELP_FLAGS;
}

export function renderWorkbenchCliReference(): string {
  const lines: string[] = [
    "## Command surface",
    "",
    "Generated from the same command metadata that renders `workbench help` and validates accepted flags.",
    "",
  ];

  for (const group of docGroups()) {
    lines.push(`### ${group}`, "");
    for (const command of WORKBENCH_COMMAND_SURFACE.commands.filter((entry) => entry.docGroup === group && entry.id !== "help" && entry.id !== "version")) {
      lines.push(`#### \`workbench ${command.id}\``, "");
      lines.push(command.summary, "");
      lines.push("Usage:", "");
      lines.push("```bash");
      lines.push(...command.usage);
      lines.push("```", "");
      lines.push(...formatDocFlags(command), "");
    }
  }

  lines.push("### Remote URLs", "");
  for (const remoteUrl of WORKBENCH_COMMAND_SURFACE.remoteUrls) {
    lines.push(`- \`${remoteUrl}\``);
  }
  lines.push("");

  return lines.join("\n").trimEnd();
}

function operationFlags(options: { samples?: boolean } = {}): FlagSpec {
  const flags = {
    ...PROJECT_FLAGS,
    ...HELP_FLAG,
    agents: "string",
    cases: "string",
    cloud: "boolean",
    "dry-run": "boolean",
    rerun: "boolean",
    versions: "string",
  } as const satisfies FlagSpec;
  return options.samples === false ? flags : { ...flags, samples: "positive-integer" };
}

function commandById(id: string): WorkbenchCommandReference | undefined {
  return WORKBENCH_COMMAND_SURFACE.commands.find((command) => command.id === id);
}

function quickHelpUsage(group: "taught" | "other"): string[] {
  return QUICK_HELP_ORDER[group].map((id) => commandById(id)?.usage[0] ?? id);
}

function allHelpUsage(group: NonNullable<WorkbenchCommandReference["fullHelpGroup"]>): string[] {
  return WORKBENCH_COMMAND_SURFACE.commands
    .filter((command) => command.fullHelpGroup === group)
    .flatMap((command) => command.usage);
}

function commandHelpDescription(entry: WorkbenchCommandReference): string[] {
  if (entry.id !== "login") {
    return [entry.summary];
  }
  return [
    entry.summary,
    "Provider OAuth capture reads native provider state from DIR when --profile-root is supplied.",
    "Codex reads DIR/.codex/auth.json; Claude reads DIR/.claude.json plus CLAUDE_CODE_OAUTH_TOKEN from claude setup-token.",
  ];
}

function docGroups(): string[] {
  return DOC_GROUP_ORDER.filter((group) =>
    WORKBENCH_COMMAND_SURFACE.commands.some((command) =>
      command.docGroup === group && command.id !== "help" && command.id !== "version"
    )
  );
}

function formatDocFlags(command: WorkbenchCommandReference): string[] {
  if (command.subcommands) {
    return [
      "Flags:",
      "",
      ...Object.entries(command.subcommands.flags)
        .map(([subcommand, flags]) => `- \`${subcommand}\`: ${formatFlagNames(flags)}`),
    ];
  }
  return command.flags ? ["Flags:", "", formatFlagNames(command.flags)] : [];
}

function formatFlagNames(flags: FlagSpec): string {
  const rendered = Object.entries(flags).map(([name, kind]) => {
    const suffix = flagValueSuffix(kind);
    const flag = name === "samples" ? "-n N, --samples N" : `--${name}${suffix}`;
    return `\`${flag}\``;
  });
  return rendered.join(", ");
}

function flagValueSuffix(kind: FlagKind): string {
  switch (kind) {
    case "boolean":
      return "";
    case "positive-integer":
      return " N";
    case "port":
      return " PORT";
    case "repeat-string":
      return " VALUE";
    case "string":
      return " VALUE";
  }
}
