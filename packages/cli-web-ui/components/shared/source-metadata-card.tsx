import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";

export interface SourceMetadataCardProps {
  sourcePath: string;
  header?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function SourceMetadataCard({
  sourcePath,
  header,
  children,
  className,
}: SourceMetadataCardProps) {
  return (
    <Card
      size="sm"
      className={cn("bg-card", className)}
    >
      <CardContent className="grid gap-3 px-4 py-0 sm:px-5">
        {header ? <div className="flex flex-wrap items-center gap-2">{header}</div> : null}
        {children}
        <div className="grid gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Source file
          </span>
          <span className="min-w-0 break-all font-mono text-xs text-foreground/82">
            {sourcePath}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
