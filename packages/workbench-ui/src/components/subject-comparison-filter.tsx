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

export interface SubjectFilterOption {
  id: string;
  label: string;
}

export function SubjectComparisonFilter({
  options,
  selectedSubjectIds,
  testId = "subject-comparison-filter",
  onSelectAll,
  onClear,
  onToggleSubject,
}: {
  options: SubjectFilterOption[];
  selectedSubjectIds: Set<string>;
  testId?: string;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleSubject: (subjectId: string, checked: boolean) => void;
}) {
  const selectedCount = selectedSubjectIds.size;
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
          aria-label={`Filter comparison subjects: ${buttonLabel}`}
          data-testid={testId}
        >
          <ListFilterIcon data-icon="inline-start" aria-hidden="true" />
          <span>Subjects: {buttonLabel}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[min(calc(100vw-2rem),24rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Comparison subjects</DropdownMenuLabel>
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
              checked={selectedSubjectIds.has(option.id)}
              onCheckedChange={(checked) => {
                onToggleSubject(option.id, checked === true);
              }}
              onSelect={(event) => event.preventDefault()}
              className="items-start py-2"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="font-medium whitespace-normal break-words [overflow-wrap:anywhere]">
                  {option.label}
                </span>
                <span className="text-xs text-muted-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
                  {formatSubjectFilterId(option.id)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatSubjectFilterId(subjectId: string): string {
  if (subjectId.length <= 18) {
    return subjectId;
  }
  return `${subjectId.slice(0, 8)}...${subjectId.slice(-8)}`;
}
