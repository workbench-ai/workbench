export function formatWorkbenchTitle({
  product,
  sections = [],
}: {
  product: string;
  sections?: ReadonlyArray<string | null | undefined | false>;
}): string {
  const normalizedProduct = product.trim();
  const productTitle = normalizedProduct.length === 0 || normalizedProduct === "Workbench"
    ? "Workbench"
    : `Workbench ${normalizedProduct}`;
  const normalizedSections = sections
    .filter((section): section is string => typeof section === "string")
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  return [productTitle, ...normalizedSections].join(" · ");
}
