# Workbench CLI

The CLI is the action surface for Workbench. It creates skill projects, runs evals, improves from evidence, publishes installable source, installs published skills, and opens the read-only inspection UI over committed Workbench objects.

[`jtbd.md`](jtbd.md) defines the jobs users complete with these commands and the exact steady-state sequences each job allows; this guide explains the commands themselves.

## Create

```bash
workbench new ./earnings-prep
workbench new ./smoke --from test/workbench-smoke
cd ./earnings-prep
# edit SKILL.md and cases
workbench eval
```

`new` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. It creates `.workbench/cases/` but no starter case; write at least one `.workbench/cases/*/case.yaml` before running `eval`. `new DIR --from OWNER/SKILL` creates an editable Workbench project from published source: it hydrates the package plus authored `.workbench` controls when present, and strips runtime objects, refs, sync state, logs, locks, remotes, install ledgers, and `.agents` directories. Use `new --from`, not `install`, when the goal is to evaluate or improve someone else's skill.

Provider-backed cases can be prompt/rubric only. Local or command-backed cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory, and shell tests write their public score to `$OUTPUT_DIR/result.json`. By default, new projects use a provider-backed Codex agent (`gpt-5.4-mini`, `auth=default`). Use `--agent claude`, `--agent local`, or `--agent command` to make that explicit, and use `--model` or `--auth` only with provider agents.
In JSON mode, `new` includes `createdPaths`, `defaultAgentSelection`, `setupCommands`, and `next`; while no workflow case exists, `next` points at creating and editing `.workbench/cases/case-001/case.yaml`.

Workbench creates source versions automatically at command boundaries. If the folder changed since the current version, the next command creates a content-derived version id before acting.

## Evaluate

```bash
workbench eval
workbench eval --agents all -n 5
workbench eval --skills all --agents all --samples 1 --rerun
```

`eval` and `compare` use manifest defaults when selector flags are omitted. Use plural selectors only when intentionally broadening or narrowing the matrix:

```bash
workbench compare
workbench compare --skills all --agents all --versions all
workbench compare --versions 26059f9a..eac5699c
```

`eval` prints the run summary, score deltas when available, and one `next:` command for the common next step. It always evaluates current source; inspect or switch historical versions with `show`, `diff`, `switch`, and `compare --versions`. `--rerun` bypasses cached evidence for the matrix selected by the current command; it does not remember selector or sample flags from a previous invocation. During non-cached local and hosted runs, stderr reports sparse phase/run/job progress with case and sample counters, failures, elapsed time, and a heartbeat only while unchanged. `--cloud` ensures the current local version exists, syncs it to Cloud, and schedules hosted work with only the version id, selectors, and sample count. It auto-links the logged-in project when needed, syncs once after Cloud accepts the run so `workbench show RUN_ID` works, polls hosted run details while it waits, then syncs terminal evidence back for `log`, `show`, and `compare`. Press Ctrl-C during the hosted wait to detach with exit 130; the run keeps running and the CLI prints `next: workbench show RUN_ID`. Auto-linking does not publish installable source. Long-running JSON commands keep stdout to one JSON document and write progress to stderr.

## Improve

```bash
workbench improve
workbench improve --skills primary --agents default --budget 1 -n 1
```

`improve` edits one mutable project skill package with one improvement-capable agent. The candidate may change `SKILL.md`, scripts, references, assets, and other package support files outside `.workbench/**`; ordinary improve does not rewrite `.workbench` eval or case controls. The flags stay plural to match `eval` and `compare`, but the selected values must resolve to exactly one skill and one agent. Run it only after scored below-perfect, failed, or reviewed eval evidence exists. Perfect eval runs and unscored runtime/auth failures are not meaningful improvement evidence; historical scored smoke-labeled traces are still evidence. Evidence is selected by skill lineage and eval definition, not by exact eval-agent hash. The selected agent is both the improver and proof eval agent, and Workbench checks evidence before asking users to configure an improver. When a one-sample proof run switches source, the printed next command is a higher-sample rerun before publishing. One-time provider setup for bare `workbench improve` is:

```bash
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
```

Hosted `improve --cloud` validates that same local improve target and evidence before network sync, lets Cloud derive eval, skill bundle, agent, and evidence from Cloud's stored state, then syncs the accepted run locally before waiting and syncs the winning version back after terminal completion unless the local current version changed while the hosted run was in flight. Local and hosted improve progress uses the same stderr renderer as eval: improvement phase first, then proof-eval case/sample counters from run and job state.

## Source And Selection

Simple projects do not need `.workbench/skills.yaml`; Workbench implicitly evaluates the root `SKILL.md` as `primary`. Add `.workbench/skills.yaml` only when comparing multiple measured skills or installing included skills beside a measured skill.

```yaml
default: all
skills:
  primary:
    path: .
    includes:
      - name: helper
        path: skills/helper
  no-skill:
    baseline: none
  upstream:
    from: github:anthropics/skills//skills/frontend-design
    ref: <commit-sha>
```

Top-level entries are measured skills. Each measured skill defines exactly one of `path`, `from`, or `baseline`; the only baseline value is `none`. Local paths must stay inside the project root. Nested `includes` are installed beside one measured skill and affect that bundle hash, but they are not comparison rows.

Agents use the same selector shape:

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

