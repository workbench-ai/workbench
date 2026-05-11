import { cn } from "../../lib/utils";

export interface TextBlockViewProps {
  value: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  fillHeight?: boolean;
  monospace?: boolean;
}

export function TextBlockView({
  value,
  className,
  testId,
  ariaLabel,
  fillHeight = false,
  monospace = false,
}: TextBlockViewProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground",
        fillHeight
          ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          : "overflow-visible",
        monospace ? "font-mono text-[13px] leading-6" : "text-sm leading-7",
        className,
      )}
      data-testid={testId}
    >
      {value}
    </div>
  );
}
