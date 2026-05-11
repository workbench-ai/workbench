import type { ReactNode } from "react";

import type { IconComponent } from "../../lib/icon-component";
import { cn } from "../../lib/utils";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

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
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("min-w-0", fullWidth ? "w-full" : "w-fit", className)}
      data-testid={testId}
    >
      <TabsList
        variant="line"
        aria-label={ariaLabel}
        className={cn(fullWidth ? "w-full justify-start" : "w-fit")}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              aria-label={item.ariaLabel}
              disabled={item.disabled}
              data-testid={item.testId}
              className={itemClassName}
            >
              {Icon ? <Icon data-icon="inline-start" /> : null}
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
