// Unified Photo Naming, UniFormat Folder Structure, Photo Directory CSV & Photo Pack (.zip) exporter.
// Produces deterministic, Excel/Revit-friendly paths whether an item has 0, 1, or many sequential site photos.

import JSZip from 'jszip';
import { UNIFORMAT_L1, UNIFORMAT_L2, UNIFORMAT_CATALOG } from '../../settings/uniformat.js';
import { STATUSES, typeMeta, recordKind, isObjectMark, itemTag, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';

const L1_MAP = Object.fromEntries(UNIFORMAT_L1.map((x) => [x.code, x.name]));
const L2_MAP = Object.fromEntries(UNIFORMAT_L2.map((x) => [x.code, x.name]));
const L3_MAP = {};
for (const item of UNIFORMAT_CATALOG) {
  if (!L3_MAP[item.uniformat]) L3_MAP[item.uniformat] = item.l3Name;
}

export function cleanToken(s, max = 32) {
  return String(s || '')
    .trim()
    .replace(/[^\w\u0E00-\u0E7F.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, max);
}

export function parseUniformat(rawCode, fallbackGroup = '') {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { l1: '', l1Name: '', l2: '', l2Name: '', l3: '', l3Name: '', l4: '' };
  const l1 = /^[A-G]/.test(code) ? code[0] : (fallbackGroup || '');
  const l2 = code.length >= 3 ? code.slice(0, 3) : '';
  const l3 = code.length >= 5 ? code.slice(0, 5) : '';
  const l4 = code.length > 5 ? code : '';
  return {
    l1, l1Name: L1_MAP[l1] || '',
    l2, l2Name: L2_MAP[l2] || '',
    l3, l3Name: L3_MAP[l3] || '',
    l4
  };
}

// Compute consistent Folder Path + Base Name + Photo Filenames for a single markup item
export function itemNaming(m, groupName = '') {
  const F = m.family || {};
  const kind = recordKind(m);
  const isMark = kind === 'mark';
  const lv = isMark ? parseUniformat(F.uniformat || F.discipline || '', F.group || '') : { l1: '', l1Name: '', l2: '', l2Name: '', l3: '', l3Name: '', l4: '' };
  const tag = itemTag(m);
  const tLabel = typeMeta(m.type).label;
  const cat = isMark ? (F.category || (m.element && m.element.ifcType) || 'Object_Mark') : tLabel;
  const fam = isMark ? (F.familyName || cleanToken(markupTitle(m), 28) || 'Mark') : (cleanToken(markupTitle(m), 28) || tLabel);

  let folderPath;
  if (isMark) {
    const l1Dir = lv.l1 ? `${lv.l1}_${cleanToken(lv.l1Name || 'Group', 22)}` : 'Unclassified';
    const l3Dir = lv.l3 ? `${cleanToken(lv.l4 || lv.l3, 14)}_${cleanToken(cat, 26)}` : cleanToken(cat, 28);
    folderPath = `Marks/${l1Dir}/${l3Dir}`;
  } else if (kind === 'issue') {
    folderPath = `Issues`;
  } else {
    folderPath = `Notes/${cleanToken(tLabel, 20)}`;
  }

  const parts = [];
  if (groupName) parts.push(cleanToken(groupName, 20));
  parts.push(tag);
  if (isMark && (lv.l4 || lv.l3)) parts.push(cleanToken(lv.l4 || lv.l3, 14));
  parts.push(cleanToken(fam, 28));
  const baseName = parts.filter(Boolean).join('_');

  const sitePhotos = (m.photos || []).map((dataUrl, i) => {
    const ext = dataUrlExt(dataUrl);
    const seq = String(i + 1).padStart(2, '0');
    const fileName = `${baseName}_P${seq}.${ext}`;
    return { seq: i + 1, kind: 'SitePhoto', fileName, relativePath: `${folderPath}/${fileName}`, dataUrl };
  });

  const viewSnap = (typeof m.snapshot === 'string' && m.snapshot.startsWith('data:image'))
    ? (() => {
      const ext = dataUrlExt(m.snapshot);
      const fileName = `${baseName}_3D.${ext}`;
      return { seq: 0, kind: '3DView', fileName, relativePath: `${folderPath}/${fileName}`, dataUrl: m.snapshot };
    })()
    : null;

  const kindLabel = kind === 'mark' ? 'Mark' : kind === 'issue' ? 'Issue' : 'Note';
  return { tag, recordKind: kindLabel, lv, category: cat, familyName: isMark ? (F.familyName || '') : '', baseName, folderPath, sitePhotos, viewSnap };
}

function dataUrlExt(d) {
  const m = /^data:image\/([a-z0-9+.-]+);/i.exec(String(d || ''));
  if (!m) return 'jpg';
  const e = m[1].toLowerCase();
  return e === 'jpeg' ? 'jpg' : e === 'png' ? 'png' : e === 'webp' ? 'webp' : 'jpg';
}

function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const csvCell = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;

// Build Photo Directory CSV (1 row per photo; items with 0 photos still get 1 clean row with HasSitePhoto=No)
export function buildPhotoDirectoryCSV(project, { groupName = () => '', include3D = true, kindFilter = 'all' } = {}) {
  const headers = [
    'ItemTag', 'RecordKind', 'Number', 'CheckedAt', 'ModelFile',
    'L1', 'L1Group', 'L2', 'L2Group', 'L3', 'L3Element', 'L4Code',
    'RevitCategory', 'FamilyName', 'TypeName', 'Placement', 'Group', 'MarkType', 'Status', 'Title',
    'HasSitePhoto', 'PhotoCount', 'PhotoSeq', 'PhotoKind', 'FileName', 'FolderPath', 'RelativePath',
    'HostSurface', 'FacingDeg', 'OffsetZ', 'X', 'Y', 'Z', 'HostRevitId', 'HostElement', 'HostGUID', 'Author', 'Created'
  ];
  const rows = [headers];
  const kindOrder = { mark: 0, issue: 1, note: 2 };
  const marks = (project.markups || [])
    .filter((m) => kindFilter === 'all' || recordKind(m) === kindFilter)
    .slice()
    .sort((a, b) => ((kindOrder[recordKind(a)] ?? 9) - (kindOrder[recordKind(b)] ?? 9)) || ((a.number || 0) - (b.number || 0)));

  for (const m of marks) {
    const F = m.family || {};
    const gn = groupName(m.group);
    const nm = itemNaming(m, gn);
    const p = m.position || { x: 0, y: 0, z: 0 };
    const common = [
      nm.tag, nm.recordKind, m.number || 0, fmtDateTime(m.checkedAt || m.createdAt), m.modelName || '',
      nm.lv.l1, nm.lv.l1Name, nm.lv.l2, nm.lv.l2Name, nm.lv.l3, nm.lv.l3Name, nm.lv.l4,
      nm.category, nm.familyName, isObjectMark(m) ? (F.typeName || '') : '', isObjectMark(m) ? (F.placement || 'face-based') : '',
      gn, typeMeta(m.type).label, (STATUSES[m.status] || STATUSES.open).label, markupTitle(m),
      nm.sitePhotos.length ? 'Yes' : 'No', nm.sitePhotos.length
    ];
    const tail = [
      F.hostSurface || '', Number.isFinite(F.rotationDeg) ? Math.round(F.rotationDeg) : '',
      Number.isFinite(F.offsetZ) ? F.offsetZ : 0,
      (p.x || 0).toFixed(4), (p.y || 0).toFixed(4), (p.z || 0).toFixed(4),
      m.element && m.element.tag ? m.element.tag : '',
      m.element ? `${m.element.ifcType || ''}${m.element.name ? ' · ' + m.element.name : ''}` : '',
      m.element ? (m.element.guid || '') : '',
      m.author || '', m.createdAt || ''
    ];

    const files = [...nm.sitePhotos, ...(include3D && nm.viewSnap ? [nm.viewSnap] : [])];
    if (!files.length) {
      rows.push([...common, '', 'None', '', nm.folderPath, '', ...tail]);
    } else {
      for (const f of files) {
        rows.push([...common, f.seq || '3D', f.kind, f.fileName, nm.folderPath, f.relativePath, ...tail]);
      }
    }
  }

  const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return {
    csv,
    blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    rowCount: rows.length - 1,
    itemCount: marks.length
  };
}

// Export full Photo Pack ZIP: Photo_Directory.csv + all images organized into UniFormat folders
export async function exportPhotoPackZip(project, { groupName = () => '', include3D = true } = {}) {
  const zip = new JSZip();
  const dir = buildPhotoDirectoryCSV(project, { groupName, include3D });
  zip.file('Photo_Directory.csv', dir.csv);

  let photoCount = 0;
  let snapCount = 0;
  const marks = (project.markups || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
  for (const m of marks) {
    const nm = itemNaming(m, groupName(m.group));
    for (const f of nm.sitePhotos) {
      zip.file(f.relativePath, dataUrlToBytes(f.dataUrl));
      photoCount++;
    }
    if (include3D && nm.viewSnap) {
      zip.file(nm.viewSnap.relativePath, dataUrlToBytes(nm.viewSnap.dataUrl));
      snapCount++;
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, photoCount, snapCount, itemCount: marks.length, rowCount: dir.rowCount };
}
