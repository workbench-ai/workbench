const sourceDirectoryHelp = [
  "Directory:",
  "  Run from a Workbench project containing benchmark.yaml plus candidates/<name>/candidate.yaml.",
  "  Candidate files live beside the candidate manifest in candidates/<name>/files/.",
  "  Pass --dir DIR or pass benchmark.yaml, candidates/<name>, or candidates/<name>/candidate.yaml as SOURCE.",
];

export const LOCAL_DEV_OPEN_LIFECYCLE_NOTE =
  "Keep this command running while using the local web view; Ctrl-C stops the server and the page will stop working.";

const hostedWatchLifecycleNoteLines = [
  "Watching is client-side polling only.",
  "Stopping this command does not cancel the hosted run; use workbench cloud runs cancel RUN_ID to cancel it.",
];

export const HOSTED_WATCH_LIFECYCLE_NOTE = hostedWatchLifecycleNoteLines.join(" ");

const localOpenLifecycleHelp = [
  "Lifecycle:",
  "  workbench open starts a long-running local web server.",
  `  ${LOCAL_DEV_OPEN_LIFECYCLE_NOTE}`,
];

const hostedWatchLifecycleHelp = [
  "Lifecycle:",
  ...hostedWatchLifecycleNoteLines.map((line) => `  ${line}`),
];

const rootLines = [
  "Usage:",
  "  workbench <command> [options]",
  "",
  ...sourceDirectoryHelp,
  "",
  "Project:",
  "  workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]",
  "  workbench init [DIR] --pipeline NAME --agent ADAPTER [--from PATH] [--example] [--json]",
  "  workbench init [DIR] --command NAME [--from PATH] [--example] [--json]",
  "  workbench check [SOURCE] [--dir DIR] [--json]",
  "  workbench adapters create PATH [--dir DIR] [--json]",
  "  workbench adapters list [--dir DIR] [--json]",
  "  workbench adapters inspect ID [--dir DIR] [--json]",
  "",
  "Local runs:",
  "  workbench eval [SOURCE] [--dir DIR] [--candidate ID] [--samples N] [--json]",
  "  workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]",
  "  workbench open [SOURCE] [--dir DIR] [--host HOST] [--port N] [--no-open] [--json]",
  "  workbench checkpoint [--dir DIR] [--json]",
  "  workbench restore [--dir DIR] [--candidate ID] [--dry-run] [--yes] [--json]",
  "",
  "Local inspection:",
  "  workbench runs list [--dir DIR] [--json]",
  "  workbench runs show RUN_ID [--dir DIR] [--json]",
  "  workbench candidates list [--dir DIR] [--json]",
  "  workbench candidates show CANDIDATE_ID [--dir DIR] [--json]",
  "  workbench candidates files [--dir DIR] [--candidate ID] [--json]",
  "  workbench candidates preview --path PATH [--dir DIR] [--candidate ID] [--output PATH|-] [--json]",
  "",
  "Remote sync:",
  "  workbench login [--base-url URL] [--no-open] [--json]",
  "  workbench logout [--json]",
  "  workbench whoami [--dir DIR] [--json]",
  "  workbench clone OWNER/BENCHMARK[@REF] [DIR] [--dry-run] [--json]",
  "  workbench remote show [--dir DIR] [--json]",
  "  workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
  "  workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
  "  workbench remote remove origin [--dir DIR] [--json]",
  "  workbench fetch [--dir DIR] [--json]",
  "  workbench pull [--dir DIR] [--dry-run] [--json]",
  "  workbench push [SOURCE] [--dir DIR] [--tag TAG] [--visibility public|private] [--dry-run] [--json]",
  "",
  "Hosted runs and resources:",
  "  workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--samples N] [--watch] [--dry-run] [--json]",
  "  workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]",
  "  workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|CANDIDATE_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]",
  "  workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]",
  "  workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
  "  workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]",
  "  workbench cloud star OWNER/BENCHMARK [--json]",
  "  workbench cloud unstar OWNER/BENCHMARK [--json]",
  "  workbench cloud benchmarks|runs|candidates <command> [options]",
  "",
  "Auth:",
  "  workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
  "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
  "",
  "Examples:",
  "  workbench init --skill invoice-review --agent codex",
  "  workbench eval candidates/codex --samples 1",
  "  workbench improve --budget 2 --samples 1",
  "  workbench open --no-open --json",
  "  workbench push --tag v1",
  "  workbench cloud eval candidates/codex --benchmark openbench/invoice-review@v1 --watch",
  "",
  "Environment:",
  "  WORKBENCH_API_URL sets the hosted Workbench API base URL.",
  "",
  "Default API URL:",
  "  https://v2.workbench.ai",
];

