// Native Excel (.xlsx) exporter for NEXAR UniFormat II project data (Level 1 → Level 4).
// Uses JSZip (already loaded by NEXAR) — works 100% offline, full Thai/UTF-8 support,
// exports ONLY the UniFormat items actually used in the current project across 2 sheets:
//   1. "UniFormat Summary" — grouped by L1 / L2 / L3 / L4 / Category / Family / Type with Qty & Item Tags
//   2. "Project Items"     — per-item detail (Item Tag, L1–L4, Coordinates, Host Face, Normal, Revit Id, GUID)

import JSZip from 'jszip';
import { UNIFORMAT_L1, UNIFORMAT_L2, UNIFORMAT_CATALOG } from '../../settings/uniformat.js';
import { STATUSES, typeMeta, isObjectMark, itemTag, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';
import { itemNaming } from './photopack.js';

const L1_MAP = Object.fromEntries(UNIFORMAT_L1.map((x) => [x.code, x.name]));
const L2_MAP = Object.fromEntries(UNIFORMAT_L2.map((x) => [x.code, x.name]));
const L3_MAP = {};
for (const item of UNIFORMAT_CATALOG) {
  if (!L3_MAP[item.uniformat]) L3_MAP[item.uniformat] = item.l3Name;
}

// Parse UniFormat code into L1 / L2 / L3 / L4 (e.g. "D5030.10" -> D, D50, D5030, D5030.10)
export function parseUniformatLevels(rawCode, fallbackGroup = '') {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { l1: '', l1Name: '', l2: '', l2Name: '', l3: '', l3Name: '', l4: '' };
  const l1 = /^[A-G]/.test(code) ? code[0] : (fallbackGroup || '');
  const l2 = code.length >= 3 ? code.slice(0, 3) : '';
  const l3 = code.length >= 5 ? code.slice(0, 5) : '';
  const l4 = code.length > 5 ? code : '';
  return {
    l1,
    l1Name: L1_MAP[l1] || '',
    l2,
    l2Name: L2_MAP[l2] || '',
    l3,
    l3Name: L3_MAP[l3] || '',
    l4
  };
}

// ---------------------------------------------------------------- minimal OOXML SpreadsheetML builder
const escXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function colRef(idx) { // 0 -> A, 25 -> Z, 26 -> AA
  let n = idx + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function buildSheetXml(headers, rows, colWidths) {
  const colsXml = colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const rowXml = (vals, rIdx, isHeader) => {
    const cells = vals.map((v, cIdx) => {
      const ref = `${colRef(cIdx)}${rIdx}`;
      const style = isHeader ? 1 : (typeof v === 'number' ? 2 : 0);
      if (v === '' || v === null || v === undefined) return `<c r="${ref}" s="${style}"/>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx}"${isHeader ? ' ht="22" customHeight="1"' : ''}>${cells}</row>`;
  };
  const allRows = [rowXml(headers, 1, true), ...rows.map((r, i) => rowXml(r, i + 2, false))].join('');
  const lastCol = colRef(Math.max(0, headers.length - 1));
  const lastRow = rows.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  <cols>${colsXml}</cols>
  <sheetData>${allRows}</sheetData>
  <autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="UniFormat Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Project Items" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Styles: 0 = regular text, 1 = dark charcoal header w/ gold-white bold text, 2 = numeric
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFF4F4F5"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F1F22"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD4D4D8"/></left><right style="thin"><color rgb="FFD4D4D8"/></right><top style="thin"><color rgb="FFD4D4D8"/></top><bottom style="thin"><color rgb="FFD4D4D8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

function buildWorkbookZip(sheets) {
  const ctOverrides = sheets.map((_, i) => `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${ctOverrides}
</Types>`;
  const wbSheets = sheets.map((s, i) => `    <sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n');
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${wbSheets}
  </sheets>
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', wbXml);
  zip.file('xl/_rels/workbook.xml.rels', wbRels);
  zip.file('xl/styles.xml', STYLES_XML);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, buildSheetXml(s.headers, s.rows, s.widths)));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE'
  });
}

// ---------------------------------------------------------------- 1) Object Marks (IFC / UniFormat) Excel
export async function exportUniformatExcel(project, { groupName = () => '' } = {}) {
  const items = (project.markups || []).filter(isObjectMark).sort((a, b) => (a.number || 0) - (b.number || 0));

  const groups = new Map();
  const itemRows = [];

  for (const m of items) {
    const F = m.family || {};
    const ufRaw = F.uniformat || F.discipline || '';
    const lv = parseUniformatLevels(ufRaw, F.group || '');
    const tag = itemTag(m);
    const cat = F.category || (m.element && m.element.ifcType) || 'Unclassified';
    const fam = F.familyName || '';
    const typ = F.typeName || '';
    const plc = F.placement || 'face-based';
    const key = [lv.l1, lv.l2, lv.l3, lv.l4, cat, fam, typ, plc].join('|');

    if (!groups.has(key)) {
      groups.set(key, {
        ...lv, category: cat, familyName: fam, typeName: typ, placement: plc,
        qty: 0, photos: 0, folderPath: '', tags: [], hostElements: new Set()
      });
    }
    const g = groups.get(key);
    const gn = groupName(m.group);
    const nm = itemNaming(m, gn);
    g.qty++;
    g.photos += nm.sitePhotos.length;
    g.folderPath = g.folderPath || nm.folderPath;
    g.tags.push(tag);
    if (m.element && (m.element.name || m.element.ifcType)) g.hostElements.add(m.element.name || m.element.ifcType);

    const p = m.position || { x: 0, y: 0, z: 0 };
    const n = F.normal || { x: 0, y: 0, z: 1 };
    const photoNames = nm.sitePhotos.map((f) => f.fileName).join(', ');
    itemRows.push([
      tag,
      m.number || 0,
      fmtDateTime(m.checkedAt || m.createdAt),
      m.modelName || '',
      lv.l1, lv.l1Name,
      lv.l2, lv.l2Name,
      lv.l3, lv.l3Name,
      lv.l4,
      cat, fam, typ, plc,
      markupTitle(m),
      (STATUSES[m.status] || STATUSES.open).label,
      gn,
      nm.sitePhotos.length,
      nm.folderPath,
      photoNames,
      F.hostSurface || '',
      Number.isFinite(F.rotationDeg) ? Math.round(F.rotationDeg) : '',
      Number.isFinite(F.offsetZ) ? +F.offsetZ.toFixed(3) : 0,
      +(p.x || 0).toFixed(4), +(p.y || 0).toFixed(4), +(p.z || 0).toFixed(4),
      +(n.x || 0).toFixed(4), +(n.y || 0).toFixed(4), +(n.z || 0).toFixed(4),
      m.element && m.element.tag ? String(m.element.tag) : '',
      m.element ? `${m.element.ifcType || ''}${m.element.name ? ' · ' + m.element.name : ''}` : '',
      m.element ? (m.element.guid || '') : '',
      m.text || '',
      m.author || ''
    ]);
  }

  const summaryEntries = [...groups.values()].sort((a, b) =>
    (a.l3 || a.l1 || 'ZZZ').localeCompare(b.l3 || b.l1 || 'ZZZ') ||
    (a.l4 || '').localeCompare(b.l4 || '') ||
    a.category.localeCompare(b.category) ||
    a.familyName.localeCompare(b.familyName)
  );

  const sumHeaders = [
    'L1', 'L1 Group', 'L2', 'L2 Group', 'L3', 'L3 Element', 'L4 Code',
    'Revit Category', 'Family Name', 'Type Name', 'Placement',
    'Qty', 'Photos', 'Mark Tags', 'Photo Folder', 'Host Elements'
  ];
  const sumWidths = [6, 22, 7, 24, 9, 28, 12, 22, 22, 18, 13, 8, 9, 28, 34, 30];
  const sumRows = summaryEntries.map((g) => [
    g.l1, g.l1Name, g.l2, g.l2Name, g.l3, g.l3Name, g.l4,
    g.category, g.familyName, g.typeName, g.placement,
    g.qty, g.photos || 0, g.tags.join(', '), g.folderPath || '', [...g.hostElements].slice(0, 8).join(', ')
  ]);

  const itemHeaders = [
    'Mark Tag', 'No.', 'Checked At', 'Model File',
    'L1', 'L1 Group', 'L2', 'L2 Group', 'L3', 'L3 Element', 'L4 Code',
    'Revit Category', 'Family Name', 'Type Name', 'Placement',
    'Title', 'Status', 'Group',
    'Photos', 'Photo Folder', 'Photo Files',
    'Host Surface', 'Facing (deg)', 'Offset Z (m)',
    'X (m)', 'Y (m)', 'Z (m)', 'Normal X', 'Normal Y', 'Normal Z',
    'Host Revit Id', 'Host Element', 'Host IFC GUID', 'Notes', 'Author'
  ];
  const itemWidths = [11, 6, 18, 22, 6, 20, 7, 22, 9, 26, 12, 22, 22, 18, 13, 24, 11, 14, 8, 32, 34, 12, 12, 12, 11, 11, 11, 10, 10, 10, 14, 26, 26, 28, 14];

  itemRows.sort((a, b) => String(a[8] || 'ZZZ').localeCompare(String(b[8] || 'ZZZ')) || String(a[10] || '').localeCompare(String(b[10] || '')) || (a[1] - b[1]));

  const blob = await buildWorkbookZip([
    { name: 'UniFormat Summary', headers: sumHeaders, rows: sumRows, widths: sumWidths },
    { name: 'Object Marks', headers: itemHeaders, rows: itemRows, widths: itemWidths }
  ]);
  return { blob, summaryCount: summaryEntries.length, itemCount: itemRows.length };
}

// ---------------------------------------------------------------- 2) Read-Only Site Notes / Issues Excel (Separate dataset)
export async function exportNotesExcel(project, { groupName = () => '' } = {}) {
  const notes = (project.markups || []).filter((m) => !isObjectMark(m)).sort((a, b) => (a.number || 0) - (b.number || 0));
  const headers = [
    'Note Tag', 'No.', 'Type', 'Status', 'Priority', 'Checked At', 'Model File',
    'Title', 'Note / Comment', 'Group',
    'X (m)', 'Y (m)', 'Z (m)', 'Host Element', 'Host IFC GUID',
    'Photos', 'Photo Folder', 'Photo Files', 'Author', 'Assigned To', 'Replies'
  ];
  const widths = [11, 6, 10, 11, 10, 18, 22, 24, 38, 14, 11, 11, 11, 24, 26, 8, 24, 32, 14, 14, 28];
  const rows = notes.map((m) => {
    const gn = groupName(m.group);
    const nm = itemNaming(m, gn);
    const p = m.position || { x: 0, y: 0, z: 0 };
    return [
      itemTag(m),
      m.number || 0,
      typeMeta(m.type).label,
      (STATUSES[m.status] || STATUSES.open).label,
      m.priority || 'normal',
      fmtDateTime(m.checkedAt || m.createdAt),
      m.modelName || '',
      markupTitle(m),
      m.text || '',
      gn,
      +(p.x || 0).toFixed(4), +(p.y || 0).toFixed(4), +(p.z || 0).toFixed(4),
      m.element ? `${m.element.ifcType || ''}${m.element.name ? ' · ' + m.element.name : ''}` : '',
      m.element ? (m.element.guid || '') : '',
      nm.sitePhotos.length,
      nm.folderPath,
      nm.sitePhotos.map((f) => f.fileName).join(', '),
      m.author || '',
      m.assignedTo || '',
      (m.replies || []).map((r) => `${r.author || ''}: ${r.text || ''}`).join(' | ')
    ];
  });
  const blob = await buildWorkbookZip([{ name: 'Site Notes', headers, rows, widths }]);
  return { blob, count: rows.length, itemCount: rows.length };
}
