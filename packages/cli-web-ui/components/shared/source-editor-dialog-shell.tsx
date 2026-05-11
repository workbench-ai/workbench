import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../lib/utils";

export interface SourceEditorDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  metadata?: React.ReactNode;
  editor: React.ReactNode;
  errorMessage?: React.ReactNode;
  footer: React.ReactNode;
  size?: "bleed" | "full";
  testId?: string;
  className?: string;
}

export function SourceEditorDialogShell({
  open,
  onOpenChange,
  title,
  description,
  metadata,
  editor,
  errorMessage,
  footer,
  size = "full",
  testId,
  className,
}: SourceEditorDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "h-full max-h-full flex flex-col gap-4 overflow-hidden p-4 sm:h-[85vh] sm:max-h-[90vh] sm:p-6",
          size === "full"
            ? "sm:max-w-[min(96rem,calc(100vw-2rem))]"
            : "sm:max-w-[min(90rem,calc(100vw-3rem))]",
          className,
        )}
        data-testid={testId}
      >
        <DialogHeader className="mb-0 grid gap-3">
          <div className="grid gap-1.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          {metadata}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {editor}
        </div>

        {errorMessage ? (
          <p className="text-destructive text-sm">{errorMessage}</p>
        ) : null}

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}