export const rootUsage = rootLines.join("\n");

function withSourceDirectoryHelp(lines: readonly string[]): string[] {
  return withHelpAfterUsage(lines, sourceDirectoryHelp);
}

function withLifecycleHelp(lines: readonly string[], lifecycleHelp: readonly string[]): string[] {
  return withHelpAfterUsage(lines, lifecycleHelp);
}

function withHelpAfterUsage(
  lines: readonly string[],
  helpLines: readonly string[],
): string[] {
  const firstBlankIndex = lines.indexOf("");
  if (firstBlankIndex < 0) {
    return [...lines, "", ...helpLines];
  }
  return [
    ...lines.slice(0, firstBlankIndex),
    "",
    ...helpLines,
    "",
    ...lines.slice(firstBlankIndex + 1),
  ];
}

const commandHelp: Record<string, string> = Object.fromEntries(Object.entries({
  init: [
    "Usage:",
    "  workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]",
    "  workbench init [DIR] --pipeline NAME --agent ADAPTER [--from PATH] [--example] [--json]",
    "  workbench init [DIR] --command NAME [--from PATH] [--example] [--json]",
    "",
    "Scaffold a local Workbench project. benchmark.yaml owns tasks, environment, and grading. candidates/<name>/candidate.yaml owns how to run the candidate. candidates/<name>/files/ owns the candidate files. optimizers/<name>.yaml owns improvement behavior.",
    "",
    "Examples:",
    "  workbench init --skill invoice-review --agent codex",
    "  workbench init ./my-eval --pipeline report-pipeline --agent claude --json",
    "  workbench init --command command-eval",
  ],
  check: withSourceDirectoryHelp([
    "Usage:",
    "  workbench check [SOURCE] [--dir DIR] [--json]",
    "",
    "Validate benchmark.yaml, one candidate manifest, and an optional optimizer manifest.",
    "",
    "Examples:",
    "  workbench check",
    "  workbench check candidates/codex --json",
  ]),
  eval: withSourceDirectoryHelp([
    "Usage:",
    "  workbench eval [SOURCE] [--dir DIR] [--candidate ID] [--samples N] [--json]",
    "",
    "Run the selected local candidate against the current benchmark and record candidate files, task outputs, grading outputs, traces, and a run record under .workbench/runtime.",
    "",
    "Examples:",
    "  workbench eval --samples 1",
    "  workbench eval candidates/codex --samples 2 --json",
  ]),
  improve: withSourceDirectoryHelp([
    "Usage:",
    "  workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]",
    "",
    "Run local candidate improvement. By default, Workbench improves the current candidate. If it has not been evaluated yet, Workbench evaluates it first. Use --from to improve an explicit candidate id.",
    "",
    "Examples:",
    "  workbench improve --budget 1 --samples 1",
    "  workbench improve candidates/codex --from cand_123 --optimizer optimizers/codex.yaml --json",
  ]),
  open: withSourceDirectoryHelp(withLifecycleHelp([
    "Usage:",
    "  workbench open [SOURCE] [--dir DIR] [--host HOST] [--port N] [--no-open] [--json]",
    "",
    "Start the local Workbench web view for the project and keep serving it until stopped.",
    "",
    "Examples:",
    "  workbench open",
    "  workbench open --port 4317 --no-open --json",
  ], localOpenLifecycleHelp)),
  checkpoint: withSourceDirectoryHelp([
    "Usage:",
    "  workbench checkpoint [--dir DIR] [--json]",
    "",
    "Save the current candidate files into local history and make the checkpoint active.",
  ]),
  restore: withSourceDirectoryHelp([
    "Usage:",
    "  workbench restore [--dir DIR] [--candidate ID] [--dry-run] [--yes] [--json]",
    "",
    "Restore a local candidate snapshot into the candidate files directory.",
    "",
    "Examples:",
    "  workbench restore --candidate cand_123 --dry-run",
    "  workbench restore --candidate cand_123 --yes",
  ]),
  runs: [
    "Usage:",
    "  workbench runs <command> [options]",
    "",
    "Inspect local run history.",
    "",
    "Commands:",
    "  workbench runs list [--dir DIR] [--json]",
    "  workbench runs show RUN_ID [--dir DIR] [--json]",
  ],
  "runs list": withSourceDirectoryHelp([
    "Usage:",
    "  workbench runs list [--dir DIR] [--json]",
    "",
    "List local runs.",
  ]),
  "runs show": withSourceDirectoryHelp([
    "Usage:",
    "  workbench runs show RUN_ID [--dir DIR] [--json]",
    "",
    "Show one local run record.",
  ]),
  candidates: [
    "Usage:",
    "  workbench candidates <command> [options]",
    "",
    "Inspect local candidates.",
    "",
    "Commands:",
    "  workbench candidates list [--dir DIR] [--json]",
    "  workbench candidates show CANDIDATE_ID [--dir DIR] [--json]",
    "  workbench candidates files [--dir DIR] [--candidate ID] [--json]",
    "  workbench candidates preview --path PATH [--dir DIR] [--candidate ID] [--output PATH|-] [--json]",
  ],
  "candidates list": withSourceDirectoryHelp([
    "Usage:",
    "  workbench candidates list [--dir DIR] [--json]",
    "",
    "List local candidates.",
  ]),
  "candidates show": withSourceDirectoryHelp([
    "Usage:",
    "  workbench candidates show CANDIDATE_ID [--dir DIR] [--json]",
    "",
    "Show one local candidate.",
  ]),
  "candidates files": withSourceDirectoryHelp([
    "Usage:",
    "  workbench candidates files [--dir DIR] [--candidate ID] [--json]",
    "",
    "List files in a local candidate snapshot.",
  ]),
  "candidates preview": withSourceDirectoryHelp([
    "Usage:",
    "  workbench candidates preview --path PATH [--dir DIR] [--candidate ID] [--output PATH|-] [--json]",
    "",
    "Preview a file from a local candidate snapshot.",
  ]),
  clone: [
    "Usage:",
    "  workbench clone OWNER/BENCHMARK[@REF] [DIR] [--dry-run] [--json]",
    "",
    "Download a hosted benchmark project into a local Workbench project and write .workbench/origin.json.",
  ],
  remote: withSourceDirectoryHelp([
    "Usage:",
    "  workbench remote show [--dir DIR] [--json]",
    "  workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
    "  workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
    "  workbench remote remove origin [--dir DIR] [--json]",
    "",
    "Manage the project origin used by fetch, pull, and push.",
  ]),
  "remote show": withSourceDirectoryHelp([
    "Usage:",
    "  workbench remote show [--dir DIR] [--json]",
    "",
    "Show the configured origin.",
  ]),
  "remote add": withSourceDirectoryHelp([
    "Usage:",
    "  workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
    "",
    "Set the project origin.",
  ]),
  "remote set-url": withSourceDirectoryHelp([
    "Usage:",
    "  workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]",
    "",
    "Replace the project origin.",
  ]),
  "remote remove": withSourceDirectoryHelp([
    "Usage:",
    "  workbench remote remove origin [--dir DIR] [--json]",
    "",
    "Remove the project origin.",
  ]),
  fetch: withSourceDirectoryHelp([
    "Usage:",
    "  workbench fetch [--dir DIR] [--json]",
    "",
    "Download remote source into .workbench/fetch without changing project files.",
  ]),
  pull: withSourceDirectoryHelp([
    "Usage:",
    "  workbench pull [--dir DIR] [--dry-run] [--json]",
    "",
    "Update managed project source files from the configured origin.",
  ]),
  push: withSourceDirectoryHelp([
    "Usage:",
    "  workbench push [SOURCE] [--dir DIR] [--tag TAG] [--visibility public|private] [--dry-run] [--json]",
    "",
    "Create or update the hosted benchmark version from local project source and write .workbench/origin.json.",
  ]),
  login: [
    "Usage:",
    "  workbench login [--base-url URL] [--no-open] [--json]",
    "",
    "Authenticate this machine with Workbench Cloud.",
  ],
  logout: [
    "Usage:",
    "  workbench logout [--json]",
    "",
    "Remove the stored Workbench Cloud access token.",
  ],
  whoami: withSourceDirectoryHelp([
    "Usage:",
    "  workbench whoami [--dir DIR] [--json]",
    "",
    "Show the effective Workbench Cloud API target, login status, username, and required adapter auth status.",
  ]),
  adapters: withSourceDirectoryHelp([
    "Usage:",
    "  workbench adapters create PATH [--dir DIR] [--json]",
    "  workbench adapters list [--dir DIR] [--json]",
    "  workbench adapters inspect ID [--dir DIR] [--json]",
    "",
    "Create, list, and inspect Workbench adapters. Adapter sources can be local paths, npm: package refs, or git: refs.",
  ]),
  auth: [
    "Usage:",
    "  workbench auth <command> [options]",
    "",
    "Connect adapter auth for local and hosted runs.",
    "",
    "Commands:",
    "  workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
    "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
  ],
  "auth connect": [
    "Usage:",
    "  workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
    "",
    "Connect adapter auth using a manifest-supported method.",
  ],
  "auth disconnect": [
    "Usage:",
    "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
    "",
    "Disconnect adapter auth locally and, when logged in, in hosted Workbench.",
  ],
  cloud: [
    "Usage:",
    "  workbench cloud <command> [options]",
    "",
    "Hosted Workbench Cloud execution and resource commands.",
    "",
    "Commands:",
    "  workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--samples N] [--watch] [--dry-run] [--json]",
    "  workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]",
    "  workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|CANDIDATE_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]",
    "  workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]",
    "  workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]",
    "  workbench cloud star OWNER/BENCHMARK [--json]",
    "  workbench cloud unstar OWNER/BENCHMARK [--json]",
    "  workbench cloud benchmarks|runs|candidates <command> [options]",
  ],
  "cloud fork": [
    "Usage:",
    "  workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]",
    "",
    "Fork a hosted benchmark project when you intend to change benchmark source.",
  ],
  "cloud star": [
    "Usage:",
    "  workbench cloud star OWNER/BENCHMARK [--json]",
    "",
    "Star a hosted benchmark.",
  ],
  "cloud unstar": [
    "Usage:",
    "  workbench cloud unstar OWNER/BENCHMARK [--json]",
    "",
    "Remove your star from a hosted benchmark.",
  ],
  "cloud eval": withSourceDirectoryHelp(withLifecycleHelp([
    "Usage:",
    "  workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--samples N] [--watch] [--dry-run] [--json]",
    "",
    "Submit candidate files to Workbench Cloud and run hosted evaluation.",
  ], hostedWatchLifecycleHelp)),
  "cloud improve": withSourceDirectoryHelp(withLifecycleHelp([
    "Usage:",
    "  workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]",
    "",
    "Run hosted candidate improvement.",
  ], hostedWatchLifecycleHelp)),
  "cloud open": [
    "Usage:",
    "  workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|CANDIDATE_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]",
    "",
    "Print and open the hosted Workbench URL.",
  ],
  "cloud watch": withSourceDirectoryHelp(withLifecycleHelp([
    "Usage:",
    "  workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]",
    "",
    "Poll a hosted run until it finishes.",
  ], hostedWatchLifecycleHelp)),
  "cloud logs": withSourceDirectoryHelp([
    "Usage:",
    "  workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Show hosted run job statuses and errors.",
  ]),
  "cloud benchmarks": [
    "Usage:",
    "  workbench cloud benchmarks <command> [options]",
    "",
    "Hosted benchmark resource commands.",
    "",
    "Commands:",
    "  workbench cloud benchmarks list [--json]",
    "  workbench cloud benchmarks show OWNER/BENCHMARK [--json]",
    "  workbench cloud benchmarks versions OWNER/BENCHMARK [--json]",
    "  workbench cloud benchmarks starred [--json]",
    "  workbench cloud benchmarks delete OWNER/BENCHMARK [--dir DIR] [--dry-run] [--json]",
  ],
  "cloud runs": [
    "Usage:",
    "  workbench cloud runs <command> [options]",
    "",
    "Hosted run resource commands.",
    "",
    "Commands:",
    "  workbench cloud runs list [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud runs show RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud runs cancel RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
  ],
  "cloud candidates": [
    "Usage:",
    "  workbench cloud candidates <command> [options]",
    "",
    "Hosted candidate resource commands.",
    "",
    "Commands:",
    "  workbench cloud candidates list [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud candidates show CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud candidates files CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud candidates preview CANDIDATE_ID --path PATH [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--output PATH|-] [--json]",
    "  workbench cloud candidates pull CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--out DIR] [--json]",
    "  workbench cloud candidates publish CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "  workbench cloud candidates unpublish CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
  ],
}).map(([key, lines]) => [key, lines.join("\n")]));