`local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter. Connect provider auth before using provider-backed agents locally or in Cloud.

```bash
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth
workbench agent add opus --adapter claude --model opus --with auth=default
```

Quote command-valued `--with` assignments with single quotes so the shell does not expand Workbench runtime variables such as `$CASE_DIR`, `$OUTPUT_DIR`, or `$SKILL_DIR` before Workbench stores the command.

## Inspect

```bash
workbench
workbench status
workbench log
workbench log --runs
workbench log --versions
workbench show <run-id>
workbench show <job-id>:stderr.log
workbench show <version-id>:SKILL.md
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench open
```

Use `workbench show <run-id>` first after multi-sample runs. It lists the job ids and canonical file paths; then use a specific job or trace ref such as `workbench show <job-id>:stderr.log` to open one stream.

Bare `workbench` is the same orientation view as `workbench status`. `log` shows one reverse-chronological timeline of versions and runs. `show REF` lists files for file-backed objects or shows interpreted run/job evidence; `show REF:PATH` reads one version, artifact, or run/job evidence file by exact path or unique canonical suffix. Internal `.workbench/` runtime files and raw trace metadata files such as `request.json`, `result.json`, and `trace.json` are not addressable evidence. Native read-only sessions such as `codex:SESSION_ID` and `claude:SESSION_ID` are also resolved through `show`.

`switch` materializes a recorded source version into the working folder and updates the current Workbench ref. It does not invoke Git.

`workbench open` serves the shared read-only inspection model. `--port 0` is valid and prints the OS-assigned bound port. Use `log` and `show REF` for summary inspection, and `show REF:PATH` for content reads. The web `Compare` surface is the browser counterpart to `workbench compare`; write actions remain in the CLI.

## Publish And Install

```bash
workbench login
workbench publish
workbench publish --as OWNER/SKILL
workbench publish --public
workbench install test/workbench-smoke
workbench install test/workbench-smoke --global
workbench skills
workbench skills --for all --global
```

`publish` links the project to a Workbench Cloud skill handle and publishes one source version through two read surfaces: an installable agent skill package and editable Workbench source. The default handle is derived from the logged-in namespace and project folder; `--as OWNER/SKILL` sets or replaces it and is remembered for later bare `publish` commands. First publish defaults to `--private`; `--team` maps to organization-internal source visibility, and `--public` exposes source through the public discovery surface. Later bare `publish` preserves the last explicit audience. `publish` returns a canonical `OWNER/SKILL` install command and pinned release URL.

`install` accepts the canonical `OWNER/SKILL` handle or a full Cloud URL and always requires that source argument. With no flags, it installs the agent skill package for the current coding agent in the current folder. If the current coding agent cannot be detected, pass `--for codex` or `--for claude`; `--for all` means exactly Codex plus Claude Code. `--global` installs for the selected coding-agent target globally, and `--dir DIR` changes the folder-scope write root. Installs copy only package files such as `SKILL.md`, scripts, references, assets, and support files. They do not copy `.workbench` eval controls or runtime state into agent skill roots. Re-running the same handle over an unchanged Workbench-managed copy is idempotent. `--yes` permits overwriting changed or unmanaged destination content. `--dry-run --json` reports `result: "planned"` without writing package files or the root-local install ledger.

`skills` is the inventory command. With no flags, it answers what the current coding agent can access in the current folder. `skills --global` answers what that agent can access globally. If no current coding agent is detected, pass `--for codex`, `--for claude`, or explicit `--for all`. `skills --for all` shows Codex and Claude access in the folder, and `skills --for all --global` shows Codex and Claude global access. Inventory is read-only, performs no network access, and reports `current`, `modified`, `missing`, `unmanaged`, or `duplicate-name` status when visible.

Use `workbench new DIR --from OWNER/SKILL` when the goal is to evaluate or improve someone else's skill. That command creates editable project source with authored `.workbench` controls; `workbench install` only makes a package visible to a coding agent.

## Auth And Sync

```bash
workbench login
codex login --device-auth
workbench login codex --method oauth
claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth
workbench login claude --method bedrock
workbench logout codex
workbench logout claude
workbench logout
workbench sync cloud
```

Bare `login` connects the CLI to Workbench Cloud and uploads any already-connected local provider auth bundles so hosted provider-backed work is ready even when `workbench login PROVIDER` was run first. For headless sessions, `login --start-only` or `login --no-open` records a pending device authorization and prints `workbench login --wait --timeout 120` as the bounded resume command. `login PROVIDER` captures provider adapter auth for local and hosted provider-backed agents. The validation path is provider OAuth only: when `~/.codex/auth.json` is missing, run `codex login --device-auth`, then `workbench login codex --method oauth`. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then run `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. For isolated validation, pass `--profile-root DIR` to read native provider state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. `status` reports Cloud auth, connected provider auth, linked publication state, and per-remote sync health from local state in both project and non-project directories. Per-remote sync is local-only and may be `never`, `up_to_date`, `local_changes`, or `error`; `local_changes` means an explicit `workbench sync REMOTE` would push local source or object changes. Read commands do not sync; use explicit `workbench sync cloud` when detached hosted work has finished elsewhere. Error `remediation` values and human `next:` lines are command-shaped, without prose prefixes such as "Run".

Bare `logout` logs out of Workbench Cloud and leaves provider credentials unchanged. `logout PROVIDER` removes Workbench's captured provider credentials even when Cloud auth is already absent; remote provider cleanup is best-effort when Cloud auth is available. Native provider CLI auth such as Codex or Claude profiles is owned by that provider and is not deleted by Workbench.

Remotes are Workbench object endpoints, not Git remotes. They are local metadata in `.workbench/remotes.yaml` and are normally created by `publish` or by the first logged-in `eval --cloud`/`improve --cloud`. `sync` is plumbing for repairing or testing object-pack exchange; the taught sharing path is `publish` and `install`.

## Cases

Cases live under `.workbench/cases`. Create, list, edit, and remove cases with the filesystem. To turn a failure into a regression case, inspect the evidence with `workbench show RUN_ID` and write the case files directly.
