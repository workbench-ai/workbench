import { ChevronDownIcon, ListFilterIcon } from "lucide-react";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/dropdown-menu";

export interface ComparisonFilterOption {
  id: string;
  label: string;
  color?: string;
}

export function ComparisonFilter({
  label = "Setups",
  options,
  selectedIds,
  testId = "comparison-filter",
  onSelectAll,
  onClear,
  onToggle,
}: {
  label?: string;
  options: ComparisonFilterOption[];
  selectedIds: Set<string>;
  testId?: string;
  onSelectAll: () => void;
  onClear: () => void;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const selectedCount = selectedIds.size;
  const totalCount = options.length;
  const buttonLabel = selectedCount === totalCount
    ? `All ${totalCount}`
    : selectedCount === 0
      ? "None"
      : `${selectedCount} of ${totalCount}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Filter ${label.toLowerCase()}: ${buttonLabel}`}
          data-testid={testId}
        >
          <ListFilterIcon data-icon="inline-start" aria-hidden="true" />
          <span>{label}: {buttonLabel}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[min(calc(100vw-2rem),24rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={selectedCount === totalCount}
            onSelect={(event) => {
              event.preventDefault();
              onSelectAll();
            }}
          >
            Select all
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={selectedCount === 0}
            onSelect={(event) => {
              event.preventDefault();
              onClear();
            }}
          >
            Clear
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selectedIds.has(option.id)}
              onCheckedChange={(checked) => onToggle(option.id, checked === true)}
              onSelect={(event) => event.preventDefault()}
              className="items-start gap-2 py-2"
            >
              {option.color ? (
                <span
                  className="mt-1 size-2.5 flex-none rounded-full ring-1 ring-border"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="grid min-w-0 gap-0.5">
                <span className="font-medium whitespace-normal break-words [overflow-wrap:anywhere]">
                  {option.label}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
