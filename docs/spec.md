# Workbench Spec

Workbench is a skill management runtime for [Agent Skills](https://agentskills.io/home). It runs and grades Eval cases with agents, records run/job/trace evidence, improves Skills from graded below-perfect, failed, or reviewed Eval evidence, versions packages automatically, and syncs the full evidence graph through Workbench remotes.

The core runtime and CLI remain the canonical source of truth for Workbench behavior. The local and hosted web UX renders the same `WorkbenchInspectionSnapshot` used by CLI formatters and receives a required `WorkbenchActionCapabilities` object describing which run, grade, Eval, improve, and acquisition actions the host can perform. Workbench Cloud is the hosted Workbench remote, runner provider, team Skill catalog, package publisher, and hosted web operation provider.

The [Quickstart](quickstart.md) teaches the canonical end-to-end path. Changes to the CLI contract below must keep that path true.

## Contract map

| If you are changing... | Start here | Cross-check |
| --- | --- | --- |
| Authored project files | [Skill and Eval shape](#skill-and-eval-shape) | [Evaluation basics](evals.md) and [Cases and grading](cases-grading.md) |
| CLI commands or JSON output | [Command surface](#command-surface) | [CLI reference](cli.md) and [Quickstart](quickstart.md) |
| Run, grade, eval, improve, or results behavior | [Execution and evidence](#execution-and-evidence) | [Agents and models](agents-models.md), [Improve from evidence](improve.md), and [Results](track.md) |
| Cloud sync, publishing, install, or ownership | [Remotes, publishing, and installation](#remotes-publishing-and-installation) | [Publish](share.md), [Install and clone](install-clone.md), and [Skill packages](skills.md) |
| Local or hosted browser behavior | [Web surfaces](#web-surfaces) | Workbench Cloud route tests |

## When to use this spec

- You need the exact file, command, runtime, remote, or web invariant.
- You are changing CLI or Workbench Cloud behavior.
- A shorter guide omits an edge case and you need the product contract.
- You are aligning tests, docs, and the authored Workbench skill.

## Vocabulary

- Skill: an agent skill package.
- Included skill: a skill installed beside a measured version for one run. It is hashed into the measured version bundle but is not a result row.
- Skill bundle: one measured entry package version plus its included skills and files.
- Version: the exact package version evaluated, such as `earnings-prep v2`, `No skill`, or `alice/summarizer@v1`.
- Project snapshot: the internal immutable project capture Workbench creates at command boundaries.
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
- Published package: an immutable package version exposed by a remote as an installable Skill.
- Skill visibility: the install/list visibility of a published package. It is separate from full project evidence access and is `private`, `internal`, or `public`.

## Skill and Eval shape

### Project layout

Simple skill projects need no `.workbench/versions.yaml`:

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/       # authored eval cases; empty after workbench skill new
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

Top-level `versions` entries are measured package versions. The top-level `default` selector must be `all` or a configured version name; `all` is reserved and cannot be used as a version name. Each measured version defines one `source:` string. `source: local:PATH` reads a mutable or vendored Skill package inside the project root after realpath resolution; absolute paths, `..` escapes, and symlink escapes are invalid. `source: none` is the built-in no-Skill version: Workbench runs the Eval with no entry `SKILL.md`, records normal run evidence, and creates no installable package files for that row. `source: workbench:OWNER/SKILL@VERSION` and `source: github:OWNER/REPO//PATH@COMMIT` are immutable external pins; GitHub `COMMIT` must be the full 40-character SHA, not a branch, tag, or short prefix. `includes` are dependencies for a measured local or remote version and are not allowed on `source: none`. When `current` is `source: local:.`, other configured local version source directories are excluded from the current bundle so alternate versions do not become part of the active Skill merely because they live in the same project.

### Agents and grading

Agents use the same top-level `default` selector shape in `.workbench/agents.yaml`; the selector must be `all` or a configured agent name, and `all` is reserved so it cannot be used as an agent name:

```yaml
default: default
agents:
  default:
    adapter: codex
```

`.workbench/eval.yaml` selects the default grading policy directly. New projects start with no eval-level grader:

```yaml
grade:
  adapter: none
```

Set a concrete default only when most cases should inherit the same grader:

```yaml
grade:
  adapter: rubric
  with:
    judge:
      use: codex
    criteria:
      - id: accuracy
        description: Uses supported facts and avoids unsupported claims.
      - id: usefulness
        description: Produces a decision-useful earnings prep note.
```

`.workbench/eval.yaml` is only the default grade adapter policy and shared adapter config. Top-level eval `version`, `name`, and `description` fields are not supported. A runnable authored case is defined only by `.workbench/cases/<case-id>/case.yaml`; the case id is the directory name, and other files under `.workbench/cases/` are support files until they live under a case directory with that canonical descriptor. A case may omit `grade.adapter` to inherit the eval default, or set `grade.adapter` to choose its exact grader. The eval default may be `none`; inherited-`none` cases run but do not create grade jobs until the case or eval selects `rubric`, `tests`, or `command`. If the case adapter matches the eval default, case `grade.with` overlays eval `grade.with`; if it differs, the case starts from that adapter's empty config. Case-specific grading is adapter-owned source: the built-in `rubric` adapter persists criteria in `case.yaml` under `grade.with.criteria`, the built-in `tests` adapter persists executable case files such as `tests/test.sh`, and the built-in `command` adapter persists `grade.with.command`. Draft grader readiness follows the same effective adapter: `none` has no grade readiness, rubric checks criteria, tests check test files, and command checks the command string. Files from an unselected grader are ordinary support files and do not block launch. For inherited `rubric` cases, criteria merge by stable `id`: global criteria apply to every case, a case criterion with the same `id` overrides the global criterion for that case, and new case-only ids append. The browser and CLI render the same adapter-generic authoring primitives instead of hard-coding `grade.with` storage paths. The shared primitive contract owns defaults and validation for required fields, list sizes, choices, file contents, and unknown authoring keys before any source write happens.

Workbench core runs the selected measured skill with the selected agent, then invokes the grade adapter against the completed workspace, public case files, private case files, traces, and output artifacts. Rubric requires an explicit `grade.with.judge` and runs one tool-capable judge turn covering every effective criterion. The judge may inspect arbitrary artifacts, including spreadsheets, and returns one exact scorecard with evidence locators. Invalid judge output fails the grade job without a repair turn. Tests and command graders remain deterministic. Provider-backed agents own `skill.run`; the rubric adapter owns its judge harness invocation.

### Sources

A Source is a deployment-owned evidence corpus. It is not part of `WorkbenchProjectState`, a Skill, an Eval, an object pack, or Eval execution evidence. An adapter owns native discovery, credentials, cursors, redaction, and native record boundaries, then streams one strict versioned envelope containing bounded generic record segments and optional generic presentation blocks. The Source contract contains no adapter, provider, session, message, span, channel, task, or outcome field.

The initial Codex and Claude adapters reuse provider-owned streaming reducers below this boundary. That implementation choice does not make `AgentTrace` the Source schema. Another adapter may ingest Slack, email, agent spans, or arbitrary records without changing Source persistence, analysis, operations, or UI.

`workbench source sync SOURCE_ID` is model-free and publishes one immutable authoritative snapshot. Private local Source state is split by access pattern: a small `~/.workbench/sources/<source-id>/binding.json` contains only deployment and namespace identity plus adapter id, while atomic `checkpoint.json` contains the committed opaque cursor and at most one active server sync id. Both files are mode `0600` in a mode `0700` Source directory. Neither contains a normalized corpus, per-record remote hash map, or pending-record journal. Bounded evidence pages are content-addressed and server-verified; old snapshots continue to resolve exact cited bodies after records change or the adapter disconnects.

`workbench source analyze SOURCE_ID --record-offset O --record-limit N` first returns an immutable preflight covering that exact window in the snapshot's canonical SHA-256 record-id order. `--all-records` is an explicit alternative. Any selected record above 512 MiB and any multi-record selection whose conservative initial output bound exceeds 50,000 occurrences fail before authorization or spend. One indivisible record below the byte cap may reach preflight even when that conservative bound is higher; extraction then publishes nothing if actual occurrences cross 50,000. Preflight discloses the selected and remaining records plus the next offset, deterministic call bounds, locality, evidence egress, token ceilings, configured-model rates, explicit `map=include|omit`, optional Map projection cost, and maximum authorized spend. Disjoint windows make every record reachable without pretending window insights are Source-wide or reconciling separate windows automatically. The CLI omits Map by default; `--map` explicitly includes only the optional projection. Map choice is excluded from semantic Analysis identity. No model call starts until the user repeats the same action with a fresh random short-lived token, explicit confirmation, and a cap they chose; the CLI emits no executable default. The exact actor, namespace, request, model, and plan independently name a stable operation. A fresh higher-cap preflight is derived from that operation's persisted immutable plan and resumes the same operation id and shards without reconstructing Source/Eval input or consuming a retry.

The LLM identifies task boundaries and synthesizes grounded workflow occurrences, a typed workflow taxonomy, and cited insights. Prompt revision v11 retains 2,048 serialized UTF-8 bytes of semantic state and a 2,560-byte published item envelope per occurrence, while requiring at most eight representative citations across retained and current evidence combined. Deterministic code partitions raw segments into complete, nonoverlapping, Unicode-safe citation atoms of at most 1,024 UTF-8 bytes. The model selects only offered atom ids; it never authors quote text or offsets. Runtime code alone materializes exact ranges and hashes, then validates bounds, tree shape, complete occurrence accounting, access, and spend. Later leaf-reduction and whole-Analysis envelopes are mechanically larger and tested at their fixed maxima. A generation binding returns either a complete structured object or an explicit provider output-limit result with usage. Extraction commits that metered result and repacks the same whole persisted segments into smaller evidence packs. It never accepts a partial structured payload, splits evidence heuristically, or infers a task boundary from the provider signal. Non-repackable semantic stages and Eval drafting fail closed on output limit. Embeddings are optional presentation-only input to the post-analysis two-dimensional Map and are never used for semantic retrieval, clustering, or reconciliation.

Each Analysis has one optimistic-concurrency review. Keep and Dismiss are the only review verbs. An Eval draft requires kept workflows, an exact review version, and a human-confirmed objective. Draft generation is separately authorized, produces an immutable portable patch, and never creates, applies, or runs an Eval automatically. Apply is an explicit base-hash-guarded action for either a hosted destination or a writable local checkout. Discard is a separate explicit judgment that rejects the patch without deleting its audit record. Ready, applied, and discarded drafts remain inspectable and do not expire silently.

### Package boundary

Authored package-version snapshots contain only the [Agent Skills package](https://agentskills.io/specification): `SKILL.md`, scripts, references, assets, package metadata, and support files outside `.workbench/**`. Workbench quality and runtime controls are separate axes: `.workbench/eval.yaml`, `.workbench/cases/`, and `.workbench/environment/Dockerfile` create evaluation identity; `.workbench/agents.yaml` creates agent identity; `.workbench/versions.yaml` selects measured package sources. Editing cases, grade criteria, environments, version selection, or agents does not create a new package version unless package files outside `.workbench/**` also change. Runtime, install, and local metadata under `.agents/`, `.workbench/objects/`, `.workbench/refs/`, `.workbench/sync/`, `.workbench/tmp/`, `.workbench/logs/`, `.workbench/locks/`, `.workbench/remotes.yaml`, and `.workbench/.gitignore` are neither versioned nor installable package files.

## Command surface

### Command list

The only domain roots are `source`, `eval`, and `skill`. Their subcommands own domain reads and mutations; known-operation controls and auth remain top-level. Bare `workbench` renders help. There are no flat aliases, implicit status command, combined run-and-grade command, or standalone trace-mining command.

```text
workbench [--json]
workbench source add|list|show|sync|analyze|evidence|review|delete
workbench eval list|show|draft|apply|discard|run|grade|results|case|grader|agent
workbench skill new|init|clone|list|show|install|improve|versions|diff|switch|sync|publish|unpublish|delete
workbench open|watch|retry|cancel|login|logout|help|version
```

`workbench source show SOURCE_ID --analysis ANALYSIS_ID --page nodes|occurrences|insights|review --cursor CURSOR --limit N --json` is the bounded Source read; `--node`, `--workflow`, and `--insight` select one grounded drilldown. The model-backed `source analyze` and `eval draft` commands return a preflight until `--confirm --max-cost USD --preflight-token TOKEN` authorizes the exact plan. `source review SOURCE_ID ANALYSIS_ID` is a deterministic Keep/Dismiss compare-and-swap with no model call or preflight. `eval apply DRAFT_ID --yes` is explicit and never runs the Eval. A local destination is the checkout's one current Eval, guarded by its declared Skill name and exact base hash. Hosted `OWNER/SKILL` means a new Eval from an empty base; only `OWNER/SKILL/EVAL` targets an existing Eval. `help` and the generated [CLI reference](cli.md) are the exact flag inventory.

### Output and auth

Default help orients around Sources, Evals, and Skills. `help --all` shows every leaf. New docs and skills teach those domain paths directly.

Human list output is presentation, not the automation contract. Commands that compare rows, including `source list`, `eval results`, `eval list`, `skill list`, `skill versions`, and `eval agent list`, render borderless aligned tables with lowercase headers. Status words may use conservative terminal color only when stdout is a TTY and color is enabled by the environment; `NO_COLOR` disables it and `FORCE_COLOR` enables it. `--json` remains the stable machine-readable contract and never includes ANSI color escapes.

Auth commands keep the same command-shaped guidance in JSON and human output. Headless Workbench Cloud login records a pending device authorization, returns `verificationUriComplete`, and returns a bounded wait command. Harness authentication is selected with `workbench login ADAPTER`; the adapter owns provider-native discovery, capture, and setup guidance. Generic Workbench readiness reports only the disconnected adapter/profile and the corresponding login command.

## Execution and evidence

### Live source and snapshots

Ordinary authoring reads the live working folder. `skill show`, `skill versions`, `skill diff`, and `open` are read-only and do not create package versions. `skill show` reports whether live package source is clean, edited, or has no snapshot; `skill versions` lists durable immutable package snapshots only. Bare `workbench` renders help rather than a hidden project-status mode.

Default `skill diff` compares the live working folder against the latest durable package snapshot without writing one; if no durable snapshot exists, the live files appear as additions. Commands that launch, publish, or otherwise need durable package source create or reuse a content-derived version id after readiness has passed. Editing an older switched version and then running a durable operation naturally creates a new lineage.

Dry-run previews may compute package hashes and would-be launch facts in memory, but they must not write package versions, object state, refs, remotes, sync state, runs, jobs, traces, artifacts, or cancellation files. Runtime evidence ids are collision-resistant object ids so isolated copies can create runs before syncing to the same remote.

### Run and grade

`eval run` and `eval grade` resolve selected package versions and agents after launch readiness passes. `eval run` records or reuses execution jobs only: it runs selected cases only when no terminal job has the selected cell's current run input hash, captures runner traces, output artifacts, workspace artifacts, and generic result evidence, and never invokes the grade adapter. `eval grade` selects existing eligible output, stages its workspace, traces, and result through read-only dependencies in a clean grader workspace, invokes `grade.run`, and never reruns the Skill. There is no combined command. Failed terminal grade jobs remain current until `--rerun`; scores are projected from grade job result items rather than stored as top-level run or job fields.

### Interactive eval authoring

Interactive Eval development is first-class and uses the same primitives in the CLI and browser. A Codex project can draft a case, run it with `workbench eval run --agents default --cases CASE_ID`, inspect output and runner traces, edit grader inputs, then call `workbench eval grade --agents default --cases CASE_ID` to judge existing output without rerunning Codex. Every execution job stores a run input hash keyed by prompt, run-visible case input, Skill version, agent snapshot, sample selection, and environment. Every grade job stores a grade input hash keyed by the subject job, resolved grader, effective config, grader-visible files, and environment. Grade-only edits therefore invalidate grade jobs only. `eval run --rerun` and `eval grade --rerun` independently force fresh evidence. Fresh grade jobs receive subject evidence only through declared read-only dependencies.

### Case drafting and readiness

If no cases exist under `.workbench/cases`, real eval fails before scheduling with `no_eval_cases` and remediates to `workbench eval case draft CASE_ID`, which creates the files required by the eval default grader. `workbench eval grader` reports the default grader, and `workbench eval grader set ADAPTER` writes the minimal `.workbench/eval.yaml` policy through the same adapter-owned primitive contract used by the browser. `workbench eval case draft CASE_ID --grader rubric|tests|command` creates the same case with an explicit case-level grader override. `none` creates only `case.yaml`. `rubric` creates `case.yaml` with a draft criterion. `tests` creates `case.yaml` plus executable `tests/test.sh`. `command` creates `case.yaml` with a draft command. Adapters without case-authored fields create only `case.yaml`.

Draft placeholders are readiness blockers: `eval run` requires the prompt placeholder to be replaced, while `eval grade` also requires the draft grade criteria placeholder to be replaced before judgment evidence can be recorded. This preserves the prompt-first workflow where a user drafts a prompt, runs output-only execution, inspects the answer, and only then writes grade criteria.

The generated shell harness intentionally fails with score `0` until edited so tests-backed projects do not accidentally record perfect draft evidence. Rubric-backed cases can be prompt plus criteria supplied globally or per case. Tests-backed cases use an executable `tests/test.sh` under the case directory.

Real local `eval run` and `eval grade` use the same readiness gate as dry-run before launch; draft placeholders, missing provider auth, missing or invalid `.workbench/environment/Dockerfile`, unavailable Docker, or an unready grade adapter fails before package-version persistence, scheduling, and evidence writes.

### Selection, reuse, and dry runs

If `--versions` or `--agents` is omitted, Workbench uses the matching manifest `default` selector. Matching completed local evidence is reused unless `--rerun` is passed: `eval run` reuses current execution jobs and `eval grade` reuses current grade jobs.

`eval run --dry-run` and `eval grade --dry-run` resolve selectors, case count, sample count where applicable, planned and reusable jobs, location, package state, environment, and launch readiness, but do not schedule or write package versions, refs, runs, jobs, remotes, sync state, traces, artifacts, or cancellation files.

Local reusable terminal jobs appear in `cachedJobIds`; `cachedRunIds` is provenance derived from the runs that own those reusable jobs, and both fields can describe a partially reusable subset of the selected matrix. A fully cacheable eval is still a new run envelope over reused run and grade evidence, not a special whole-run cache path. Hosted dry-run keeps planned package versions in memory for readiness instead of resolving them through persisted object state and leaves cache IDs empty rather than presenting local evidence as hosted planner output; accepted hosted runs use the Cloud planner after sync.

### Progress output

The launch contract is one `workbench.run.v1` snapshot; version, agent, case, sample, run, and grade details appear in `progress` and `measurements`. During long-running non-cached work, CLI progress is derived from normalized run and job state and written sparsely to stderr with step, planned/completed/scored/remaining work, clearly labeled partial score, failures and cancellations, active job, evidence count, total reported cost, wall time, and heartbeat. It does not show ETA.

In `--json` mode, stdout remains one final schema-tagged document containing one run snapshot; after a durable accepted run id exists, stderr progress JSON Lines are `workbench.run.v1` snapshots for that run. Pre-accept hosted JSON progress is suppressed until Workbench Cloud accepts the run; if setup failure clears the temporary local handle, the final error may include `subject.correlationRunId`, which is not watchable or showable, but must not expose a top-level durable `runId`.

Queued status and hosted-worker guidance begin only after Workbench Cloud accepts the run. Terminal failed or canceled `workbench.run.v1` snapshots and terminal `watch` output omit self-referential `next: workbench eval show RUN_ID` hints.

### Next commands and setup

Successful perfect grade output points to `workbench eval results`; publishing and Workbench Cloud login remain explicit Skill workflows. Successful below-perfect grade output points to `workbench skill improve` only when that command can run with an improvement-capable agent; otherwise the next command is one staged provider-backed improver setup step.

Harness setup is adapter-owned. Explicit setup and execution commands retain `workbench login ADAPTER` as their concrete remediation; `skill show` remains inspection rather than an implicit workflow dispatcher.

Missing local provider auth, missing or invalid `.workbench/environment/Dockerfile`, local Docker sandbox availability, Workbench Cloud auth, or hosted provider auth is reported as blocked launch readiness plus command-shaped setup remediation while preserving the no-write preview; when no cases exist, the top-level `next` remains `workbench eval case draft CASE_ID` because real eval cannot launch yet, and draft placeholder issues point at the case file before provider, environment, or Docker setup. Otherwise the top-level `next` is normally the first setup step when one exists, preferring immediate auth/setup commands before hosted plan blockers, and JSON issues may include `subject.setupCommands` for the full staged sequence. Hosted personal-plan blockers preserve the full publish-and-rerun command-shaped remediation with the documented `ORG/SKILL` placeholder plus structured requirement details.

Evaluating an older internal full-project state is not part of the execution command surface; use `skill show`, `skill diff`, `skill switch`, `eval show`, and `eval results` for historical inspection.

### Runtime isolation and failures

Run jobs mount all resolved skills at `/workspace/input/skills`. `SKILL_DIR` points at the selected entry skill directory, `SKILLS_DIR` points at `/workspace/input/skills`, `CASE_DIR` points at the case files, and `OUTPUT_DIR` points at output files.

Command and local agents run jobs with isolated network unless configured with `network=on`, `network=open`, or `network=true`. Harness-backed adapters default to open egress when their manifest requires auth. If such an agent is explicitly configured with isolated network, Workbench fails before scheduling the eval.

If a run adapter, command, auth materialization, or runtime fails before producing a public result file, Workbench records failed run, job, trace, and artifact evidence with the error. When a shell test writes `$OUTPUT_DIR/result.json`, that public result file controls pass/fail and score even if the shell exits nonzero afterward; failed result-file evidence is not treated as missing score data.

### Improvement scope

`improve` edits only the mutable `current` project skill package: any file outside `.workbench/**`, including `SKILL.md`, scripts, references, assets, agent metadata, and package support files. Ordinary improve may read `.workbench` eval/case/evidence state but must not rewrite `.workbench/**`; improving eval design is a separate future job, not hidden in skill improvement.

### Improvement agent readiness

`improve` requires exactly one selected version and one selected agent; if a default selector expands to multiple entries, the usage error lists configured versions and agents and shows concrete commands such as `workbench skill improve --versions current --agents default`. The selected agent must have a skill-improvement adapter before execution starts whenever actionable evidence exists; empty projects and perfect-only eval history return a diagnostic evidence error, not an unconditional rerun command.

If the current Eval definition has not been run and graded, improve remediation points to `workbench eval run` followed by `workbench eval grade`; perfect-only current evidence remediation creates the next unused draft case with `workbench eval case draft CASE_ID`. If actionable evidence exists and a selected non-provider agent cannot improve, dry-run returns a blocked readiness envelope and non-dry-run returns `improve_adapter_required`; when an improvement-capable `improver` already exists, both reuse that agent's provider setup and improve commands instead of suggesting another agent.

There is no implicit fallback improver: the selected agent is both the improver and proof eval agent unless the user follows the explicit `--agents improver` setup path.

### Improvement adapter auth

Configure the selected agent directly, for example `workbench login codex` followed by `workbench eval agent add default --adapter codex --with auth=default`. Omit `model` to use the adapter default; explicit model labels pass through opaquely. Provider-native files, environment variables, setup commands, defaults, and validation remain adapter-owned.

Hosted dry-run reports local improve-agent ineligibility before Cloud target checks, and reports Workbench Cloud login first when Cloud auth is absent. If provider auth is captured before Workbench Cloud auth, the next successful bare `workbench login` uploads connected provider bundles to Cloud for hosted execution. Repeating `workbench login PROVIDER --method oauth` with a matching connected local provider bundle and no fresh native capture material reuses that bundle and uploads it instead of reporting the native setup step again.

Isolated adapter validation may pass a profile root through the adapter login surface. Generic Workbench code does not inspect provider-native files or environment variables.

### Improvement evidence and proof

`improve` requires graded below-perfect, failed, or reviewed eval evidence for the selected version and eval definition; perfect eval runs are not improvement evidence, unscored runtime or auth failures are not improvement evidence, and useful evidence is not rejected merely because it came from a different eval agent or a historical smoke-labeled case. Once the selected proof agent has a perfect current comparable eval for the same eval definition, older below-perfect traces stop making `improve` ready.

`improve --dry-run` resolves the selected version, agent, evidence, incumbent, proof eval plan, location, auth plus local Docker sandbox readiness, and write scope for the same edited current source a real improve would reconcile, but it does not edit source, schedule proof work, sync Cloud, auto-link a remote, or write Workbench object state.

Workbench records the proposed improved version plus proof run and proof grade jobs. Proof runs use the ordinary eval pipeline, eval hash, case set, samples, grade adapter contract, and selected agent. If the improve adapter cannot create a patch, or the proof eval fails at the adapter/runtime layer, `improve` fails clearly; a proof eval failure still leaves the candidate version and proof run available for inspection and results.

Workbench switches to the improved version only when the proof run succeeds and beats the incumbent for the same eval agent and eval hash, and the switched output points to a higher-sample rerun before publish when the proof was small. Hosted `improve --cloud` validates local target and evidence before hosted plan checks, Cloud auto-linking, sync, or scheduling, then follows the same local materialization rule after terminal Cloud evidence syncs back and reconciles the same Cloud remote once more after a promoted local switch; if the local current version changed while the hosted run was in flight, Workbench refuses to overwrite it and leaves `workbench skill switch VERSION --dry-run` as the explicit resolution preview.

### Run watch, cancel, and retry

Known-run lifecycle operations are top-level commands. `watch RUN_ID` follows local committed state, local hosted live-handle state, or hosted inspection state until terminal, renders the same concrete `workbench.run.v1` snapshot projection as launch, and syncs terminal hosted evidence before returning. A successful terminal inspection exits `0` for succeeded, failed, and canceled runs; automation reads `run.status`. Failed or canceled output omits self-referential `next: workbench eval show RUN_ID`; successful output preserves non-default selectors in its `eval results` guidance. `watch` exits `130` on user interrupt and nonzero when the run cannot be inspected or remains pending past the timeout.

`cancel RUN_ID` requests cancellation without deleting evidence: accepted hosted cancellation goes through the Cloud cancel API, pre-accept hosted cancellation terminalizes the local live handle and prevents scheduling, and local cancellation writes an ignored request for the active executor. Canceling an already terminal run fails immediately with `run_terminal` and `workbench eval show RUN_ID`.

`retry RUN_ID` creates a new run from the selected run's stored operation plan and records `retryOfRunId`; it retries the whole run, not only failed jobs. Eval retry uses the stored version, Skill, agent, cases, step, and samples. Improve retry uses the original base version and budget. If the plan is missing or invalid, retry fails before scheduling and points to the owning `eval run`, `eval grade`, or `skill improve` action.

In `--json` mode, lifecycle commands return one command envelope with `run: WorkbenchRunSnapshot`; they do not expose separate command-level `result`, `progress`, or `jobs` structures. `run` is output-only execution, not a read verb and not an object-exchange verb.

`skill switch` is the explicit command that materializes an older or alternate version into the working folder. It does not invoke Git. `--dry-run` reports added, changed, and removed package-source files without writing them. A real switch refuses to overwrite unsaved local package source; pass `--yes` only after reviewing the preview.

### Results

`eval results` defaults to the current Eval snapshot and uses manifest version and agent defaults unless selectors are passed. It projects only evidence whose run and grade input hashes match the selected Eval version, package version, case, configuration, agent, and sample. Origin Eval hashes remain provenance. Results are pure inspection over committed local state and never reconcile edited files or create evidence.

CLI results render the package-version and agent axes for all recorded local package versions that have matching evidence; `--versions all` keeps that historical matrix, while `--versions current` narrows to the current package version and unambiguous version-id prefixes select the matching result row. Human results output is an aligned table and renders only cells with recorded run evidence; JSON keeps the full selected matrix, including cells with no run, when the selected version sources are valid.

If the current selected version has no recorded evidence, human output says so and points to `workbench eval run` before grading. Unrun historical versions are omitted from the human table and retained in JSON; partially unrun selected cells are named. Local package ordinals remain stable across filtering.

Result cells prefer the terminal run with the most case/sample evidence, using recency only as a tie-breaker, and still carry run status and error when no numeric score exists. Failed evals with public result-file scores still show those scores; runtime failures with no result file render as failed evidence with `n/a`. Canceled partial evals keep their canceled status and sample coverage but do not expose a completed quality score or `status.runs.lastScore`.

Human results output reports the same primary metric vocabulary as the browser: Quality, Coverage, Latency, and Cost. Quality is a numeric score only, not a pass/fail classification. Coverage is completed samples over planned samples. JSON result cells and run measurement summaries expose coverage as `{ completed, planned }`; requested operation sample counts remain in operation plans as `samples`. Run, grade, improve, and other role totals stay in run/job evidence drilldown rather than becoming role-specific result columns.

## Remotes, publishing, and installation

### Local storage and remotes

Raw Workbench runtime state is not a Git repository. Git users keep using Git normally; Workbench does not call Git, write Git branches, create tags, commit, push, pull, or mutate Git refs. Workbench storage is repo-local and ignored, similar in spirit to `.git` but independent of Git.

Workbench remotes are non-secret local object endpoints recorded in schema-tagged `.workbench/remotes.yaml`, analogous to git remote configuration but not exposed as nouns. `skill publish` creates or updates the Cloud remote for the selected Skill handle, and hosted `eval run`, `eval grade`, or `skill improve` auto-links the same Cloud Skill when a logged-in project has no linked remote. File remotes remain available for portability tests.

Accepted URLs are explicit `file:///absolute/path` remotes and Workbench Cloud skill URLs such as `https://workbench.ai/skills/OWNER/SKILL`; bare paths and API implementation URLs are rejected. Adding or changing a remote does not create a package version.

`workbench skill sync` merges immutable object packs between local `.workbench/objects`, canonical trace bundles, and the remote, then records each attempt in `.workbench/sync/<remote>.json`, including a local object-graph fingerprint after successful sync. Trace records are transported in the object pack and hydrated back into project bundles under `.workbench/traces/<trace-id>/`; local projects do not store traces under `.workbench/objects/trace`. For Workbench Cloud remotes, that fingerprint ignores lifecycle objects already owned by that Cloud remote, so imported hosted run/job/trace/artifact snapshots do not create false local sync dirtiness.

File remotes are sync-only. Workbench Cloud remotes use the same object pack schema over HTTP and are the only remotes that can publish installable packages. Local live-inspection metadata under `.workbench/live/`, including hosted pre-schedule run handles, is ignored delivery state and is never versioned, synced, published, or installed.

### Network operations

Network is explicit. Ordinary local reads and writes do not perform hidden remote synchronization. `source` adapter actions, `skill sync|publish|install`, hosted `eval run|grade`, hosted `skill improve`, and accepted hosted `watch|cancel|retry` are the network command surfaces.

Hosted `eval run --cloud`, `eval grade --cloud`, and `skill improve --cloud` first resolve the current local evidence plan and validate provider auth plus knowable hosted plan access before creating a temporary live handle, auto-linking, syncing, or scheduling. Hosted `retry` first resolves the selected run's stored operation plan.

Before Cloud accepts that run id, human progress is labeled as preparing the Workbench Cloud run; JSON mode suppresses `workbench.run.v1` progress until durable acceptance, and queued plus hosted-worker wording is reserved for accepted Cloud run snapshots. Hosted compute requires an organization-owned Cloud skill whose organization has an active Team or Enterprise plan; personal Free skills can publish source but cannot start Workbench-hosted operations.

If a pre-accept auto-link, sync, resolve, or scheduling failure occurs after that handle is printed, Workbench clears the temporary handle and returns the setup error without adding durable failed run evidence; the cleared correlation id may appear as `subject.correlationRunId`, but it is not a top-level `runId` and is not watchable or showable. Personal plan blockers preserve the full publish-and-rerun command-shaped remediation with the documented `ORG/SKILL` placeholder and carry structured requirement details, and knowable hosted operation plan blockers return before a temporary handle or sync.

Until Cloud accepts it, `watch` and `cancel` operate on the local handle; cancellation is a lock-free live-state side channel, and the original hosted command observes the request promptly before scheduling, even when pre-schedule sync is still running. Pre-accept cancellation terminalizes the local handle so the cancellation can be inspected, while intentional detach during that window leaves the handle watchable. Intentional cancel or detach during that window leaves the previous remote sync health intact instead of recording the in-flight abort as a remote failure.

The schedule request sends that run id plus only minimal scheduling input: operation kind, version id, optional skill selector, optional agent selector, and limits such as samples or budget. Cloud derives the eval snapshot, skill bundle, selected agent, and improve evidence from Cloud's stored project state and returns an authoritative snapshot for the same run id; the CLI then replaces the local live handle with that Cloud snapshot.

Hosted waits observe the same inspection envelope and state-notice API as the web UI, refetch on `changed` or `reset`, advance their cursor on progress-only evidence, and feed the same sparse renderer used by local Eval and Skill operations. Capacity policy is a deployment concern and does not change the contract.

Once a hosted run reaches a terminal state, the CLI reports terminal evidence sync as an explicit progress phase and syncs Cloud evidence back once; promoted hosted improve reconciles the same Cloud remote again after switching local source. Ctrl-C during an attached local or hosted wait detaches with exit 130, leaves the local worker or hosted runner active, and returns `next: workbench watch RUN_ID`; `watch` is the explicit resume and refresh command for that known run.

`workbench skill sync cloud` remains object-exchange repair and portability plumbing for local source or local-only object changes, not the normal run-follow command, and imported Cloud-owned lifecycle objects are tracked as Cloud-owned so they do not dirty sync status or dry-run write deltas. If a remote is unavailable, local objects remain usable, `workbench skill show --json` reports the per-remote error as state, and explicit `workbench skill sync REMOTE` remains the repair command when auth and link prerequisites are already satisfied.

If local package source or locally owned objects changed after the last successful sync, `skill show` reports `local_changes` without contacting the remote and provides `workbench skill sync REMOTE --dry-run` as the explicit repair. Logged-out Cloud remotes report `auth_required` and point to `workbench login`.

### Publishing and removal

`workbench skill publish [VERSION]` syncs the selected version to a Workbench Cloud remote, records it in the published-version set, moves the current publication pointer, and exposes the package for install or clone. After success, the persisted fingerprint includes publication refs, so `skill show` reports the remote as `up_to_date` and `skill sync cloud --dry-run` reports no work unless locally owned state changed.

`--as OWNER/SKILL` sets or replaces the linked Cloud Skill handle when publishing; dry-run preview derives the handle in memory and writes no files. In dry-run output, `next` is the exact non-dry-run publish command to retry, while JSON `installCommand` and human `after publish:` expose the install handoff that becomes valid only after a real publish. Subsequent bare `publish` uses the persisted handle and preserves the last explicit Skill visibility.

If synced state already shows the requested version, handle, and visibility as the current published package, `publish` returns `Already published` and does not send another publish mutation. `--team` requires an organization-owned Skill and user-facing errors use team visibility wording rather than internal storage enum names.

Workbench Cloud publishes return one canonical install handle like `OWNER/SKILL`; human and JSON output expose that handle, not install URL fields. Published package versions are addressable as `OWNER/SKILL@VERSION` and Cloud `/skills/OWNER/SKILL/versions/VERSION` URLs, where `VERSION` may be the full version id or any unambiguous displayed prefix. In JSON mode, publish returns one command envelope on stdout and does not write human progress prose to stderr.

File remotes reject publish because they are object-pack sync endpoints, not package hosts. Public packages are still served through the Cloud Skill URL and well-known discovery for the public `skills` CLI, but the Workbench CLI teaches `OWNER/SKILL` handles. Publication is explicit; ordinary sync and `--cloud` auto-linking share evidence and package versions but do not publish a package or change Skill visibility.

`workbench skill unpublish VERSION --dry-run` validates that a prior exact published version is removable, reports the current published version, and returns the exact non-dry-run `workbench skill unpublish VERSION` follow-up without removing package availability or rewriting local publication refs. Non-dry-run `workbench skill unpublish VERSION` removes that prior exact version from the published-version set without deleting the local immutable version or moving the current publication pointer; the current published version must first be replaced. When a still-published replacement is known, current-version unpublish errors point directly to `workbench skill publish VERSION`; otherwise they point to `workbench skill versions`. The CLI validates removability before printing destructive removal progress.

`workbench skill delete OWNER/SKILL --dry-run` previews deletion of the entire Cloud Skill project, and `workbench skill delete OWNER/SKILL --yes` deletes the project, published packages, hosted runs, and synced objects. When run from a local Workbench project linked to that Cloud handle, non-dry-run delete also clears matching local publication refs and removes the dead Cloud remote so `workbench skill show` no longer advertises the deleted project. Version-pinned delete refs are rejected with `workbench skill unpublish VERSION` remediation because unpublish is the version-level removal command.

### Installation

`workbench skill install SOURCE` requires a source locator and resolves in two modes. Workbench Cloud handles such as `OWNER/SKILL`, `OWNER/SKILL@VERSION`, or `/skills/OWNER/SKILL` URLs are authoritative: Workbench either installs that exact published package with its provenance and version identity or returns the Cloud error. Explicit external sources delegate to the pinned upstream `skills add` command. External Agent Skills are not Workbench-versioned; `publish`, `clone`, Eval evidence, improve lineage, and Workbench Cloud visibility do not apply to that installed copy.

Explicit external sources include local paths, GitHub/GitLab URLs, `github:` and `gitlab:` shorthand, SSH/git URLs, `.git` URLs, and non-Workbench HTTP(S) sources. Workbench does not parse or discover those source shapes itself. It maps only explicit Workbench-owned flags to `skills add`: `--target codex` becomes `--agent codex`, `--target claude` becomes `--agent claude-code`, `--scope global` becomes `--global`, `--yes` is forwarded, and `--dir DIR` runs the delegated command from `DIR` so relative external sources and folder installs resolve there. If `--target` is omitted, Workbench passes no upstream `--agent` and the upstream `skills` package owns agent detection or selection. Advanced upstream options are passed after `--`, for example `workbench skill install github:vercel-labs/skills -- --skill find-skills --full-depth` or `workbench skill install ./local-skill -- --agent cursor`. Post-`--` external options are rejected for Workbench sources.

With no flags, install targets exactly one detected current coding-agent target in folder scope; when no single target is detected, it fails with a command-shaped remediation such as `workbench skill install OWNER/SKILL --target codex`. `--target codex|claude` selects the coding-agent product, `--scope folder|global` selects where it is written, and installing for both Codex and Claude is two explicit commands.

It installs only the agent skill package: `SKILL.md`, scripts, references, assets, agent metadata, and package support files. It never installs authored `.workbench` controls, runtime objects, refs, logs, remotes, locks, or install metadata inside the package directory. The package directory name comes from the published handle's `SKILL` segment, so a handle such as `OWNER/command-skill` installs into `command-skill` even if `SKILL.md` frontmatter contains a different display name.

Re-running the same source over an unchanged Workbench-managed copy is a no-write idempotent result, including the root-local install ledger timestamp, and dry-run reports top-level `result: "unchanged"`. If the published package version changes but the installable package files are byte-identical, real install updates only the root-local ledger and reports `metadataChanged: true`, while dry-run reports `result: "planned"`, `metadataChanged: true`, and `filesCopied: 0`.

Changed or unmanaged Workbench-managed destination content requires `--yes`. Overwrite remediation preserves the source pin, scope, directory, and any explicit target flag from the attempted command, but it does not add a target flag that was only inferred from the current coding agent. Workbench-source `--dry-run` reports the resolved target without writing package files or the root-local `.workbench-installs.json` ledger, and `filesCopied` is `0` because it is an actual-write count; successful planned dry-runs return and print the exact non-dry-run install command as `next`, while destinations that require `--yes` return `blocked` with `requiresOverwrite: true` and the exact `--yes` command in `remediation`/`next`. External `--dry-run` does not run mutating `skills add`; it reports the exact delegated command and writes nothing. Bare `workbench skill install` is a usage error.

### Inventory

`workbench skill list` is the read-only inventory command. With no flags it scans configured Codex and Claude folder and global skill roots visible from the current directory, not arbitrary sibling directories. If the requested directory itself is an editable Workbench project with `SKILL.md` and `.workbench` controls, inventory includes that current project as a folder-scope `project` row even when it is not nested under an agent skill root.

Empty human inventory output includes a short hint that `skills` scans configured roots and the current Workbench project only, and that arbitrary sibling `SKILL.md` folders should be entered for `workbench skill init` or found with shell search. `--target codex|claude` narrows to one coding-agent product, `--scope folder|global` narrows to one access scope, and `--dir DIR` changes the folder-scope scan root.

Broad inventory sorts folder rows before global rows, managed/current or Workbench-project rows before unmanaged rows, and the detected current coding agent before other targets. To keep broad scans focused on the immediate install/adopt job, unmanaged global rows are omitted unless `--scope global` is requested; managed/current, modified, missing, and Workbench-project global rows remain visible.

Inventory performs no network access, takes no project write lock, writes no files, and reports `current`, `modified`, `missing`, `project`, `unmanaged`, or `duplicate-name` status from visible skill roots and Workbench install ledgers. `project` means a visible local skill folder has `.workbench` project controls but no Workbench install-ledger provenance. It does not show a `not installed` universe because catalog search is a separate job.

### Install targets

For Codex folder scope, Workbench reads `.agents/skills` roots visible from the requested directory up to the Git root and writes to exactly `<dir>/.agents/skills`. For Codex global scope, Workbench reads and writes `$HOME/.agents/skills`. For Claude folder scope, Workbench reads and writes `<dir>/.claude/skills`. For Claude global scope, Workbench reads and writes `$CLAUDE_CONFIG_DIR/skills` when set, otherwise `$HOME/.claude/skills`. These target paths are implementation details in human output and are present in JSON for automation.

### Project creation and cloning

`workbench skill new DIR` creates a brand-new Workbench skill project and fails on any non-empty target directory. It writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/environment/Dockerfile`, `.workbench/.gitignore`, and ignored runtime directories.

Provider-backed default agent setup is reported separately from first-case authoring: JSON exposes `setupCommands`, human output says provider setup is still required before provider-backed eval, and top-level `next` remains the project-scoped `workbench eval case draft CASE_ID` while no case exists. `workbench skill init` adopts the current directory as an existing skill project, requires `SKILL.md`, creates the same missing `.workbench` controls around the package, and does not rewrite `SKILL.md`.

`workbench skill clone OWNER/SKILL[@VERSION]|URL DIR` is the editable-Skill acquisition path. The bare handle clones the current published package; `@VERSION` clones an exact still-published package version. It creates a Workbench project containing the Agent Skill package plus the normal minimal `.workbench` scaffold, including its own environment Dockerfile. Authored Eval controls, agents, runtime object state, refs, sync state, logs, locks, remotes, install ledgers, and `.agents` pollution are not copied from the published package; the cloned project initializes its own fresh local `.workbench/objects`, `.workbench/refs`, and `.workbench/sync` state for versioning.

### Ownership and visibility

Workbench Cloud owns the `OWNER` namespace in those URLs. Personal namespaces are created from user profiles. Organization namespaces, teams, membership, and skill grants live only in Cloud. The CLI does not add commands for organization or team state, and no organization/team metadata is persisted in `.workbench`.

Skill visibility does not grant project evidence access. A `private` package is readable only by users with project read access. An `internal` package is readable by members of the owning organization and is valid only for organization-owned Skills. A `public` package is readable by anyone through the canonical `/skills/OWNER/SKILL/.well-known/skills/index.json` discovery URL used by Agent Skills clients and the upstream `skills` CLI; the bare `/skills/OWNER/SKILL/.well-known/skills` route redirects there, and unsupported `.well-known` paths return JSON 404 responses. Internal and private installs use the same `/skills/OWNER/SKILL` URL with Workbench CLI auth. Runs, jobs, traces, artifacts, Eval evidence, reviews, and improvement history require project read access regardless of Skill visibility.

## Web surfaces

### Local browser and inspection

`workbench open` serves the local Workbench UI from a read-only inspection snapshot as a foreground server; the CLI prints the actual bound URL and a `Press Ctrl-C to stop` hint, then closes the server and exits `0` when the user presses Ctrl-C. `--port` accepts integers from 0 through 65535, and port 0 asks the OS for an ephemeral port.

The browser reads live package files, authored evaluation files, and durable object state through `WorkbenchInspectionSnapshotEnvelope` and starts local Eval/improve operations through `/api/operations` using the same operation request vocabulary as CLI scheduling. Eval-like requests carry `caseIds`, targets, and `steps`; grade adapter selection comes from the resolved authored case grader, which is either the Eval default or `case.yaml grade.adapter`. CLI-friendly run, grade, and Eval commands lower into that shape before planning. Inline browser default-grader editing writes only `.workbench/eval.yaml` through `/api/evaluation/grader`: the local server accepts `adapter` plus adapter-generic `authoring`, validates the values against Eval-scope primitive controls, and writes the minimal default-grader policy. Inline browser case creation and editing writes real `.workbench/cases/<case-id>/` files before those cases are run: the case title is the case folder name, new cases accept an explicit title or derive one from the prompt, edits target an existing `caseId`, title changes rename the case folder, and `grade.adapter` plus adapter-generic `grade.authoring` values are validated against the selected grader's primitive plan before the grade adapter maps those values into files. Local operation requests start the private local-worker path; they do not shell out to `workbench`. The local endpoint returns a `workbench.run.v1` snapshot once durable run state exists, while the worker continues the run and writes durable state until terminal state.

Local browser routes watch package and Workbench control files; changing `SKILL.md`, authored assets, cases, agents, Eval controls, or `.workbench/environment/Dockerfile` sends a state notice so the UI refetches without requiring a package snapshot. Local and hosted browser routes return `WorkbenchInspectionSnapshotEnvelope` from `/snapshot`, then deliver `WorkbenchStateNotice` invalidations through `/state/stream` or `/state/wait`; the UI refetches the envelope on `changed` or `reset`, treats `progress` as focused trace evidence freshness, and does not depend on active-work polling.

Automatic live refetches are quiet; the global refreshing indicator is reserved for explicit user refresh. User-facing web timestamps use the viewer's browser locale and timezone; UTC is not forced unless a future surface explicitly labels itself as UTC.

`workbench skill show` reads current project, package, version, and package-file state. `workbench skill versions` reads immutable package history. `workbench eval show REF[:PATH]` reads Eval versions, runs, jobs, execution traces, artifacts, and files. These inspection commands do not take the project write lock and remain summary-first until an exact file is selected.

`workbench eval show RUN_ID` summarizes run facts, the same progress snapshot used by `watch`, failure groups, measurements, case results, jobs, and runnable `workbench eval show RUN_ID:PATH` evidence reads. It does not watch, sync, cancel, retry, or point failed/canceled runs back to itself.

Agent and case evidence rows are keyed by measured skill plus agent, so multi-skill or multi-version matrix runs do not merge same-agent case/sample rows. Public run/job sample labels are one-based like live progress in human and command JSON projections; raw stored job objects keep zero-based sample indexes.

Run/job evidence projections expose one canonical user-facing path per file, filter nested internal `.workbench` runtime paths, omit raw trace metadata files such as `request.json`, `result.json`, and `trace.json`, and resolve suffixes only after collapsing equivalent candidates. Provider and grader evidence remains opaque outside its adapter and is available through exact file refs. Direct trace inspection uses the same raw-metadata filter.

Hosted skill pages use the same snapshot projection, live invalidation contract, and operation vocabulary. Run status starts as `queued` for hosted work waiting on environment or worker capacity, moves to `running` once work is claimed or proof work is pending, and becomes terminal when all jobs finish. Captured files and terminal trace artifacts are attached when the job records terminal trace evidence.

### Hosted snapshot reads

Cloud hosted Skill pages initially receive a `WorkbenchInspectionSnapshot` inside the envelope. Users with project read access boot from a compact project index that includes identity, status counts, refs, action capabilities, and package/version file manifests, but omits historical runs, jobs, traces, execution events, artifacts, result matrices, lineage, and file contents. Evidence views load the full evidence snapshot through explicit Workbench detail reads. Package-only viewers receive a snapshot constructed from the published package version and publication refs only; it includes package files and intentionally omits authored Workbench controls, runs, jobs, traces, execution events, artifacts, private score evidence, and improvement history. Package-only live cursors advance only when package-publication refs change; private durable run and job mutations advance the full project state cursor, while progress-only execution events advance the full project progress cursor.

### Hosted file reads

Hosted selected-file reads are exact detail reads. A file preview or `show REF:PATH`-equivalent URL must resolve the selected owner, version/run/evidence object, and path, then fetch that one file body. It must not hydrate the whole hosted project merely to extract a single package, evaluation, trace, or artifact file. The public route shape stays the same; this is a storage and performance invariant under the shared read contract.

### Primary surfaces

Hosted primary navigation contains only Sources, Evals, and Skills. Managed Cloud puts organization and plan administration behind a separate account gateway outside that product menu; owner-operated skill-state deployments omit the gateway. Local `workbench open` remains a Skill/Eval inspection surface over the same portable files and evidence contracts.

### Sources

`/sources` lists Sources with snapshot freshness, record count, latest Analysis, and one primary action. `Add Source` gives one generic CLI/API ingestion handoff; the server does not register adapters or persist their credentials and cursors. `/sources/:sourceId` has only Analyses and Records. Sync is visibly model-free; Analyze always shows the exact snapshot, selection, locality, evidence egress, token and call ceilings, optional Map bounds, the deterministic safety-cost ceiling, and the separate user-chosen spend cap before confirmation. Completed operations report actual metered usage; Workbench does not place an uncalibrated estimate in the wire contract.

`/sources/:sourceId/analyses/:analysisId` has only Workflows and Insights. Workflows has only Map and Taxonomy presentations over the same workflow tree. Both share a contextual inspector with exact citation links; Keep and Dismiss apply only to workflow leaves that can become Eval inputs. Insights are read-only evidence-grounded findings for exploration and objective shaping. Evidence is a drawer or deep link, never a parallel analysis tab. Taxonomy is the complete accessible ARIA-tree path; Map is optional presentation and falls back to Taxonomy when disabled, pending, failed, or unavailable. Neither view exposes vectors, cluster ids, embedding controls, or taxonomy mutation.

Draft Eval becomes available only after at least one workflow is kept. The form requires a human-confirmed objective and destination, then shows the same model preflight before generation. Local checkout handoff is a copyable CLI command; the browser never claims filesystem access.

### Evals

`/evals` is a projection over existing Eval and owning Skill summaries. Eval detail is the one canonical cases, results, runs, authoring, and execution-evidence workspace. Skill detail links to its filtered Evals instead of rendering a second Eval workspace. Results keep Quality, Coverage, Latency, and Cost; run/job traces and artifacts remain contextual evidence.

An immutable Source-derived draft opens at the destination-independent `/evals/drafts/:draftId` route and shows proposed cases, grader rationale, citations, and exact file diff. Revise creates a new draft. Hosted Apply and local `workbench eval apply` both check the base hash, are idempotent at the expected result hash, and return to Eval detail without starting a run. `workbench eval discard DRAFT_ID --yes` and the matching browser confirmation reject a ready patch without applying it. The Evals index lists ready work first and retains applied and discarded drafts as inspectable terminal decisions.

### Skills

`/skills` and Skill detail own package files, versions, publication, acquisition, improvement, and links to owning Evals. `Use skill` copies install or clone commands and never pretends a hosted page can write locally. Package-only viewers receive the published package and acquisition actions but no private Eval or Source evidence.
