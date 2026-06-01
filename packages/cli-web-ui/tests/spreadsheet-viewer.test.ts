import { strToU8, zipSync } from "fflate";
// @ts-expect-error jsdom is an existing test dependency without bundled declarations.
import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import {
  expandSheetExtentToFitViewport,
  expandSheetExtentToIncludeCell,
  getBaseSheetExtent,
} from "../lib/spreadsheet-viewer-model";
import { parseOoxmlWorkbook } from "../lib/spreadsheet-viewer-ooxml";

describe("spreadsheet viewer contracts", () => {
  test("expands the initial extent to cover the visible viewport width", () => {
    expect(
      expandSheetExtentToFitViewport(
        { endRow: 45, endCol: 2 },
        {
          clientWidth: 1280,
          clientHeight: 634,
          rowHeaderWidth: 40,
          columnHeaderHeight: 20,
        },
        {
          getColumnWidth: (col) => (col === 0 ? 360 : col === 1 ? 150 : 96),
          getRowHeight: () => 22,
        },
      ),
    ).toEqual({ endRow: 45, endCol: 9 });
  });

  test("scroll offsets do not create blank spreadsheet extent", () => {
    expect(
      expandSheetExtentToFitViewport(
        { endRow: 45, endCol: 2 },
        {
          clientWidth: 640,
          clientHeight: 400,
          rowHeaderWidth: 40,
          columnHeaderHeight: 20,
        },
        {
          getColumnWidth: (col) => (col === 0 ? 360 : col === 1 ? 150 : 96),
          getRowHeight: () => 22,
        },
      ),
    ).toEqual({ endRow: 45, endCol: 2 });
  });

  test("does not grow once the viewport is already covered", () => {
    expect(
      expandSheetExtentToFitViewport(
        { endRow: 48, endCol: 4 },
        {
          clientWidth: 640,
          clientHeight: 400,
          rowHeaderWidth: 40,
          columnHeaderHeight: 20,
        },
        {
          getColumnWidth: (col) => (col === 0 ? 360 : col === 1 ? 150 : 96),
          getRowHeight: () => 22,
        },
      ),
    ).toEqual({ endRow: 48, endCol: 4 });
  });

  test("base extent and selection growth follow the workbook range exactly", () => {
    expect(
      getBaseSheetExtent({
        range: {
          startCol: 0,
          endCol: 2,
          startRow: 0,
          endRow: 15,
        },
      } as never),
    ).toEqual({ endRow: 15, endCol: 2 });

    expect(
      expandSheetExtentToIncludeCell(
        { endRow: 15, endCol: 2 },
        { row: 16, col: 3 },
      ),
    ).toEqual({ endRow: 16, endCol: 3 });
  });

  test("owned OOXML parser displays cached formula values without calculating formulas", () => {
    globalThis.DOMParser = new JSDOM("").window.DOMParser;

    const workbook = parseOoxmlWorkbook(createFormulaWorkbookFixture());
    const income = workbook.sheets.find((sheet) => sheet.name === "Income Statement");

    expect(income?.worksheet.getRange("B2")).toMatchObject({
      rawValues: [[30]],
      values: [["30"]],
      displayFormula: "=Support!A1+Support!B1",
    });
    expect(income?.worksheet.getRange("B3")).toMatchObject({
      rawValues: [[""]],
      values: [[""]],
      displayFormula: "=SUM(Support!A1:B1)",
    });
  });

  test("owned OOXML parser preserves Excel border weights", () => {
    globalThis.DOMParser = new JSDOM("").window.DOMParser;

    const workbook = parseOoxmlWorkbook(createStyledWorkbookFixture());
    const sheet = workbook.sheets.find((candidate) => candidate.name === "Sheet1");
    const styledCell = sheet?.renderedCells.get("A1");

    expect(styledCell?.style).toMatchObject({
      backgroundColor: "#FFE8EC",
      borderLeft: "3px solid #D33F49",
      borderRight: "3px solid #D33F49",
      borderTop: "3px solid #D33F49",
      borderBottom: "3px solid #D33F49",
    });
  });
});

function createStyledWorkbookFixture(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
        </sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`),
    "xl/styles.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>
        <fills count="2">
          <fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FFFFE8EC"/></patternFill></fill>
        </fills>
        <borders count="2">
          <border><left/><right/><top/><bottom/><diagonal/></border>
          <border>
            <left style="thick"><color rgb="FFD33F49"/></left>
            <right style="thick"><color rgb="FFD33F49"/></right>
            <top style="thick"><color rgb="FFD33F49"/></top>
            <bottom style="thick"><color rgb="FFD33F49"/></bottom>
            <diagonal/>
          </border>
        </borders>
        <cellXfs count="2">
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <xf numFmtId="0" fontId="0" fillId="1" borderId="1" xfId="0"/>
        </cellXfs>
      </styleSheet>`),
    "xl/worksheets/sheet1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" s="1"><v>1</v></c></row>
        </sheetData>
      </worksheet>`),
  };

  return zipSync(files);
}

function createFormulaWorkbookFixture(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Support" sheetId="1" r:id="rId1"/>
          <sheet name="Income Statement" sheetId="2" r:id="rId2"/>
        </sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      </Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1"><v>10</v></c><c r="B1"><v>20</v></c></row>
        </sheetData>
      </worksheet>`),
    "xl/worksheets/sheet2.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="2"><c r="B2"><f>Support!A1+Support!B1</f><v>30</v></c></row>
          <row r="3"><c r="B3"><f>SUM(Support!A1:B1)</f></c></row>
        </sheetData>
      </worksheet>`),
  };

  return zipSync(files);
}

function xml(source: string): Uint8Array {
  return strToU8(source);
}
