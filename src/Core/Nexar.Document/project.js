// Project data model. Schema documented in docs/schema/nexar-project.schema.json
// (shared contract with NEXBIM, the future Unity app, and Revit scripts). All positions are IFC coordinates in metres, Z-up.
export const SCHEMA = 'nexar.project/1.0';

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

export const MARKUP_TYPES = {
  family:  { label: 'Mark',    color: '#DFB73A', icon: 'cube',  kind: 'mark' },
  note:    { label: 'Note',    color: '#5B8CFF', icon: 'note',  kind: 'note' },
  issue:   { label: 'Issue',   color: '#E56565', icon: 'issue', kind: 'note' },
  capture: { label: 'Capture', color: '#4CB884', icon: 'photo', kind: 'note' }
};
// Normalize legacy 'comment' type into unified 'note'
export function normType(t) { return t === 'comment' ? 'note' : (MARKUP_TYPES[t] ? t : 'note'); }
export function typeMeta(t) { return MARKUP_TYPES[normType(t)] || MARKUP_TYPES.note; }
export function recordKind(m) {
  if (!m) return 'note';
  const t = normType(m.type);
  return t === 'family' ? 'mark' : 'note';
}
export function isObjectMark(m) { return recordKind(m) === 'mark'; }
export function itemTag(m) {
  const pre = isObjectMark(m) ? 'MK' : 'NT';
  return `${pre}-${String((m && m.number) || 0).padStart(3, '0')}`;
}
export function pinLabel(m) {
  return `${isObjectMark(m) ? 'M' : 'N'}${(m && m.number) || 0}`;
}

export const STATUSES = {
  open: { label: 'Open', bcf: 'Open' },
  'in-progress': { label: 'In progress', bcf: 'In Progress' },
  resolved: { label: 'Resolved', bcf: 'Resolved' },
  closed: { label: 'Closed', bcf: 'Closed' }
};
export const PRIORITIES = { low: 'Low', normal: 'Normal', high: 'High' };

export function statusColor(m) {
  if (m.status === 'resolved') return '#4CB884';
  if (m.status === 'closed') return '#77777C';
  return typeMeta(m.type).color;
}

export function newProject(name = 'Untitled project') {
  const now = new Date().toISOString();
  return {
    schema: SCHEMA,
    id: uuid(),
    name,
    createdAt: now,
    modifiedAt: now,
    units: 'm',
    coordinateSystem: { up: 'Z', handedness: 'right', note: 'All positions are IFC/project coordinates in metres' },
    models: [],
    geo: { anchor: null, controlPoints: [] },
    markups: [],
    groups: [],
    views: [],
    tracks: [],
    nextNumber: 1,
    nextMarkNumber: 1,
    nextNoteNumber: 1,
    app: { viewOrigin: null }
  };
}

export function nextNumberFor(project, type) {
  const k = normType(type) === 'family' ? 'mark' : 'note';
  const list = (project && project.markups) ? project.markups.filter((x) => recordKind(x) === k) : [];
  return list.length + 1;
}

// Auto-renumber both streams (MK-001..N and NT-001..M) cleanly with zero gaps after delete / re-type / import
export function renumberMarkups(project) {
  if (!project || !Array.isArray(project.markups)) return;
  const marks = [], notes = [];
  for (const m of project.markups) {
    m.type = normType(m.type);
    m.kind = recordKind(m);
    if (!m.checkedAt) m.checkedAt = m.createdAt || new Date().toISOString();
    if (m.kind === 'mark') marks.push(m); else notes.push(m);
  }
  const byOrder = (a, b) => ((a.number || 1e9) - (b.number || 1e9)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  marks.sort(byOrder);
  notes.sort(byOrder);
  marks.forEach((m, i) => { m.number = i + 1; });
  notes.forEach((m, i) => { m.number = i + 1; });
  project.nextMarkNumber = marks.length + 1;
  project.nextNoteNumber = notes.length + 1;
  project.nextNumber = project.markups.length + 1;
}

export function newMarkup(p, fields = {}) {
  const now = new Date().toISOString();
  const t = normType(fields.type || 'family');
  const k = t === 'family' ? 'mark' : 'note';
  const num = fields.number != null ? fields.number : (p && Array.isArray(p.markups) ? nextNumberFor(p, t) : ((p && p.nextNumber++) || 1));
  return {
    id: uuid(),
    kind: k,
    number: num,
    type: t,
    title: '',
    text: '',
    status: 'open',
    priority: 'normal',
    assignedTo: '',
    group: null,
    author: '',
    createdAt: now,
    checkedAt: now,
    modifiedAt: now,
    modelName: '',
    position: { x: 0, y: 0, z: 0 },
    element: null,
    family: null,
    gps: null,
    source: '3d',
    viewpoint: null,
    snapshot: null,
    photos: [],
    replies: [],
    locked: false,
    ...fields,
    type: t,
    kind: k
  };
}

export function markupTitle(m) {
  if (m.title) return m.title;
  if (m.family && m.family.familyName) return `${m.family.familyName}${m.family.typeName ? ' · ' + m.family.typeName : ''}`;
  const t = (m.text || '').split('\n')[0].trim();
  return t ? t.slice(0, 60) : `${typeMeta(m.type).label} ${itemTag(m)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toDatetimeLocal(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDateTime(iso);
}
