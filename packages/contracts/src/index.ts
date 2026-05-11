import YAML, { LineCounter, type YAMLError } from "yaml";
import { z } from "zod";

export const TriggerTypeSchema = z.string().min(1);
export const TriggerAdapterIdSchema = z.string().min(1);
export const SourceAdapterIdSchema = z.string().min(1);
export const AttemptStateSchema = z.enum([
  "queued",
  "scheduled_retry",
  "starting",
  "running",
  "cancelling",
  "completed",
  "failed",
  "canceled",
]);
export const ExecutionLifecycleStateSchema = z.enum([
  "queued",
  "scheduled_retry",
  "starting",
  "running",
  "waiting",
  "cancelling",
  "completed",
  "failed",
  "canceled",
]);
export const AttemptStageStateSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
  "skipped",
]);
export const GateDecisionSchema = z.enum(["accepted", "rejected", "error"]);
export const SourceTypeSchema = z.enum(["trigger", "action", "retry"]);
export const StageSessionPolicySchema = z.enum(["fresh", "resume", "previous"]);
export const WorkspaceModeSchema = z.enum(["managed", "project"]);
export const PlatformIdSchema = z.string().min(1);
export const WorkflowValidityStatusSchema = z.enum(["valid", "invalid"]);
export const WorkflowAvailabilityStatusSchema = z.enum([
  "available",
  "unavailable",
  "unchecked",
]);
export const HarnessEventPhaseSchema = z.enum([
  "session",
  "turn",
  "item",
  "tool",
  "error",
  "usage",
]);
export const TraceSpanKindSchema = z.enum([
  "hook",
  "stage",
  "turn",
  "tool_call",
  "assistant_output",
  "usage",
  "gate",
  "action",
  "error",
]);
export const TraceSpanStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "canceled",
  "warning",
]);
export const TraceEventKindSchema = z.enum([
  "status",
  "message",
  "output",
  "usage",
  "error",
  "note",
]);
export const PreviewKindSchema = z.enum([
  "text",
  "markdown",
  "table",
  "spreadsheet",
  "image",
  "pdf",
  "unsupported",
]);
export const PreviewSourceEncodingSchema = z.enum(["utf8", "base64"]);
export const DiffStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
]);
export const HookOutcomeLevelSchema = z.enum(["info", "warning", "error"]);
export const ExecutionOwnerSchema = z
  .object({
    kind: z.literal("workflow"),
    id: z.string().min(1),
  })
  .strict();

export const WorkflowExecutionOwnerSchema = z
  .object({
    kind: z.literal("workflow"),
    id: z.string().min(1),
  })
  .strict();

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const TriggerEventSchema = z.object({
  id: z.string(),
  owner: ExecutionOwnerSchema,
  trigger_type: TriggerTypeSchema,
  adapter_id: TriggerAdapterIdSchema.optional(),
  binding_id: z.string().min(1).nullable().optional(),
  attempt_number: z.int().positive().nullable().optional(),
  received_at: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), JsonValueSchema).default({}),
});

export const StageGateSchema = z
  .object({
    command: z.string().min(1),
    reject_to: z.string().min(1),
    max_cycles: z.int().nonnegative(),
    timeout_ms: z.int().positive().default(10_000),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const StageHooksSchema = z
  .object({
    before: z.string().nullish(),
    after: z.string().nullish(),
    after_gate: z.string().nullish(),
    timeout_ms: z.int().positive().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const StageSchema = z
  .object({
    id: z.string().min(1),
    harness: z.string().min(1),
    prompt: z.string(),
    session: StageSessionPolicySchema.default("fresh"),
    gate: StageGateSchema.nullish(),
    hooks: StageHooksSchema.nullish(),
  })
  .strict();

export const WorkflowInputTypeSchema = z.enum(["text", "textarea", "select"]);

export const WorkflowInputOptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).nullish(),
  })
  .strict();

const WorkflowInputStaticOptionSchema = z.union([
  z.string().min(1),
  z
    .object({
      value: z.string().min(1),
      label: z.string().min(1).optional(),
      description: z.string().min(1).nullish(),
    })
    .strict(),
]);

const WorkflowInputStaticOptionSourceSchema = z
  .object({
    values: z.array(WorkflowInputStaticOptionSchema).min(1),
    default_value: z.string().min(1).nullish(),
  })
  .strict();

const WorkflowInputCommandOptionSourceSchema = z
  .object({
    command: z.string().min(1),
    timeout_ms: z.int().positive().default(10_000),
  })
  .strict();

const WorkflowBaseInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).nullish(),
  required: z.boolean().default(false),
});

export const WorkflowTextInputSchema = WorkflowBaseInputSchema.extend({
  type: z.literal("text"),
}).strict();

export const WorkflowTextareaInputSchema = WorkflowBaseInputSchema.extend({
  type: z.literal("textarea"),
}).strict();

export const WorkflowSelectInputSchema = WorkflowBaseInputSchema.extend({
  type: z.literal("select"),
  options: z.union([
    WorkflowInputStaticOptionSourceSchema,
    WorkflowInputCommandOptionSourceSchema,
  ]),
}).strict();

export const WorkflowInputSchema = z.discriminatedUnion("type", [
  WorkflowTextInputSchema,
  WorkflowTextareaInputSchema,
  WorkflowSelectInputSchema,
]);

export const WorkflowManualInputBindingSchema = z
  .object({
    ref: z.string().min(1),
    payload_key: z.string().min(1),
  })
  .strict();

export const WorkflowActionInputBindingSchema = z
  .object({
    ref: z.string().min(1),
  })
  .strict();

export const WorkflowTriggerBindingSchema = z
  .object({
    id: z.string().min(1),
    adapter: TriggerAdapterIdSchema,
    config: z.record(z.string(), JsonValueSchema).default({}),
  })
  .strict();

export const WorkflowSourceBindingSchema = z
  .object({
    id: z.string().min(1),
    adapter: SourceAdapterIdSchema,
    config: z.record(z.string(), JsonValueSchema).default({}),
  })
  .strict();

export const WorkflowActionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    command: z.string().min(1),
    confirm: z.boolean().default(false),
    inputs: z.array(WorkflowActionInputBindingSchema).min(1).optional(),
    timeout_ms: z.int().positive().default(30_000),
    set_state: z.string().min(1).nullish(),
    start_new_attempt: z.boolean().default(false),
  })
  .strict();

const HarnessRetrySchema = z
  .object({
    max_retries: z.int().nonnegative().default(0),
    base_delay_ms: z.int().positive().default(10_000),
    max_backoff_ms: z.int().positive().default(300_000),
  })
  .strict();

const HarnessCancelSchema = z
  .object({
    graceful_timeout_ms: z.int().positive().default(15_000),
    hard_kill_timeout_ms: z.int().positive().default(5_000),
  })
  .strict();
const GenericHarnessObjectSchema = z.record(z.string(), JsonValueSchema);

export const DEFAULT_HARNESS_RETRY: z.output<typeof HarnessRetrySchema> = {
  max_retries: 0,
  base_delay_ms: 10_000,
  max_backoff_ms: 300_000,
};

export const DEFAULT_HARNESS_CANCEL: z.output<typeof HarnessCancelSchema> = {
  graceful_timeout_ms: 15_000,
  hard_kill_timeout_ms: 5_000,
};

const defaultWorkspaceMode = "managed" as const;
const defaultWorkspacePruneTtlSeconds = 604_800;
const defaultHookTimeoutMs = 60_000;
const defaultInputCommandTimeoutMs = 10_000;
const defaultActionTimeoutMs = 30_000;
const defaultStageSession = "fresh" as const;
const defaultHarnessTurnTimeoutMs = 3_600_000;
const defaultHarnessStallTimeoutMs = 300_000;
export const DEFAULT_HARNESS_PREPARE_TIMEOUT_MS = 300_000;

export const HarnessAuthSchema = GenericHarnessObjectSchema;
export const HarnessPrepareSchema = z
  .object({
    run: z.string().trim().min(1),
    env: z.record(z.string(), z.string()).optional(),
    timeout_ms: z.int().positive().default(DEFAULT_HARNESS_PREPARE_TIMEOUT_MS),
  })
  .strict();

export const HarnessSchema = z
  .object({
    id: z.string().min(1),
    auth: HarnessAuthSchema,
    model: z.string().trim().min(1).optional(),
    effort: z.string().trim().min(1).optional(),
    turn_timeout_ms: z.int().positive().default(3_600_000),
    stall_timeout_ms: z.int().positive().default(300_000),
    config: GenericHarnessObjectSchema.default({}),
    prepare: HarnessPrepareSchema.optional(),
    retry: HarnessRetrySchema.default(DEFAULT_HARNESS_RETRY),
    cancel: HarnessCancelSchema.default(DEFAULT_HARNESS_CANCEL),
  })
  .strict();

export const WorkflowHarnessCatalogSchema = z.record(
  z.string().min(1),
  HarnessSchema,
);

export const WorkflowMetadataSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    description: z.string().nullable().optional(),
  })
  .catchall(JsonValueSchema)
  .optional();

