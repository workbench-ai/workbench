"use client";

import {
  useState,
} from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
} from "lucide-react";

import type {
  WorkbenchActionCapabilities,
  WorkbenchAcquisitionOption,
  WorkbenchOperationCapability,
  WorkbenchOperationRequest,
  WorkbenchRunSnapshot,
} from "@workbench-ai/workbench-contract";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import { Input } from "@workbench-ai/cli-web-ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/popover";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { startWorkbenchOperation } from "../lib/operations";

export function WorkbenchActionBar({
  actions,
  apiBasePath,
  onOperationStarted,
}: {
  actions: WorkbenchActionCapabilities;
  apiBasePath: string;
  onOperationStarted: (started: WorkbenchRunSnapshot) => void;
}) {
  const sourceOnly = actions.evidenceAccess === "source";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {!sourceOnly ? (
        <>
          {actions.run.enabled ? (
            <OperationPopover
              apiBasePath={apiBasePath}
              capability={actions.run}
              onOperationStarted={onOperationStarted}
              title="Run"
            />
          ) : null}
          {actions.grade.enabled ? (
            <OperationPopover
              apiBasePath={apiBasePath}
              capability={actions.grade}
              onOperationStarted={onOperationStarted}
              title="Grade"
            />
          ) : null}
          <OperationPopover
            apiBasePath={apiBasePath}
            capability={actions.improve}
            fallbackOperation={actions.eval}
            onOperationStarted={onOperationStarted}
            title="Improve"
          />
          <OperationPopover
            apiBasePath={apiBasePath}
            buttonVariant="default"
            capability={actions.eval}
            onOperationStarted={onOperationStarted}
            title="Evaluate"
          />
        </>
      ) : null}
      <UseSkillPopover
        acquisition={actions.acquisition}
        primary={sourceOnly}
      />
    </div>
  );
}

function OperationPopover({
  apiBasePath,
  buttonVariant = "outline",
  capability,
  fallbackOperation,
  onOperationStarted,
  title,
}: {
  apiBasePath: string;
  buttonVariant?: "default" | "outline";
  capability: WorkbenchOperationCapability;
  fallbackOperation?: WorkbenchOperationCapability;
  onOperationStarted: (started: WorkbenchRunSnapshot) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState(String(capability.defaultRequest.samples ?? 1));
  const [budget, setBudget] = useState(String(capability.defaultRequest.budget ?? 1));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !capability.enabled;
  const request = requestWithFormValues(capability.defaultRequest, samples, budget);

  const submit = async (nextRequest: WorkbenchOperationRequest) => {
    setPending(true);
    setError(null);
    try {
      const started = await startWorkbenchOperation(apiBasePath, nextRequest);
      setOpen(false);
      onOperationStarted(started);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant={buttonVariant} size="sm">
          {title}
          <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{operationDescription(capability.defaultRequest)}</PopoverDescription>
        </PopoverHeader>
        <div className="grid min-w-0 gap-3">
          <OperationSummary request={capability.defaultRequest} />
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
            Samples
            <Input
              min={1}
              type="number"
              value={samples}
              onChange={(event) => setSamples(event.target.value)}
            />
          </label>
          {capability.defaultRequest.kind === "improve" ? (
            <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
              Budget
              <Input
                min={1}
                type="number"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
          ) : null}
          {disabled ? (
            <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {capability.disabledReason ?? `${title} is not available for this skill.`}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}
          <Button
            type="button"
            variant={buttonVariant}
            disabled={disabled || pending}
            onClick={() => void submit(request)}
          >
            {pending ? "Starting..." : `Start ${title.toLowerCase()}`}
          </Button>
          {disabled && fallbackOperation?.enabled ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void submit(fallbackOperation.defaultRequest)}
            >
              Start evaluation first
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OperationSummary({ request }: { request: WorkbenchOperationRequest }) {
  const items = [
    request.versionId ? ["Version", request.versionId] : null,
    request.evalHash ? ["Evaluation", request.evalHash] : null,
    request.skill ? ["Skill", request.skill] : null,
    request.agent ? ["Agent", request.agent] : null,
  ].filter((entry): entry is [string, string] => Boolean(entry));
  if (items.length === 0) {
    return null;
  }
  return (
    <dl className="grid min-w-0 gap-1 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      {items.map(([label, value]) => (
        <div key={label} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs leading-5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate font-mono text-foreground" title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UseSkillPopover({
  acquisition,
  primary,
}: {
  acquisition: readonly WorkbenchAcquisitionOption[];
  primary: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={primary ? "default" : "outline"} size="sm">
          Use skill
          <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Use skill</PopoverTitle>
          <PopoverDescription>Install the package or create editable source.</PopoverDescription>
        </PopoverHeader>
        <div className="grid min-w-0 gap-2">
          {acquisition.length > 0 ? acquisition.map((option) => (
            <CopyAction key={option.id} option={option} />
          )) : (
            <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs leading-5 text-muted-foreground">
              No acquisition options are available for this skill.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CopyAction({ option }: { option: WorkbenchAcquisitionOption }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-left transition-colors hover:bg-muted/35",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={() => {
        void navigator.clipboard.writeText(option.value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-medium text-foreground">{option.label}</span>
        <code className="truncate font-mono text-xs text-muted-foreground" title={option.value}>{option.value}</code>
      </span>
      {copied ? <CheckIcon aria-hidden="true" className="size-4 text-success" /> : <CopyIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
    </button>
  );
}

function requestWithFormValues(
  request: WorkbenchOperationRequest,
  samples: string,
  budget: string,
): WorkbenchOperationRequest {
  const parsedSamples = Number.parseInt(samples, 10);
  const parsedBudget = Number.parseInt(budget, 10);
  return {
    ...request,
    samples: Number.isFinite(parsedSamples) && parsedSamples > 0 ? parsedSamples : 1,
    ...(request.kind === "improve"
      ? { budget: Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 1 }
      : {}),
  };
}

function operationDescription(request: WorkbenchOperationRequest): string {
  return request.variant === "cloud"
    ? "Start a hosted Workbench run."
    : "Start a local Workbench run.";
}
