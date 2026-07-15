import type { ReactNode } from "react";

import type { IconComponent } from "../../lib/icon-component";
import { cn } from "../../lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export interface ViewSwitchItem {
  value: string;
  label: ReactNode;
  icon?: IconComponent;
  ariaLabel?: string;
  disabled?: boolean;
  testId?: string;
}

interface ViewSwitchProps {
  ariaLabel: string;
  value: string;
  items: ReadonlyArray<ViewSwitchItem>;
  onValueChange: (value: string) => void;
  fullWidth?: boolean;
  className?: string;
  itemClassName?: string;
  testId?: string;
}

export function ViewSwitch({
  ariaLabel,
  value,
  items,
  onValueChange,
  fullWidth = false,
  className,
  itemClassName,
  testId,
}: ViewSwitchProps) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      className={cn("flex h-9 min-w-0 items-center gap-1", fullWidth ? "w-full" : "w-fit", className)}
      data-testid={testId}
      onValueChange={(next) => { if (next) onValueChange(next); }}
      size="sm"
      type="single"
      value={value}
      variant="default"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const selected = value === item.value;
        return <ToggleGroupItem aria-label={item.ariaLabel} className={cn("rounded-none border-x-0 border-t-0 border-b-2 px-2", selected ? "border-foreground text-foreground" : "border-transparent text-muted-foreground", fullWidth && "flex-1", itemClassName)} data-testid={item.testId} disabled={item.disabled} key={item.value} value={item.value}>{Icon ? <Icon data-icon="inline-start" /> : null}{item.label}</ToggleGroupItem>;
      })}
    </ToggleGroup>
  );
}