export const WorkflowStateSchema = z
  .object({
    initial: z.string().min(1),
    terminal: z.array(z.string().min(1)).min(1),
    on_attempt: z
      .object({
        completed: z.string().min(1).nullish(),
        failed: z.string().min(1).nullish(),
        canceled: z.string().min(1).nullish(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const WorkflowWorkspaceSchema = z
  .object({
    mode: WorkspaceModeSchema.default("managed"),
    prune_ttl_seconds: z.int().positive().default(604_800),
  })
  .strict();

export const WorkflowHooksSchema = z
  .object({
    after_create: z.string().nullish(),
    before_run: z.string().nullish(),
    after_run: z.string().nullish(),
    before_remove: z.string().nullish(),
    timeout_ms: z.int().positive().default(60_000),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const WorkflowExecutionBodySchema = z
  .object({
    state: WorkflowStateSchema,
    workspace: WorkflowWorkspaceSchema,
    hooks: WorkflowHooksSchema,
    harnesses: WorkflowHarnessCatalogSchema.default({}),
    stages: z.array(StageSchema),
    actions: z.array(WorkflowActionSchema).optional(),
  })
  .strict();

export const WorkflowDocumentSchema = z
  .object({
    metadata: WorkflowMetadataSchema,
    inputs: z.array(WorkflowInputSchema).min(1).optional(),
    state: WorkflowStateSchema,
    triggers: z.array(WorkflowTriggerBindingSchema).default([]),
    sources: z.array(WorkflowSourceBindingSchema).default([]),
    workspace: WorkflowWorkspaceSchema,
    hooks: WorkflowHooksSchema,
    harnesses: WorkflowHarnessCatalogSchema.default({}),
    stages: z.array(StageSchema),
    actions: z.array(WorkflowActionSchema).optional(),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    if (
      workflow.stages.length > 0 &&
      Object.keys(workflow.harnesses).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["harnesses"],
        message: "harnesses is required when stages are configured",
        params: {
          workflow_rule: "missing_harnesses_with_stages",
        },
      });
    }

    const knownInputIds = new Set<string>();
    workflow.inputs?.forEach((input, index) => {
      if (knownInputIds.has(input.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "id"],
          message: `Duplicate input id "${input.id}"`,
          params: {
            workflow_rule: "duplicate_input_id",
          },
        });
      }
      knownInputIds.add(input.id);

      if (input.type !== "select" || !("values" in input.options)) {
        return;
      }

      const seenOptionValues = new Set<string>();
      const optionValues = input.options.values.map((option) =>
        typeof option === "string" ? option : option.value,
      );
      optionValues.forEach((optionValue, optionIndex) => {
        if (!seenOptionValues.has(optionValue)) {
          seenOptionValues.add(optionValue);
          return;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "options", "values", optionIndex],
          message: `Duplicate option value "${optionValue}"`,
          params: {
            workflow_rule: "duplicate_input_option_value",
          },
        });
      });

      if (
        input.options.default_value &&
        !optionValues.includes(input.options.default_value)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "options", "default_value"],
          message: `Unknown default option "${input.options.default_value}"`,
          params: {
            workflow_rule: "unknown_input_default_value",
          },
        });
      }
    });

    const assertKnownInputRef = (
      ref: string,
      path: Array<string | number>,
    ): void => {
      if (knownInputIds.has(ref)) {
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Unknown input ref "${ref}"`,
        params: {
          workflow_rule: "unknown_input_ref",
        },
      });
    };

    const seenTriggerBindingIds = new Set<string>();
    workflow.triggers.forEach((binding, index) => {
      if (seenTriggerBindingIds.has(binding.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["triggers", index, "id"],
          message: `Duplicate trigger binding id "${binding.id}"`,
          params: {
            workflow_rule: "duplicate_trigger_binding_id",
          },
        });
      }
      seenTriggerBindingIds.add(binding.id);
    });

    const seenSourceBindingIds = new Set<string>();
    workflow.sources.forEach((binding, index) => {
      if (seenSourceBindingIds.has(binding.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", index, "id"],
          message: `Duplicate source binding id "${binding.id}"`,
          params: {
            workflow_rule: "duplicate_source_binding_id",
          },
        });
      }
      seenSourceBindingIds.add(binding.id);
    });

    const seenStageIds = new Set<string>();
    workflow.stages.forEach((stage, index) => {
      if (seenStageIds.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "id"],
          message: `Duplicate stage id "${stage.id}"`,
          params: {
            workflow_rule: "duplicate_stage_id",
          },
        });
      }
      seenStageIds.add(stage.id);

      if (!workflow.harnesses[stage.harness]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "harness"],
          message: `Unknown harness ref "${stage.harness}"`,
          params: {
            workflow_rule: "unknown_stage_harness_ref",
          },
        });
      }

      if (stage.session === "previous" && index === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "session"],
          message: "session: previous requires an earlier stage",
          params: {
            workflow_rule: "previous_session_without_prior_stage",
          },
        });
      }

      if (
        stage.session === "previous" &&
        index > 0 &&
        workflow.stages[index - 1]?.harness !== stage.harness
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "session"],
          message:
            "session: previous requires the immediately previous stage to use the same harness",
          params: {
            workflow_rule: "previous_session_harness_mismatch",
          },
        });
      }
    });

    const stageIds = workflow.stages.map((stage) => stage.id);
    workflow.stages.forEach((stage, index) => {
      if (!stage.gate) {
        return;
      }

      const rejectIndex = stageIds.indexOf(stage.gate.reject_to);
      if (rejectIndex === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "gate", "reject_to"],
          message: `Unknown reject_to stage "${stage.gate.reject_to}"`,
          params: {
            workflow_rule: "unknown_reject_to_stage",
          },
        });
      }

      if (rejectIndex >= index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "gate", "reject_to"],
          message: "reject_to must reference an earlier stage",
          params: {
            workflow_rule: "reject_to_not_earlier_stage",
          },
        });
      }
    });

    const seenActionIds = new Set<string>();
    workflow.actions?.forEach((action, index) => {
      if (seenActionIds.has(action.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "id"],
          message: `Duplicate action id "${action.id}"`,
          params: {
            workflow_rule: "duplicate_action_id",
          },
        });
      }

      seenActionIds.add(action.id);

      const seenActionInputRefs = new Set<string>();
      action.inputs?.forEach((binding, bindingIndex) => {
        assertKnownInputRef(binding.ref, [
          "actions",
          index,
          "inputs",
          bindingIndex,
          "ref",
        ]);
        if (seenActionInputRefs.has(binding.ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["actions", index, "inputs", bindingIndex, "ref"],
            message: `Duplicate action input ref "${binding.ref}"`,
            params: {
              workflow_rule: "duplicate_action_input_ref",
            },
          });
        }
        seenActionInputRefs.add(binding.ref);
      });

      if (
        action.start_new_attempt &&
        action.set_state &&
        workflow.state.terminal.includes(action.set_state)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "set_state"],
          message:
            "set_state cannot target a terminal state when start_new_attempt is true",
          params: {
            workflow_rule: "terminal_set_state_with_new_attempt",
          },
        });
      }
    });
  });

const PipelineInputStaticOptionSourceSchema = z
  .object({
    values: z.array(WorkflowInputStaticOptionSchema).min(1),
    defaultValue: z.string().min(1).nullish(),
  })
  .strict();

const PipelineInputCommandOptionSourceSchema = z
  .object({
    command: z.string().min(1),
    timeoutMs: z.int().positive().default(defaultInputCommandTimeoutMs),
  })
  .strict();

export const PipelineInputSchema = WorkflowBaseInputSchema.extend({
  type: WorkflowInputTypeSchema,
  options: z
    .union([
      PipelineInputStaticOptionSourceSchema,
      PipelineInputCommandOptionSourceSchema,
    ])
    .optional(),
}).strict();

export const PipelineStageGateSchema = z
  .object({
    command: z.string().min(1),
    rejectTo: z.string().min(1),
    maxCycles: z.int().nonnegative(),
    timeoutMs: z.int().positive().default(10_000),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const PipelineStageHooksSchema = z
  .object({
    before: z.string().nullish(),
    after: z.string().nullish(),
    afterGate: z.string().nullish(),
    timeoutMs: z.int().positive().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const PipelineStageSchema = z
  .object({
    id: z.string().min(1),
    harness: z.string().min(1),
    prompt: z.string(),
    session: StageSessionPolicySchema.default("fresh"),
    gate: PipelineStageGateSchema.nullish(),
    hooks: PipelineStageHooksSchema.nullish(),
  })
  .strict();

export const PipelineHooksSchema = z
  .object({
    afterCreate: z.string().nullish(),
    beforeRun: z.string().nullish(),
    afterRun: z.string().nullish(),
    beforeRemove: z.string().nullish(),
    timeoutMs: z.int().positive().default(defaultHookTimeoutMs),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const PipelineHarnessPrepareSchema = z
  .object({
    run: z.string().trim().min(1),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.int().positive().default(DEFAULT_HARNESS_PREPARE_TIMEOUT_MS),
  })
  .strict();

const PipelineHarnessRetrySchema = z
  .object({
    maxRetries: z.int().nonnegative().default(DEFAULT_HARNESS_RETRY.max_retries),
    baseDelayMs: z.int().positive().default(DEFAULT_HARNESS_RETRY.base_delay_ms),
    maxBackoffMs: z
      .int()
      .positive()
      .default(DEFAULT_HARNESS_RETRY.max_backoff_ms),
  })
  .strict();

const PipelineHarnessCancelSchema = z
  .object({
    gracefulTimeoutMs: z
      .int()
      .positive()
      .default(DEFAULT_HARNESS_CANCEL.graceful_timeout_ms),
    hardKillTimeoutMs: z
      .int()
      .positive()
      .default(DEFAULT_HARNESS_CANCEL.hard_kill_timeout_ms),
  })
  .strict();

export const PipelineHarnessSchema = z
  .object({
    id: z.string().min(1),
    auth: HarnessAuthSchema,
    model: z.string().trim().min(1).optional(),
    effort: z.string().trim().min(1).optional(),
    turnTimeoutMs: z.int().positive().default(defaultHarnessTurnTimeoutMs),
    stallTimeoutMs: z.int().positive().default(defaultHarnessStallTimeoutMs),
    config: GenericHarnessObjectSchema.default({}),
    prepare: PipelineHarnessPrepareSchema.optional(),
    retry: PipelineHarnessRetrySchema.default({
      maxRetries: DEFAULT_HARNESS_RETRY.max_retries,
      baseDelayMs: DEFAULT_HARNESS_RETRY.base_delay_ms,
      maxBackoffMs: DEFAULT_HARNESS_RETRY.max_backoff_ms,
    }),
    cancel: PipelineHarnessCancelSchema.default({
      gracefulTimeoutMs: DEFAULT_HARNESS_CANCEL.graceful_timeout_ms,
      hardKillTimeoutMs: DEFAULT_HARNESS_CANCEL.hard_kill_timeout_ms,
    }),
  })
  .strict();

export const PipelineHarnessCatalogSchema = z.record(
  z.string().min(1),
  PipelineHarnessSchema,
);

export const PipelineSpecSchema = z
  .object({
    metadata: WorkflowMetadataSchema,
    inputs: z.array(PipelineInputSchema).min(1).optional(),
    hooks: PipelineHooksSchema.default({
      timeoutMs: defaultHookTimeoutMs,
    }),
    harnesses: PipelineHarnessCatalogSchema.default({}),
    stages: z.array(PipelineStageSchema),
  })
  .strict()
  .superRefine((pipeline, ctx) => {
    if (
      pipeline.stages.length > 0 &&
      Object.keys(pipeline.harnesses).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["harnesses"],
        message: "harnesses is required when stages are configured",
        params: {
          workflow_rule: "missing_harnesses_with_stages",
        },
      });
    }

    const seenInputIds = new Set<string>();
    pipeline.inputs?.forEach((input, index) => {
      if (seenInputIds.has(input.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "id"],
          message: `Duplicate input id "${input.id}"`,
          params: {
            workflow_rule: "duplicate_input_id",
          },
        });
      }
      seenInputIds.add(input.id);

      if (!input.options || !("values" in input.options)) {
        return;
      }

      const seenOptionValues = new Set<string>();
      const optionValues = input.options.values.map((option) =>
        typeof option === "string" ? option : option.value,
      );
      optionValues.forEach((optionValue, optionIndex) => {
        if (!seenOptionValues.has(optionValue)) {
          seenOptionValues.add(optionValue);
          return;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "options", "values", optionIndex],
          message: `Duplicate option value "${optionValue}"`,
          params: {
            workflow_rule: "duplicate_input_option_value",
          },
        });
      });

      if (
        input.options.defaultValue &&
        !optionValues.includes(input.options.defaultValue)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputs", index, "options", "defaultValue"],
          message: `Unknown default option "${input.options.defaultValue}"`,
          params: {
            workflow_rule: "unknown_input_default_value",
          },
        });
      }
    });

    const seenStageIds = new Set<string>();
    const stageIds = pipeline.stages.map((stage) => stage.id);
    pipeline.stages.forEach((stage, index) => {
      if (seenStageIds.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "id"],
          message: `Duplicate stage id "${stage.id}"`,
          params: {
            workflow_rule: "duplicate_stage_id",
          },
        });
      }
      seenStageIds.add(stage.id);

      if (!pipeline.harnesses[stage.harness]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "harness"],
          message: `Unknown harness ref "${stage.harness}"`,
          params: {
            workflow_rule: "unknown_stage_harness_ref",
          },
        });
      }

      if (stage.session === "previous" && index === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "session"],
          message: "session: previous requires an earlier stage",
          params: {
            workflow_rule: "previous_session_without_prior_stage",
          },
        });
      }

      if (
        stage.session === "previous" &&
        index > 0 &&
        pipeline.stages[index - 1]?.harness !== stage.harness
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "session"],
          message:
            "session: previous requires the immediately previous stage to use the same harness",
          params: {
            workflow_rule: "previous_session_harness_mismatch",
          },
        });
      }

      if (!stage.gate) {
        return;
      }

      const rejectIndex = stageIds.indexOf(stage.gate.rejectTo);
      if (rejectIndex === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "gate", "rejectTo"],
          message: `Unknown rejectTo stage "${stage.gate.rejectTo}"`,
          params: {
            workflow_rule: "unknown_reject_to_stage",
          },
        });
      }

      if (rejectIndex >= index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "gate", "rejectTo"],
          message: "rejectTo must reference an earlier stage",
          params: {
            workflow_rule: "reject_to_not_earlier_stage",
          },
        });
      }
    });
  });

export const WorkflowIngressSchema = z
  .object({
    kind: z.enum(["trigger", "source"]),
    id: z.string().min(1),
    adapter: z.string().min(1),
    config: z.record(z.string(), JsonValueSchema).default({}),
  })
  .strict();

export const WorkflowActionSpecSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    command: z.string().min(1),
    confirm: z.boolean().default(false),
    inputs: z.array(WorkflowActionInputBindingSchema).min(1).optional(),
    timeoutMs: z.int().positive().default(defaultActionTimeoutMs),
    setState: z.string().min(1).nullish(),
    startNewRun: z.boolean().default(false),
  })
  .strict();

export const WorkflowStateSpecSchema = z
  .object({
    initial: z.string().min(1),
    terminal: z.array(z.string().min(1)).min(1),
    onRun: z
      .object({
        completed: z.string().min(1).nullish(),
        failed: z.string().min(1).nullish(),
        canceled: z.string().min(1).nullish(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const WorkflowWorkspaceSpecSchema = z
  .object({
    mode: WorkspaceModeSchema.default("managed"),
    pruneTtlSeconds: z.int().positive().default(defaultWorkspacePruneTtlSeconds),
  })
  .strict();

export const WorkflowSpecSchema = z
  .object({
    metadata: WorkflowMetadataSchema,
    state: WorkflowStateSpecSchema,
    ingress: z.array(WorkflowIngressSchema).default([]),
    workspace: WorkflowWorkspaceSpecSchema.default({
      mode: "managed",
      pruneTtlSeconds: defaultWorkspacePruneTtlSeconds,
    }),
    pipeline: PipelineSpecSchema,
    actions: z.array(WorkflowActionSpecSchema).optional(),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const knownInputIds = new Set(
      workflow.pipeline.inputs?.map((input) => input.id) ?? [],
    );
    const assertKnownInputRef = (
      ref: string,
      path: Array<string | number>,
    ): void => {
      if (knownInputIds.has(ref)) {
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Unknown input ref "${ref}"`,
        params: {
          workflow_rule: "unknown_input_ref",
        },
      });
    };

    const seenIngressIds = new Set<string>();
    workflow.ingress.forEach((binding, index) => {
      if (seenIngressIds.has(binding.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ingress", index, "id"],
          message: `Duplicate ingress id "${binding.id}"`,
          params: {
            workflow_rule: "duplicate_ingress_id",
          },
        });
      }
      seenIngressIds.add(binding.id);
    });

    const seenActionIds = new Set<string>();
    workflow.actions?.forEach((action, index) => {
      if (seenActionIds.has(action.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "id"],
          message: `Duplicate action id "${action.id}"`,
          params: {
            workflow_rule: "duplicate_action_id",
          },
        });
      }
      seenActionIds.add(action.id);

      const seenActionInputRefs = new Set<string>();
      action.inputs?.forEach((binding, bindingIndex) => {
        assertKnownInputRef(binding.ref, [
          "actions",
          index,
          "inputs",
          bindingIndex,
          "ref",
        ]);
        if (seenActionInputRefs.has(binding.ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["actions", index, "inputs", bindingIndex, "ref"],
            message: `Duplicate action input ref "${binding.ref}"`,
            params: {
              workflow_rule: "duplicate_action_input_ref",
            },
          });
        }
        seenActionInputRefs.add(binding.ref);
      });

      if (
        action.startNewRun &&
        action.setState &&
        workflow.state.terminal.includes(action.setState)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "setState"],
          message:
            "setState cannot target a terminal state when startNewRun is true",
          params: {
            workflow_rule: "terminal_set_state_with_new_attempt",
          },
        });
      }
    });
  });

