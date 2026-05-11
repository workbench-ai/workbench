import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../lib/utils";

interface InspectorDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  testId?: string;
  bodyTestId?: string;
  className?: string;
  bodyClassName?: string;
}

export function InspectorDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
  bodyTestId,
  className,
  bodyClassName,
}: InspectorDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[min(94vh,calc(100dvh-1rem))] gap-0 overflow-hidden p-0 sm:max-w-[min(96rem,calc(100vw-2rem))]",
          className,
        )}
        data-testid={testId}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "min-h-0 overflow-hidden px-4 py-4 sm:px-6 sm:py-6",
            bodyClassName,
          )}
          data-testid={bodyTestId}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
