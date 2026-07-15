# Sources

Sources turn an evidence corpus into grounded workflow and insight candidates while keeping human judgment between discovery and Eval creation.

## Mental model

The path is explicit:

```text
Source → immutable Snapshot → immutable Analysis → human Review → immutable Eval draft → explicit Apply
```

A Source is not owned by a Skill and does not enter a Skill object pack. An Eval execution trace is run evidence, not a Source record. Applying a draft writes ordinary portable Eval files and never starts a run.

Source core accepts only bounded generic records, semantic text segments, and optional generic presentation blocks. It has no session, message, Slack, email, span, provider, task, or outcome field. Adapters own credentials, cursors, native record boundaries, redaction, and conversion. This lets local Codex and Claude sessions, a Slack log, email, agent spans, or a future input follow the same storage, analysis, review, and Eval path.

## Add and sync local sessions

Create a private Source with a local adapter:

```bash
workbench login
workbench source add "Local Codex sessions" --adapter codex
workbench source sync SOURCE_ID
workbench source show SOURCE_ID
```

Use `--adapter claude` for Claude Code. Sync is model-free. The CLI reports records, ordered sync events, and changed evidence pages while the adapter runs. The adapter uses a bounded current-snapshot lookup to reuse known bodies, then streams generic page and record events followed by one finish event. The server atomically accepts each bounded batch, verifies every record root, derives removals by absence, and publishes one immutable snapshot. Interrupted sync resumes from the verified server prefix.

Source detail retains the latest generic sync coverage, including omitted item and byte totals plus bounded reasons. These warnings remain visible beside the snapshot so users can judge evidence completeness before authorizing analysis.

Local state contains only the deployment and namespace binding, adapter id, committed opaque cursor, and at most one active sync id. It does not keep another normalized corpus, a per-record Cloud hash map, or a pending-record journal. Evidence presentation is captured generically at ingest, so records and citations remain readable after the adapter or native origin disconnects.

## Analyze an exact snapshot

The first Analyze call is dry and returns the exact snapshot, selected records and segments, deterministic window continuation, locality, evidence egress, optional Map projection bounds, a first-attempt call/cost ceiling, and a retry-inclusive absolute safety ceiling:

```bash
workbench source analyze SOURCE_ID --record-offset 0 --record-limit 1
```

Review the returned preflight, choose a cap yourself, then rerun the same command with `--confirm --max-cost USD --preflight-token TOKEN`. Workbench intentionally emits no executable confirmation command or default cap. The server privately binds each random, short-lived token to a stable operation identity covering the exact actor, namespace, request, model, and immutable plan. A lower cap can stop before completion without publishing partial results. `Review higher cap` in the browser and a fresh exact CLI preflight are both generated from that persisted operation plan; approving the higher cap resumes the same operation id and successful model shards without reconstructing a Source request or spending a retry.

Entire-Source analysis is explicit, disabled by default until the deployment has calibrated its model and spend bounds, and remains one logical Analysis. When enabled, the runtime streams bounded private extraction shards, checkpoints their immutable results, folds them through the LLM into one workflow taxonomy, and publishes only the final Analysis. Shards are not Sources, record windows, Analyses, or public identities. Deterministic record windows remain useful for cheaper focused exploration; their coverage never presents a partial window as complete or Source-wide and Workbench does not reconcile separate window Analyses.

Map projection is an optional presentation step, not part of semantic Analysis identity. The CLI omits it by default, including for hosted or otherwise unbound Sources. Use `--map` only when the optional layout is worth its disclosed embedding calls, cost, and deadline budget. The server preflight explicitly reports `map=include` or `map=omit` based on the deployment's presentation capability; omitting Map does not change the workflow taxonomy or insights. If projection fails after semantic publication, Analysis stays ready. Repeat the same snapshot and record selection with `--map` to receive a fresh ordinary Analyze preflight; semantic identity reuse prevents another generation pass. There is no special Map-retry API.