export const AuthoredWorkflowDocumentSchema = WorkflowSpecSchema;

export const AttemptStageSchema = z.object({
  id: z.string(),
  index: z.int().nonnegative(),
  state: AttemptStageStateSchema,
  run_count: z.int().nonnegative(),
  session_id: z.string().nullable(),
  started_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  last_gate_decision: GateDecisionSchema.nullable(),
  last_gate_exit_code: z.int().nullable(),
  terminal_reason: z.string().nullable(),
});

export const AttemptSchema = z.object({
  number: z.int().positive(),
  source_type: SourceTypeSchema,
  state: AttemptStateSchema,
  stages: z.array(AttemptStageSchema),
  current_stage_id: z.string().nullable(),
  current_stage_run_index: z.int().nonnegative().nullable(),
  start_git_ref: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  workspace_path: z.string(),
  cancel_requested: z.boolean(),
  terminal_reason: z.string().nullable(),
});

export const ExecutionSchema = z.object({
  id: z.string(),
  owner: ExecutionOwnerSchema,
  workflow_state: z.string(),
  lifecycle_state: ExecutionLifecycleStateSchema,
  attempts: z.array(AttemptSchema),
  harness_id: z.string().nullable().default(null),
  workspace_mode: WorkspaceModeSchema.default("managed"),
  workspace_path: z.string().default(""),
  base_branch: z.string().nullable().default(null),
  start_git_ref: z.string().nullable().default(null),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ExecutionEventSchema = z.object({
  seq: z.int().nonnegative(),
  at: z.string().datetime({ offset: true }),
  type: z.string(),
  execution_id: z.string(),
  attempt_number: z.int().positive().nullable(),
  stage_id: z.string().nullable(),
  stage_run_index: z.int().nonnegative().nullable(),
  data: z.record(z.string(), JsonValueSchema),
});

export const PersistedStageSessionSchema = z.object({
  owner_stage_id: z.string(),
  harness_id: z.string().min(1),
  harness_session: z.record(z.string(), JsonValueSchema).default({}),
  updated_at: z.string().datetime({ offset: true }),
});

export const HarnessSessionSchema = z.object({
  id: z.string(),
  harness_id: z.string(),
  attempt_number: z.int().positive(),
  stage_id: z.string(),
  stage_run_index: z.int().nonnegative(),
  harness_session: z.record(z.string(), JsonValueSchema).default({}),
  started_at: z.string().datetime({ offset: true }),
  last_event_at: z.string().datetime({ offset: true }).nullable(),
});

export const HarnessEventSchema = z.object({
  at: z.string().datetime({ offset: true }),
  attempt_number: z.int().positive(),
  stage_id: z.string(),
  stage_run_index: z.int().nonnegative(),
  phase: HarnessEventPhaseSchema,
  name: z.string(),
  payload: z.record(z.string(), JsonValueSchema),
});

export const TraceSpanSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  attempt_number: z.int().positive(),
  stage_id: z.string().nullable(),
  stage_run_index: z.int().nonnegative().nullable(),
  kind: TraceSpanKindSchema,
  title: z.string(),
  status: TraceSpanStatusSchema,
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  attributes: z.record(z.string(), JsonValueSchema),
});

export const TraceEventSchema = z.object({
  id: z.string(),
  span_id: z.string(),
  attempt_number: z.int().positive(),
  stage_id: z.string().nullable(),
  stage_run_index: z.int().nonnegative().nullable(),
  kind: TraceEventKindSchema,
  at: z.string().datetime({ offset: true }),
  message: z.string(),
  attributes: z.record(z.string(), JsonValueSchema),
});

export const TraceUsageSummarySchema = z.object({
  provider: z.string().nullable(),
  model: z.string().nullable(),
  input_tokens: z.int().nonnegative().nullable(),
  uncached_input_tokens: z.int().nonnegative().nullable(),
  cached_input_tokens: z.int().nonnegative().nullable(),
  cache_creation_input_tokens: z.int().nonnegative().nullable(),
  cache_read_input_tokens: z.int().nonnegative().nullable(),
  output_tokens: z.int().nonnegative().nullable(),
  reasoning_output_tokens: z.int().nonnegative().nullable(),
  total_tokens: z.int().nonnegative().nullable(),
  total_cost_usd: z.number().nonnegative().nullable(),
  cost_source: z.string().nullable(),
  pricing_source: z.string().nullable(),
});

export const TraceSummarySchema = z.object({
  attempt_number: z.int().positive(),
  stage_id: z.string().nullable(),
  stage_run_index: z.int().nonnegative().nullable(),
  status: TraceSpanStatusSchema,
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  duration_ms: z.int().nonnegative(),
  tool_call_count: z.int().nonnegative(),
  input_tokens: z.int().nonnegative().nullable(),
  output_tokens: z.int().nonnegative().nullable(),
  usage: TraceUsageSummarySchema.nullable().optional(),
  final_output_present: z.boolean(),
  error_message: z.string().nullable(),
});

export const ExecutionTraceSchema = z.object({
  trace_id: z.string(),
  spans: z.array(TraceSpanSchema),
  events: z.array(TraceEventSchema),
  summaries: z.array(TraceSummarySchema),
});

export const WorkspaceBranchContextSchema = z
  .object({
    branch: z.string().nullable(),
    head_state: z.enum(["branch", "detached", "no_git"]),
  })
  .strict();


export const HookOutcomeSchema = z.object({
  attempt_number: z.int().positive().nullable().optional(),
  stage_id: z.string().nullable().optional(),
  stage_run_index: z.int().nonnegative().nullable().optional(),
  hook: z.enum([
    "after_create",
    "before_run",
    "after_run",
    "before_remove",
    "before_stage",
    "after_stage",
    "after_gate",
    "gate",
    "action",
  ]),
  level: HookOutcomeLevelSchema,
  command: z.string(),
  exit_code: z.int().nullable(),
  signal: z.string().nullable().optional(),
  duration_ms: z.int().nonnegative(),
  output_path: z.string().nullable(),
  message: z.string().nullable(),
});

export const StageRunArtifactSchema = z.object({
  attempt_number: z.int().positive(),
  stage_id: z.string(),
  run_index: z.int().nonnegative(),
  output_file: z.string(),
  events_file: z.string(),
  raw_events_file: z.string().nullable().optional(),
  final_output: z.string().nullable(),
});

export const WorkflowLoadRecordSchema = z.object({
  id: z.string().min(1),
  file_path: z.string(),
  source_yaml: z.string(),
  effective_workflow: WorkflowDocumentSchema.nullable(),
  validity_status: WorkflowValidityStatusSchema,
  availability_status: WorkflowAvailabilityStatusSchema,
  availability_errors: z.array(z.string()),
  last_error: z.string().nullable(),
  state_vocabulary: z.array(z.string()),
  updated_at: z.string().datetime({ offset: true }),
});

export const WorkspaceStatusSchema = z.enum([
  "retained",
  "pruned",
  "not_created",
]);

export const WorkflowExecutionSchema = ExecutionSchema.extend({
  owner: WorkflowExecutionOwnerSchema,
});

export const LatestTurnPreviewSchema = z.object({
  at: z.string().datetime({ offset: true }),
  stage_id: z.string().nullable(),
  stage_run_index: z.int().nonnegative().nullable(),
  prompt: z.string().nullable(),
  response: z.string().nullable(),
  intermediate: z.string().nullable(),
});

const ExecutionSummaryBaseSchema = z.object({
  latest_attempt: AttemptSchema.nullable(),
  first_trigger: TriggerEventSchema.nullable().optional(),
  latest_trigger: TriggerEventSchema.nullable().optional(),
  latest_turn_preview: LatestTurnPreviewSchema.nullable().optional(),
  current_stage_id: z.string().nullable(),
  current_stage_run_index: z.int().nonnegative().nullable(),
  stage_progress: z.object({
    completed: z.int().nonnegative(),
    total: z.int().nonnegative(),
  }),
  cycle_counts: z.record(z.string(), z.int().nonnegative()),
});

export const WorkflowExecutionSummarySchema = ExecutionSummaryBaseSchema.extend(
  {
    execution: WorkflowExecutionSchema,
  },
);

export const ExecutionSummarySchema = WorkflowExecutionSummarySchema;

const ExecutionDetailBaseSchema = z.object({
  triggers: z.array(TriggerEventSchema),
  event_tail: z.array(ExecutionEventSchema),
  branch_context: WorkspaceBranchContextSchema,
  workspace_status: WorkspaceStatusSchema,
  hook_outcomes: z.array(HookOutcomeSchema),
  trace: ExecutionTraceSchema,
  harness_events: z.array(HarnessEventSchema),
  stage_artifacts: z.array(StageRunArtifactSchema),
});

export const WorkflowExecutionDetailSchema = ExecutionDetailBaseSchema.extend({
  execution: WorkflowExecutionSchema,
  workflow: WorkflowLoadRecordSchema,
  matches_current_workflow: z.boolean().nullable(),
  effective_actions: z.array(WorkflowActionSchema),
});

export const ExecutionDetailSchema = WorkflowExecutionDetailSchema;

