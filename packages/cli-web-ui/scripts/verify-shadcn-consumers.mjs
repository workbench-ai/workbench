import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const sourceExtensions = new Set([".jsx", ".tsx"]);
const forbiddenNativeTags = new Map([
  ["button", "Button"],
  ["hr", "Separator"],
  ["input", "Input or InputGroupInput"],
  ["label", "FieldLabel or Label"],
  ["option", "SelectItem"],
  ["select", "Select"],
  ["table", "Table"],
  ["textarea", "Textarea"],
]);
const groupedItems = new Map([
  ["DropdownMenuCheckboxItem", "DropdownMenuGroup"],
  ["DropdownMenuItem", "DropdownMenuGroup"],
  ["DropdownMenuLabel", "DropdownMenuGroup"],
  ["SelectItem", "SelectGroup"],
  ["TabsTrigger", "TabsList"],
]);
const excludedPathFragments = [
  "/components/ui/",
  "/node_modules/",
  "/products/workbench-cloud/videos/",
];
const excludedFiles = new Set([
  "products/cli-web-ui/components/shared/spreadsheet-viewer.tsx",
]);

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isAuditedFile(filePath) {
  const normalized = normalizePath(path.resolve(filePath));
  const relative = normalizePath(path.relative(repoRoot, filePath));
  return sourceExtensions.has(path.extname(filePath))
    && !excludedPathFragments.some((fragment) => normalized.includes(fragment))
    && !excludedFiles.has(relative)
    && !/(?:^|\/)(?:__tests__|fixtures)(?:\/|$)/u.test(relative)
    && !/\.(?:spec|test)\.[jt]sx$/u.test(relative);
}

function collectFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return isAuditedFile(root) ? [root] : [];
  }
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(entryPath);
    }
    return isAuditedFile(entryPath) ? [entryPath] : [];
  });
}

function tagNameText(tagName, sourceFile) {
  return tagName.getText(sourceFile);
}

function openingElement(node) {
  if (ts.isJsxElement(node)) {
    return node.openingElement;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return node;
  }
  return null;
}

function hasJsxAttribute(node, name) {
  const opening = openingElement(node);
  return Boolean(opening?.attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  ));
}

function hasAncestorComponent(node, componentName, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const name = tagNameText(current.openingElement.tagName, sourceFile);
      if (name === componentName) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

export function auditSource(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
  );
  const issues = [];

  function report(node, message) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    issues.push({
      column: position.character + 1,
      filePath,
      line: position.line + 1,
      message,
    });
  }

  function visit(node) {
    const opening = openingElement(node);
    if (opening) {
      const tagName = tagNameText(opening.tagName, sourceFile);
      const replacement = forbiddenNativeTags.get(tagName);
      if (replacement) {
        report(opening, `Use the shared shadcn ${replacement} component instead of <${tagName}>.`);
      }
      if (hasJsxAttribute(node, "aria-pressed")) {
        report(opening, "Use Toggle or ToggleGroup instead of managing aria-pressed locally.");
      }
      const requiredGroup = groupedItems.get(tagName);
      if (requiredGroup && !hasAncestorComponent(node, requiredGroup, sourceFile)) {
        report(opening, `${tagName} must be nested inside ${requiredGroup}.`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

function parseFileArguments(argv) {
  const filesIndex = argv.indexOf("--files");
  if (filesIndex === -1) {
    return null;
  }
  return argv.slice(filesIndex + 1).map((filePath) => path.resolve(filePath));
}

function main() {
  const explicitFiles = parseFileArguments(process.argv.slice(2));
  const files = explicitFiles ?? [
    path.join(repoRoot, "products"),
    path.join(repoRoot, "packages", "internal"),
  ].flatMap(collectFiles);
  const issues = files.flatMap((filePath) => {
    if (!fs.existsSync(filePath)) {
      return [{ column: 1, filePath, line: 1, message: "File does not exist." }];
    }
    return auditSource(filePath, fs.readFileSync(filePath, "utf8"));
  });

  if (issues.length === 0) {
    process.stdout.write(`Shared shadcn consumer audit passed (${files.length} files).\n`);
    return;
  }

  for (const issue of issues) {
    const relative = normalizePath(path.relative(repoRoot, issue.filePath));
    process.stderr.write(`${relative}:${issue.line}:${issue.column} ${issue.message}\n`);
  }
  process.stderr.write(`Shared shadcn consumer audit failed with ${issues.length} issue(s).\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