All selected semantic text enters bounded requests. Long records are packed from persisted stable segments instead of keeping only their head and tail. The LLM decides whether one record contains zero, one, or several tasks; an open task may continue across adjacent packs, while later related work becomes another occurrence under the same workflow. The LLM then synthesizes one typed workflow hierarchy and produces cited insights. Prompt revision v11 retains 2,048 serialized UTF-8 bytes of semantic state and a 2,560-byte immutable publication envelope per occurrence, and makes the eight-citation limit apply across retained and current evidence combined. Focused scale tests prove that those bounds remain inside the later 4,096-byte leaf-reduction input envelope and the 20 GiB worst-case Analysis publication envelope.

Deterministic code divides raw segments into complete, nonoverlapping, Unicode-safe citation atoms of at most 1,024 UTF-8 bytes. The LLM selects representative offered atom ids; it never reproduces a quote or counts offsets. The runtime turns selected ids into exact immutable citation ranges and hashes, then verifies bounds, tree shape, complete occurrence assignment, access, and spend. It does not infer task boundaries from time gaps, turns, tool names, or provider events. Generation providers report `complete` or `output_limit` explicitly. During extraction, an explicit provider output limit is charged and checkpointed, then the same whole persisted segments are repacked into smaller requests; no partial tool payload is accepted and no evidence is heuristically split. Later semantic stages and Eval drafting fail closed on the same signal because their outputs cannot be losslessly repacked.

Ingest and Analyze have separate safety envelopes. One immutable record root can name roughly 8 GiB of bounded segment pages, but Analyze refuses a selected record above 512 MiB and refuses any multi-record selection whose conservative output bound exceeds 50,000 occurrences before a preflight token or model spend. A one-record window is atomic and cannot be split by Source core, so it may be reviewed and authorized even when that conservative bound is higher; extraction then stops incrementally with no partial Analysis if it finds more than 50,000 actual occurrences. The current persisted Codex Source snapshot has 7,943 records, 2,211,224 segments, and 11,315,058,315 semantic bytes, plus disclosed omissions of 487,805 items and 165,710,700 bytes. Its largest record by bytes is offset 2,022 at 184,511,411 bytes and 9,523 segments; its largest by segment count is offset 110 at 167,726,943 bytes and 12,507 segments. Both fit the per-record byte cap, while the complete snapshot remains intentionally explored through disclosed deterministic record windows. A preflight also has a fixed authorization deadline of at most one year: unfinished work fails closed and continuation requires a fresh reviewed preflight. If one source-native record exceeds the byte cap, its producer—not Source core—must emit smaller meaningful record boundaries before resync.

The full local Codex cold sync was measured at 978.182 seconds for 25,953 uploaded pages and 33,897 ordered events, with 659,750,912 bytes maximum CLI RSS and no swap. Its no-change incremental sync took 34.508 seconds and uploaded four pages. With the locally configured Claude Haiku 4.5 Bedrock rates of $1.10/$5.50 per million input/output tokens, the largest byte record's deliberately conservative preflight disclosed 102,845 first-attempt and 205,690 retry-inclusive calls, retry-inclusive ceilings of about 22.7 billion input and 1.8 billion output tokens, and first/retry-inclusive cost ceilings of $17,497.42/$34,994.83 over a 354-day operation deadline. Those are authorization ceilings, not expected spend estimates, and Workbench leaves the user's spend cap blank.

Embeddings are never used for semantic retrieval, clustering, or reconciliation. A deployment may optionally embed final compact occurrence summaries only to produce two-dimensional Map coordinates, then discard the vectors. Analysis and review remain unchanged if Map is unavailable or fails.

## Explore and review

In Workbench Cloud, Source detail has Analyses and Records. Analysis has Workflows and Insights. Workflows can be viewed as the same hierarchy in Map or Taxonomy; both share one inspector and exact contextual citations. Taxonomy is the complete keyboard and screen-reader path. Evidence is not a separate analysis mode.

Review every workflow that may become an Eval input with one of two verbs:

- Keep accepts the grounded workflow for possible Eval drafting.
- Dismiss excludes the workflow from the reviewed selection.