export const ExecutionFilterSchema = z.object({
  owner_kind: z.enum(["workflow"]).optional(),
  owner_id: z.string().optional(),
  workflow_state: z.string().optional(),
  lifecycle_state: ExecutionLifecycleStateSchema.optional(),
  latest_attempt_state: AttemptStateSchema.optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

export const ChangeSummarySchema = z.object({
  path: z.string(),
  old_path: z.string().nullable(),
  status: DiffStatusSchema,
  mime_type: z.string().nullable(),
  preview_kind: PreviewKindSchema,
  additions: z.int().nonnegative(),
  deletions: z.int().nonnegative(),
});

export const FilePreviewSourceSchema = z.object({
  content: z.string(),
  encoding: PreviewSourceEncodingSchema,
});

export const FilePreviewSchema = z.object({
  path: z.string(),
  view: z.enum(["diff", "raw", "rendered"]),
  mime_type: z.string().nullable(),
  preview_kind: PreviewKindSchema,
  diff: z.string().nullable(),
  source: FilePreviewSourceSchema.nullable(),
  rendered_html: z.string().nullable(),
});

export const WorkflowMutationRequestSchema = z.object({
  source_yaml: z.string().min(1),
});

export const WorkflowEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export const ManualExecutionRequestSchema = z.object({
  binding_id: z.string().min(1).optional(),
  payload: z.record(z.string(), JsonValueSchema).optional(),
});

export const ActionInvocationRequestSchema = z.object({
  confirm: z.boolean().optional(),
  inputs: z.record(z.string(), z.string()).optional(),
});

export const WorkflowInputResolverResultSchema = z
  .object({
    options: z.array(WorkflowInputOptionSchema).default([]),
    default_value: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ResolvedWorkflowInputSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).nullable().optional(),
    type: WorkflowInputTypeSchema,
    required: z.boolean(),
    default_value: z.string().min(1).nullable().optional(),
    options: z.array(WorkflowInputOptionSchema).nullable().optional(),
    payload_key: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ManualWorkflowInputResolutionRequestSchema = z.object({
  binding_id: z.string().min(1).optional(),
  values: z.record(z.string(), z.string()).optional(),
});

export const WorkflowInputResolutionRequestSchema = z.object({
  values: z.record(z.string(), z.string()).optional(),
});

export const WorkflowInputResolutionResponseSchema = z.object({
  inputs: z.array(ResolvedWorkflowInputSchema),
});

export const ExecutionDeleteResultSchema = z
  .object({
    execution_id: z.string().min(1),
    status: z.enum(["deleted", "already_deleted"]),
    owner_kind: z.enum(["workflow"]).nullable(),
    owner_id: z.string().min(1).nullable(),
  })
  .strict();

export const SseEnvelopeSchema = z.object({
  event_id: z.string(),
  at: z.string().datetime({ offset: true }),
  type: z.string(),
  workflow_id: z.string().nullable(),
  execution_id: z.string().nullable(),
  data: z.record(z.string(), JsonValueSchema),
});

export const HarnessManifestCapabilitiesSchema = z
  .object({
    supports_resume: z.boolean(),
    supports_interrupt: z.boolean(),
    required_runtime_capabilities: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const HarnessManifestSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1),
    auth_schema: JsonValueSchema,
    config_schema: JsonValueSchema,
    defaults: z
      .object({
        auth: GenericHarnessObjectSchema.optional(),
        model: z.string().trim().min(1).optional(),
        effort: z.string().trim().min(1).optional(),
        turn_timeout_ms: z.int().positive().optional(),
        stall_timeout_ms: z.int().positive().optional(),
        config: z.record(z.string(), JsonValueSchema).optional(),
      })
      .strict(),
    capabilities: HarnessManifestCapabilitiesSchema,
    supported_workspace_modes: z.array(WorkspaceModeSchema).min(1),
  })
  .strict();

export const TriggerManifestCapabilitiesSchema = z
  .object({
    supports_create: z.boolean(),
    supports_continue: z.boolean(),
    supports_reconciliation: z.boolean(),
  })
  .strict();

export const TriggerManifestSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1),
    config_schema: JsonValueSchema,
    capabilities: TriggerManifestCapabilitiesSchema,
  })
  .strict();

export const SourceManifestCapabilitiesSchema = z
  .object({
    supports_reconciliation: z.boolean(),
  })
  .strict();

export const SourceManifestSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1),
    config_schema: JsonValueSchema,
    capabilities: SourceManifestCapabilitiesSchema,
  })
  .strict();

export const FlowExtensionResourceSchema = z
  .object({
    path: z.string().min(1),
    label: z.string().min(1).optional(),
    resolved_path: z.string().min(1).optional(),
  })
  .strict();

export const FlowExtensionResourcesSchema = z
  .object({
    docs: z.array(FlowExtensionResourceSchema).default([]),
    examples: z.array(FlowExtensionResourceSchema).default([]),
  })
  .strict();

export const FlowExtensionManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    resources: FlowExtensionResourcesSchema.default({
      docs: [],
      examples: [],
    }),
  })
  .strict();

export const FlowExtensionCatalogEntrySchema =
  FlowExtensionManifestSchema.extend({
    status: z.literal("loaded").default("loaded"),
    harness_ids: z.array(z.string().min(1)).default([]),
    trigger_ids: z.array(z.string().min(1)).default([]),
    source_ids: z.array(z.string().min(1)).default([]),
    trace_replayer_harness_ids: z.array(z.string().min(1)).default([]),
  }).strict();

export const FlowHarnessAdapterCatalogEntrySchema =
  HarnessManifestSchema.extend({
    kind: z.literal("harness"),
    extension_id: z.string().min(1),
    extension_name: z.string().min(1),
  }).strict();

export const FlowTriggerAdapterCatalogEntrySchema =
  TriggerManifestSchema.extend({
    kind: z.literal("trigger"),
    extension_id: z.string().min(1),
    extension_name: z.string().min(1),
  }).strict();

export const FlowSourceAdapterCatalogEntrySchema =
  SourceManifestSchema.extend({
    kind: z.literal("source"),
    extension_id: z.string().min(1),
    extension_name: z.string().min(1),
  }).strict();

export const FlowAdapterCatalogEntrySchema = z.discriminatedUnion("kind", [
  FlowHarnessAdapterCatalogEntrySchema,
  FlowTriggerAdapterCatalogEntrySchema,
  FlowSourceAdapterCatalogEntrySchema,
]);

export const GlobalSkillProviderSupportSchema = z
  .object({
    providerId: z.string().min(1),
    providerLabel: z.string().min(1),
  })
  .strict();

export const GlobalSkillCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    summary: z.string().nullable(),
    enabled: z.boolean(),
    providerSupport: z.array(GlobalSkillProviderSupportSchema).default([]),
  })
  .strict();

export const GlobalSkillCatalogSchema = z
  .object({
    skills: z.array(GlobalSkillCatalogEntrySchema).default([]),
  })
  .strict();

export const GlobalSkillUpdateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const ProviderIntegrationCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const ProviderIntegrationCatalogSchema = z
  .object({
    providerId: z.string().min(1),
    providerLabel: z.string().min(1),
    integrations: z.array(ProviderIntegrationCatalogEntrySchema).default([]),
  })
  .strict();

export const ProviderIntegrationUpdateSchema = z
  .object({
    enabledIds: z.array(z.string().min(1)),
  })
  .strict();

export const RuntimeCapabilityStatusSchema = z
  .object({
    id: z.string().min(1),
    available: z.boolean(),
    reason: z.string().nullable().optional(),
  })
  .strict();

export const RuntimeCapabilitiesSchema = z
  .object({
    platform_id: PlatformIdSchema,
    capabilities: z.array(RuntimeCapabilityStatusSchema),
    harnesses: z.array(HarnessManifestSchema),
  })
  .strict();

export const RuntimeOwnerModeSchema = z.enum([
  "persistent",
  "transient",
  "dev_server",
]);

export const RuntimeStatusSchema = z.object({
  started_at: z.string().datetime({ offset: true }),
  queue_depth: z.int().nonnegative(),
  active_executions: z.int().nonnegative(),
  workflow_count: z.int().nonnegative(),
  platform_id: PlatformIdSchema,
  runtime_url: z.string().url(),
  repo_root: z.string(),
  flow_root: z.string(),
  flow_home: z.string(),
  managed_workspace_root: z.string(),
  launch_id: z.string().nullable(),
  owner_pid: z.int().positive(),
  owner_mode: RuntimeOwnerModeSchema.nullable(),
  ui_served: z.boolean(),
});

export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type AttemptState = z.infer<typeof AttemptStateSchema>;
export type ExecutionLifecycleState = z.infer<
  typeof ExecutionLifecycleStateSchema
>;
export type AttemptStageState = z.infer<typeof AttemptStageStateSchema>;
export type GateDecision = z.infer<typeof GateDecisionSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type StageSessionPolicy = z.infer<typeof StageSessionPolicySchema>;
export type WorkspaceMode = z.infer<typeof WorkspaceModeSchema>;
export type PlatformId = z.infer<typeof PlatformIdSchema>;
export type RuntimeOwnerMode = z.infer<typeof RuntimeOwnerModeSchema>;
export type WorkflowValidityStatus = z.infer<
  typeof WorkflowValidityStatusSchema
>;
export type WorkflowAvailabilityStatus = z.infer<
  typeof WorkflowAvailabilityStatusSchema
>;
export type ExecutionOwner = z.infer<typeof ExecutionOwnerSchema>;
export type WorkflowExecutionOwner = z.infer<
  typeof WorkflowExecutionOwnerSchema
>;
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type WorkflowInputType = z.infer<typeof WorkflowInputTypeSchema>;
export type WorkflowInputOption = z.infer<typeof WorkflowInputOptionSchema>;
export type WorkflowTextInput = z.infer<typeof WorkflowTextInputSchema>;
export type WorkflowTextareaInput = z.infer<typeof WorkflowTextareaInputSchema>;
export type WorkflowSelectInput = z.infer<typeof WorkflowSelectInputSchema>;
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;
export type WorkflowManualInputBinding = z.infer<
  typeof WorkflowManualInputBindingSchema
>;
export type WorkflowTriggerBinding = z.infer<
  typeof WorkflowTriggerBindingSchema
>;
export type WorkflowSourceBinding = z.infer<
  typeof WorkflowSourceBindingSchema
>;
export type WorkflowActionInputBinding = z.infer<
  typeof WorkflowActionInputBindingSchema
>;
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type PipelineInput = z.infer<typeof PipelineInputSchema>;
export type PipelineStageGate = z.infer<typeof PipelineStageGateSchema>;
export type PipelineStageHooks = z.infer<typeof PipelineStageHooksSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type PipelineHooks = z.infer<typeof PipelineHooksSchema>;
export type PipelineHarness = z.infer<typeof PipelineHarnessSchema>;
export type PipelineHarnessCatalog = z.infer<
  typeof PipelineHarnessCatalogSchema
>;
export type PipelineSpec = z.infer<typeof PipelineSpecSchema>;
export type WorkflowIngress = z.infer<typeof WorkflowIngressSchema>;
export type WorkflowActionSpec = z.infer<typeof WorkflowActionSpecSchema>;
export type WorkflowStateSpec = z.infer<typeof WorkflowStateSpecSchema>;
export type WorkflowWorkspaceSpec = z.infer<
  typeof WorkflowWorkspaceSpecSchema
>;
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;
export type HarnessPrepareInput = z.input<typeof HarnessPrepareSchema>;
export type HarnessPrepare = z.infer<typeof HarnessPrepareSchema>;
export type WorkflowHarness = z.infer<typeof HarnessSchema>;
export type WorkflowHarnessCatalog = z.infer<
  typeof WorkflowHarnessCatalogSchema
>;
export type WorkflowMetadata = z.infer<typeof WorkflowMetadataSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type WorkflowWorkspace = z.infer<typeof WorkflowWorkspaceSchema>;
export type WorkflowHooks = z.infer<typeof WorkflowHooksSchema>;
export type WorkflowExecutionBody = z.infer<
  typeof WorkflowExecutionBodySchema
>;
export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;
export type AuthoredWorkflowDocument = z.infer<
  typeof AuthoredWorkflowDocumentSchema
>;
export type AttemptStage = z.infer<typeof AttemptStageSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
export type PersistedStageSession = z.infer<typeof PersistedStageSessionSchema>;
export type HarnessSession = z.infer<typeof HarnessSessionSchema>;
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;
export type TraceSpanKind = z.infer<typeof TraceSpanKindSchema>;
export type TraceSpanStatus = z.infer<typeof TraceSpanStatusSchema>;
export type TraceEventKind = z.infer<typeof TraceEventKindSchema>;
export type TraceSpan = z.infer<typeof TraceSpanSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;
export type WorkspaceBranchContext = z.infer<
  typeof WorkspaceBranchContextSchema
