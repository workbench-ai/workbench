# Workbench Spec

Workbench is a skill management runtime for [Agent Skills](https://agentskills.io/home). It runs and grades eval cases with agents, records run/job/trace evidence, improves skills from graded below-perfect, failed, or reviewed eval evidence, versions source automatically, and syncs the full evidence graph through Workbench remotes.

The core runtime and CLI remain the canonical source of truth for Workbench behavior. The local and hosted web UX renders the same `WorkbenchInspectionSnapshot` used by CLI formatters and receives a required `WorkbenchActionCapabilities` object describing which run, grade, eval, improve, and acquisition actions the host can perform. Workbench Cloud is the hosted Workbench remote, runner provider, team skill catalog, hosted source provider, and hosted web operation provider.

[Common workflows](workflows.md) contains the command paths users run to finish each common task. Changes to the CLI contract below must keep those paths true.

## Contract map

| If you are changing... | Start here | Cross-check |
| --- | --- | --- |
| Authored project files | [Source and eval shape](#source-and-eval-shape) | [Evaluation basics](evals.md) and [Cases and grading](cases-grading.md) |
| CLI commands or JSON output | [Command surface](#command-surface) | [CLI reference](cli.md) and [Common workflows](workflows.md) |
| Run, grade, eval, improve, or results behavior | [Execution and evidence](#execution-and-evidence) | [Agents and models](agents-models.md), [Improve from evidence](improve.md), and [Results](track.md) |
| Cloud sync, publishing, install, or ownership | [Remotes, publishing, and installation](#remotes-publishing-and-installation) | [Publish](share.md), [Install and clone](install-clone.md), and [Skill packages](skills.md) |
| Local or hosted browser behavior | [Web surfaces](#web-surfaces) | Workbench Cloud route tests |

## When to use this spec

- You need the exact source, command, runtime, remote, or web invariant.
- You are changing CLI or Workbench Cloud behavior.
- A shorter guide omits an edge case and you need the product contract.
- You are aligning tests, docs, and the authored Workbench skill.

## Vocabulary

- Skill: an agent skill package.
- Included skill: a skill installed beside a measured version for one run. It is hashed into the measured version bundle but is not a result row.
- Skill bundle: one measured entry package version plus its included skills and files.
- Version: the exact package version evaluated, such as `earnings-prep v2`, `No skill`, or `alice/summarizer@v1`.
- Project snapshot: the internal immutable source capture Workbench creates at command boundaries.
- Eval: the grade configuration and cases that evaluate skill performance.
- Case: one representative workflow input.
- Agent: one runtime configuration, such as adapter, model label, auth profile, and adapter config.
- Run: one user-started eval, improve, or retry attempt. Matrix detail lives in jobs and result summaries, not in several launch results the user has to manage.
- Trace: observed execution evidence produced by a live host session, an eval case run, or an explicit import.
- Lineage: parent-child relationships between package versions.
- Remote: a Workbench object endpoint used for versions, runs, trace progress, traces, artifacts, and refs.
- Namespace: a Workbench Cloud owner slug. A namespace can be a user or an organization and appears in URLs as `/skills/OWNER/SKILL`.
- Organization: a Cloud-only namespace with members and teams. Organization data is never written into local skill folders.
- Team: a Cloud-only group inside an organization used for project access grants.
- Published source: an immutable package version exposed by a remote as an installable skill.
- Source visibility: the install/list visibility of the published package version. It is separate from full project evidence access and is `private`, `internal`, or `public`.

## Source and eval shape

### Project layout

Simple skill projects need no `.workbench/versions.yaml`:

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/       # authored eval cases; empty after workbench new
.workbench/agents.yaml
.workbench/.gitignore
.workbench/objects/      # ignored runtime object database
.workbench/refs/         # ignored Workbench refs
.workbench/sync/         # ignored per-remote sync state
.workbench/tmp/          # ignored temporary files
.workbench/logs/         # ignored runtime logs
.workbench/locks/        # ignored local command locks
```

When `.workbench/versions.yaml` is absent and `SKILL.md` exists, Workbench behaves as if this were configured:

```yaml
default: current
versions:
  current:
    source: local:.
```

Local result labels default to the `name` frontmatter in `SKILL.md`, with a selected result-matrix ordinal appended so every selected local package version has a distinct JSON label.

### Version sources

Advanced projects may add `.workbench/versions.yaml`:

```yaml
default: all
versions:
  current:
    source: local:.
    includes:
      - name: helper
        source: local:skills/helper
      - name: upstream
        source: github:anthropics/skills//skills/frontend-design@<40-character-commit-sha>
      - name: hosted
        source: workbench:acme/earnings-prep@v019
  no-skill:
    source: none
    label: No skill
  upstream-v020:
    source: workbench:acme/earnings-prep@v020
```

Top-level `versions` entries are measured package versions. The top-level `default` selector must be `all` or a configured version name; `all` is reserved and cannot be used as a version name. Each measured version defines one `source:` string. `source: local:PATH` reads a mutable or vendored skill package inside the project root after realpath resolution; absolute paths, `..` escapes, and symlink escapes are invalid. `source: none` is the built-in no-skill version: Workbench runs the eval with no entry `SKILL.md`, records normal run evidence, and does not create installable source files for that row. `source: workbench:OWNER/SKILL@VERSION` and `source: github:OWNER/REPO//PATH@COMMIT` are immutable external pins; GitHub `COMMIT` must be the full 40-character SHA, not a branch, tag, or short prefix. `includes` are dependencies for a measured local or remote version and are not allowed on `source: none`. When `current` is `source: local:.`, other configured local version source directories are excluded from the current bundle so alternate versions do not become part of the active skill merely because they live in the same project.

### Agents and grading

Agents use the same top-level `default` selector shape in `.workbench/agents.yaml`; the selector must be `all` or a configured agent name, and `all` is reserved so it cannot be used as an agent name:

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

`.workbench/eval.yaml` selects grading directly:

```yaml
version: 1
name: earnings-prep
description: Evaluates whether the skill creates a useful earnings prep note.
grade:
  adapter: rubric
  with:
    criteria:
      - id: accuracy
        description: Uses supported facts and avoids unsupported claims.
      - id: usefulness
        description: Produces a decision-useful earnings prep note.
```

`.workbench/eval.yaml` owns global grade configuration. A runnable authored case is defined only by `.workbench/cases/<case-id>/case.yaml`; other files under `.workbench/cases/` are support files until they live under a case directory with that canonical descriptor. Each case descriptor can add `grade.with` overrides for that case. For the built-in `rubric` grading adapter, criteria merge by stable `id`: global criteria apply to every case, a case criterion with the same `id` overrides the global criterion for that case, and new case-only ids append. The browser renders each case's resolved adapter-generic grade plan in the `Evaluation > Cases` matrix and on the case detail page.

Workbench core runs the selected measured skill with the selected agent, then invokes the grade adapter against the completed workspace, public case files, private case files, traces, and output artifacts. Graders such as `tests` and `rubric` own judgment and score result items only. Provider-backed agents such as `codex` and `claude` own `skill.run` only. Engine adapters such as Harbor still own their own `engine.resolve` and `grade.run` behavior when used as external engines, but the first-party skill-eval path does not wrap agent execution inside the built-in Workbench engine.

### Live trace capture

`workbench record on` enables Workbench's own native Codex and Claude Code trace plugins through official host plugin commands. It writes Workbench-owned recording config under `~/.workbench/traces/recording.json` and reports the local spool path under `~/.workbench/traces/spool/events.jsonl`. It must not directly edit `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.codex/config.toml`, or provider history directories as part of capture setup. If a requested host cannot install or enable the Workbench plugin, the command fails with the host command the operator can run. `workbench record off` disables Workbench's local recording config to stop durable capture, then fails loudly if a requested host plugin or marketplace cannot be removed through the official host plugin command; it must not report success while a requested Workbench plugin teardown failed.

Host plugins call the hidden `workbench trace-hook --host HOST --event EVENT` entrypoint. The hook normalizes the payload into one generic spool event and returns success so tracing cannot break the host turn. The core runtime owns only generic spool kinds such as prompt, claim, stop, discard, and event; host-specific parsing stays at the CLI/plugin edge. A live prompt/stop pair becomes a trace record only when the turn has a durable skill claim. The shipped native plugins create that claim from an explicit leading `$skill` invocation; host integrations can also emit an exact `claim` event when the host provides a real skill activation signal. Ambient host turns and incidental `$skill` mentions in ordinary text are discarded during compaction. `workbench traces`, `workbench show TRACE_ID`, review, and promotion compact pending spool events before reading trace records.

Live trace records are projected into normal run/job evidence for project inspection. A matching live capture appears in `Runs` as a `live` run with an `agent-session` job; the job timeline and output views are rendered from the attached trace evidence. `workbench traces` remains a low-level CLI inventory for reviewing and promoting captured trace records. Workbench does not scan provider session histories such as `~/.codex/sessions` or `~/.claude/projects` as a hidden side effect. A trace can be ungraded or graded, unreviewed or human-reviewed, and can be promoted into a normal authored case with `workbench case promote TRACE_ID --id CASE_ID` only after it is captured, terminal, and has captured input. Failed or deferred reviews require an explicit corrected `--expected` before promotion.

### Package boundary

Authored package-version snapshots contain only the [Agent Skills package](https://agentskills.io/specification): `SKILL.md`, scripts, references, assets, package metadata, and support files outside `.workbench/**`. Workbench quality and runtime controls are separate axes: `.workbench/eval.yaml`, `.workbench/cases/`, and `.workbench/environment/Dockerfile` create evaluation identity; `.workbench/agents.yaml` creates agent identity; `.workbench/versions.yaml` selects measured package sources. Editing cases, grade criteria, environments, version selection, or agents does not create a new package version unless package files outside `.workbench/**` also change. Runtime, install, and local metadata under `.agents/`, `.workbench/objects/`, `.workbench/refs/`, `.workbench/sync/`, `.workbench/tmp/`, `.workbench/logs/`, `.workbench/locks/`, `.workbench/remotes.yaml`, and `.workbench/.gitignore` are not versioned skill source and are not installable source.

## Command surface

### Command list

The taught operator loop is `new`, `init`, `run`, `grade`, `eval`, `improve`, `results`, `publish`, `skills`, and `install`. `clone` is the explicit editable remote-source acquisition command. The full CLI contract also exposes status, inspection, source switching, known-run lifecycle, agent configuration, auth, and plumbing sync.

```text
workbench [--json]
workbench new DIR [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]
workbench init [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]
workbench clone OWNER/SKILL[@VERSION]|URL DIR [--json]
workbench status [--dir DIR] [--json]
workbench log [--runs|--versions] [--dir DIR] [--json]
workbench versions [--dir DIR] [--json]
workbench show REF[:PATH] [--dir DIR] [--json]
workbench switch VERSION [--dry-run] [--yes] [--dir DIR] [--json]
workbench diff [A..B] [--dir DIR] [--json]
workbench run [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]
workbench grade [--versions all|LIST] [--agents all|LIST] [--cases LIST] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]
workbench eval [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--dir DIR] [--json]
workbench record on|off|status [--hosts codex,claude] [--json]
workbench traces [--dir DIR] [--json]
workbench trace review TRACE_ID --pass|--fail|--defer [--note TEXT] [--tag TAG]... [--expected TEXT] [--dir DIR] [--json]
workbench case draft CASE_ID [--dir DIR] [--json]
workbench case promote TRACE_ID --id CASE_ID [--dir DIR] [--json]
workbench improve [--versions LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--dir DIR] [--json]
workbench watch RUN_ID [--dir DIR] [--json]
workbench cancel RUN_ID [--dir DIR] [--json]
workbench retry RUN_ID [--dir DIR] [--json]
workbench results [--versions all|LIST] [--agents all|LIST] [--dir DIR] [--json]
workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]
workbench unpublish VERSION [--dry-run] [--dir DIR] [--json]
workbench delete OWNER/SKILL|URL [--dry-run] [--yes] [--json]
workbench skills [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]
workbench install SOURCE [--target codex|claude] [--scope folder|global] [--dir DIR] [--yes] [--dry-run] [--json] [-- SKILLS_ARGS...]
workbench agent list [--dir DIR] [--json]
workbench agent add NAME --adapter X [--model M] [--with k=v]... [--dir DIR] [--json]
workbench agent rm NAME [--dir DIR] [--json]
workbench login [PROVIDER] [--method METHOD] [--profile P] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]
workbench logout [PROVIDER] [--json]
workbench sync [REMOTE] [--dir DIR] [--dry-run] [--json]
workbench open [--host HOST] [--port PORT] [--dir DIR] [--no-open]
workbench help [COMMAND] [--all]
```

### Output and auth

Default help shows orientation plus the taught lifecycle commands. `help --all` shows the complete product contract above. New docs and skills should teach the primary loop first and link to command help or this contract for lower-level inspection and sync commands.

Human list output is presentation, not the automation contract. Commands that compare rows, including `results`, `skills`, `versions`, `agent list`, and `log`, render borderless aligned tables with lowercase headers. Status words may use conservative terminal color only when stdout is a TTY and color is enabled by the environment; `NO_COLOR` disables it and `FORCE_COLOR` enables it. `--json` remains the stable machine-readable contract and never includes ANSI color escapes.

Auth commands keep the same command-shaped guidance in JSON and human output. Headless `workbench login --start-only --no-open --json` or `workbench login --no-open --json` records a pending device authorization, returns `verificationUriComplete`, and returns a bounded `workbench login --wait --timeout 120 --json` resume command; the operator opens `verificationUriComplete`, signs in and approves the device request, then runs the printed resume command. Provider OAuth capture is native-aware: when native Codex or Claude OAuth material is missing, the first setup command is the provider CLI command, and when native material is present the next setup command is `workbench login PROVIDER --method oauth`. Errors that include `subject.setupCommands` render those commands as a human `setup:` block before the executable `next:` remediation. Isolated Codex `--profile-root DIR` setup is staged as `mkdir -p DIR/.codex`, `CODEX_HOME=DIR/.codex codex login --device-auth`, then `workbench login codex --method oauth --profile-root DIR`; `next:` remains the first provider CLI command.

## Execution and evidence

### Live source and snapshots

Ordinary authoring reads the live working folder. `status`, `versions`, `log`, `show`, `diff`, and `open` are read-only and do not create package versions. `versions` lists durable immutable package snapshots only.

`status` hashes the live package source and reports `worktree.sourceState: "clean"` when it matches a durable snapshot, `"edited"` when it differs from an existing snapshot, or `"no_snapshot"` before any package snapshot exists; human status prints `Source: clean`, `Source: edited`, or `Source: no snapshots yet`. Once cases exist and no active run is more important, `status` normally points to `workbench eval`; when edited source has current scored evidence from one non-default eval agent, it preserves that selector as `workbench eval --agents AGENT`. When the selected or default eval would fail launch readiness because provider auth or Docker is missing, status points to that concrete setup step instead.

Default `diff` compares the live working folder against the latest durable package snapshot without writing one; if no durable snapshot exists, the live files appear as additions. Commands that actually launch, publish, or otherwise need durable package source create or reuse a content-derived version id after readiness has passed. Editing an older switched version and then running a durable operation naturally creates a new lineage.

Dry-run previews may compute package hashes and would-be launch facts in memory, but they must not write package versions, object state, refs, remotes, sync state, runs, jobs, traces, artifacts, or cancellation files. Runtime evidence ids are collision-resistant object ids so isolated copies can create runs before syncing to the same remote.

### Run, grade, and eval

`run`, `grade`, and `eval` resolve selected package versions and agents after launch readiness passes. `run` records or reuses execute jobs only: it executes selected cases only when current execute evidence is missing or stale, captures runner traces, output artifacts, workspace artifacts, and generic result evidence, and never invokes the grade adapter. `grade` records grade jobs only: it selects existing eligible execute jobs, stages their subject output, workspace, traces, and result through read-only dependencies in a clean grader workspace, invokes `grade.run`, and never reruns the skill. `eval` combines the two phases: it creates any missing or stale execute jobs, creates any missing or stale grade jobs, and reuses current execute or grade evidence unless `--rerun` forces the selected phase work. Failed terminal grade jobs are current grade evidence until `--rerun`, so a repeated `grade` or cacheable `eval` does not retry a failing judge by default. Scores are projected from grade job result items; runs and jobs do not store top-level score fields.

### Interactive eval authoring

Interactive eval development is first-class and uses the same primitives. A provider-backed Codex project can draft a case, execute it with `workbench run --agents default --cases CASE_ID`, inspect output and runner traces, add or edit `grade.with.criteria`, then call `workbench grade --agents default --cases CASE_ID` to judge existing output without rerunning Codex. Execution freshness is keyed by prompt, public case input, package version, agent snapshot, and sample selection. Grade freshness is keyed by the subject execution evidence plus the current grade adapter, effective grade config, grader config, and private grader-visible files. Therefore grade-only edits invalidate grade jobs, not execute jobs; `workbench eval` after a grade-only edit and existing execute evidence reuses that execute job and creates grade work only. `workbench run --rerun` forces fresh execute jobs, `workbench grade --rerun` forces fresh grade jobs only, and `workbench eval --rerun` forces both selected execute and grade phases. Fresh grade jobs do not inherit prior grade workspaces, traces, or artifacts; they only receive subject execution evidence through declared read-only dependencies.

### Case drafting and readiness

If no cases exist under `.workbench/cases`, real eval fails before scheduling with `no_eval_cases` and remediates to `workbench case draft CASE_ID`, which creates a draft `.workbench/cases/CASE_ID/case.yaml`; local and command-backed projects also get an executable `tests/test.sh` harness. Provider-backed projects return an editor `next` command for `case.yaml`; local or command-backed projects return an editor `next` command for both generated files.

Draft placeholders are readiness blockers: `run` requires the prompt placeholder to be replaced, while `grade` and `eval` also require the draft grade criteria placeholder to be replaced before judgment evidence can be recorded. This preserves the prompt-first workflow where a user drafts a prompt, runs output-only execution, inspects the answer, and only then writes grade criteria for grading.

The generated shell harness intentionally fails with score `0` until edited so local and command-backed projects do not accidentally record perfect draft evidence. Provider-backed cases can be prompt plus `grade.with.criteria` only. Local or command-backed cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory.

Real local `run`, `grade`, and `eval` use the same readiness gate as dry-run before launch; draft placeholders, missing provider auth, missing or invalid `.workbench/environment/Dockerfile`, unavailable Docker, or an unready grade adapter fails before package-version persistence, scheduling, and run/job/evidence writes.

### Selection, reuse, and dry runs

If `--versions` or `--agents` is omitted, Workbench uses the matching manifest `default` selector. Matching completed local evidence is reused unless `--rerun` is passed: `run` reuses current execute jobs, `grade` reuses current grade jobs, and `eval` reuses both phases when possible.

`run --dry-run`, `grade --dry-run`, and `eval --dry-run` resolve selectors, case count, sample count, execute jobs, grade jobs, cached jobs, location, source state, the explicit environment file, and launch readiness for the same live package source the matching real operation would snapshot after readiness, including `cases=0` and other readiness issues when no cases have been authored, but they do not schedule or write package versions, refs, runs, jobs, remotes, sync state, traces, artifacts, or cancellation files.

Local reusable terminal jobs appear in `cachedJobIds`; `cachedRunIds` is provenance derived from the runs that own those reusable jobs, and both fields can describe a partially reusable subset of the selected matrix. A fully cacheable eval is still a new run envelope over reused execute and grade evidence, not a special whole-run cache path. Hosted dry-run keeps planned package versions in memory for readiness instead of resolving them through persisted object state and leaves cache IDs empty rather than presenting local evidence as hosted planner output; accepted hosted runs use the Cloud planner after sync.

### Progress output

The launch contract is one `workbench.run.v1` snapshot; version, agent, case, sample, execute, and grade details appear in `progress` and `measurements`. During long-running non-cached work, CLI progress is derived from normalized run and job state and written sparsely to stderr with phase, planned/completed/scored/remaining work, clearly labeled partial score, failures and cancellations, active job, evidence count, total reported cost, wall time, and heartbeat. It does not show ETA.

In `--json` mode, stdout remains one final schema-tagged document containing one run snapshot; after a durable accepted run id exists, stderr progress JSON Lines are `workbench.run.v1` snapshots for that run. Pre-accept hosted JSON progress is suppressed until Workbench Cloud accepts the run; if setup failure clears the temporary local handle, the final error may include `subject.correlationRunId`, which is not watchable or showable, but must not expose a top-level durable `runId`.

Queued status and hosted-worker guidance begin only after Workbench Cloud accepts the run. Terminal failed or canceled `workbench.run.v1` snapshots and terminal `watch` output omit self-referential `next: workbench show RUN_ID` hints.

### Next commands and setup

Successful perfect eval output points to `workbench results`; publishing and Workbench Cloud login are explicit sharing/readiness workflows surfaced by `status`, `publish`, `sync`, and hosted commands. Successful below-perfect eval output points to `improve` only when that command can run with an improvement-capable agent; otherwise the next command is one staged provider-backed improver setup step, followed by provider setup for that improver, followed by an improver rerun once that agent is runnable.

Provider setup commands account for native auth already present in the current home: when native Codex auth or Claude OAuth material exists but Workbench provider auth is missing, readiness starts at `workbench login PROVIDER --method oauth` instead of repeating the native login step. Bare `status` demotes optional provider setup for an already-added but unauthenticated improver to `workbench results`, while explicit setup and execution commands keep the concrete auth remediation.

Missing local provider auth, missing or invalid `.workbench/environment/Dockerfile`, local Docker sandbox availability, Workbench Cloud auth, or hosted provider auth is reported as blocked launch readiness plus command-shaped setup remediation while preserving the no-write preview; when no cases exist, the top-level `next` remains `workbench case draft CASE_ID` because real eval cannot launch yet, and draft placeholder issues point at the case file before provider, environment, or Docker setup. Otherwise the top-level `next` is normally the first setup step when one exists, preferring immediate auth/setup commands before hosted plan blockers, and JSON issues may include `subject.setupCommands` for the full staged sequence. Hosted personal-plan blockers preserve the full publish-and-rerun command-shaped remediation with the documented `ORG/SKILL` placeholder plus structured requirement details.

Evaluating an older internal full-project state is not part of the execution command surface; use `show`, `diff`, `switch`, and `results` for historical inspection.

### Runtime isolation and failures

Execute jobs mount all resolved skills at `/workspace/input/skills`. `SKILL_DIR` points at the selected entry skill directory, `SKILLS_DIR` points at `/workspace/input/skills`, `CASE_DIR` points at the case files, and `OUTPUT_DIR` points at output files.

Command and local agents run execute jobs with isolated network unless configured with `network=on`, `network=open`, or `network=true`. Provider-backed Codex and Claude agents default to open egress because adapter execution must reach the provider. If a provider-backed agent is explicitly configured with isolated network, Workbench fails before scheduling the eval.

If an execute adapter, command, auth materialization, or runtime fails before producing a public result file, Workbench records failed run, job, trace, and artifact evidence with the error. When a shell test writes `$OUTPUT_DIR/result.json`, that public result file controls pass/fail and score even if the shell exits nonzero afterward; failed result-file evidence is not treated as missing score data.

### Improvement scope

`improve` edits only the mutable `current` project skill package: any file outside `.workbench/**`, including `SKILL.md`, scripts, references, assets, agent metadata, and package support files. Ordinary improve may read `.workbench` eval/case/evidence state but must not rewrite `.workbench/**`; improving eval design is a separate future job, not hidden in skill improvement.

### Improvement agent readiness

`improve` requires exactly one selected version and one selected agent; if a default selector expands to multiple entries, the usage error lists configured versions and agents and shows concrete commands such as `workbench improve --versions current --agents default`. The selected agent must have a skill-improvement adapter before execution starts whenever actionable evidence exists; empty projects and perfect-only eval history return a diagnostic evidence error, not an unconditional rerun command.

If the current eval definition has not been run yet, improve remediation points to `workbench eval`; perfect-only current evidence remediation creates the next unused draft case with `workbench case draft CASE_ID`. If actionable evidence exists and a selected non-provider agent cannot improve, dry-run returns a blocked readiness envelope and non-dry-run returns `improve_adapter_required`; when an improvement-capable `improver` already exists, both reuse that agent's provider setup, improver rerun, and improve commands instead of suggesting another `agent add`, otherwise the staged setup starts by adding `improver`.

There is no implicit fallback improver: the selected agent is both the improver and proof eval agent unless the user follows the explicit `--agents improver` setup path.

### Improvement provider auth

The hard-cut setup path is to configure that selected agent directly, for example `codex login --device-auth` if `~/.codex/auth.json` is missing, `workbench login codex --method oauth`, and `workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default`. Claude setup is `claude setup-token` in an interactive shell, browser authorization, `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`, and `workbench agent add default --adapter claude --model sonnet --with auth=default`; Workbench captures the Claude profile plus OAuth token without implementing a second Claude browser authorization flow. Provider `model` values are adapter pass-through; Claude models must be Claude Code accepted aliases such as `opus` or `sonnet`, or full Claude Code model ids.

Hosted dry-run reports local improve-agent ineligibility before Cloud target checks, and reports Workbench Cloud login first when Cloud auth is absent. If provider auth is captured before Workbench Cloud auth, the next successful bare `workbench login` uploads connected provider bundles to Cloud for hosted execution. Repeating `workbench login PROVIDER --method oauth` with a matching connected local provider bundle and no fresh native capture material reuses that bundle and uploads it instead of reporting the native setup step again.

Isolated validation can pass `--profile-root DIR` to read provider-native state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. Empty or malformed Codex `auth.json` files are treated as missing native auth for readiness and are rejected by `workbench login codex --method oauth` with `provider_oauth_invalid`.

### Improvement evidence and proof

`improve` requires graded below-perfect, failed, or reviewed eval evidence for the selected version and eval definition; perfect eval runs are not improvement evidence, unscored runtime or auth failures are not improvement evidence, and useful evidence is not rejected merely because it came from a different eval agent or a historical smoke-labeled case. Once the selected proof agent has a perfect current comparable eval for the same eval definition, older below-perfect traces stop making `improve` ready.

`improve --dry-run` resolves the selected version, agent, evidence, incumbent, proof eval plan, location, auth plus local Docker sandbox readiness, and write scope for the same edited current source a real improve would reconcile, but it does not edit source, schedule proof work, sync Cloud, auto-link a remote, or write Workbench object state.

Workbench records the proposed improved version plus proof execute and proof grade jobs. Proof runs use the ordinary eval pipeline, eval hash, case set, samples, grade adapter contract, and selected agent. If the improve adapter cannot create a patch, or the proof eval fails at the adapter/runtime layer, `improve` fails clearly; a proof eval failure still leaves the candidate version and proof run available for inspection and results.

Workbench switches to the improved version only when the proof run succeeds and beats the incumbent for the same eval agent and eval hash, and the switched output points to a higher-sample rerun before publish when the proof was small. Hosted `improve --cloud` validates local target and evidence before hosted plan checks, Cloud auto-linking, sync, or scheduling, then follows the same local materialization rule after terminal Cloud evidence syncs back and reconciles the same Cloud remote once more after a promoted local switch; if the local current version changed while the hosted run was in flight, Workbench refuses to overwrite it and leaves `workbench switch VERSION --dry-run` as the explicit resolution preview.

### Run watch, cancel, and retry

Known-run lifecycle operations are top-level commands. `watch RUN_ID` follows local committed state, local hosted live-handle state, or hosted inspection state until the run is terminal, renders the same concrete `workbench.run.v1` snapshot projection as the launch command, and syncs terminal hosted evidence before returning; if the run is already terminal locally, it summarizes local evidence without contacting Cloud. A successful terminal inspection exits `0` for succeeded, failed, and canceled runs; automation reads `run.status` for result semantics. Failed or canceled terminal watch output omits self-referential `next: workbench show RUN_ID`; succeeded eval watch/retry next commands preserve non-default version or agent selectors so the printed results command inspects the evidence from that run. `watch` exits `130` on user interrupt and nonzero when the run cannot be inspected or is still pending past the watch timeout.

`cancel RUN_ID` requests cancellation without deleting evidence: accepted hosted cancellation goes through the Cloud cancel API, pre-accept hosted cancellation terminalizes the local live handle and prevents the original command from scheduling, and local cancellation writes an ignored request under `.workbench/tmp/cancel/` for the active executor to observe before pending jobs and at cooperative running-job boundaries. Canceling an already terminal run fails immediately with `run_terminal` and `workbench show RUN_ID`.

`retry RUN_ID` creates a new run from the selected run's stored operation plan and records `retryOfRunId`; it retries the whole run, not only failed jobs. Eval retry uses the plan's evaluated version, selected skill, selected agent, and samples. Improve retry uses the plan's original base version and budget, while the old proof run's `versionId` remains the candidate version it evaluated. Hosted retry validates the stored plan, creates a local watchable retry handle with the final retry run id, and then performs the normal remote sync or auto-link repair before resolving the Cloud skill id and scheduling the retry, so a locally known pre-accept hosted run does not require a manual publish before retry. If the stored operation plan is missing or invalid, retry fails before scheduling and points to a fresh `run`, `grade`, `eval`, or `improve`.

In `--json` mode, lifecycle commands return one command envelope with `run: WorkbenchRunSnapshot`; they do not expose separate command-level `result`, `progress`, or `jobs` structures. `run` is output-only execution, not a read verb and not an object-exchange verb.

`switch` is the explicit command that materializes an older or alternate version into the working folder. It does not invoke Git. `switch --dry-run` reports added, changed, and removed package-source files without writing them. A real `switch` refuses to overwrite local package source that is not represented by any saved Workbench version; pass `--yes` only after reviewing the dry-run preview.

### Results

`results` defaults to the current eval snapshot and uses manifest version and agent defaults unless `--versions` or `--agents` is passed. It never mixes measurements across eval hashes. `results` is pure inspection over committed local Workbench state: it does not reconcile edited files into a package version, persist derived eval or skill-bundle snapshots, write refs, or create run/evidence objects.

CLI results render the package-version and agent axes for all recorded local package versions that have matching evidence; `--versions all` keeps that historical matrix, while `--versions current` narrows to the current package version and unambiguous version-id prefixes select the matching result row. Human results output is an aligned table and renders only cells with recorded run evidence; JSON keeps the full selected matrix, including cells with no run, when the selected version sources are valid.

If the current selected version has no recorded evidence, human output says so explicitly and points to `workbench eval` even when historical selected versions have visible evidence; if non-current selected versions are also unrun, human output says those unrun versions were omitted from the table, and partially unrun selected agent/version cells are named. Local package ordinals in result labels are stable across filtering. Recorded run evidence remains comparable even if an unrelated historical package manifest is no longer parseable. Included skills affect bundle hashes but do not appear as rows unless also defined as top-level measured versions.

Result cells prefer the terminal run with the most case/sample evidence, using recency only as a tie-breaker, and still carry run status and error when no numeric score exists. Failed evals with public result-file scores still show those scores; runtime failures with no result file render as failed evidence with `n/a`. Canceled partial evals keep their canceled status and sample coverage but do not expose a completed quality score or `status.runs.lastScore`.

Human results output reports the same primary metric vocabulary as the browser: Quality, Coverage, Latency, and Cost. Quality is a numeric score only, not a pass/fail classification. Coverage is completed samples over planned samples. JSON result cells and run measurement summaries expose coverage as `{ completed, planned }`; requested operation sample counts remain in operation plans as `samples`. Latency and Cost show totals plus per-sample values using the same sample denominator. Execute, grade, improve, and other role totals stay in run/job evidence drilldown rather than becoming role-specific result columns.

## Remotes, publishing, and installation

### Local storage and remotes

Raw Workbench runtime state is not a Git repository. Git users keep using Git normally; Workbench does not call Git, write Git branches, create tags, commit, push, pull, or mutate Git refs. Workbench storage is repo-local and ignored, similar in spirit to `.git` but independent of Git.

Workbench remotes are non-secret local Workbench object endpoints recorded in schema-tagged `.workbench/remotes.yaml`, analogous to git remote configuration but not exposed as taught CLI nouns. `publish` creates or updates the Cloud remote for the selected skill handle, and `run --cloud`, `grade --cloud`, `eval --cloud`, or `improve --cloud` auto-links the same Cloud skill project when a logged-in project has no linked Cloud remote yet. File remotes can be configured by editing `.workbench/remotes.yaml` for portability tests.

Accepted URLs are explicit `file:///absolute/path` remotes and Workbench Cloud skill URLs such as `https://workbench.ai/skills/OWNER/SKILL`; bare paths and API implementation URLs are rejected. Adding or changing a remote does not create a package version.

`workbench sync` merges immutable object packs between local `.workbench/objects` and the remote and records each attempt in `.workbench/sync/<remote>.json`, including a local object-graph fingerprint after successful sync. For Workbench Cloud remotes, that fingerprint ignores lifecycle objects already owned by that Cloud remote, so imported hosted run/job/trace/artifact snapshots do not create false local sync dirtiness.

File remotes are sync-only. Workbench Cloud remotes use the same object pack schema over HTTP and are the only remotes that can publish installable source. Local live-inspection metadata under `.workbench/live/`, including hosted pre-schedule run handles, is ignored delivery state and is never versioned, synced, published, or installed.

### Network operations

Network is explicit. Ordinary local reads and writes do not perform hidden remote synchronization. `workbench sync`, `publish`, `install`, `run --cloud`, `grade --cloud`, `eval --cloud`, `improve --cloud`, and accepted hosted `workbench watch|cancel|retry` are the network command surfaces.

Hosted `run --cloud`, `grade --cloud`, `eval --cloud`, and `improve --cloud` first resolve the current local source/evidence plan and validate selected hosted provider auth plus knowable hosted plan access before creating a temporary local live handle, Cloud auto-linking, sync, resolve, or scheduling work that may take time. Hosted `retry` first resolves the selected run's stored operation plan, then creates a temporary local live handle before hosted repair work.

Before Cloud accepts that run id, human progress is labeled as preparing the Workbench Cloud run; JSON mode suppresses `workbench.run.v1` progress until durable acceptance, and queued plus hosted-worker wording is reserved for accepted Cloud run snapshots. Hosted compute requires an organization-owned Cloud skill whose organization has an active Team or Enterprise plan; personal Free skills can publish source but cannot start Workbench-hosted operations.

If a pre-accept auto-link, sync, resolve, or scheduling failure occurs after that handle is printed, Workbench clears the temporary handle and returns the setup error without adding durable failed run evidence; the cleared correlation id may appear as `subject.correlationRunId`, but it is not a top-level `runId` and is not watchable or showable. Personal plan blockers preserve the full publish-and-rerun command-shaped remediation with the documented `ORG/SKILL` placeholder and carry structured requirement details, and knowable hosted operation plan blockers return before a temporary handle or sync.

Until Cloud accepts it, `watch` and `cancel` operate on the local handle; cancellation is a lock-free live-state side channel, and the original hosted command observes the request promptly before scheduling, even when pre-schedule sync is still running. Pre-accept cancellation terminalizes the local handle so the cancellation can be inspected, while intentional detach during that window leaves the handle watchable. Intentional cancel or detach during that window leaves the previous remote sync health intact instead of recording the in-flight abort as a remote failure.

The schedule request sends that run id plus only minimal scheduling input: operation kind, version id, optional skill selector, optional agent selector, and limits such as samples or budget. Cloud derives the eval snapshot, skill bundle, selected agent, and improve evidence from Cloud's stored project state and returns an authoritative snapshot for the same run id; the CLI then replaces the local live handle with that Cloud snapshot.

Hosted waits observe the same inspection envelope and state-notice API as the web UI, refetch the snapshot on `changed` or `reset`, advance their wait cursor without refetching on progress-only trace evidence, and feed the same sparse concrete progress renderer used by local run, grade, eval, improve, retry, status, and show from normalized runs and jobs. Production runner capacity keeps five warm hosts, enough immediate capacity for the common 20-sample hosted eval loop on the default runner shape, and burst scale-out adds runners in five-host increments for larger queues.

Once a hosted run reaches a terminal state, the CLI reports terminal evidence sync as an explicit progress phase and syncs Cloud evidence back once; promoted hosted improve reconciles the same Cloud remote again after switching local source. Ctrl-C during an attached local or hosted wait detaches with exit 130, leaves the local worker or hosted runner active, and returns `next: workbench watch RUN_ID`; `watch` is the explicit resume and refresh command for that known run.

`workbench sync cloud` remains object-exchange repair and portability plumbing for local source or local-only object changes, not the normal run-follow command, and imported Cloud-owned lifecycle objects are tracked as Cloud-owned so they do not dirty sync status or dry-run write deltas. If a remote is unavailable, local objects remain usable, `workbench status --json` reports the per-remote error as state, and explicit `workbench sync REMOTE` remains the repair command when auth and link prerequisites are already satisfied.

If local source or local-owned objects changed after the last successful sync, status reports `local_changes` instead of `up_to_date` without contacting the remote; when another workflow action remains primary, status also exposes `syncNext` in JSON and `sync next: workbench sync REMOTE --dry-run` in human output. When the affected remote is Workbench Cloud and the CLI is logged out, status reports `auth_required` and points to `workbench login`. Published logged-out Cloud remotes also report `auth_required` so status and `sync cloud --dry-run` agree that login is required before reconciliation.

### Publishing and removal

`workbench publish [VERSION]` syncs the selected version to a Workbench Cloud remote, records it in the published-version set, moves the mutable `publication/current-version` pointer to that version, and asks Workbench Cloud to expose source through two read surfaces: an installable agent skill package and editable package source for `workbench clone`. After a successful publish, the persisted remote sync fingerprint includes those publication refs, so `status` reports the remote as `up_to_date` and `sync cloud --dry-run` reports no push or pull work unless additional local-owned changes exist.

`--as OWNER/SKILL` sets or replaces the linked Cloud skill handle when publishing; dry-run preview derives the handle in memory and writes no files. In dry-run output, `next` is the exact non-dry-run publish command to retry, while JSON `installCommand` and human `after publish:` expose the install handoff that becomes valid only after a real publish. Subsequent bare `publish` uses the persisted handle and preserves the last explicit source visibility.

If synced state already shows the requested version, handle, and visibility as current published source, `publish` returns `Already published` and does not send another publish mutation. `--team` requires an organization-owned skill and user-facing errors use team visibility wording rather than internal storage enum names.

Workbench Cloud publishes return one canonical install handle like `OWNER/SKILL`; human and JSON output expose that handle, not install URL fields. Published package versions are addressable as `OWNER/SKILL@VERSION` and Cloud `/skills/OWNER/SKILL/versions/VERSION` URLs, where `VERSION` may be the full version id or any unambiguous displayed prefix. In JSON mode, publish returns one command envelope on stdout and does not write human progress prose to stderr.

File remotes reject publish because they are object-pack sync endpoints, not source hosts. Public source is still served through the Cloud skill URL and well-known discovery for the public `skills` CLI, but the Workbench CLI teaches `OWNER/SKILL` handles. Publication is explicit; ordinary sync and `--cloud` auto-linking share evidence and package versions but do not expose installable source or change published visibility.

`workbench unpublish VERSION --dry-run` validates that a prior exact published version is removable, reports the current published version, and returns the exact non-dry-run `workbench unpublish VERSION` follow-up without deleting source availability or rewriting local publication refs. Non-dry-run `workbench unpublish VERSION` removes that prior exact version from the published-version set without deleting the local immutable version or moving the current publication pointer; the current published version must first be replaced. When a still-published replacement is known, current-version unpublish errors point directly to `workbench publish VERSION`; otherwise they point to `workbench versions`. The CLI validates removability before printing destructive removal progress.

`workbench delete OWNER/SKILL --dry-run` previews deletion of the entire Cloud skill project, and `workbench delete OWNER/SKILL --yes` deletes the project, published source, install package, hosted runs, and synced objects. When run from a local Workbench project linked to that Cloud handle, non-dry-run delete also clears matching local publication refs and removes the dead Cloud remote so `status` no longer advertises the deleted project. Version-pinned delete refs are rejected with `workbench unpublish VERSION` remediation because unpublish is the version-level removal command.

### Installation

`workbench install SOURCE` requires a source and resolves in two modes. For plausible Workbench Cloud sources such as `OWNER/SKILL`, `OWNER/SKILL@VERSION`, or `/skills/OWNER/SKILL` URLs, it checks Workbench Cloud first. If a published Workbench source is available, it installs with Workbench provenance, Workbench version identity, and the current managed-copy semantics. If the source is explicitly external, or a Workbench check is unauthenticated, not found, or unavailable, it delegates to the pinned upstream `skills add` command and reports that the install is an external Agent Skill. External Agent Skills are not Workbench-versioned; `publish`, `clone`, eval evidence, improve lineage, and Workbench Cloud visibility do not apply to that installed copy.

Explicit external sources include local paths, GitHub/GitLab URLs, `github:` and `gitlab:` shorthand, SSH/git URLs, `.git` URLs, and non-Workbench HTTP(S) sources. Workbench does not parse or discover those source shapes itself. It maps only explicit Workbench-owned flags to `skills add`: `--target codex` becomes `--agent codex`, `--target claude` becomes `--agent claude-code`, `--scope global` becomes `--global`, `--yes` is forwarded, and `--dir DIR` runs the delegated command from `DIR` so relative external sources and folder installs resolve there. If `--target` is omitted for external fallback, Workbench passes no upstream `--agent` and the upstream `skills` package owns agent detection or selection. Advanced upstream options are passed after `--`, for example `workbench install vercel-labs/skills -- --skill find-skills --full-depth` or `workbench install ./local-skill -- --agent cursor`. If Cloud resolution succeeds as a Workbench source, post-`--` external options are rejected.

With no flags, install targets exactly one detected current coding-agent target in folder scope; when no single target is detected, it fails with a command-shaped remediation such as `workbench install OWNER/SKILL --target codex`. `--target codex|claude` selects the coding-agent product, `--scope folder|global` selects where it is written, and installing for both Codex and Claude is two explicit commands.

It installs only the agent skill package: `SKILL.md`, scripts, references, assets, agent metadata, and package support files. It never installs authored `.workbench` controls, runtime objects, refs, logs, remotes, locks, or install metadata inside the package directory. The package directory name comes from the published handle's `SKILL` segment, so a handle such as `OWNER/command-skill` installs into `command-skill` even if `SKILL.md` frontmatter contains a different display name.

Re-running the same source over an unchanged Workbench-managed copy is a no-write idempotent result, including the root-local install ledger timestamp, and dry-run reports top-level `result: "unchanged"`. If the published package version changes but the installable package files are byte-identical, real install updates only the root-local ledger and reports `metadataChanged: true`, while dry-run reports `result: "planned"`, `metadataChanged: true`, and `filesCopied: 0`.

Changed or unmanaged Workbench-managed destination content requires `--yes`. Overwrite remediation preserves the source pin, scope, directory, and any explicit target flag from the attempted command, but it does not add a target flag that was only inferred from the current coding agent. Workbench-source `--dry-run` reports the resolved target without writing package files or the root-local `.workbench-installs.json` ledger, and `filesCopied` is `0` because it is an actual-write count; successful planned dry-runs return and print the exact non-dry-run install command as `next`, while destinations that require `--yes` return `blocked` with `requiresOverwrite: true`, target-level `result: "blocked"`, and the exact `--yes` command in `remediation`/`next`. External fallback `--dry-run` does not run mutating `skills add`; it reports the exact delegated command and writes nothing. Bare `workbench install` is a usage error.

### Inventory

`workbench skills` is the read-only inventory command. With no flags it scans configured Codex and Claude folder and global skill roots visible from the current directory, not arbitrary sibling directories. If the requested directory itself is an editable Workbench project with `SKILL.md` and `.workbench` controls, inventory includes that current project as a folder-scope `project` row even when it is not nested under an agent skill root.

Empty human inventory output includes a short hint that `skills` scans configured roots and the current Workbench project only, and that arbitrary sibling `SKILL.md` folders should be entered for `workbench init` or found with shell search. `--target codex|claude` narrows to one coding-agent product, `--scope folder|global` narrows to one access scope, and `--dir DIR` changes the folder-scope scan root.

Broad inventory sorts folder rows before global rows, managed/current or Workbench-project rows before unmanaged rows, and the detected current coding agent before other targets. To keep broad scans focused on the immediate install/adopt job, unmanaged global rows are omitted unless `--scope global` is requested; managed/current, modified, missing, and Workbench-project global rows remain visible.

Inventory performs no network access, takes no project write lock, writes no files, and reports `current`, `modified`, `missing`, `project`, `unmanaged`, or `duplicate-name` status from visible skill roots and Workbench install ledgers. `project` means a visible local skill folder has `.workbench` project controls but no Workbench install-ledger provenance. It does not show a `not installed` universe because catalog search is a separate job.

### Install targets

For Codex folder scope, Workbench reads `.agents/skills` roots visible from the requested directory up to the Git root and writes to exactly `<dir>/.agents/skills`. For Codex global scope, Workbench reads and writes `$HOME/.agents/skills`. For Claude folder scope, Workbench reads and writes `<dir>/.claude/skills`. For Claude global scope, Workbench reads and writes `$CLAUDE_CONFIG_DIR/skills` when set, otherwise `$HOME/.claude/skills`. These target paths are implementation details in human output and are present in JSON for automation.

### Project creation and cloning

`workbench new DIR` creates a brand-new Workbench skill project and fails on any non-empty target directory. It writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/environment/Dockerfile`, `.workbench/.gitignore`, and ignored runtime directories.

Provider-backed default agent setup is reported separately from first-case authoring: JSON exposes `setupCommands`, human output says provider setup is still required before provider-backed eval, and top-level `next` remains the project-scoped `workbench case draft CASE_ID` while no case exists. `workbench init` adopts the current directory as an existing skill project, requires `SKILL.md`, creates the same missing `.workbench` controls around the package, and does not rewrite `SKILL.md`.

`workbench clone OWNER/SKILL[@VERSION]|URL DIR` is the editable-source acquisition path. The bare handle clones the current published package source; `@VERSION` clones an exact still-published package version. It creates a Workbench project containing the agent skill package plus the normal minimal `.workbench` scaffold, including its own environment Dockerfile. Authored eval controls, agents, runtime object state, refs, sync state, logs, locks, remotes, install ledgers, and `.agents` pollution are not copied from the published source; the cloned project initializes its own fresh local `.workbench/objects`, `.workbench/refs`, and `.workbench/sync` state for versioning.

### Ownership and visibility

Workbench Cloud owns the `OWNER` namespace in those URLs. Personal namespaces are created from user profiles. Organization namespaces, teams, membership, and skill grants live only in Cloud. The CLI does not add commands for organization or team state, and no organization/team metadata is persisted in `.workbench`.

Published source visibility does not grant project evidence access. `private` source is readable only by users with project read access. `internal` source is readable by members of the owning organization and is valid only for organization-owned skills. `public` source is readable by anyone through the canonical `/skills/OWNER/SKILL/.well-known/skills/index.json` discovery URL used by Agent Skills clients and the upstream `skills` CLI; the bare `/skills/OWNER/SKILL/.well-known/skills` route redirects there, and unsupported `.well-known` paths return JSON 404 responses. Internal and private installs use the same `/skills/OWNER/SKILL` URL with Workbench CLI auth. Runs, jobs, traces, artifacts, eval evidence, reviews, and improvement history require project read access regardless of source visibility.

## Web surfaces

### Local browser and inspection

`workbench open` serves the local Workbench UI from a read-only inspection snapshot as a foreground server; the CLI prints the actual bound URL and a `Press Ctrl-C to stop` hint, then closes the server and exits `0` when the user presses Ctrl-C. `--port` accepts integers from 0 through 65535, and port 0 asks the OS for an ephemeral port.

The browser reads live package files, authored evaluation source, and durable object state through `WorkbenchInspectionSnapshotEnvelope` and starts local eval/improve operations through `/api/operations` using the same operation request vocabulary as CLI scheduling. Eval-like requests carry `caseIds`, targets, phases, and grader; CLI-friendly run, grade, and eval commands lower into that shape before planning. Inline browser case creation writes real `.workbench/cases/<case-id>/case.yaml` files before those cases are run, with the local server deriving a unique case id from the title or prompt. Local operation requests start the private local-worker path; they do not shell out to `workbench`. The local endpoint returns a `workbench.run.v1` snapshot once durable run state exists, while the worker continues the run and writes durable state until terminal state.

Local browser routes watch authored source and Workbench control files; changing `SKILL.md`, authored assets, cases, agents, eval controls, or `.workbench/environment/Dockerfile` sends a state notice so the UI refetches without requiring a package snapshot. Local and hosted browser routes return `WorkbenchInspectionSnapshotEnvelope` from `/snapshot`, then deliver `WorkbenchStateNotice` invalidations through `/state/stream` or `/state/wait`; the UI refetches the envelope on `changed` or `reset`, treats `progress` as focused trace evidence freshness, and does not depend on active-work polling.

Automatic live refetches are quiet; the global refreshing indicator is reserved for explicit user refresh. User-facing web timestamps use the viewer's browser locale and timezone; UTC is not forced unless a future surface explicitly labels itself as UTC.

`workbench status` is the active attention read and includes active runs with compact concrete progress plus `workbench watch RUN_ID` as the causal next command when a known run is still queued or running. `workbench log` and `workbench show` read inspection state without taking the project write lock; path-only `show` reads live package and authored evaluation files, while `show REF:PATH` reads historical source or run/job evidence content. Timeline commands are summary-first and omit file content.

`workbench show RUN_ID` summarizes run facts, the same progress snapshot and evidence count used by watch/status, failure groups, `Measurements`, non-case `Job groups`, paired `Case results`, and exact `Jobs` before listing runnable `workbench show RUN_ID:PATH` commands for canonical evidence files, but it does not watch, sync, cancel, retry, or point failed/canceled runs back to the same show command.

Agent and case evidence rows are keyed by measured skill plus agent, so multi-skill or multi-version matrix runs do not merge same-agent case/sample rows. Public run/job sample labels are one-based like live progress in human and command JSON projections; raw stored job objects keep zero-based sample indexes.

Run/job evidence projections expose one canonical user-facing path per file, filter nested internal `.workbench` runtime paths, omit raw trace metadata files such as `request.json`, `result.json`, and `trace.json`, and resolve suffixes only after collapsing equivalent candidates. Provider session refs printed by Workbench evidence, such as `codex:SESSION_ID` and `claude:SESSION_ID`, resolve from that evidence through `workbench show`; native local provider sessions resolve when the local provider files exist. Direct trace inspection uses the same raw-metadata filter.

Hosted skill pages use the same snapshot projection, live invalidation contract, and operation vocabulary. Run status starts as `queued` for hosted work waiting on environment or worker capacity, moves to `running` once work is claimed or proof work is pending, and becomes terminal when all jobs finish. Captured files and terminal trace artifacts are attached when the job records terminal trace evidence.

### Hosted snapshot reads

Cloud hosted skill pages initially receive a `WorkbenchInspectionSnapshot` inside the envelope. Users with project read access boot from a compact project index that includes identity, status counts, refs, action capabilities, and source/version file manifests, but omits historical runs, jobs, traces, execution events, artifacts, result matrices, lineage, and file contents. Evidence views load the full evidence snapshot through explicit Workbench detail reads. Source-only viewers receive a snapshot constructed from the published package version and publication refs only; it includes package files and intentionally omits authored Workbench controls, runs, jobs, traces, execution events, artifacts, private score evidence, and improvement history. Source-only live cursors advance only when publication/source-visible refs change; private durable run and job mutations advance the full project state cursor, while progress-only execution events advance the full project progress cursor.

### Hosted file reads

Hosted selected-file reads are exact detail reads. A file preview or `show REF:PATH`-equivalent URL must resolve the selected owner, version/run/evidence object, and path, then fetch that one file body. It must not hydrate the whole hosted project merely to extract a single package, evaluation, trace, or artifact file. The public route shape stays the same; this is a storage and performance invariant under the shared read contract.

### Primary surfaces

The primary web surfaces are `Files`, `Evaluation`, and `Runs`. `Files` is the default browser route for local `workbench open` and hosted `/skills/OWNER/SKILL` pages.

The shared header shows the Workbench brand, optional hosted account controls, snapshot freshness, refresh, and a compact active-work badge such as `No active runs`, `1 running`, or `1 running, 2 queued`. The skill header renders the canonical `OWNER/SKILL` handle when known, uses the same handle for copy and acquisition actions, falls back to the package frontmatter name only when no handle exists, shows source visibility when hosted, and renders an action bar driven entirely by `WorkbenchActionCapabilities`.

Full-access local and hosted pages show `Evaluate`, `Improve`, and `Use skill` popovers when those actions are available. Evaluation execution is started through `Evaluate`; the header does not expose separate global `Run` or `Grade` controls. Operation popovers submit `WorkbenchOperationRequest` objects to the host operation endpoint and navigate to the returned run route.

`Use skill` remains acquisition: it copies install or editable-source commands for remote/source contexts and does not pretend a hosted page can write to a user's filesystem. Source-only Cloud pages do not expose run/grade/eval/improve mutations; they expose acquisition options only.

### Files

`Files` is the current source browser for the active skill package, with rendered/raw previews for package files and a collapsible history section. When the URL does not explicitly select a package version, `Files` selects the project current version, then the current published version, then the newest known version by creation time. This keeps full-access hosted pages aligned with source-only hosted pages when a project has published version 2 but no private current ref. It shows package files such as `SKILL.md`, scripts, references, assets, metadata, `dist/**`, and other support files outside `.workbench/**` and `.agents/**`. Authored evaluation controls appear under `Evaluation`, not `Files`. It does not show Workbench controls or runtime/object metadata such as `.workbench/eval.yaml`, `.workbench/cases/**`, `.workbench/agents.yaml`, `.workbench/objects`, `.workbench/refs`, `.workbench/sync`, `.workbench/live`, `.workbench/tmp`, `.workbench/logs`, `.workbench/locks`, `.workbench/remotes.yaml`, `.workbench/.gitignore`, `.git/**`, `node_modules/**`, `__pycache__/**`, or `.DS_Store`.

### Evaluation

`Evaluation` has `Results` and `Cases`. `Results` is the quality decision surface and the browser counterpart to `workbench results`. It renders one selected evaluation at a time, with exact package version labels, state badges such as `Current` or `Published`, Quality, Coverage, Latency, and Cost columns, primary metric bars, and quality tradeoff charts. Results are a read-only projection over real evaluated cases and configurations.

The selected evaluation appears above the table with case count and grader type; if multiple eval definitions exist, a single selector switches the grading scope. Evaluation snapshots have required `createdAt`, `updatedAt`, `gradeAdapter`, and typed `cases` metadata. The selector orders options by `createdAt`, assigns `Evaluation N` from that order, defaults to the newest option, and marks that same option `Latest`; older evaluations show `Created DATE` plus case count and grader type. `updatedAt` records when the authored eval source was observed but does not reorder evaluation history.

The current active package version, no-skill version, alternate pinned versions, and prior scored local versions are rows in the same scorecard rather than separate page modes, but rows from different evaluations are not ranked together by default. Failed rows show `Failed` and a concise error summary while still opening the run evidence.

The scorecard labels completed and planned samples as `Coverage`; underlying execute/grade job completion belongs in run details and progress, not the results table. Eval job phases must not inflate the sample count, and role-specific timing or cost must not be copied into per-agent result columns. If no visible rows have recorded cost, the web scorecard omits the cost column and explains missing cost in run details as failed before usage, not reported, or not tested. CLI `workbench results --versions ...` remains the scriptable version-axis results surface.

`Cases` is the editable case-by-configuration matrix for the selected evaluation. Rows are authored cases, columns are configurations, and each output cell is one clickable unit for running, grading, and inspecting related run/job evidence. Empty cells render `Not run`. Column visibility is view-scoped; the inline `+` reveals another existing configuration in the comparison, the `x` removes a visible column from the comparison, and the bottom `+ Add case` creates a real authored case row. Execute-only attempts can be graded later with the current grading config by submitting a grade phase against the existing attempt. Case detail pages show definition files plus linked run evidence when the viewer has full project access.

### Runs

`Runs` shows active and completed runs/jobs from the snapshot. Active jobs appear first, followed by completed runs in reverse chronology.

Run detail pages are full skill-scoped pages under `/runs/:runId`. They show status, Quality, Coverage, Latency, Cost, evaluation, measured skill, agent, start time, improved-output version when present, run error, `Measurements`, non-case `Jobs`, paired `Case results`, selected job output files, and timelines backed by interpreted execution trace detail. Execute, grade, improve, and live agent-session role details appear inside job drilldown, not as primary run summary columns.

Browser run pages select one job with `/runs/:runId/jobs/:jobId`; `?view=timeline` and `?view=output` choose the selected job's evidence view. Eval case jobs keep `Execute` and `Grade` phase tabs, but the route identity is the job id rather than query fields that restate case, agent, skill, bundle, version, phase, or sample. Case outcome facts stay separate from the selected phase's status, score, duration, and error so a failed grade does not masquerade as a failed execute timeline.

Raw jobs, traces, artifacts, and captured files are inspected inside that run evidence context or through CLI object commands as trace evidence, not as the primary run summary.