Insights are read-only evidence-grounded findings. Explore their linked workflows and supporting or contradicting citations, then use that context to shape the human-authored Eval objective; they are not review state or selectable Eval inputs.

The workflow hierarchy itself is exploratory and immutable. There are no merge, split, move, cluster, topic, or cross-Analysis reconciliation actions. Refreshing a Source creates an independent Snapshot and Analysis.

The CLI exposes the same grounded drilldown without another noun or source-shaped projection. `--page nodes` starts at the taxonomy root, `--node` opens one category or workflow, `--workflow` pages that workflow's occurrences and citation ids, `--insight` opens one insight and its representative citation ids, and `source evidence` prints locator metadata plus the exact cited quote (JSON retains the full immutable segment). Selector pagination commands preserve the selector:

```bash
workbench source show SOURCE_ID --analysis ANALYSIS_ID --page nodes --json
workbench source show SOURCE_ID --analysis ANALYSIS_ID --node NODE_ID --json
workbench source show SOURCE_ID --analysis ANALYSIS_ID --workflow WORKFLOW_ID --json
workbench source show SOURCE_ID --analysis ANALYSIS_ID --insight INSIGHT_ID --json
workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID
```

CLI review accepts one optimistic-concurrency patch:

```bash
workbench source show SOURCE_ID --analysis ANALYSIS_ID --page review --decision kept --json
workbench source review SOURCE_ID ANALYSIS_ID --input review.json
```

A stale review version conflicts instead of overwriting another reviewer. Keep and Dismiss are deterministic, singular compare-and-swap updates and run no model.

## Draft and apply an Eval

Eval drafting requires kept workflow ids, the exact Analysis review version, and an objective the user has confirmed or edited:

```bash
workbench eval draft \
  --source SOURCE_ID \
  --analysis ANALYSIS_ID \
  --review-version VERSION \
  --review-hash REVIEW_HASH \
  --workflows WORKFLOW_IDS \
  --objective "OBJECTIVE" \
  --destination DESTINATION
```

Insights help the user understand patterns and choose the objective, but they are not executable workflow test units or Eval-draft dependencies. The immutable draft captures only the selected reviewed workflows and their exact cited evidence.

The first call returns the model preflight. Repeating it with `--confirm --max-cost USD --preflight-token TOKEN` creates an immutable patch containing proposed cases, grader rationale, exact citations, Source lineage, base hash, and expected result hash. If that chosen cap is exhausted, request a fresh exact preflight and approve a higher cap to resume the same operation without losing completed model shards. Revising creates a new draft id. Drafts have explicit `ready`, `applied`, or `discarded` status; all three remain listed and inspectable, and no retention timer silently removes them.

Review the exact diff, then apply explicitly:

```bash
workbench eval apply DRAFT_ID --yes
```

Or reject the proposal without deleting its audit record:

```bash
workbench eval discard DRAFT_ID --yes
```

Hosted apply checks the hosted destination base. Local apply downloads the patch, checks the checkout base, and uses the same portable mutation validation. A retry is idempotent when the destination already matches the expected result. Any other base conflicts rather than overwriting. Apply never runs the Eval, and the resulting Eval and Skill remain usable without Source access.

The CLI pins each accepted model operation and resulting Eval draft to its backend before returning a follow-up command. Those tiny routing records contain no evidence or credentials and survive Source deletion, so `watch`, `retry`, `cancel`, `eval apply`, and `eval discard` remain backend-portable without a Source argument. For a private backend, supply that backend's token explicitly (for example with `WORKBENCH_API_TOKEN`); a Cloud config token is never forwarded to a differently bound endpoint.

Destination identity is explicit. `--destination local --dir CHECKOUT` targets that checkout's single current Eval and binds the draft to both its declared Skill name and exact Eval base hash. `--destination OWNER/SKILL` creates a new hosted Eval from an empty base; it never guesses the first or current Eval. Only `--destination OWNER/SKILL/EVAL` patches that exact existing hosted Eval.
