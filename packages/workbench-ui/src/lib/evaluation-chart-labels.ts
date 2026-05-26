export const EVALUATION_CATEGORY_AXIS_LINE_HEIGHT = 12;

const CATEGORY_AXIS_CHARACTER_WIDTH = 6.4;
const CATEGORY_AXIS_LABEL_PADDING = 16;
const CATEGORY_AXIS_ROW_PADDING = 18;
const CATEGORY_LABEL_LONG_THRESHOLD = 18;
const CATEGORY_X_AXIS_MAX_CHARS_PER_LINE = 16;
const CATEGORY_Y_AXIS_MIN_WIDTH = 128;
const CATEGORY_Y_AXIS_MAX_WIDTH = 320;
const CATEGORY_Y_AXIS_MIN_CHARS_PER_LINE = 12;
const CATEGORY_Y_AXIS_WIDTH_CHARS_CAP = 42;

export interface EvaluationCategoryAxisLayout {
  hasLongLabels: boolean;
  rowHeight: number;
  xAxisHeight: number;
  xAxisMaxCharsPerLine: number;
  yAxisMaxCharsPerLine: number;
  yAxisWidth: number;
}

export function buildEvaluationCategoryAxisLayout(
  labels: readonly string[],
): EvaluationCategoryAxisLayout {
  const normalizedLabels = labels.map(normalizeEvaluationCategoryAxisLabel);
  const longestLabelLength = normalizedLabels.reduce(
    (maxLength, label) => Math.max(maxLength, label.length),
    0,
  );
  const yAxisWidth = clamp(
    Math.ceil(
      Math.min(longestLabelLength, CATEGORY_Y_AXIS_WIDTH_CHARS_CAP) *
        CATEGORY_AXIS_CHARACTER_WIDTH +
        CATEGORY_AXIS_LABEL_PADDING,
    ),
    CATEGORY_Y_AXIS_MIN_WIDTH,
    CATEGORY_Y_AXIS_MAX_WIDTH,
  );
  const yAxisMaxCharsPerLine = Math.max(
    CATEGORY_Y_AXIS_MIN_CHARS_PER_LINE,
    Math.floor((yAxisWidth - CATEGORY_AXIS_LABEL_PADDING) / CATEGORY_AXIS_CHARACTER_WIDTH),
  );
  const yAxisMaxLineCount = maxWrappedLineCount(normalizedLabels, yAxisMaxCharsPerLine);
  const xAxisMaxLineCount = maxWrappedLineCount(normalizedLabels, CATEGORY_X_AXIS_MAX_CHARS_PER_LINE);

  return {
    hasLongLabels: normalizedLabels.some((label) => label.length > CATEGORY_LABEL_LONG_THRESHOLD),
    rowHeight: Math.max(
      34,
      yAxisMaxLineCount * EVALUATION_CATEGORY_AXIS_LINE_HEIGHT + CATEGORY_AXIS_ROW_PADDING,
    ),
    xAxisHeight: Math.max(
      36,
      xAxisMaxLineCount * EVALUATION_CATEGORY_AXIS_LINE_HEIGHT + 24,
    ),
    xAxisMaxCharsPerLine: CATEGORY_X_AXIS_MAX_CHARS_PER_LINE,
    yAxisMaxCharsPerLine,
    yAxisWidth,
  };
}

export function wrapEvaluationCategoryAxisLabel(
  value: string,
  maxCharsPerLine: number,
): string[] {
  const normalized = normalizeEvaluationCategoryAxisLabel(value);
  if (!normalized) {
    return [""];
  }

  const lineLimit = Math.max(1, Math.floor(maxCharsPerLine));
  const lines: string[] = [];
  let currentLine = "";

  for (const word of normalized.split(" ")) {
    if (!word) {
      continue;
    }

    if (word.length > lineLimit) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      for (let index = 0; index < word.length; index += lineLimit) {
        lines.push(word.slice(index, index + lineLimit));
      }
      continue;
    }

    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= lineLimit) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [normalized];
}

function maxWrappedLineCount(
  labels: readonly string[],
  maxCharsPerLine: number,
): number {
  return labels.reduce(
    (maxLineCount, label) =>
      Math.max(maxLineCount, wrapEvaluationCategoryAxisLabel(label, maxCharsPerLine).length),
    1,
  );
}

function normalizeEvaluationCategoryAxisLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
