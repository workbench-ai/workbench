import { FolderOpenIcon, ListChecksIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@workbench-ai/cli-web-ui/components/ui/card";
import { Skeleton } from "@workbench-ai/cli-web-ui/components/ui/skeleton";

import { SurfaceSection } from "./surface-section";

function SkeletonBadgeRow({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-5 w-20 rounded-full" />
      ))}
    </div>
  );
}

function SkeletonCopyBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid min-w-0 gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className={index === rows - 1 ? "h-4 w-4/5" : "h-4 w-full"}
        />
      ))}
    </div>
  );
}

export function FactsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-xl bg-muted/35 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SourceYamlSkeleton() {
  return (
    <div className="grid min-w-0 gap-2" aria-busy="true" data-testid="source-yaml-loading">
      <Skeleton className="h-5 w-48 max-w-full rounded-full" />
      <div className="rounded-xl border border-border/70 bg-background p-3">
        <SkeletonCopyBlock rows={5} />
      </div>
    </div>
  );
}

export function SubjectManifestSkeleton() {
  return (
    <div className="grid min-w-0 gap-3" aria-busy="true" data-testid="subject-manifest-loading">
      <Skeleton className="h-5 w-48 max-w-full rounded-full" />
      <div className="rounded-xl border border-border/70 bg-background p-3">
        <SkeletonCopyBlock rows={6} />
      </div>
    </div>
  );
}

export function ExecutionTraceSkeleton() {
  return (
    <div className="grid min-w-0 gap-2" aria-busy="true" data-testid="execution-trace-loading">
      <div className="rounded-lg border border-border/60 px-3 py-3">
        <Skeleton className="h-4 w-36" />
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function EvaluationDetailSurfaceSkeleton() {
  return (
    <div className="grid min-w-0 gap-4" aria-busy="true" data-testid="evaluation-detail-loading">
      <SkeletonBadgeRow count={4} />
      <EvaluationCaseRowsSkeleton showBadges={false} />
    </div>
  );
}

function FilePreviewSkeleton() {
  return (
    <div
      className="grid min-h-[28rem] gap-3 lg:grid-cols-[minmax(14rem,18rem)_minmax(16rem,1fr)]"
      aria-busy="true"
    >
      <div className="grid content-start gap-2 rounded-lg border border-border p-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md p-2">
            <Skeleton className="mt-0.5 size-4 rounded" />
            <div className="grid gap-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-4 h-80 w-full" />
      </div>
    </div>
  );
}

export function BenchmarkSurfaceSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" data-testid="benchmark-loading-state">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-2">
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-48 max-w-full" />
      </div>

      <SurfaceSection title="Cases">
        <div className="grid gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="grid gap-2 border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          ))}
        </div>
      </SurfaceSection>

      <SurfaceSection title="Subject">
        <div className="grid gap-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </SurfaceSection>
    </div>
  );
}

export function SubjectArchiveSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" data-testid="subject-archive-loading">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SubjectFilesSurfaceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <SurfaceSection
        title="Subject Files"
        icon={FolderOpenIcon}
        description="Inspect the subject file snapshot."
        className="flex min-h-0 flex-1 flex-col"
      >
        <SkeletonBadgeRow count={3} />
        <FilePreviewSkeleton />
      </SurfaceSection>
    </div>
  );
}

export function EvaluationCaseRowsSkeleton({
  showBadges = true,
}: {
  showBadges?: boolean;
} = {}) {
  return (
    <div className="grid min-w-0 gap-3" aria-busy="true" data-testid="evaluation-cases-loading">
      {showBadges ? <SkeletonBadgeRow count={4} /> : null}
      <div className="grid gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem_5rem] gap-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SubjectOverviewSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" data-testid="subject-overview-loading">
      <SurfaceSection title="Overview" icon={ListChecksIcon}>
        <FactsSkeleton />
      </SurfaceSection>
      <SurfaceSection title="Evaluations" icon={ListChecksIcon}>
        <SkeletonBadgeRow count={3} />
        <EvaluationCaseRowsSkeleton />
      </SurfaceSection>
    </div>
  );
}

export function EvaluationsDetailSkeleton() {
  return (
    <div
      className="grid w-full min-w-0 gap-3"
      aria-busy="true"
      data-testid="evaluations-loading-state"
    >
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-2 py-0">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function LineageSurfaceSkeleton() {
  return (
    <div
      className="flex h-[clamp(34rem,64vh,48rem)] min-h-[34rem] flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-4 lg:h-[clamp(36rem,68vh,52rem)] lg:min-h-[36rem]"
      aria-busy="true"
      data-testid="lineage-loading-state"
    >
      <div className="relative min-h-0 flex-1">
        <Skeleton className="absolute left-[12%] top-[10%] h-20 w-44" />
        <Skeleton className="absolute left-[38%] top-[34%] h-20 w-44" />
        <Skeleton className="absolute right-[10%] top-[58%] h-20 w-44" />
        <div className="absolute left-[22%] top-[26%] h-px w-[28%] rotate-[18deg] bg-border" />
        <div className="absolute right-[22%] top-[52%] h-px w-[28%] rotate-[18deg] bg-border" />
      </div>
    </div>
  );
}

export function EvaluationCaseDetailSkeleton() {
  return (
    <div className="grid min-w-0 gap-3" aria-busy="true" data-testid="evaluation-case-loading">
      <SkeletonBadgeRow count={4} />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-14" />
      </div>
      <div className="grid min-w-0 gap-2 pt-1">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
