import type { ReactNode } from "react";

import { ChevronRightIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../../lib/utils";

interface DisclosurePanelProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  bodyClassName?: string;
}

export function DisclosurePanel({
  title,
  description,
  aside,
  children,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  className,
  triggerClassName,
  contentClassName,
  bodyClassName,
}: DisclosurePanelProps) {
  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-muted/20",
        className,
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "group h-auto w-full justify-between rounded-none border-0 px-3 py-3 text-left hover:bg-muted/35",
            triggerClassName,
          )}
        >
          <div className="grid min-w-0 gap-1 text-left">
            <span className="text-sm font-medium text-foreground">{title}</span>
            {description ? (
              <span className="text-xs text-muted-foreground">{description}</span>
            ) : null}
          </div>

          <div className="ml-3 flex shrink-0 items-center gap-2">
            {aside}
            <ChevronRightIcon
              data-icon="inline-end"
              className="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
            />
          </div>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className={contentClassName}>
        <div className={cn("grid gap-3 border-t border-border/60 px-3 py-3", bodyClassName)}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
