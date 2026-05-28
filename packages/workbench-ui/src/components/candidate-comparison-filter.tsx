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

export interface CandidateFilterOption {
  id: string;
  label: string;
  color?: string;
}

export function CandidateComparisonFilter({
  options,
  selectedCandidateIds,
  testId = "candidate-comparison-filter",
  onSelectAll,
  onClear,
  onToggleCandidate,
}: {
  options: CandidateFilterOption[];
  selectedCandidateIds: Set<string>;
  testId?: string;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  const selectedCount = selectedCandidateIds.size;
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
          aria-label={`Filter comparison candidates: ${buttonLabel}`}
          data-testid={testId}
        >
          <ListFilterIcon data-icon="inline-start" aria-hidden="true" />
          <span>Candidates: {buttonLabel}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[min(calc(100vw-2rem),24rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Comparison candidates</DropdownMenuLabel>
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
              checked={selectedCandidateIds.has(option.id)}
              onCheckedChange={(checked) => {
                onToggleCandidate(option.id, checked === true);
              }}
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
                <span className="text-xs text-muted-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
                  {formatCandidateFilterId(option.id)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatCandidateFilterId(candidateId: string): string {
  if (candidateId.length <= 18) {
    return candidateId;
  }
  return `${candidateId.slice(0, 8)}...${candidateId.slice(-8)}`;
}