>;
export type HookOutcome = z.infer<typeof HookOutcomeSchema>;
export type StageRunArtifact = z.infer<typeof StageRunArtifactSchema>;
export type WorkflowLoadRecord = z.infer<typeof WorkflowLoadRecordSchema>;
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
export type HarnessAuth = z.infer<typeof HarnessAuthSchema>;
export type WorkflowExecutionSummary = z.infer<
  typeof WorkflowExecutionSummarySchema
>;
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
export type LatestTurnPreview = z.infer<typeof LatestTurnPreviewSchema>;
export type WorkflowExecutionDetail = z.infer<
  typeof WorkflowExecutionDetailSchema
>;
export type ExecutionDetail = z.infer<typeof ExecutionDetailSchema>;
export type ChangeSummary = z.infer<typeof ChangeSummarySchema>;
export type FilePreview = z.infer<typeof FilePreviewSchema>;
export type SseEnvelope = z.infer<typeof SseEnvelopeSchema>;
export type HarnessManifestCapabilities = z.infer<
  typeof HarnessManifestCapabilitiesSchema
>;
export type HarnessManifest = z.infer<typeof HarnessManifestSchema>;
export type TriggerManifest = z.infer<typeof TriggerManifestSchema>;
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
export type RuntimeCapabilityStatus = z.infer<
  typeof RuntimeCapabilityStatusSchema
>;
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
export type FlowExtensionResource = z.infer<
  typeof FlowExtensionResourceSchema
>;
export type FlowExtensionResources = z.infer<
  typeof FlowExtensionResourcesSchema
>;
export type FlowExtensionManifest = z.infer<
  typeof FlowExtensionManifestSchema
>;
export type FlowExtensionCatalogEntry = z.infer<
  typeof FlowExtensionCatalogEntrySchema
>;
export type FlowAdapterCatalogEntry = z.infer<
  typeof FlowAdapterCatalogEntrySchema
>;
export type GlobalSkillProviderSupport = z.infer<
  typeof GlobalSkillProviderSupportSchema
>;
export type GlobalSkillCatalogEntry = z.infer<
  typeof GlobalSkillCatalogEntrySchema
>;
export type GlobalSkillCatalog = z.infer<typeof GlobalSkillCatalogSchema>;
export type GlobalSkillUpdate = z.infer<typeof GlobalSkillUpdateSchema>;
export type ProviderIntegrationCatalogEntry = z.infer<
  typeof ProviderIntegrationCatalogEntrySchema
>;
export type ProviderIntegrationCatalog = z.infer<
  typeof ProviderIntegrationCatalogSchema
>;
export type ProviderIntegrationUpdate = z.infer<
  typeof ProviderIntegrationUpdateSchema
>;
export type WorkflowEnabledRequest = z.infer<
  typeof WorkflowEnabledRequestSchema
>;
export type WorkflowInputResolverResult = z.infer<
  typeof WorkflowInputResolverResultSchema
>;
export type ResolvedWorkflowInput = z.infer<typeof ResolvedWorkflowInputSchema>;
export type WorkflowInputResolutionRequest = z.infer<
  typeof WorkflowInputResolutionRequestSchema
>;
export type ManualWorkflowInputResolutionRequest = z.infer<
  typeof ManualWorkflowInputResolutionRequestSchema
>;
export type WorkflowInputResolutionResponse = z.infer<
  typeof WorkflowInputResolutionResponseSchema
>;
export type ExecutionDeleteResult = z.infer<typeof ExecutionDeleteResultSchema>;
export interface WorkflowStateActionTarget {
  id: string;
  label: string;
  startNewAttempt: boolean;
}

export interface WorkflowStateSemantics {
  state: string;
  isInitial: boolean;
  isTerminal: boolean;
  fromAttemptCompleted: boolean;
  fromAttemptFailed: boolean;
  fromAttemptCanceled: boolean;
  actionTargets: WorkflowStateActionTarget[];
}

export function workflowDocumentFromSpec(workflow: WorkflowSpec): WorkflowDocument {
  return WorkflowDocumentSchema.parse({
    metadata: workflow.metadata,
    inputs: workflow.pipeline.inputs?.map((input) =>
      workflowInputFromPipelineInput(input),
    ),
    state: {
      initial: workflow.state.initial,
      terminal: workflow.state.terminal,
      on_attempt: workflow.state.onRun
        ? {
            completed: workflow.state.onRun.completed ?? null,
            failed: workflow.state.onRun.failed ?? null,
            canceled: workflow.state.onRun.canceled ?? null,
          }
        : undefined,
    },
    triggers: workflow.ingress
      .filter((binding) => binding.kind === "trigger")
      .map((binding) => ({
        id: binding.id,
        adapter: binding.adapter,
        config: binding.config,
      })),
    sources: workflow.ingress
      .filter((binding) => binding.kind === "source")
      .map((binding) => ({
        id: binding.id,
        adapter: binding.adapter,
        config: binding.config,
      })),
    workspace: {
      mode: workflow.workspace.mode,
      prune_ttl_seconds: workflow.workspace.pruneTtlSeconds,
    },
    hooks: {
      after_create: workflow.pipeline.hooks.afterCreate ?? null,
      before_run: workflow.pipeline.hooks.beforeRun ?? null,
      after_run: workflow.pipeline.hooks.afterRun ?? null,
      before_remove: workflow.pipeline.hooks.beforeRemove ?? null,
      timeout_ms: workflow.pipeline.hooks.timeoutMs,
      env: workflow.pipeline.hooks.env,
    },
    harnesses: Object.fromEntries(
      Object.entries(workflow.pipeline.harnesses).map(([key, harness]) => [
        key,
        {
          id: harness.id,
          auth: harness.auth,
          model: harness.model,
          effort: harness.effort,
          turn_timeout_ms: harness.turnTimeoutMs,
          stall_timeout_ms: harness.stallTimeoutMs,
          config: harness.config,
          prepare: harness.prepare
            ? {
                run: harness.prepare.run,
                env: harness.prepare.env,
                timeout_ms: harness.prepare.timeoutMs,
              }
            : undefined,
          retry: {
            max_retries: harness.retry.maxRetries,
            base_delay_ms: harness.retry.baseDelayMs,
            max_backoff_ms: harness.retry.maxBackoffMs,
          },
          cancel: {
            graceful_timeout_ms: harness.cancel.gracefulTimeoutMs,
            hard_kill_timeout_ms: harness.cancel.hardKillTimeoutMs,
          },
        },
      ]),
    ),
    stages: workflow.pipeline.stages.map((stage) => ({
      id: stage.id,
      harness: stage.harness,
      prompt: stage.prompt,
      session: stage.session,
      gate: stage.gate
        ? {
            command: stage.gate.command,
            reject_to: stage.gate.rejectTo,
            max_cycles: stage.gate.maxCycles,
            timeout_ms: stage.gate.timeoutMs,
            env: stage.gate.env,
          }
        : undefined,
      hooks: stage.hooks
        ? {
            before: stage.hooks.before ?? null,
            after: stage.hooks.after ?? null,
            after_gate: stage.hooks.afterGate ?? null,
            timeout_ms: stage.hooks.timeoutMs,
            env: stage.hooks.env,
          }
        : undefined,
    })),
    actions: workflow.actions?.map((action) => ({
      id: action.id,
      label: action.label,
      command: action.command,
      confirm: action.confirm,
      inputs: action.inputs,
      timeout_ms: action.timeoutMs,
      set_state: action.setState ?? null,
      start_new_attempt: action.startNewRun,
    })),
  });
}

export function workflowSpecFromDocument(
  workflow: WorkflowDocument,
): WorkflowSpec {
  const workspace = workflow.workspace ?? {
    mode: defaultWorkspaceMode,
    prune_ttl_seconds: defaultWorkspacePruneTtlSeconds,
  };
  const hooks = workflow.hooks ?? {
    after_create: null,
    before_run: null,
    after_run: null,
    before_remove: null,
    timeout_ms: defaultHookTimeoutMs,
  };
  const harnesses = workflow.harnesses ?? {};
  const stages = workflow.stages ?? [];

  return WorkflowSpecSchema.parse({
    metadata: workflow.metadata,
    state: {
      initial: workflow.state.initial,
      terminal: workflow.state.terminal,
      onRun: workflow.state.on_attempt
        ? {
            completed: workflow.state.on_attempt.completed ?? null,
            failed: workflow.state.on_attempt.failed ?? null,
            canceled: workflow.state.on_attempt.canceled ?? null,
          }
        : undefined,
    },
    ingress: [
      ...(workflow.triggers ?? []).map((binding) => ({
        kind: "trigger" as const,
        id: binding.id,
        adapter: binding.adapter,
        config: binding.config,
      })),
      ...(workflow.sources ?? []).map((binding) => ({
        kind: "source" as const,
        id: binding.id,
        adapter: binding.adapter,
        config: binding.config,
      })),
    ],
    workspace: {
      mode: workspace.mode,
      pruneTtlSeconds: workspace.prune_ttl_seconds,
    },
    pipeline: {
      inputs: workflow.inputs?.map((input) => pipelineInputFromWorkflowInput(input)),
      hooks: {
        afterCreate: hooks.after_create ?? null,
        beforeRun: hooks.before_run ?? null,
        afterRun: hooks.after_run ?? null,
        beforeRemove: hooks.before_remove ?? null,
        timeoutMs: hooks.timeout_ms,
        env: hooks.env,
      },
      harnesses: Object.fromEntries(
        Object.entries(harnesses).map(([key, harness]) => {
          const retry = harness.retry ?? DEFAULT_HARNESS_RETRY;
          const cancel = harness.cancel ?? DEFAULT_HARNESS_CANCEL;
          return [
            key,
            {
              id: harness.id,
              auth: harness.auth,
              model: harness.model,
              effort: harness.effort,
              turnTimeoutMs:
                harness.turn_timeout_ms ?? defaultHarnessTurnTimeoutMs,
              stallTimeoutMs:
                harness.stall_timeout_ms ?? defaultHarnessStallTimeoutMs,
              config: harness.config ?? {},
              prepare: harness.prepare
                ? {
                    run: harness.prepare.run,
                    env: harness.prepare.env,
                    timeoutMs:
                      harness.prepare.timeout_ms ??
                      DEFAULT_HARNESS_PREPARE_TIMEOUT_MS,
                  }
                : undefined,
              retry: {
                maxRetries: retry.max_retries,
                baseDelayMs: retry.base_delay_ms,
                maxBackoffMs: retry.max_backoff_ms,
              },
              cancel: {
                gracefulTimeoutMs: cancel.graceful_timeout_ms,
                hardKillTimeoutMs: cancel.hard_kill_timeout_ms,
              },
            },
          ];
        }),
      ),
      stages: stages.map((stage) => ({
        id: stage.id,
        harness: stage.harness,
        prompt: stage.prompt,
        session: stage.session,
        gate: stage.gate
          ? {
              command: stage.gate.command,
              rejectTo: stage.gate.reject_to,
              maxCycles: stage.gate.max_cycles,
              timeoutMs: stage.gate.timeout_ms,
              env: stage.gate.env,
            }
          : undefined,
        hooks: stage.hooks
          ? {
              before: stage.hooks.before ?? null,
              after: stage.hooks.after ?? null,
              afterGate: stage.hooks.after_gate ?? null,
              timeoutMs: stage.hooks.timeout_ms,
              env: stage.hooks.env,
            }
          : undefined,
      })),
    },
    actions: workflow.actions?.map((action) => ({
      id: action.id,
      label: action.label,
      command: action.command,
      confirm: action.confirm,
      inputs: action.inputs,
      timeoutMs: action.timeout_ms,
      setState: action.set_state ?? null,
      startNewRun: action.start_new_attempt,
    })),
  });
}

