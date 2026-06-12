import { cn } from "../../lib/utils";

/**
 * The Workbench mark: the "ascending band" — a 4x4 case-dot grid cut to a
 * diagonal band climbing from bottom-left to top-right, dot radii growing
 * along the ascent. Monochrome only: it renders in currentColor (ink on
 * light surfaces, white on dark), never in an accent color.
 */
export function WorkbenchLogoMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 26.5 26.5"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor">
        <circle cx="16.5" cy="3.5" r="2.58" />
        <circle cx="23" cy="3.5" r="2.8" />
        <circle cx="10" cy="10" r="2.15" />
        <circle cx="16.5" cy="10" r="2.37" />
        <circle cx="23" cy="10" r="2.58" />
        <circle cx="3.5" cy="16.5" r="1.72" />
        <circle cx="10" cy="16.5" r="1.93" />
        <circle cx="16.5" cy="16.5" r="2.15" />
        <circle cx="3.5" cy="23" r="1.5" />
        <circle cx="10" cy="23" r="1.72" />
      </g>
    </svg>
  );
}

export function WorkbenchBrand({
  product,
  className,
}: {
  product?: string;
  className?: string;
}) {
  const label = product?.trim() ? `Workbench ${product.trim()}` : "Workbench";
  return (
    <span
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 text-lg font-medium leading-none tracking-[-0.035em] text-foreground",
        className,
      )}
    >
      <WorkbenchLogoMark className="shrink-0" size={22} />
      <span>{label}</span>
    </span>
  );
}
