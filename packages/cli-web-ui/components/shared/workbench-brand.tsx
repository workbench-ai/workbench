import { cn } from "../../lib/utils";

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
        "flex h-8 shrink-0 items-center gap-2 text-lg font-medium leading-none tracking-tight text-foreground",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        className="size-7 shrink-0"
        height="28"
        viewBox="0 0 28 28"
        width="28"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="28" height="28" fill="currentColor" rx="4" ry="4" className="text-primary" />
        <rect x="7" y="10.4" width="14" height="1.1" fill="white" rx="0.55" ry="0.55" />
        <rect x="9.8" y="10.4" width="1.1" height="7.7" fill="white" rx="0.55" ry="0.55" />
        <rect x="17.1" y="10.4" width="1.1" height="7.7" fill="white" rx="0.55" ry="0.55" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