function workflowInputFromPipelineInput(input: PipelineInput): WorkflowInput {
  if (!input.options) {
    return WorkflowInputSchema.parse({
      id: input.id,
      label: input.label,
      description: input.description ?? null,
      type: input.type,
      required: input.required,
    });
  }

  if ("values" in input.options) {
    return WorkflowInputSchema.parse({
      id: input.id,
      label: input.label,
      description: input.description ?? null,
      type: input.type,
      required: input.required,
      options: {
        values: input.options.values,
        default_value: input.options.defaultValue ?? null,
      },
    });
  }

  return WorkflowInputSchema.parse({
    id: input.id,
    label: input.label,
    description: input.description ?? null,
    type: input.type,
    required: input.required,
    options: {
      command: input.options.command,
      timeout_ms: input.options.timeoutMs,
    },
  });
}

function pipelineInputFromWorkflowInput(input: WorkflowInput): PipelineInput {
  if (input.type !== "select") {
    return PipelineInputSchema.parse({
      id: input.id,
      label: input.label,
      description: input.description ?? null,
      type: input.type,
      required: input.required,
    });
  }

  if ("values" in input.options) {
    return PipelineInputSchema.parse({
      id: input.id,
      label: input.label,
      description: input.description ?? null,
      type: input.type,
      required: input.required,
      options: {
        values: input.options.values,
        defaultValue: input.options.default_value ?? null,
      },
    });
  }

  return PipelineInputSchema.parse({
    id: input.id,
    label: input.label,
    description: input.description ?? null,
    type: input.type,
    required: input.required,
    options: {
      command: input.options.command,
      timeoutMs: input.options.timeout_ms,
    },
  });
}

export function isWorkflowEnabled(
  workflow: Pick<WorkflowDocument, "metadata"> | null | undefined,
): boolean {
  return workflow?.metadata?.enabled ?? true;
}

export function isWorkflowRunnableRecord(
  workflow:
    | Pick<
        WorkflowLoadRecord,
        "validity_status" | "availability_status" | "effective_workflow"
      >
    | null
    | undefined,
): boolean {
  return (
    workflow?.validity_status === "valid" &&
    workflow?.availability_status === "available" &&
    !!workflow.effective_workflow &&
    isWorkflowEnabled(workflow.effective_workflow)
  );
}

export function isWorkflowOwner(
  owner: Pick<ExecutionOwner, "kind"> | null | undefined,
): owner is Extract<ExecutionOwner, { kind: "workflow" }> {
  return owner?.kind === "workflow";
}

export function isWorkflowExecution(
  execution: Pick<Execution, "owner"> | null | undefined,
): execution is WorkflowExecution {
  return isWorkflowOwner(execution?.owner);
}

export function isWorkflowExecutionSummary(
  summary: ExecutionSummary | null | undefined,
): summary is WorkflowExecutionSummary {
  return isWorkflowExecution(summary?.execution);
}

export function isWorkflowExecutionDetail(
  detail: ExecutionDetail | null | undefined,
): detail is WorkflowExecutionDetail {
  return isWorkflowExecution(detail?.execution);
}

export function workflowIdForExecution(
  execution: Pick<Execution, "owner"> | null | undefined,
): string | null {
  return execution?.owner.kind === "workflow" ? execution.owner.id : null;
}

export function workflowIdForTrigger(
  trigger: Pick<TriggerEvent, "owner"> | null | undefined,
): string | null {
  return trigger?.owner.kind === "workflow" ? trigger.owner.id : null;
}

export function describeWorkflowStateSemantics(
  workflow: WorkflowDocument,
  state: string,
): WorkflowStateSemantics {
  return {
    state,
    isInitial: workflow.state.initial === state,
    isTerminal: workflow.state.terminal.includes(state),
    fromAttemptCompleted: workflow.state.on_attempt?.completed === state,
    fromAttemptFailed: workflow.state.on_attempt?.failed === state,
    fromAttemptCanceled: workflow.state.on_attempt?.canceled === state,
    actionTargets: (workflow.actions ?? [])
      .filter((action) => action.set_state === state)
      .map((action) => ({
        id: action.id,
        label: action.label,
        startNewAttempt: action.start_new_attempt,
      })),
  };
}

export function collectWorkflowStateVocabulary(
  workflow: WorkflowDocument,
): string[] {
  const terminalStates = new Set(workflow.state.terminal);
  const values = new Set<string>();
  const orderedStates: string[] = [];

  // Keep the board readable as a lifecycle: initial, then active/review states, then terminal outcomes.
  const appendState = (
    state: string | null | undefined,
    deferTerminal = false,
  ): void => {
    if (!state || values.has(state)) {
      return;
    }

    if (
      deferTerminal &&
      terminalStates.has(state) &&
      state !== workflow.state.initial
    ) {
      return;
    }

    values.add(state);
    orderedStates.push(state);
  };

  appendState(workflow.state.initial);

  appendState(workflow.state.on_attempt?.completed, true);
  appendState(workflow.state.on_attempt?.failed, true);
  appendState(workflow.state.on_attempt?.canceled, true);

  for (const action of workflow.actions ?? []) {
    appendState(action.set_state, true);
  }

  for (const state of workflow.state.terminal) {
    appendState(state);
  }

  return orderedStates;
}

export function isAttemptTerminal(state: AttemptState): boolean {
  return state === "completed" || state === "failed" || state === "canceled";
}

export function isAttemptActive(state: AttemptState): boolean {
  return !isAttemptTerminal(state);
}

export type WorkflowValidationSource =
  | "yaml"
  | "schema"
  | "semantic"
  | "collection";
export type WorkflowValidationPath = Array<string | number>;

export interface WorkflowValidationPosition {
  line: number;
  column: number;
  offset: number;
}

export interface WorkflowValidationRange {
  start: WorkflowValidationPosition;
  end: WorkflowValidationPosition;
}

export interface WorkflowValidationDiagnostic {
  source: WorkflowValidationSource;
  code: string;
  path: WorkflowValidationPath;
  message: string;
  file_path?: string;
  workflow_id?: string;
  range?: WorkflowValidationRange;
}

export interface WorkflowSourceValidationResult {
  document: unknown | null;
  authored_workflow: AuthoredWorkflowDocument | null;
  workflow: WorkflowDocument | null;
  validation_error: string | null;
}

export interface WorkflowSourceValidationDetailedResult {
  file_path?: string;
  document: unknown | null;
  authored_workflow: AuthoredWorkflowDocument | null;
  workflow: WorkflowDocument | null;
  workflow_id: string | null;
  diagnostics: WorkflowValidationDiagnostic[];
  valid: boolean;
  validity_status: WorkflowValidityStatus;
  availability_status: WorkflowAvailabilityStatus;
  availability_errors: string[];
}

export interface WorkflowValidationSourceInput {
  file_path: string;
  source_yaml: string;
}

export interface WorkflowCollectionValidationResult {
  files: WorkflowSourceValidationDetailedResult[];
  diagnostics: WorkflowValidationDiagnostic[];
  valid: boolean;
}

export interface ParsedWorkflowSource {
  document: unknown;
  workflow: WorkflowDocument;
}

export interface ParsedAuthoredWorkflowSource {
  document: unknown;
  authored_workflow: AuthoredWorkflowDocument;
}

const workflowYamlStringifyOptions = {
  indent: 2,
  lineWidth: 0,
  nullStr: "null",
} as const;

export function stripWorkflowExtensionKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripWorkflowExtensionKeys);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("x-"))
        .map(([key, child]) => [key, stripWorkflowExtensionKeys(child)]),
    );
  }

  return value;
}

export function stringifyWorkflowYaml(document: unknown): string {
  return YAML.stringify(
    canonicalizeWorkflowYamlDocument(document),
    workflowYamlStringifyOptions,
  );
}

function canonicalizeWorkflowYamlDocument(document: unknown): unknown {
  if (!isPlainRecord(document)) {
    return document;
  }

  const canonicalDocument: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(document)) {
    switch (key) {
      case "metadata": {
        const metadata = canonicalizeWorkflowMetadata(value);
        if (metadata) {
          canonicalDocument[key] = metadata;
        }
        break;
      }
      case "state":
        canonicalDocument[key] = canonicalizeWorkflowState(value);
        break;
      case "inputs": {
        const inputs = canonicalizeWorkflowInputs(value);
        if (inputs !== undefined) {
          canonicalDocument[key] = inputs;
        }
        break;
      }
      case "triggers": {
        const triggers = canonicalizeWorkflowTriggers(value);
        if (triggers !== undefined) {
          canonicalDocument[key] = triggers;
        }
        break;
      }
      case "ingress": {
        const ingress = canonicalizeWorkflowIngress(value);
        if (ingress !== undefined) {
          canonicalDocument[key] = ingress;
        }
        break;
      }
      case "sources": {
        const sources = canonicalizeWorkflowSources(value);
        if (sources !== undefined) {
          canonicalDocument[key] = sources;
        }
        break;
      }
      case "workspace":
        canonicalDocument[key] = canonicalizeWorkflowWorkspace(value);
        break;
      case "hooks":
        canonicalDocument[key] = canonicalizeWorkflowHooks(value);
        break;
      case "pipeline":
        canonicalDocument[key] = canonicalizePipelineSpec(value);
        break;
      case "harnesses": {
        const harnesses = canonicalizeWorkflowHarnesses(value);
        if (harnesses !== undefined) {
          canonicalDocument[key] = harnesses;
        }
        break;
      }
      case "stages":
        canonicalDocument[key] = canonicalizeWorkflowStages(value);
        break;
      case "actions": {
        const actions = canonicalizeWorkflowActions(value);
        if (actions !== undefined) {
          canonicalDocument[key] = actions;
        }
        break;
      }
      default:
        canonicalDocument[key] = canonicalizeJsonValue(value);
        break;
    }
  }

  return canonicalDocument;
}

function canonicalizeWorkflowMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  const metadata = canonicalizeRecord(value);
  if (!metadata) {
    return undefined;
  }

  if (metadata.enabled === true) {
    delete metadata.enabled;
  }
  if (metadata.description == null) {
    delete metadata.description;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function canonicalizeWorkflowState(value: unknown): unknown {
  const state = canonicalizeRecord(value);
  if (!state) {
    return canonicalizeJsonValue(value);
  }

  const onRun = canonicalizeRecord(state.onRun);
  if (onRun) {
    if (onRun.completed == null) {
      delete onRun.completed;
    }
    if (onRun.failed == null) {
      delete onRun.failed;
    }
    if (onRun.canceled == null) {
      delete onRun.canceled;
    }
    if (Object.keys(onRun).length > 0) {
      state.onRun = onRun;
    } else {
      delete state.onRun;
    }
  }

  const onAttempt = canonicalizeRecord(state.on_attempt);
  if (onAttempt) {
    if (onAttempt.completed == null) {
      delete onAttempt.completed;
    }
    if (onAttempt.failed == null) {
      delete onAttempt.failed;
    }
    if (onAttempt.canceled == null) {
      delete onAttempt.canceled;
    }
    if (Object.keys(onAttempt).length > 0) {
      state.on_attempt = onAttempt;
    } else {
      delete state.on_attempt;
    }
  }

  return state;
}

function canonicalizeWorkflowIngress(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((binding) => {
    const canonicalBinding = canonicalizeRecord(binding);
    if (!canonicalBinding) {
      return canonicalizeJsonValue(binding);
    }

    if (isEmptyRecord(canonicalBinding.config)) {
      delete canonicalBinding.config;
    }

    return canonicalBinding;
  });
}

function canonicalizeWorkflowInputs(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((input) => {
    const canonicalInput = canonicalizeRecord(input);
    if (!canonicalInput) {
      return canonicalizeJsonValue(input);
    }

    if (canonicalInput.description == null) {
      delete canonicalInput.description;
    }
    if (canonicalInput.required === false) {
      delete canonicalInput.required;
    }

    const options = canonicalizeRecord(canonicalInput.options);
    if (options && "command" in options && options.timeout_ms === defaultInputCommandTimeoutMs) {
      delete options.timeout_ms;
      canonicalInput.options = options;
    }

    return canonicalInput;
  });
}

function canonicalizeWorkflowTriggers(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((binding) => {
    const canonicalBinding = canonicalizeRecord(binding);
    if (!canonicalBinding) {
      return canonicalizeJsonValue(binding);
    }

    if (isEmptyRecord(canonicalBinding.config)) {
      delete canonicalBinding.config;
    }

    return canonicalBinding;
  });
}

function canonicalizeWorkflowSources(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((binding) => {
    const canonicalBinding = canonicalizeRecord(binding);
    if (!canonicalBinding) {
      return canonicalizeJsonValue(binding);
    }

    if (isEmptyRecord(canonicalBinding.config)) {
      delete canonicalBinding.config;
    }

    return canonicalBinding;
  });
}

function canonicalizeWorkflowWorkspace(value: unknown): unknown {
  const workspace = canonicalizeRecord(value);
  if (!workspace) {
    return canonicalizeJsonValue(value);
  }

  if (workspace.mode === defaultWorkspaceMode) {
    delete workspace.mode;
  }
  if (workspace.pruneTtlSeconds === defaultWorkspacePruneTtlSeconds) {
    delete workspace.pruneTtlSeconds;
  }
  if (workspace.prune_ttl_seconds === defaultWorkspacePruneTtlSeconds) {
    delete workspace.prune_ttl_seconds;
  }

  return workspace;
}

function canonicalizeWorkflowHooks(value: unknown): unknown {
  const hooks = canonicalizeRecord(value);
  if (!hooks) {
    return canonicalizeJsonValue(value);
  }

  if (hooks.afterCreate == null) {
    delete hooks.afterCreate;
  }
  if (hooks.beforeRun == null) {
    delete hooks.beforeRun;
  }
  if (hooks.afterRun == null) {
    delete hooks.afterRun;
  }
  if (hooks.beforeRemove == null) {
    delete hooks.beforeRemove;
  }
  if (hooks.timeoutMs === defaultHookTimeoutMs) {
    delete hooks.timeoutMs;
  }
  if (hooks.after_create == null) {
    delete hooks.after_create;
  }
  if (hooks.before_run == null) {
    delete hooks.before_run;
  }
  if (hooks.after_run == null) {
    delete hooks.after_run;
  }
  if (hooks.before_remove == null) {
    delete hooks.before_remove;
  }
  if (hooks.timeout_ms === defaultHookTimeoutMs) {
    delete hooks.timeout_ms;
  }
  if (isEmptyRecord(hooks.env)) {
    delete hooks.env;
  }

  return hooks;
}

function canonicalizePipelineSpec(value: unknown): unknown {
  const pipeline = canonicalizeRecord(value);
  if (!pipeline) {
    return canonicalizeJsonValue(value);
  }

  if (pipeline.metadata) {
    const metadata = canonicalizeWorkflowMetadata(pipeline.metadata);
    if (metadata) {
      pipeline.metadata = metadata;
    } else {
      delete pipeline.metadata;
    }
  }

  const inputs = canonicalizePipelineInputs(pipeline.inputs);
  if (inputs !== undefined) {
    pipeline.inputs = inputs;
  } else {
    delete pipeline.inputs;
  }

  pipeline.hooks = canonicalizePipelineHooks(pipeline.hooks);

  const harnesses = canonicalizePipelineHarnesses(pipeline.harnesses);
  if (harnesses !== undefined) {
    pipeline.harnesses = harnesses;
  } else {
    delete pipeline.harnesses;
  }

  pipeline.stages = canonicalizePipelineStages(pipeline.stages);
  return pipeline;
}

function canonicalizePipelineInputs(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((input) => {
    const canonicalInput = canonicalizeRecord(input);
    if (!canonicalInput) {
      return canonicalizeJsonValue(input);
    }

    if (canonicalInput.description == null) {
      delete canonicalInput.description;
    }
    if (canonicalInput.required === false) {
      delete canonicalInput.required;
    }

    const options = canonicalizeRecord(canonicalInput.options);
    if (options && "command" in options && options.timeoutMs === defaultInputCommandTimeoutMs) {
      delete options.timeoutMs;
      canonicalInput.options = options;
    }

    return canonicalInput;
  });
}

function canonicalizePipelineHooks(value: unknown): unknown {
  const hooks = canonicalizeRecord(value);
  if (!hooks) {
    return {};
  }

  if (hooks.afterCreate == null) {
    delete hooks.afterCreate;
  }
  if (hooks.beforeRun == null) {
    delete hooks.beforeRun;
  }
  if (hooks.afterRun == null) {
    delete hooks.afterRun;
  }
  if (hooks.beforeRemove == null) {
    delete hooks.beforeRemove;
  }
  if (hooks.timeoutMs === defaultHookTimeoutMs) {
    delete hooks.timeoutMs;
  }
  if (isEmptyRecord(hooks.env)) {
    delete hooks.env;
  }

  return hooks;
}

function canonicalizePipelineHarnesses(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const harnesses = Object.fromEntries(
    Object.entries(value).map(([key, harness]) => [
      key,
      canonicalizePipelineHarness(harness) ?? canonicalizeJsonValue(harness),
    ]),
  );

  return Object.keys(harnesses).length > 0 ? harnesses : undefined;
}

function canonicalizePipelineStages(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return canonicalizeJsonValue(value);
  }

  return value.map((stage) => {
    const canonicalStage = canonicalizeRecord(stage);
    if (!canonicalStage) {
      return canonicalizeJsonValue(stage);
    }

    if (canonicalStage.session === defaultStageSession) {
      delete canonicalStage.session;
    }

    const gate = canonicalizeRecord(canonicalStage.gate);
    if (gate) {
      if (gate.timeoutMs === 10_000) {
        delete gate.timeoutMs;
      }
      if (isEmptyRecord(gate.env)) {
        delete gate.env;
      }
      canonicalStage.gate = gate;
    } else {
      delete canonicalStage.gate;
    }

    const hooks = canonicalizeRecord(canonicalStage.hooks);
    if (hooks) {
      if (hooks.before == null) {
        delete hooks.before;
      }
      if (hooks.after == null) {
        delete hooks.after;
      }
      if (hooks.afterGate == null) {
        delete hooks.afterGate;
      }
      if (hooks.timeoutMs == null) {
        delete hooks.timeoutMs;
      }
      if (isEmptyRecord(hooks.env)) {
        delete hooks.env;
      }
      canonicalStage.hooks = hooks;
    } else {
      delete canonicalStage.hooks;
    }

    return canonicalStage;
  });
}

function canonicalizeWorkflowHarnesses(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const harnesses = Object.fromEntries(
    Object.entries(value).map(([key, harness]) => [
      key,
      canonicalizeWorkflowHarness(harness) ?? canonicalizeJsonValue(harness),
    ]),
  );

  return Object.keys(harnesses).length > 0 ? harnesses : undefined;
}

function canonicalizeWorkflowStages(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return canonicalizeJsonValue(value);
  }

  return value.map((stage) => {
    const canonicalStage = canonicalizeRecord(stage);
    if (!canonicalStage) {
      return canonicalizeJsonValue(stage);
    }

    if (canonicalStage.session === defaultStageSession) {
      delete canonicalStage.session;
    }
    if (canonicalStage.gate == null) {
      delete canonicalStage.gate;
    }

    return canonicalStage;
  });
}

function canonicalizeWorkflowActions(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }

  return value.map((action) => {
    const canonicalAction = canonicalizeRecord(action);
    if (!canonicalAction) {
      return canonicalizeJsonValue(action);
    }

    if (canonicalAction.confirm === false) {
      delete canonicalAction.confirm;
    }
    if (canonicalAction.timeoutMs === defaultActionTimeoutMs) {
      delete canonicalAction.timeoutMs;
    }
    if (canonicalAction.startNewRun === false) {
      delete canonicalAction.startNewRun;
    }
    if (canonicalAction.timeout_ms === defaultActionTimeoutMs) {
      delete canonicalAction.timeout_ms;
    }
    if (canonicalAction.start_new_attempt === false) {
      delete canonicalAction.start_new_attempt;
    }

    return canonicalAction;
  });
}

function canonicalizeWorkflowHarness(
  value: unknown,
): Record<string, unknown> | undefined {
  const harness = canonicalizeRecord(value);
  if (!harness) {
    return undefined;
  }

  if (harness.turn_timeout_ms === defaultHarnessTurnTimeoutMs) {
    delete harness.turn_timeout_ms;
  }
  if (harness.stall_timeout_ms === defaultHarnessStallTimeoutMs) {
    delete harness.stall_timeout_ms;
  }
  if (isEmptyRecord(harness.config)) {
    delete harness.config;
  }

  const retry = canonicalizeRecord(harness.retry);
  if (retry && recordMatchesDefaults(retry, DEFAULT_HARNESS_RETRY)) {
    delete harness.retry;
  }

  const cancel = canonicalizeRecord(harness.cancel);
  if (cancel && recordMatchesDefaults(cancel, DEFAULT_HARNESS_CANCEL)) {
    delete harness.cancel;
  }

  return harness;
}

function canonicalizePipelineHarness(
  value: unknown,
): Record<string, unknown> | undefined {
  const harness = canonicalizeRecord(value);
  if (!harness) {
    return undefined;
  }

  if (harness.turnTimeoutMs === defaultHarnessTurnTimeoutMs) {
    delete harness.turnTimeoutMs;
  }
  if (harness.stallTimeoutMs === defaultHarnessStallTimeoutMs) {
    delete harness.stallTimeoutMs;
  }
  if (isEmptyRecord(harness.config)) {
    delete harness.config;
  }

  const prepare = canonicalizeRecord(harness.prepare);
  if (prepare) {
    if (prepare.timeoutMs === DEFAULT_HARNESS_PREPARE_TIMEOUT_MS) {
      delete prepare.timeoutMs;
    }
    if (isEmptyRecord(prepare.env)) {
      delete prepare.env;
    }
    harness.prepare = prepare;
  }

  const retry = canonicalizeRecord(harness.retry);
  if (
    retry &&
    recordMatchesDefaults(retry, {
      maxRetries: DEFAULT_HARNESS_RETRY.max_retries,
      baseDelayMs: DEFAULT_HARNESS_RETRY.base_delay_ms,
      maxBackoffMs: DEFAULT_HARNESS_RETRY.max_backoff_ms,
    })
  ) {
    delete harness.retry;
  }

  const cancel = canonicalizeRecord(harness.cancel);
  if (
    cancel &&
    recordMatchesDefaults(cancel, {
      gracefulTimeoutMs: DEFAULT_HARNESS_CANCEL.graceful_timeout_ms,
      hardKillTimeoutMs: DEFAULT_HARNESS_CANCEL.hard_kill_timeout_ms,
    })
  ) {
    delete harness.cancel;
  }

  return harness;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  return canonicalizeRecord(value);
}

function canonicalizeRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) {
      continue;
    }
    record[key] = canonicalizeJsonValue(child);
  }
  return record;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEmptyRecord(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function recordMatchesDefaults(
  value: Record<string, unknown>,
  defaults: Record<string, unknown>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === Object.keys(defaults).length &&
    keys.every((key) => value[key] === defaults[key])
  );
}

export function validateWorkflowSourceYamlDetailed(
  sourceYaml: string,
  options?: { filePath?: string },
): WorkflowSourceValidationDetailedResult {
  return toPublicWorkflowValidationResult(
    validateWorkflowSourceYamlDetailedInternal(sourceYaml, options),
  );
}

export function validateWorkflowSources(
  inputs: readonly WorkflowValidationSourceInput[],
): WorkflowCollectionValidationResult {
  const internalFiles = inputs.map((input) =>
    validateWorkflowSourceYamlDetailedInternal(input.source_yaml, {
      filePath: input.file_path,
    }),
  );
  const diagnostics: WorkflowValidationDiagnostic[] = [];
  const firstFileByWorkflowId = new Map<
    string,
    WorkflowSourceValidationDetailedInternalResult
  >();

  for (const file of internalFiles) {
    if (!file.authored_workflow || !file.workflow_id) {
      continue;
    }

    const first = firstFileByWorkflowId.get(file.workflow_id);
    if (!first) {
      firstFileByWorkflowId.set(file.workflow_id, file);
      continue;
    }

    const diagnostic: WorkflowValidationDiagnostic = {
      source: "collection",
      code: "duplicate_workflow_id",
      path: file.authored_workflow.metadata?.id ? ["metadata", "id"] : [],
      message: `duplicate workflow id "${file.workflow_id}" also declared in ${first.file_path ?? "<unknown>"}`,
      file_path: file.file_path,
      workflow_id: file.workflow_id,
      range: file.authored_workflow.metadata?.id
        ? findWorkflowPathRange(file, ["metadata", "id"])
        : undefined,
    };

    file.diagnostics.push(diagnostic);
    file.valid = false;
    file.validity_status = "invalid";
    diagnostics.push(diagnostic);
  }

  return {
    files: internalFiles.map(toPublicWorkflowValidationResult),
    diagnostics,
    valid:
      internalFiles.every((file) => file.valid) && diagnostics.length === 0,
  };
}