export function commandUsage(commandPath: string): string | null {
  return commandHelp[commandPath] ?? cloudNestedCommandUsage(commandPath);
}

const hostedCommandHelp: Record<string, string> = Object.fromEntries(Object.entries({
  "benchmarks list": [
    "Usage:",
    "  workbench cloud benchmarks list [--json]",
    "",
    "List public hosted benchmarks.",
  ],
  "benchmarks show": [
    "Usage:",
    "  workbench cloud benchmarks show OWNER/BENCHMARK [--json]",
    "",
    "Show one hosted benchmark.",
  ],
  "benchmarks versions": [
    "Usage:",
    "  workbench cloud benchmarks versions OWNER/BENCHMARK [--json]",
    "",
    "List hosted benchmark versions.",
  ],
  "benchmarks starred": [
    "Usage:",
    "  workbench cloud benchmarks starred [--json]",
    "",
    "List benchmarks starred by the current user.",
  ],
  "benchmarks delete": [
    "Usage:",
    "  workbench cloud benchmarks delete OWNER/BENCHMARK [--dir DIR] [--dry-run] [--json]",
    "",
    "Delete a hosted benchmark project that you own.",
  ],
  "runs list": [
    "Usage:",
    "  workbench cloud runs list [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "List hosted runs.",
  ],
  "runs show": [
    "Usage:",
    "  workbench cloud runs show RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Show one hosted run.",
  ],
  "runs cancel": [
    "Usage:",
    "  workbench cloud runs cancel RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Cancel a hosted run.",
  ],
  "candidates list": [
    "Usage:",
    "  workbench cloud candidates list [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "List hosted candidates.",
  ],
  "candidates show": [
    "Usage:",
    "  workbench cloud candidates show CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Show one hosted candidate.",
  ],
  "candidates files": [
    "Usage:",
    "  workbench cloud candidates files CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "List files in a hosted candidate snapshot.",
  ],
  "candidates preview": [
    "Usage:",
    "  workbench cloud candidates preview CANDIDATE_ID --path PATH [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--output PATH|-] [--json]",
    "",
    "Preview a file from a hosted candidate snapshot.",
  ],
  "candidates pull": [
    "Usage:",
    "  workbench cloud candidates pull CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--out DIR] [--json]",
    "",
    "Download hosted candidate files.",
  ],
  "candidates publish": [
    "Usage:",
    "  workbench cloud candidates publish CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Make a hosted candidate public.",
  ],
  "candidates unpublish": [
    "Usage:",
    "  workbench cloud candidates unpublish CANDIDATE_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]",
    "",
    "Make a hosted candidate private.",
  ],
}).map(([key, lines]) => [key, lines.join("\n")]));

function cloudNestedCommandUsage(commandPath: string): string | null {
  if (!commandPath.startsWith("cloud ")) {
    return null;
  }
  const withoutCloud = commandPath.slice("cloud ".length);
  return hostedCommandHelp[withoutCloud] ?? null;
}
