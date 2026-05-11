import { strFromU8, unzipSync } from "fflate";

export type WorkbookPackageMetadata = {
  activeTabIndex: number | null;
  sheetVisibilityByName: Map<string, SheetVisibility>;
};

export type SheetVisibility = "visible" | "hidden" | "veryHidden";

const WORKBOOK_XML_PATH = "xl/workbook.xml";

export function extractWorkbookPackageMetadata(bytes: Uint8Array): WorkbookPackageMetadata {
  try {
    const archive = unzipSync(bytes);
    const workbookXmlBytes = archive[WORKBOOK_XML_PATH];

    if (!workbookXmlBytes) {
      return {
        activeTabIndex: null,
        sheetVisibilityByName: new Map(),
      };
    }

    const workbookXml = strFromU8(workbookXmlBytes);
    const doc = new DOMParser().parseFromString(workbookXml, "application/xml");
    const activeTabAttr = doc.querySelector("workbookView")?.getAttribute("activeTab");
    const activeTabIndex =
      activeTabAttr && Number.isFinite(Number(activeTabAttr))
        ? Number(activeTabAttr)
        : null;
    const sheetVisibilityByName = new Map<string, SheetVisibility>();

    for (const sheet of Array.from(doc.querySelectorAll("sheet"))) {
      const name = sheet.getAttribute("name");
      const rawState = sheet.getAttribute("state");

      if (!name) {
        continue;
      }

      const state =
        rawState === "hidden" || rawState === "veryHidden" ? rawState : "visible";

      sheetVisibilityByName.set(name, state);
    }

    return {
      activeTabIndex,
      sheetVisibilityByName,
    };
  } catch {
    return {
      activeTabIndex: null,
      sheetVisibilityByName: new Map(),
    };
  }
}