export function formatWorkflowValidationDiagnostics(
  diagnostics: readonly WorkflowValidationDiagnostic[],
): string {
  return diagnostics
    .map((diagnostic) => {
      if (diagnostic.path.length === 0) {
        return diagnostic.message;
      }
      return `${formatWorkflowValidationPath(diagnostic.path)}: ${diagnostic.message}`;
    })
    .join("; ");
}

export function validateWorkflowSourceYaml(
  sourceYaml: string,
): WorkflowSourceValidationResult {
  const result = validateWorkflowSourceYamlDetailed(sourceYaml);
  return {
    document: result.document,
    authored_workflow: result.authored_workflow,
    workflow: result.workflow,
    validation_error: result.valid
      ? null
      : formatWorkflowValidationDiagnostics(result.diagnostics),
  };
}

export function parseAuthoredWorkflowSourceYaml(
  sourceYaml: string,
  options?: { contextLabel?: string },
): ParsedAuthoredWorkflowSource {
  const result = validateWorkflowSourceYamlDetailed(sourceYaml, {
    filePath: options?.contextLabel,
  });

  if (!result.authored_workflow || !result.valid || result.document === null) {
    const message =
      formatWorkflowValidationDiagnostics(result.diagnostics) ||
      "Workflow validation failed.";
    if (
      hasWorkflowYamlDiagnostic(result.diagnostics) ||
      !options?.contextLabel
    ) {
      throw new Error(message);
    }
    throw new Error(
      `Workflow validation failed for ${options.contextLabel}: ${message}`,
    );
  }

  return {
    document: result.document,
    authored_workflow: result.authored_workflow,
  };
}

export function parseWorkflowSourceYaml(
  sourceYaml: string,
  options?: { contextLabel?: string },
): ParsedWorkflowSource {
  const result = validateWorkflowSourceYamlDetailed(sourceYaml, {
    filePath: options?.contextLabel,
  });

  if (!result.workflow || !result.valid || result.document === null) {
    const message =
      formatWorkflowValidationDiagnostics(result.diagnostics) ||
      "Workflow validation failed.";
    if (
      hasWorkflowYamlDiagnostic(result.diagnostics) ||
      !options?.contextLabel
    ) {
      throw new Error(message);
    }
    throw new Error(
      `Workflow validation failed for ${options.contextLabel}: ${message}`,
    );
  }

  return {
    document: result.document,
    workflow: result.workflow,
  };
}

interface WorkflowSourceValidationDetailedInternalResult extends WorkflowSourceValidationDetailedResult {
  lineCounter: LineCounter | null;
  yamlDocument: YAML.Document | null;
}

function validateWorkflowSourceYamlDetailedInternal(
  sourceYaml: string,
  options?: { filePath?: string },
): WorkflowSourceValidationDetailedInternalResult {
  const lineCounter = new LineCounter();
  const yamlDocument = YAML.parseDocument(sourceYaml, {
    lineCounter,
    prettyErrors: true,
  });

  if (yamlDocument.errors.length > 0) {
    const diagnostics = yamlDocument.errors.map((error) =>
      toYamlDiagnostic(error, lineCounter, options?.filePath),
    );
    return {
      file_path: options?.filePath,
      document: null,
      authored_workflow: null,
      workflow: null,
      workflow_id: fileStemFromPath(options?.filePath) ?? null,
      diagnostics,
      valid: false,
      validity_status: "invalid",
      availability_status: "unchecked",
      availability_errors: [],
      lineCounter,
      yamlDocument: null,
    };
  }

  const document = yamlDocument.toJS();
  const workflowId = deriveWorkflowIdFromDocument(document, options?.filePath);
  const strippedDocument = stripWorkflowExtensionKeys(document);
  const result = WorkflowSpecSchema.safeParse(strippedDocument);

  if (!result.success) {
    const diagnostics = result.error.issues.flatMap((issue) =>
      toZodDiagnostics(
        issue,
        yamlDocument,
        lineCounter,
        workflowId,
        options?.filePath,
      ),
    );

    return {
      file_path: options?.filePath,
      document,
      authored_workflow: null,
      workflow: null,
      workflow_id: workflowId,
      diagnostics,
      valid: false,
      validity_status: "invalid",
      availability_status: "unchecked",
      availability_errors: [],
      lineCounter,
      yamlDocument,
    };
  }

  const authoredWorkflow = result.data;
  let workflow: WorkflowDocument | null = null;
  try {
    workflow = workflowDocumentFromSpec(authoredWorkflow as WorkflowSpec);
  } catch (error) {
    return {
      file_path: options?.filePath,
      document,
      authored_workflow: authoredWorkflow,
      workflow: null,
      workflow_id: workflowId,
      diagnostics: [
        {
          source: "schema",
          code: "workflow_compile_failed",
          path: [],
          message:
            error instanceof Error ? error.message : String(error),
          file_path: options?.filePath,
          workflow_id: workflowId ?? undefined,
        },
      ],
      valid: false,
      validity_status: "invalid",
      availability_status: "unchecked",
      availability_errors: [],
      lineCounter,
      yamlDocument,
    };
  }
  return {
    file_path: options?.filePath,
    document,
    authored_workflow: authoredWorkflow,
    workflow,
    workflow_id:
      authoredWorkflow.metadata?.id ??
      fileStemFromPath(options?.filePath) ??
      null,
    diagnostics: [],
    valid: true,
    validity_status: "valid",
    availability_status: "unchecked",
    availability_errors: [],
    lineCounter,
    yamlDocument,
  };
}

function toPublicWorkflowValidationResult(
  result: WorkflowSourceValidationDetailedInternalResult,
): WorkflowSourceValidationDetailedResult {
  return {
    file_path: result.file_path,
    document: result.document,
    authored_workflow: result.authored_workflow,
    workflow: result.workflow,
    workflow_id: result.workflow_id,
    diagnostics: result.diagnostics,
    valid: result.valid,
    validity_status: result.validity_status,
    availability_status: result.availability_status,
    availability_errors: result.availability_errors,
  };
}

function toYamlDiagnostic(
  error: YAMLError,
  lineCounter: LineCounter,
  filePath?: string,
): WorkflowValidationDiagnostic {
  return {
    source: "yaml",
    code: error.code,
    path: [],
    message: error.message,
    file_path: filePath,
    workflow_id: fileStemFromPath(filePath) ?? undefined,
    range: toYamlErrorRange(error, lineCounter),
  };
}

function toZodDiagnostics(
  issue: z.ZodIssue,
  yamlDocument: YAML.Document,
  lineCounter: LineCounter,
  workflowId: string | null,
  filePath?: string,
  pathPrefix: WorkflowValidationPath = [],
): WorkflowValidationDiagnostic[] {
  if (issue.code === "unrecognized_keys") {
    const basePath = [
      ...pathPrefix,
      ...normalizeWorkflowValidationPath(issue.path),
    ];
    return issue.keys.map((key) => {
      const path = [...basePath, String(key)];
      const isRemovedWorkspaceRoot =
        basePath.length === 1 && basePath[0] === "workspace" && key === "root";
      return {
        source: "schema",
        code: isRemovedWorkspaceRoot ? "workspace_root_removed" : issue.code,
        path,
        message: isRemovedWorkspaceRoot
          ? "workspace.root has been removed; Flow now manages execution workspace locations outside the project root. Remove workspace.root and keep only workspace.prune_ttl_seconds."
          : `Unrecognized key: "${key}"`,
        file_path: filePath,
        workflow_id: workflowId ?? undefined,
        range: findWorkflowPathRangeFromDocument(
          yamlDocument,
          lineCounter,
          path,
        ),
      };
    });
  }

  const source = issue.code === "custom" ? "semantic" : "schema";
  const code =
    issue.code === "custom"
      ? String(issue.params?.workflow_rule ?? "custom")
      : issue.code;
  const path = [...pathPrefix, ...normalizeWorkflowValidationPath(issue.path)];

  return [
    {
      source,
      code,
      path,
      message: issue.message,
      file_path: filePath,
      workflow_id: workflowId ?? undefined,
      range: findWorkflowPathRangeFromDocument(yamlDocument, lineCounter, path),
    },
  ];
}

function findWorkflowPathRange(
  result: WorkflowSourceValidationDetailedInternalResult,
  path: WorkflowValidationPath,
): WorkflowValidationRange | undefined {
  if (!result.yamlDocument || !result.lineCounter) {
    return undefined;
  }
  return findWorkflowPathRangeFromDocument(
    result.yamlDocument,
    result.lineCounter,
    path,
  );
}

function findWorkflowPathRangeFromDocument(
  yamlDocument: YAML.Document,
  lineCounter: LineCounter,
  path: WorkflowValidationPath,
): WorkflowValidationRange | undefined {
  let currentPath = [...path];

  while (true) {
    const target =
      currentPath.length === 0
        ? yamlDocument.contents
        : yamlDocument.getIn(currentPath, true);
    const range = extractWorkflowNodeRange(target);
    if (range) {
      return toWorkflowValidationRange(range[0], range[2], lineCounter);
    }

    if (currentPath.length === 0) {
      return undefined;
    }

    currentPath = currentPath.slice(0, -1);
  }
}

function extractWorkflowNodeRange(
  node: unknown,
): [number, number, number] | null {
  if (!node || typeof node !== "object" || !("range" in node)) {
    return null;
  }

  const range = (node as { range?: unknown }).range;
  if (!Array.isArray(range) || range.length < 3) {
    return null;
  }

  const [start, valueEnd, nodeEnd] = range;
  if (
    typeof start !== "number" ||
    typeof valueEnd !== "number" ||
    typeof nodeEnd !== "number"
  ) {
    return null;
  }

  return [start, valueEnd, nodeEnd];
}

function toYamlErrorRange(
  error: YAMLError,
  lineCounter: LineCounter,
): WorkflowValidationRange | undefined {
  const [start, end] = error.pos;
  return toWorkflowValidationRange(start, end, lineCounter);
}

function toWorkflowValidationRange(
  startOffset: number,
  endOffset: number,
  lineCounter: LineCounter,
): WorkflowValidationRange {
  const safeEndOffset = endOffset > startOffset ? endOffset : startOffset + 1;
  return {
    start: toWorkflowValidationPosition(startOffset, lineCounter),
    end: toWorkflowValidationPosition(safeEndOffset, lineCounter),
  };
}

function toWorkflowValidationPosition(
  offset: number,
  lineCounter: LineCounter,
): WorkflowValidationPosition {
  const position = lineCounter.linePos(offset);
  if (position.line === 0) {
    return {
      line: 1,
      column: offset + 1,
      offset,
    };
  }

  return {
    line: position.line,
    column: position.col,
    offset,
  };
}

function deriveWorkflowIdFromDocument(
  document: unknown,
  filePath?: string,
): string | null {
  const metadata = asRecord(document)?.["metadata"];
  const metadataRecord = asRecord(metadata);
  if (
    metadataRecord &&
    typeof metadataRecord["id"] === "string" &&
    metadataRecord["id"].trim().length > 0
  ) {
    return metadataRecord["id"];
  }

  return fileStemFromPath(filePath) ?? null;
}

export function normalizeWorkflowIdFromName(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || "workflow";
}

function fileStemFromPath(filePath: string | undefined): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const fileName =
    lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  if (!fileName.endsWith(".yaml")) {
    return fileName || null;
  }

  const stem = fileName.slice(0, -".yaml".length);
  return stem || null;
}

function formatWorkflowValidationPath(path: WorkflowValidationPath): string {
  return (
    path
      .map((segment) =>
        typeof segment === "number" ? String(segment) : segment,
      )
      .join(".") || "<root>"
  );
}

function normalizeWorkflowValidationPath(
  path: readonly PropertyKey[],
): WorkflowValidationPath {
  return path.map((segment) =>
    typeof segment === "number" ? segment : String(segment),
  );
}

function hasWorkflowYamlDiagnostic(
  diagnostics: readonly WorkflowValidationDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.source === "yaml");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
