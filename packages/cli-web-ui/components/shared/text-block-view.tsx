import { cn } from "../../lib/utils";

export interface TextBlockViewProps {
  value: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  monospace?: boolean;
}

export function TextBlockView({
  value,
  className,
  testId,
  ariaLabel,
  monospace = false,
}: TextBlockViewProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "min-w-0 max-w-full overflow-visible whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground",
        monospace ? "font-mono text-[13px] leading-6" : "text-sm leading-7",
        className,
      )}
      data-testid={testId}
    >
      {value}
    </div>
  );
}
