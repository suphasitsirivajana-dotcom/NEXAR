// NEXAR — main application wiring.
import * as THREE from 'three';
import { APP_VERSION, CATALOG_VERSION, SETTINGS_KEY, LAST_KEY, LOCATION_FEATURES, DEFAULT_SETTINGS, DEFAULT_FAMILY_PRESETS, UNIFORMAT_GROUPS, UNIFORMAT_L2 } from '../../../settings/defaults.js';
import { Viewer } from './viewer.js';
import { loadModelFile, getIfcElementInfo, ifcColumnIds, extOf, MODEL_EXT } from '../../Core/Nexar.Loaders/loaders.js';
import { store } from '../../Core/Nexar.Document/store.js';
import { Ribbon, toast, hint, hideHint, modal, confirmBox, promptBox, download, fileToDataURL, $, $$, h, esc } from './ui.js';
import { icon, LOGO, LOGO_LOCKUP, LOGO_HERO } from './icons.js';
import { newProject, newMarkup, uuid, MARKUP_TYPES, STATUSES, PRIORITIES, normType, typeMeta, recordKind, isObjectMark, itemTag, pinLabel, renumberMarkups, nextNumberFor, statusColor, markupTitle, fmtDateTime, toDatetimeLocal, timeAgo, SCHEMA } from '../../Core/Nexar.Document/project.js';
import { gpsToModel, modelToGps, ifcToRaw, rawToIfc, gpsToEN, bearingFromPair, normDeg, normDeg180, modelHeadingOfRawDir, fmtM, fmtLL } from '../../Core/Nexar.Spatial/geo.js';
import { GPS, DeviceOrient, StepTracker } from '../../Core/Nexar.Sensors/sensors.js';
import { ARController, xrARSupported } from './ar.js';
import { exportBCF, importBCF } from '../../Exporters/bcf.js';
import { itemNaming, buildPhotoDirectoryCSV, exportPhotoPackZip } from '../../Exporters/photopack.js';
import { encodeCP, decodeCP, cpSheet, startScan, decodeImageFile, detectQR } from '../../Core/Nexar.Sensors/qr.js';
import { poseFromDetection, poseToModel } from '../../Core/Nexar.Spatial/pose.js';

// ================================================================ settings
const settings = { ...DEFAULT_SETTINGS };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  Object.assign(settings, saved);
  if (!saved.theme) {
    const legacyTheme = localStorage.getItem('nx-theme');
    if (legacyTheme === 'light' || legacyTheme === 'dark') settings.theme = legacyTheme;
  }
} catch (e) { /* private mode */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };
function normalizePreset(p) {
  const uf = String(p.uniformat || p.discipline || 'D5030').toUpperCase();
  const grp = p.group || (/^[A-G]/.test(uf) ? uf[0] : 'D');
  const l2 = p.l2 || uf.slice(0, 3);
  return {
    id: p.id || ('p-' + Math.random().toString(36).slice(2, 8)),
    uniformat: uf,
    l2,
    group: grp,
    l3Name: p.l3Name || '',
    category: p.category || 'Generic Models',
    familyName: String(p.familyName || 'Marker').replace(/^NEX_/, ''),
    typeName: p.typeName || '',
    placement: p.placement === 'level-based' ? 'level-based' : 'face-based',
    offsetZ: Number.isFinite(p.offsetZ) ? p.offsetZ : 0,
    pinned: p.pinned !== false
  };
}
function getFamilyPresets() {
  if (!Array.isArray(settings.familyPresets) || !settings.familyPresets.length || (settings.catalogVer || 0) < CATALOG_VERSION) {
    // Seamless upgrade to full ASTM E1557 UniFormat II catalog while preserving any custom presets
    const custom = Array.isArray(settings.familyPresets) ? settings.familyPresets.filter((x) => String(x.id || '').startsWith('custom-')) : [];
    const merged = [...DEFAULT_FAMILY_PRESETS, ...custom].map(normalizePreset);
    if (Array.isArray(settings.familyPresets) && (settings.catalogVer || 0) < CATALOG_VERSION) {
      settings.familyPresets = merged;
      settings.catalogVer = CATALOG_VERSION;
      saveSettings();
    }
    return merged;
  }
  return settings.familyPresets.map(normalizePreset);
}
function getPinnedPresets() {
  const all = getFamilyPresets();
  const pinned = all.filter((p) => p.pinned);
  return pinned.length ? pinned : all.slice(0, 6);
}
const UNIT_SCALE = { m: 1, mm: 1000, cm: 100, ft: 3.280839895 };
function fmtCoord(metres) {
  const u = settings.units || 'm';
  const k = UNIT_SCALE[u] || 1;
  const dec = u === 'mm' ? 0 : (settings.precision ?? 2);
  return `${(metres * k).toFixed(dec)} ${u}`;
}

// Contextual popover menus (Topbar Project / Export & Bottom Dock More)
function closePopover() { $('#menu-root').innerHTML = ''; }
function openPopover(anchor, items, { align = 'left', above = false } = {}) {
  const root = $('#menu-root');
  if (root.dataset.anchorId === anchor.id && root.children.length) { closePopover(); return; }
  closePopover();
  root.dataset.anchorId = anchor.id || '';
  const bg = h('<div class="pop-backdrop"></div>');
  bg.onclick = closePopover;
  const menu = h('<div class="pop-menu"></div>');
  for (const it of items) {
    if (it.sep) { menu.appendChild(h('<div class="pop-sep"></div>')); continue; }
    if (it.sec) { menu.appendChild(h(`<div class="pop-sec">${esc(it.sec)}</div>`)); continue; }
    const b = h(`<button type="button" class="pop-item ${it.on ? 'on' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.sub ? `<span class="pop-sub">${esc(it.sub)}</span>` : ''}</button>`);
    b.onclick = () => { if (!it.keepOpen) closePopover(); it.onClick && it.onClick(); };
    menu.appendChild(b);
  }
  root.append(bg, menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 230, mh = menu.offsetHeight || 200;
  let left = align === 'right' ? r.right - mw : align === 'center' ? r.left + r.width / 2 - mw / 2 : r.left;
  left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
  let top = above ? r.top - mh - 8 : r.bottom + 6;
  if (top < 8) top = Math.min(window.innerHeight - mh - 8, r.bottom + 6);
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// ================================================================ state
// CAM state (Walk mode): live camera with the model fitted into it at true scale
const cam = { on: false, stream: null, prevFov: 55, view: settings.camView === 'split' ? 'split' : 'overlay', anchor: null, qr: false, qrT: 0, qrLast: 0 };
const app = {
  project: null,
  tool: 'select', toolData: null,
  sel: null,               // selected markup id
  elSel: null,             // { modelId, eid, info }
  loc: { ifc: null, raw: null, acc: null, heading: null, corr: { x: 0, y: 0 }, fix: null, fixZ: null },
  panelTab: 'markups', mkFilter: 'all',
  xr: false,
  dirty: false
};
const isTouch = matchMedia('(pointer: coarse)').matches;

// ================================================================ core objects
const viewer = new Viewer($('#viewport'), $('#c'));
viewer.walk.eye = settings.eye;
viewer.setGrid(settings.grid);
viewer.scopeOn = settings.scope; viewer.scopeFactor = settings.scopeFactor;
viewer.addEventListener('scope-limit', () => toast('Scope limit reached — press Home or turn off Scope in View', 'info', 1400));
const gps = new GPS();
const orient = new DeviceOrient();
const steps = new StepTracker();
viewer.orientSource = orient;
const ar = new ARController({
  viewer, orient, video: $('#camfeed'), overlay: $('#ar-overlay'), settings, toast,
  getRefs, getPositionRaw: () => app.loc.raw, getBearing, onMark: createMarkupFromAR,
  getFaceHeading, toggleSteps: () => cycleTrack(), stepsActive: () => steps.active, trackLabel: () => TRACK_LABEL[settings.trackMode],
  manualStep: () => doStep(false), stepCount: () => app._stepN || 0,
  onQrDetect: (det, K) => onQrDetect(det, K),
  toggleTripod: () => toggleTripod(), tripodActive: () => !!app.loc.tripod
});
ar.addEventListener('end', () => { syncModeUI(); });

// ================================================================ ribbon
// APP_VERSION and LOCATION_FEATURES live in settings/defaults.js.
const LOCATION_CMDS = new Set(['walk-mark', 'self-mark', 'face-point', 'set-location', 'gps', 'follow', 'qr-scan', 'track', 'track-clear',
  'heading-2pt', 'compass', 'ar-xr', 'ar-cam', 'walk-track', 'track-mode', 'steps']);

const RIBBON_FULL = [
  { id: 'home', label: 'Home', groups: [
    { label: 'Project', items: [
      { cmd: 'new', icon: 'newfile', label: 'New', tip: 'New project' },
      { cmd: 'open-model', icon: 'open', label: 'Open Model', tip: 'Open an IFC / DXF / GLB / OBJ file' },
      { cmd: 'projects', icon: 'layers', label: 'Projects', tip: 'Projects stored on this device' },
      { cmd: 'save', icon: 'save', label: 'Save', tip: 'Download the project file (.nexar.json)' }] },
    { label: 'Navigate', items: [
      { cmd: 'walk-mark', icon: 'walk', label: 'Walk&Mark', tip: 'Simple mode: tap where you stand → walk → mark where you stand' },
      { cmd: 'mode-orbit', icon: 'orbit', label: '3D', tip: 'Orbit the 3D model' },
      { cmd: 'mode-plan', icon: 'plan', label: 'Plan', tip: 'Plan view (section cut)' },
      { cmd: 'mode-walk', icon: 'walk', label: 'Walk', tip: 'Walk through the model (WASD / sticks)' },
      { cmd: 'gyro', icon: 'gyro', label: 'Gyro', tip: 'Optional: turn the device to look around (Walk mode)' },
      { cmd: 'home', icon: 'home', label: 'Home', tip: 'Back to the Home view (H)' },
      { cmd: 'set-home', icon: 'sethome', label: 'Set Home', tip: 'Set the current view as Home' },
      { cmd: 'fit', icon: 'fit', label: 'Fit', tip: 'Zoom to fit the whole model' }] },
    { label: 'Markup', items: [
      { cmd: 'select', icon: 'select', label: 'Select' },
      { cmd: 'capture', icon: 'photo', label: 'Capture', tip: 'Capture this view into the active group (C)' },
      { cmd: 'mark-center', icon: 'pin', label: 'Mark', tip: 'Mark the point under the crosshair (M)' },
      { cmd: 'groups', icon: 'layers', label: 'Group', tip: 'Group captures and marks in sequence' },
      { cmd: 'save-view', icon: 'bookmark', label: 'Save View' }] }] },
  { id: 'markup', label: 'Markup', groups: [
    { label: 'Create', items: [
      { cmd: 'capture', icon: 'photo', label: 'Capture', tip: 'Capture this view into the active group (C)' },
      { cmd: 'mark-center', icon: 'pin', label: 'Quick Note', tip: 'Drop a note at the crosshair (M)' },
      { cmd: 'groups', icon: 'layers', label: 'Group' },
      { cmd: 'mk-family', icon: 'cube', label: 'Mark (IFC)', tip: 'Place an IFC Object Mark (MK-###)' },
      { cmd: 'mk-note', icon: 'note', label: 'Note', tip: 'Place a read-only Note / Comment (NT-###)' },
      { cmd: 'mk-issue', icon: 'issue', label: 'Issue', tip: 'Place a site Issue note (NT-###)' }] },
    { label: 'Edit', items: [
      { cmd: 'mk-edit', icon: 'edit', label: 'Edit' },
      { cmd: 'mk-lock', icon: 'lock', label: 'Lock', tip: 'Lock the selected markup (no edit / delete)' },
      { cmd: 'mk-resolve', icon: 'resolve', label: 'Resolve' },
      { cmd: 'mk-delete', icon: 'trash', label: 'Delete' }] },
    { label: 'Show', items: [
      { cmd: 'toggle-markups', icon: 'pin', label: 'Pins' },
      { cmd: 'panel-markups', icon: 'panel', label: 'List' }] }] },
  { id: 'view', label: 'View', groups: [
    { label: 'Saved views', items: [
      { cmd: 'save-view', icon: 'bookmark', label: 'Save View' },
      { cmd: 'panel-views', icon: 'views', label: 'Views' }] },
    { label: 'Display', items: [
      { cmd: 'xray', icon: 'xray', label: 'X-Ray' },
      { cmd: 'section', icon: 'section', label: 'Section', tip: 'Horizontal section (plan cut)' },
      { cmd: 'grid', icon: 'grid', label: 'Grid' },
      { cmd: 'models', icon: 'layers', label: 'Models' }] },
    { label: 'Site QR', items: [
      { cmd: 'qr-create', icon: 'qr', label: 'Create QR', tip: 'Create a QR at model coordinates — print it, fix it on site, then QR LOCK in CAM' }] },
    { label: 'Navigation', items: [
      { cmd: 'home', icon: 'home', label: 'Home', tip: 'Back to the Home view (H)' },
      { cmd: 'set-home', icon: 'sethome', label: 'Set Home', tip: 'Set the current view as Home' },
      { cmd: 'scope', icon: 'scope', label: 'Scope', tip: 'Scope box: keep the model on screen and the camera in range' },
      { cmd: 'nav-lock', icon: 'navlock', label: 'Lock View', tip: 'Lock the view (no orbit / pan)' },
      { cmd: 'fit', icon: 'fit', label: 'Fit' }] }] },
  { id: 'site', label: 'Site', groups: [
    { label: 'Location', items: [
      { cmd: 'self-mark', icon: 'pin', label: "I'm Here", tip: 'Self-mark: tap where you stand on the plan (e.g. next to a column)' },
      { cmd: 'face-point', icon: 'target', label: 'Face Point', tip: 'Tap the point you are facing (e.g. the next column) to lock the heading' },
      { cmd: 'set-location', icon: 'anchor', label: 'Set Location', tip: 'Stand on a point → tap it on the plan → capture GPS' },
      { cmd: 'gps', icon: 'gps', label: 'Locate Me', tip: 'Turn on GPS and show your position on the plan' },
      { cmd: 'follow', icon: 'follow', label: 'Follow', tip: 'Walk camera follows GPS' }] },
    { label: 'QR control point', items: [
      { cmd: 'qr-create', icon: 'qr', label: 'Create QR', tip: 'Create a QR at model coordinates for the surveyor to set out' },
      { cmd: 'qr-scan', icon: 'scan', label: 'Scan QR', tip: 'Scan a QR on site to lock your position' }] },
    { label: 'Path', items: [
      { cmd: 'track', icon: 'path', label: 'Path', tip: 'Show the walked path' },
      { cmd: 'track-clear', icon: 'erase', label: 'Clear' }] },
    { label: 'Calibrate', items: [
      { cmd: 'heading-2pt', icon: 'twopoint', label: '2nd Point', tip: 'Refine heading with a second point (better than the compass)' },
      { cmd: 'compass', icon: 'compass', label: 'Compass' }] }] },
  { id: 'ar', label: 'AR', groups: [
    { label: 'Augmented reality', items: [
      { cmd: 'ar-xr', icon: 'ar', label: 'WebXR AR', tip: 'Android Chrome (ARCore) — tracking 6DoF' },
      { cmd: 'ar-cam', icon: 'camera', label: 'Camera AR', tip: 'iPhone / iPad / any device — camera + gyro + GPS/QR' }] },
    { label: 'Walkthrough', items: [
      { cmd: 'self-mark', icon: 'pin', label: "I'm Here", tip: 'Tap where you stand on the plan' },
      { cmd: 'mode-walk', icon: 'walk', label: 'Walk' },
      { cmd: 'walk-track', icon: 'walk', label: 'Walk Track', tip: 'Walk for real: the model follows your steps and the phone heading' },
      { cmd: 'track-mode', icon: 'path', label: 'Tracking', tip: 'Switch tracking: Hybrid (steps + GPS) → Steps only → GPS' },
      { cmd: 'gyro', icon: 'gyro', label: 'Gyro Look', tip: 'Turn the phone to look around' },
      { cmd: 'follow', icon: 'follow', label: 'Follow GPS' }] },
    { label: 'Setup', items: [{ cmd: 'settings', icon: 'sliders', label: 'Settings' }] }] },
  { id: 'share', label: 'Export', groups: [
    { label: 'Object Marks (IFC)', items: [
      { cmd: 'ifc-export', icon: 'ifc', label: 'IFC + Marks', tip: 'Export Object Marks (MK-###) into IFC with parameters (Revit: Link IFC)' },
      { cmd: 'xlsx-export', icon: 'table', label: 'UniFormat Excel', tip: 'Export used UniFormat L1–L4 Object Marks (.xlsx)' },
      { cmd: 'marks-json', icon: 'json', label: 'Marks JSON', tip: 'Object Marks JSON only (_Marks.json)' }] },
    { label: 'Notes (Read-Only)', items: [
      { cmd: 'notes-xlsx', icon: 'table', label: 'Notes Excel', tip: 'Export site Notes / Comments separately (.xlsx)' },
      { cmd: 'notes-csv', icon: 'table', label: 'Notes CSV', tip: 'Export site Notes / Comments (.csv)' },
      { cmd: 'notes-json', icon: 'json', label: 'Notes JSON', tip: 'Notes JSON only (_Notes.json)' }] },
    { label: 'Share & Project', items: [
      { cmd: 'html-export', icon: 'html', label: 'Interactive HTML', tip: 'One .html file: model + marks + photos — opens in any browser' },
      { cmd: 'photo-zip', icon: 'photo', label: 'Photo Pack ZIP', tip: 'Organized UniFormat photo folders + Photo_Directory.csv' },
      { cmd: 'photo-csv', icon: 'table', label: 'Photo Dir CSV', tip: 'Categorized Photo Directory CSV only' },
      { cmd: 'bcf-export', icon: 'bcf', label: 'Export BCF', tip: 'Open in Revit / Navisworks / Solibri / BIMcollab' },
      { cmd: 'bcf-import', icon: 'import', label: 'Import BCF' },
      { cmd: 'json-export', icon: 'json', label: 'Full Backup', tip: 'Full NEXAR project backup (.nexar.json)' },
      { cmd: 'json-import', icon: 'import', label: 'Import JSON' },
      { cmd: 'csv-export', icon: 'table', label: 'All CSV' }] },
    { label: 'Help', items: [{ cmd: 'manual', icon: 'info', label: 'Manual', tip: 'How to use NEXAR (opens in a new tab)' }, { cmd: 'settings', icon: 'sliders', label: 'Settings' }, { cmd: 'revit-guide', icon: 'bcf', label: 'Revit Guide' }] }] }
];
// shelved features: drop the Site / AR tabs and every location button (the code stays, nothing is deleted)
const RIBBON = LOCATION_FEATURES ? RIBBON_FULL : RIBBON_FULL
  .filter((t) => t.id !== 'site' && t.id !== 'ar')
  .map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, items: g.items.filter((i) => !LOCATION_CMDS.has(i.cmd)) })).filter((g) => g.items.length) }));
const ribbon = new Ribbon($('#ribbon-tabs'), $('#ribbon'), RIBBON, onCommand);
// mouse wheel scrolls the ribbon sideways when it is wider than the window
for (const el of [$('#ribbon'), $('#ribbon-tabs')]) {
  el.addEventListener('wheel', (e) => {
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); el.scrollLeft += e.deltaY;
  }, { passive: false });
}

async function onCommand(cmd) {
  const P = app.project;
  switch (cmd) {
    case 'new': return cmdNewProject();
    case 'open-model': return $('#file-model').click();
    case 'projects': return cmdProjects();
    case 'save': case 'json-export': return download(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' }), `${slug(P.name)}.nexar.json`);
    case 'json-import': case 'bcf-import': $('#file-project').dataset.kind = cmd; return $('#file-project').click();
    case 'mode-orbit': return setMode('orbit');
    case 'mode-plan': return setMode('plan');
    case 'mode-walk': return setMode('walk');
    case 'fit': return viewer.fitAll();
    case 'home': return goHome();
    case 'set-home': return setHome();
    case 'scope': settings.scope = !settings.scope; saveSettings(); viewer.scopeOn = settings.scope; toast(settings.scope ? 'Scope box on — model stays in view' : 'Scope box off — free navigation', 'info'); return syncToggles();
    case 'select': return setTool('select');
    case 'mk-family': return startPlace('family');
    case 'mk-comment': return startPlace('note');
    case 'mk-note': return startPlace('note');
    case 'mk-issue': return startPlace('issue');
    case 'mk-photo': return startPlace('note', true);
    case 'mk-edit': return withSel((m) => openMarkupEditor(m, false));
    case 'mk-lock': return withSel((m) => { m.locked = !m.locked; touch(m); toast(m.locked ? 'Markup locked' : 'Markup unlocked', 'ok'); });
    case 'mk-resolve': return withSel((m) => { if (m.locked) return toast('Markup is locked', 'warn'); m.status = m.status === 'resolved' ? 'open' : 'resolved'; touch(m); });
    case 'mk-delete': return withSel((m) => deleteMarkup(m));
    case 'toggle-markups': settings.showMarkups = !settings.showMarkups; saveSettings(); refreshMarkers(); return syncToggles();
    case 'panel-markups': return openPanel('markups');
    case 'panel-views': return openPanel('views');
    case 'models': return openPanel('info');
    case 'save-view': return saveView();
    case 'capture': return captureView();
    case 'mark-center': return markCenter();
    case 'groups': return groupDialog();
    case 'xray': viewer.setXray(!viewer.xray); return syncToggles();
    case 'section': return setSection(!viewer.clipOn);
    case 'grid': settings.grid = !settings.grid; saveSettings(); viewer.setGrid(settings.grid); return syncToggles();
    case 'nav-lock': viewer.setNavLocked(!viewer.navLocked); toast(viewer.navLocked ? 'View locked' : 'View unlocked', 'info'); return syncToggles();
    case 'self-mark': return startSelfMark();
    case 'walk-mark': return startWalkMark();
    case 'face-point': return startFacePoint();
    case 'steps': return toggleSteps();
    case 'track-mode': return cycleTrack();
    case 'walk-track': return startWalkTrack();
    case 'set-location': return anchorWizard();
    case 'gps': return toggleGPS();
    case 'follow': viewer.walk.follow = !viewer.walk.follow; if (viewer.walk.follow) { if (!gps.active) await toggleGPS(); setMode('walk'); } return syncToggles();
    case 'gyro': return toggleGyro();
    case 'qr-create': return startCPCreate();
    case 'qr-scan': return scanQR();
    case 'track': settings.showTrack = !settings.showTrack; saveSettings(); renderTrack(); return syncToggles();
    case 'track-clear': if (await confirmBox('Clear path', 'Delete all recorded paths?', 'Clear', true)) { P.tracks = []; save(); renderTrack(); } return;
    case 'heading-2pt': return twoPointWizard();
    case 'compass': return compassDialog();
    case 'ar-xr': return startXR();
    case 'ar-cam': return startCamAR();
    case 'settings': return settingsDialog();
    case 'bcf-export': return cmdExportBCF();
    case 'html-export': return cmdExportHTML();
    case 'manual': return window.open(`./docs/manual.html?v=${APP_VERSION}`, '_blank');
    case 'ifc-export': return cmdExportIFC();
    case 'xlsx-export': return cmdExportXLSX();
    case 'marks-json': return cmdExportSplitJSON('mark');
    case 'notes-xlsx': return cmdExportNotesXLSX();
    case 'notes-csv': return cmdExportNotesCSV();
    case 'notes-json': return cmdExportSplitJSON('note');
    case 'photo-zip': return cmdExportPhotoZip();
    case 'photo-csv': return cmdExportPhotoCSV();
    case 'csv-export': return cmdExportCSV();
    case 'revit-guide': return revitGuide();
    default: console.warn('unknown command', cmd);
  }
}
function withSel(fn) {
  const m = app.project.markups.find((x) => x.id === app.sel);
  if (!m) { toast('Select a markup first (tap a pin or pick one in the list)', 'warn'); return; }
  fn(m);
}
function syncToggles() {
  ribbon.setActive('xray', viewer.xray);
  ribbon.setActive('section', viewer.clipOn);
  ribbon.setActive('grid', settings.grid);
  ribbon.setActive('nav-lock', viewer.navLocked);
  ribbon.setActive('scope', settings.scope);
  ribbon.setActive('steps', steps.active);
  ribbon.setActive('walk-track', steps.active && viewer.walk.gyro && viewer.walk.follow && viewer.mode === 'walk');
  ribbon.setActive('face-point', app.tool === 'face');
  ribbon.setActive('gps', gps.active);
  ribbon.setActive('follow', viewer.walk.follow);
  ribbon.setActive('gyro', viewer.walk.gyro);
  ribbon.setActive('track', settings.showTrack);
  ribbon.setActive('toggle-markups', settings.showMarkups);
  const sel = app.project && app.project.markups.find((x) => x.id === app.sel);
  ribbon.setActive('mk-lock', !!(sel && sel.locked));
  for (const t of ['select', 'mk-family', 'mk-comment', 'mk-note', 'mk-issue', 'mk-photo', 'set-location', 'qr-create', 'heading-2pt']) ribbon.setActive(t, false);
  ribbon.setActive('self-mark', app.tool === 'self');
  const toolCmd = { select: 'select', anchor: 'set-location', cp: 'qr-create', second: 'heading-2pt' }[app.tool]
    || (app.tool === 'place' ? (app.toolData.photo ? 'mk-photo' : `mk-${app.toolData.type}`) : null);
  if (toolCmd) ribbon.setActive(toolCmd, true);
  ribbon.setActive('mode-orbit', viewer.mode === 'orbit'); ribbon.setActive('mode-plan', viewer.mode === 'plan'); ribbon.setActive('mode-walk', viewer.mode === 'walk');
  $('#lock-badge').hidden = !viewer.navLocked;
  // Sync Clean Field Bottom Dock toggles
  const dCam = $('#dock-cam'); if (dCam) dCam.classList.toggle('tool-on', cam.on);
  const dMeas = $('#dock-measure'); if (dMeas) dMeas.classList.toggle('tool-on', app.tool === 'measure');
  const dSec = $('#dock-section'); if (dSec) dSec.classList.toggle('tool-on', viewer.clipOn);
  const dXray = $('#dock-xray'); if (dXray) dXray.classList.toggle('tool-on', viewer.xray);
  const dMark = $('#dock-mark'); if (dMark) dMark.classList.toggle('tool-on', app.tool === 'place');
  renderFamilyBar();
}
// re-sync when the ribbon tab changes (it re-renders)
new MutationObserver(() => syncToggles()).observe($('#ribbon'), { childList: true });

// ================================================================ modes & tools
function setMode(m) {
  if (ar.active) ar.stop();
  const first = m === 'plan' && !app._planSeen;
  viewer.setMode(m);
  if (m === 'plan' && !app._planHint) { app._planHint = true; toast('Plan view: drag to pan · pinch to zoom · switch to 3D to orbit', 'info', 4000); }
  if (m === 'walk' && !isTouch && !app._walkHint) { app._walkHint = true; toast('Walk mode: WASD to move · Q/E up-down · Drag to look · Shift = fast', 'info', 4500); }
  if (first) { app._planSeen = true; if (!viewer.clipOn) setSection(true); viewer.fitAll(); }
  syncModeUI();
}
function syncModeUI() {
  $$('#modebar [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === viewer.mode || (b.dataset.mode === 'ar' && (viewer.mode === 'xr' || viewer.mode === 'cam-ar'))));
  const walking = viewer.mode === 'walk';
  const tc = settings.touchControls || 'auto';
  const showSticks = walking && (tc === 'always' || (tc === 'auto' && isTouch));
  document.body.classList.toggle('show-sticks', showSticks);
  // game-style controls in Walk: left stick = move, right stick = look (iPad/touch or Always On), ▲▼ = fly up / down, speed
  $('#joystick').hidden = !showSticks;
  $('#joystick-look').hidden = !showSticks;
  $('#fly').hidden = !walking;
  $('#gyro-btn').hidden = !(walking && isTouch);
  $('#gyro-btn').classList.toggle('on', !!viewer.walk.gyro);
  $('#gyro-state').textContent = viewer.walk.gyro ? 'ON' : 'OFF';
  $('#cam-btn').hidden = !walking;
  $('#cam-btn').classList.toggle('on', cam.on);
  $('#cam-state').textContent = cam.on ? 'ON' : 'OFF';
  $('#cam-panel').hidden = !(walking && cam.on);
  $('#step-btn').hidden = !LOCATION_FEATURES || (app.wm ? app.wm.state !== 'walk' : !(walking && app.loc.stepMode));
  $('#crosshair').hidden = !(viewer.mode === 'cam-ar' || walking); // aim point for Mark / Capture
  $('#quick').hidden = viewer.mode === 'xr' || viewer.mode === 'cam-ar';
  document.body.dataset.mode = viewer.mode;
  syncToggles();
}
// Ground points (anchor / QR) are picked most accurately on a cut plan, not on the roof in 3D
function goPlanForPicking() {
  // remember where the user was, so we can put them back (otherwise they stay stuck in Plan, which cannot rotate)
  if (!app.prePick) app.prePick = { mode: viewer.mode, clip: viewer.clipOn };
  if (viewer.mode !== 'plan') setMode('plan');
  if (!viewer.clipOn) setSection(true);
}
function restorePickMode() {
  const p = app.prePick; app.prePick = null;
  if (!p) return;
  if (p.mode !== viewer.mode && (p.mode === 'orbit' || p.mode === 'walk')) setMode(p.mode);
  if (!p.clip && viewer.clipOn) setSection(false);
}
// ---------------- Home view (like the Revit ViewCube home)
function goHome() {
  const h = app.project && app.project.app.home;
  if (viewer.mode !== 'orbit' && viewer.mode !== 'plan' && viewer.mode !== 'walk') return;
  if (h) viewer.setViewState(h); else viewer.fitAll();
  syncModeUI();
}
function setHome() {
  app.project.app.home = viewer.getViewState();
  save();
  toast('Home view set — press Home / H to come back', 'ok');
}

function setTool(t, data = null) {
  app.tool = t; app.toolData = data;
  viewer.penTapPriority = t !== 'select';
  if (t === 'select') hideHint();
  else if (window.innerWidth < 900) { document.body.classList.remove('panel-open'); setTimeout(() => viewer.resize(), 300); } // free the screen on phones
  document.body.dataset.tool = t;
  syncToggles();
}
function cancelTool() {
  if (app.hostLock) { app.hostLock = null; viewer.clearHighlight(); }
  setTool('select'); restorePickMode();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); closePopover(); return settingsDialog(); }
  if (e.key === 'Escape') { closePopover(); if (!$('#modal-root').children.length) cancelTool(); return; }
  if (/input|textarea|select/i.test(e.target.tagName) || $('#modal-root').children.length) return;
  if (e.key === 'f' || e.key === 'F') viewer.fitAll();
  if (e.key === 'h' || e.key === 'H') goHome();
  if (e.key === '1') setMode('orbit'); if (e.key === '2') setMode('plan'); if (e.key === '3') setMode('walk');
  if (e.key === 'c' || e.key === 'C') captureView();
  if (e.key === 'r' || e.key === 'R') toggleMeasure();
  if (e.key === 'm' || e.key === 'M') { if (settings.uiMode !== 'ribbon') toggleQuickMark(); else markCenter(); }
  if (e.key === 'n' || e.key === 'N') startPlace('note');
  if (e.key === 'Delete' && app.sel) withSel(deleteMarkup);
});

function startPlace(type, photo = false, presetId = null) {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  type = normType(type || 'family');
  const pinned = getPinnedPresets();
  const all = getFamilyPresets();
  const pid = type === 'family' ? (presetId || (app.activePresetId && all.some((x) => x.id === app.activePresetId) ? app.activePresetId : (pinned[0] && pinned[0].id)) || null) : null;
  app.activeMarkType = type;
  if (pid) app.activePresetId = pid;
  if (app.fastMark === undefined) app.fastMark = true;
  // Note / Issue always open the form immediately; Object Mark (IFC) uses 1-Tap by default
  const instant = type === 'family' && !photo && app.fastMark;
  setTool('place', { type, photo, presetId: pid, instant });
  const p = pid ? all.find((x) => x.id === pid) : null;
  const label = p ? p.familyName.replace(/_/g, ' ') : typeMeta(type).label;
  const hostNote = app.hostLock ? ` on locked ${app.hostLock.info ? app.hostLock.info.ifcType : 'Host'}` : '';
  hint(instant ? `Click model to stamp Mark: ${label}${hostNote} (Esc to stop)` : `Click model to place ${label}${hostNote}`, cancelTool);
}

function toggleQuickMark() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (app.tool === 'place') return cancelTool();
  startPlace(app.activeMarkType || 'family', false, app.activePresetId);
}

// ---------------- 3D Tape Measure (point-to-point distance, XY horizontal, ΔZ vertical)
function refreshMeasures() {
  const segs = (app.measures || []).map((s) => ({ ...s, label: fmtCoord(s.d3D) }));
  viewer.setMeasures(segs, app.measureStart || null);
}
function toggleMeasure() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (app.tool === 'measure') { app.measureStart = null; refreshMeasures(); return cancelTool(); }
  app.measures = app.measures || [];
  app.measureStart = null;
  setTool('measure');
  refreshMeasures();
  hint('Measure: tap 1st point on the model (Esc to exit)', cancelTool);
}
function clearMeasures() {
  app.measures = [];
  app.measureStart = null;
  refreshMeasures();
  renderFamilyBar();
}

function renderFamilyBar() {
  const bar = $('#family-bar');
  if (!bar) return;
  if (app.tool === 'measure') {
    bar.hidden = false;
    const list = app.measures || [];
    const last = list[list.length - 1];
    const readout = last
      ? `<span class="meas-readout"><b>${fmtCoord(last.d3D)}</b> · XY ${fmtCoord(last.dXY)} · ΔZ ${fmtCoord(Math.abs(last.dz))}</span>`
      : `<span class="meas-readout">${app.measureStart ? 'Pick <b>2nd point</b>…' : 'Pick <b>1st point</b> on model'}</span>`;
    bar.innerHTML = `<div class="fb-row fb-modes">
      <div class="fb-mode-group"><span class="fb-chip mode-on">${icon('ruler')}<span>Measure</span></span>${readout}</div>
      <div class="fb-right-group">
        ${list.length ? `<button type="button" class="fb-chip" data-mundo="1">Undo</button><button type="button" class="fb-chip" data-mclear="1">Clear (${list.length})</button>` : ''}
        <button type="button" class="fb-close" data-cancel="1" title="Done (Esc)">${icon('x')}</button>
      </div>
    </div>`;
    return;
  }
  const active = app.tool === 'place' && app.toolData;
  bar.hidden = !active;
  if (!active) return;
  const curType = app.toolData.type || 'family';
  const curPid = app.toolData.presetId || app.activePresetId || null;
  const fast = app.fastMark !== false;
  const autoPh = !!app.autoPhoto;
  const pinned = getPinnedPresets();
  const modes = [['family', 'Mark (IFC)', 'cube'], ['note', 'Note', 'note'], ['issue', 'Issue', 'issue']];
  const hostChip = app.hostLock
    ? `<button type="button" class="fb-chip host-pill" data-unhost="1" title="Face-based Host locked — click to unlock">${icon('lock')}<span>Host: ${esc(app.hostLock.info ? (app.hostLock.info.name || app.hostLock.info.ifcType) : `#${app.hostLock.eid}`).slice(0, 18)}</span><span>✕</span></button>`
    : '';
  const row1 = `<div class="fb-row fb-modes">
    <div class="fb-mode-group">${modes.map(([k, l, ic]) => `<button type="button" class="fb-chip ${curType === k ? 'mode-on' : ''}" data-mtype="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    <div class="fb-right-group">
      ${curType === 'family' ? `<button type="button" class="fb-chip ${fast ? 'on' : ''}" data-fast="1" title="1-Tap: stamp immediately without popup">${fast ? '⚡ 1-Tap' : '✎ Form'}</button>` : ''}
      <button type="button" class="fb-chip ${autoPh ? 'on' : ''}" data-autoph="1" title="Optional: automatically open camera right after placing a mark">${icon('photo')}</button>
      ${curType === 'family' ? `<button type="button" class="fb-chip" data-setup="1" title="Choose UniFormat items for today's inspection or add custom Family">${icon('plus')}<span>Setup</span></button>` : ''}
      <button type="button" class="fb-close" data-cancel="1" title="Done (Esc)">${icon('x')}</button>
    </div>
  </div>`;
  const row2 = (curType === 'family' || hostChip) ? `<div class="fb-row">
    ${hostChip}
    ${curType === 'family' ? pinned.map((p) => `<button type="button" class="fb-chip ${curPid === p.id ? 'on' : ''}" data-preset="${esc(p.id)}" title="${esc(p.uniformat)} · ${esc(p.category)} · ${esc(p.familyName)} : ${esc(p.typeName)}"><span>${esc(p.familyName.replace(/_/g, ' '))}</span></button>`).join('') : ''}
  </div>` : '';
  bar.innerHTML = row1 + row2;
}
$('#family-bar').onclick = (e) => {
  if (e.target.closest('[data-cancel]')) { if (app.tool === 'measure') { app.measureStart = null; refreshMeasures(); } return cancelTool(); }
  if (e.target.closest('[data-mclear]')) return clearMeasures();
  if (e.target.closest('[data-mundo]')) {
    if (app.measureStart) app.measureStart = null;
    else if (app.measures && app.measures.length) app.measures.pop();
    refreshMeasures(); return renderFamilyBar();
  }
  if (e.target.closest('[data-unhost]')) { app.hostLock = null; viewer.clearHighlight(); return startPlace(app.activeMarkType || 'family', false, app.activePresetId); }
  if (e.target.closest('[data-setup]')) return settingsDialog('families');
  if (e.target.closest('[data-autoph]')) {
    app.autoPhoto = !app.autoPhoto;
    toast(app.autoPhoto ? 'Auto-Camera ON — camera opens after each mark' : 'Auto-Camera OFF — mark without camera', 'info', 2000);
    return renderFamilyBar();
  }
  if (e.target.closest('[data-fast]')) {
    app.fastMark = !(app.fastMark !== false);
    return startPlace('family', false, app.activePresetId);
  }
  const pr = e.target.closest('[data-preset]');
  if (pr) return startPlace('family', false, pr.dataset.preset);
  const mt = e.target.closest('[data-mtype]');
  if (mt) return startPlace(mt.dataset.mtype, false, mt.dataset.mtype === 'family' ? app.activePresetId : null);
};

viewer.addEventListener('tap', async (e) => {
  const { x, y } = e.detail;
  if (viewer.mode === 'xr' || viewer.mode === 'cam-ar') return;
  const tool = app.tool;
  if (tool === 'select') {
    const hit = viewer.pick(x, y);
    if (!hit) return clearSelection();
    if (hit.type === 'marker') return selectMarkup(hit.id, false);
    if (hit.type === 'cp') return showCPSheet(app.project.geo.controlPoints.find((c) => c.id === hit.id));
    if (hit.type === 'model' && hit.eid != null) return selectElement(hit);
    setPickReadout(viewer.worldToIfc(hit.point));
    return clearSelection();
  }
  if (tool === 'measure') {
    const hit = viewer.pick(x, y, { markers: false });
    if (!hit) return toast('Tap a point on the model to measure', 'warn');
    const ifc = viewer.worldToIfc(hit.point);
    setPickReadout(ifc);
    if (!app.measureStart) {
      app.measureStart = ifc;
      refreshMeasures();
      renderFamilyBar();
      hint('Measure: tap 2nd point on the model (Esc to exit)', cancelTool);
    } else {
      const a = app.measureStart, b = ifc;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const dXY = Math.hypot(dx, dy), d3D = Math.hypot(dx, dy, dz);
      app.measures = app.measures || [];
      app.measures.push({ a, b, d3D, dXY, dz });
      app.measureStart = null;
      refreshMeasures();
      renderFamilyBar();
      hint('Measure: tap 1st point for next distance (Esc to exit)', cancelTool);
      toast(`Distance: ${fmtCoord(d3D)} (XY ${fmtCoord(dXY)} · ΔZ ${fmtCoord(Math.abs(dz))})`, 'ok', 3200);
    }
    return;
  }
  if (tool === 'place-model') { setTool('select'); return placeModelAt(x, y); }
  const hostFilter = tool === 'place' && app.hostLock ? { modelId: app.hostLock.modelId, eid: app.hostLock.eid } : null;
  const hit = viewer.pick(x, y, { markers: false, hostFilter });
  if (!hit) return toast(hostFilter ? 'Tap directly on the highlighted Host element (or click Host ✕ to unlock)' : 'No surface there — tap on the model', 'warn');
  const ifc = viewer.worldToIfc(hit.point);
  const data = app.toolData;
  if (tool === 'place') {
    if (!data || !data.instant) setTool('select');
    return createMarkupAt(hit, ifc, { ...data, photo: !!(data && data.photo) || !!app.autoPhoto });
  }
  setTool('select');
  if (tool === 'anchor') { restorePickMode(); return anchorStep2(ifc); }
  if (tool === 'cp') { restorePickMode(); return cpDialog(ifc); }
  if (tool === 'second') { restorePickMode(); return twoPointStep2(ifc); }
  if (tool === 'wmpos') { await selfMarkAt(hit, ifc); return wmState('face'); }
  if (tool === 'wmface') return wmSetFacing(ifc);
  if (tool === 'self') { await selfMarkAt(hit, ifc); return restorePickMode(); }
  if (tool === 'face') { facePointAt(ifc); return restorePickMode(); }
});
viewer.addEventListener('dbltap', (e) => {
  if (viewer.mode !== 'orbit') return;
  const hit = viewer.pick(e.detail.x, e.detail.y, { markers: false });
  if (hit) viewer.focusPoint(hit.point, viewer.persp.position.distanceTo(viewer.orbit.target) * 0.6);
});

// ================================================================ project lifecycle
let saveTimer = null;
function save() {
  if (!app.project) return;
  app.project.modifiedAt = new Date().toISOString();
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await store.putProject(app.project); setSaveState('saved'); } catch (e) { console.error(e); setSaveState('error'); }
  }, 500);
}
function setSaveState(s) {
  const el = $('#save-state');
  el.dataset.state = s;
  el.innerHTML = s === 'saving' ? '<span class="spin-sm"></span>Saving' : s === 'error' ? `${icon('x')}Not saved` : `${icon('check')}Saved`;
}
function touch(m) { m.modifiedAt = new Date().toISOString(); save(); refreshMarkers(); renderPanel(); syncToggles(); }

async function openProject(p) {
  for (const o of [...viewer.models.children]) viewer.removeModel(o.userData.modelId);
  viewer.hasOffset = false; viewer.root.position.set(0, 0, 0); viewer.root.updateMatrixWorld(true);
  steps.stop(); app.loc.stepMode = false; app.loc.tripod = false; app.prePick = null; app.wm = null; document.body.classList.remove('wm'); $('#wm').hidden = true;
  app.project = p; app.sel = null; app.elSel = null; app.loc.corr = { x: 0, y: 0 }; app.loc.fix = null;
  // migrate older/foreign files
  p.geo = p.geo || { anchor: null, controlPoints: [] }; p.geo.controlPoints = p.geo.controlPoints || [];
  p.markups = p.markups || []; p.groups = p.groups || []; p.views = p.views || []; p.tracks = p.tracks || []; p.app = p.app || { viewOrigin: null };
  renumberMarkups(p);
  // restore the last "I'm Here" / QR position
  if (LOCATION_FEATURES && p.geo.here && p.geo.here.position) { app.loc.fix = { id: p.geo.here.id, position: { ...p.geo.here.position }, t: p.geo.here.t }; app.loc.fixZ = p.geo.here.position.z; }
  try { localStorage.setItem(LAST_KEY, p.id); } catch (e) { /* ignore */ }
  $('#project-name').textContent = p.name;
  for (const rec of p.models) {
    const f = await store.getFile(rec.fileId);
    if (!f) { rec.missing = true; continue; }
    rec.missing = false;
    try { await addLoadedModel(rec, f.name, f.data, false); } catch (e) { console.error(e); toast(`Could not load ${rec.name}: ${e.message}`, 'error', 5000); }
  }
  busy(false);
  updateEmptyState();
  refreshAll();
  if (viewer.models.children.length) { if (p.app.home) viewer.setViewState(p.app.home); else viewer.fitAll(false); }
  const missing = p.models.filter((m) => m.missing);
  if (missing.length) toast(`Model file not on this device: ${missing.map((m) => m.name).join(', ')} — use Open Model to add it again`, 'warn', 7000);
}

async function addLoadedModel(rec, name, data, isNew) {
  busy(`Loading ${name}…`);
  const res = await loadModelFile(name, data, { unitScale: rec.unitScale }, (t) => busy(t));
  viewer.addModel(res.object, rec.id, app.project.app.viewOrigin);
  app._cols = null; // column snap cache
  if (!app.project.app.viewOrigin) app.project.app.viewOrigin = viewer.offset.toArray();
  res.object.visible = rec.visible !== false;
  rec.info = { ...res.info };
  if (isNew) rec.format = res.info.format;
  updateFloorFromStoreys();
  return res;
}

async function onModelFiles(files) {
  for (const file of files) {
    const ext = extOf(file.name);
    if (!MODEL_EXT.includes(ext) && !['dwg', 'rvt'].includes(ext)) { toast(`.${ext} is not supported`, 'warn'); continue; }
    try {
      const data = await file.arrayBuffer();
      const P = app.project;
      let rec = P.models.find((m) => m.name === file.name && m.missing);
      const isNew = !rec;
      if (!rec) rec = { id: uuid(), name: file.name, format: ext, fileId: null, visible: true, unitScale: null, info: null };
      if (!rec.fileId) rec.fileId = rec.id;
      const res = await addLoadedModel(rec, file.name, data, isNew);
      await store.putFile({ id: rec.fileId, name: file.name, data });
      rec.missing = false;
      if (isNew) P.models.push(rec);
      busy(false);
      save(); updateEmptyState(); refreshAll();
      viewer.fitAll();
      toast(`${file.name} loaded`, 'ok');
      if (res.info.site && !P.geo.anchor) suggestSiteAnchor(res.info);
    } catch (e) {
      busy(false); console.error(e);
      toast(e.message || String(e), 'error', 6000);
    }
  }
}

async function cmdNewProject() {
  const name = await promptBox('New project', 'Project name', 'Untitled project');
  if (name === null) return;
  const p = newProject(name || 'Untitled project');
  await store.putProject(p);
  await openProject(p);
}

async function cmdProjects() {
  const list = (await store.listProjects()).sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
  const body = h(`<div class="proj-list">${list.map((p) => `
    <div class="proj-item ${p.id === app.project.id ? 'current' : ''}" data-id="${p.id}">
      <div class="proj-icon">${icon('layers')}</div>
      <div class="proj-main"><b>${esc(p.name)}</b><span>${p.models.length} models · ${p.markups.length} markups · ${timeAgo(p.modifiedAt)}</span></div>
      <button class="icon-btn" data-act="rename" title="Rename">${icon('edit')}</button>
      <button class="icon-btn" data-act="del" title="Delete">${icon('trash')}</button>
    </div>`).join('')}</div>`);
  const m = modal({ title: 'Projects', body, actions: [{ label: 'New project', icon: 'plus', kind: 'primary', onClick: (c) => { c(); cmdNewProject(); } }] });
  body.onclick = async (e) => {
    const item = e.target.closest('.proj-item'); if (!item) return;
    const id = item.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
    const p = list.find((x) => x.id === id);
    if (act === 'del') {
      if (id === app.project.id) return toast('The open project cannot be deleted', 'warn');
      if (!(await confirmBox('Delete project', `Delete "${p.name}" and its model files on this device? This cannot be undone.`, 'Delete', true))) return;
      for (const md of p.models) await store.deleteFile(md.fileId);
      await store.deleteProject(id); item.remove(); return;
    }
    if (act === 'rename') {
      const n = await promptBox('Rename project', 'Name', p.name); if (!n) return;
      p.name = n; await store.putProject(p);
      if (id === app.project.id) { app.project.name = n; $('#project-name').textContent = n; save(); }
      item.querySelector('b').textContent = n; return;
    }
    m.close(); if (id !== app.project.id) openProject(await store.getProject(id));
  };
}
$('#project-name').onclick = async (e) => {
  if (settings.uiMode === 'ribbon') {
    const n = await promptBox('Rename project', 'Project name', app.project.name);
    if (n) { app.project.name = n; $('#project-name').textContent = n; save(); }
    return;
  }
  openPopover(e.currentTarget, [
    { sec: 'Project' },
    { icon: 'open', label: 'Open Model (IFC / DXF / GLB)', onClick: () => $('#file-model').click() },
    { icon: 'layers', label: 'Switch Projects', onClick: () => cmdProjects() },
    { icon: 'newfile', label: 'New Project', onClick: () => cmdNewProject() },
    { icon: 'edit', label: 'Rename Project', onClick: async () => {
      const n = await promptBox('Rename project', 'Project name', app.project.name);
      if (n) { app.project.name = n; $('#project-name').textContent = n; save(); }
    } },
    { sep: true },
    { icon: 'save', label: 'Save Project (.nexar.json)', onClick: () => onCommand('save') },
    { icon: 'import', label: 'Import Project / BCF', onClick: () => onCommand('json-import') },
    { icon: 'layers', label: 'Models & Info', onClick: () => openPanel('info') }
  ], { align: 'left' });
};

// ================================================================ busy / empty state
function busy(text) {
  const el = $('#busy');
  if (!text) { el.hidden = true; return; }
  el.hidden = false; el.querySelector('span').textContent = text;
}
function updateEmptyState() { $('#empty').hidden = viewer.models.children.length > 0; }

// ================================================================ markups
async function ensureAuthor() {
  if (settings.author) return settings.author;
  const n = await promptBox('Your name', 'Author name (shown in BCF / Revit)', '');
  settings.author = n || 'Site user'; saveSettings();
  return settings.author;
}
async function elementInfoFor(modelId, eid) {
  if (eid == null) return null;
  try {
    const info = await getIfcElementInfo(viewer.getModel(modelId), eid);
    return info ? { guid: info.guid, name: info.name, ifcType: info.ifcType, tag: info.tag || '', modelId, expressID: eid } : null;
  } catch (e) { return null; }
}
function gpsOfPoint(ifc) {
  const a = app.project.geo.anchor;
  if (a) { const g = modelToGps(a, ifc); return { lat: g.lat, lon: g.lon, acc: null, derived: true }; }
  return null;
}

function modelNameFor(modelId) {
  const ms = (app.project && app.project.models) || [];
  const rec = (modelId && ms.find((m) => m.id === modelId)) || ms.find((m) => m.visible !== false && !m.missing) || ms[0];
  return rec ? rec.name : '';
}

async function createMarkupAt(hit, ifc, { type, photo, source, presetId, instant } = {}) {
  const t = normType(type || 'family');
  const isMark = t === 'family';
  const author = instant ? (settings.author || 'Site user') : await ensureAuthor();
  const element = hit.type === 'model' ? await elementInfoFor(hit.modelId, hit.eid) : null;
  const presets = getFamilyPresets();
  const pr = isMark ? (presetId ? presets.find((x) => x.id === presetId) : getPinnedPresets()[0]) : null;
  const surface = {
    hostSurface: (hit && hit.hostSurface) || 'Floor',
    normal: (hit && hit.normal) || { x: 0, y: 0, z: 1 },
    rotationDeg: Number.isFinite(hit && hit.rotationDeg) ? hit.rotationDeg : 0
  };
  const family = isMark && pr ? {
    presetId: pr.id,
    uniformat: pr.uniformat || '',
    group: pr.group || '',
    placement: pr.placement || 'face-based',
    category: pr.category || '',
    familyName: pr.familyName || '',
    typeName: pr.typeName || '',
    offsetZ: Number.isFinite(pr.offsetZ) ? pr.offsetZ : 0,
    ...surface
  } : (isMark ? { presetId: '', uniformat: '', group: '', placement: 'face-based', category: '', familyName: '', typeName: '', offsetZ: 0, ...surface } : null);
  const now = new Date().toISOString();
  const num = nextNumberFor(app.project, t);
  const m = newMarkup(app.project, {
    number: num, type: t, author, checkedAt: now, modelName: modelNameFor(hit && hit.modelId),
    position: ifc, element, family, gps: gpsOfPoint(ifc), group: ensureGroup().id,
    source: source || (viewer.mode === 'plan' ? 'plan' : viewer.mode === 'walk' ? 'walk' : '3d'),
    viewpoint: viewer.getViewState(), snapshot: viewer.snapshot(720)
  });
  if (instant) {
    app.project.markups.push(m);
    renumberMarkups(app.project);
    app.sel = m.id;
    setPickReadout(ifc);
    save(); refreshMarkers(); renderPanel();
    const sInfo = family && family.hostSurface ? ` · ${family.hostSurface} ${Math.round(family.rotationDeg || 0)}°` : '';
    toast(`${itemTag(m)} · ${markupTitle(m)}${sInfo} · X ${fmtCoord(ifc.x)} Y ${fmtCoord(ifc.y)} Z ${fmtCoord(ifc.z)}`, 'ok', 2600);
    if (photo) snapPhotoForMarkup(m);
    return;
  }
  openMarkupEditor(m, true, photo);
}

function snapPhotoForMarkup(m) {
  if (!m) return;
  if (m.locked) return toast('Markup is locked — unlock to attach photos', 'warn');
  app._photoTargetId = m.id;
  $('#file-cam-photo').click();
}
$('#file-cam-photo').onchange = async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const m = app.project && app.project.markups.find((x) => x.id === app._photoTargetId);
  if (!m) return;
  let added = 0;
  for (const f of files) {
    try { m.photos.push(await fileToDataURL(f)); added++; } catch (err) { toast(err.message, 'error'); }
  }
  if (added) {
    m.modifiedAt = new Date().toISOString();
    const nm = itemNaming(m, groupName(m.group));
    const lastFile = nm.sitePhotos[nm.sitePhotos.length - 1];
    save(); refreshMarkers(); renderPanel();
    toast(`Attached ${added} photo${added > 1 ? 's' : ''} → ${lastFile ? lastFile.fileName : nm.tag}`, 'ok', 3000);
  }
};

async function createMarkupFromAR(raw, info) {
  const author = await ensureAuthor();
  const ifc = rawToIfc(raw);
  const element = info.eid != null ? await elementInfoFor(info.modelId, info.eid) : null;
  const gpsNow = gps.last && gps.active ? { lat: gps.last.lat, lon: gps.last.lon, acc: gps.last.acc } : gpsOfPoint(ifc);
  const activeModel = (app.project.models || []).find((x) => x.id === info.modelId) || (app.project.models || []).find((x) => !x.missing && x.visible !== false);
  const m = newMarkup(app.project, {
    type: normType(info.type || 'note'), text: info.text, author, position: ifc, element, gps: gpsNow, source: info.source,
    checkedAt: new Date().toISOString(), modelName: activeModel ? activeModel.name : '',
    viewpoint: { ...viewer.getViewState(), mode: 'orbit' }, snapshot: info.photo || null, photos: info.photo ? [info.photo] : []
  });
  app.project.markups.push(m);
  renumberMarkups(app.project);
  save(); refreshMarkers(); renderPanel();
}

function openMarkupEditor(m, isNew, openCamera = false) {
  const draft = JSON.parse(JSON.stringify(m));
  draft.type = normType(draft.type);
  draft.kind = recordKind(draft);
  if (!draft.checkedAt) draft.checkedAt = draft.createdAt || new Date().toISOString();
  draft.family = draft.family || { presetId: '', uniformat: '', group: '', placement: 'face-based', category: '', familyName: '', typeName: '', offsetZ: 0, hostSurface: 'Floor', normal: { x: 0, y: 0, z: 1 }, rotationDeg: 0 };
  const F = draft.family;
  const presets = getFamilyPresets();
  const lockedAtOpen = m.locked && !isNew;
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
  const body = h(`<div class="mk-editor ${lockedAtOpen ? 'is-locked' : ''}">
    <div class="seg type-seg" id="me-type">${Object.entries(MARKUP_TYPES).map(([k, t]) => `<button type="button" data-t="${k}" class="${draft.type === k ? 'on' : ''}" style="--c:${t.color}">${icon(t.icon)}<span>${t.label}${k === 'family' ? ' (IFC)' : ''}</span></button>`).join('')}</div>
    <div class="fam-box" id="me-fambox" ${draft.type !== 'family' ? 'hidden' : ''}>
      <div class="fam-head">
        <b>${icon('cube')} UniFormat / Revit Object Mark</b>
        <span class="fam-surf">${esc(F.placement || 'face-based')} · ${esc(F.hostSurface || 'Floor')} ${Math.round(F.rotationDeg || 0)}°</span>
      </div>
      <label class="field"><span>UniFormat Family Preset</span>
        <select id="me-preset"><option value="">— None / Custom —</option>${presets.map((p) => `<option value="${esc(p.id)}" ${p.id === F.presetId ? 'selected' : ''}>[${esc(p.uniformat)}] ${esc(p.familyName)} : ${esc(p.typeName)} (${esc(p.category)})</option>`).join('')}</select>
      </label>
      <div class="field-row">
        <label class="field" style="max-width:120px"><span>UniFormat L3/L4</span><input id="me-fuf" value="${esc(F.uniformat || '')}" placeholder="D5030 or D5030.10"></label>
        <label class="field"><span>Revit Category</span><input id="me-fcat" value="${esc(F.category || '')}" placeholder="e.g. Security Devices"></label>
        <label class="field"><span>Family Name</span><input id="me-fname" value="${esc(F.familyName || '')}" placeholder="e.g. CCTV_Camera"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Type</span><input id="me-ftype" value="${esc(F.typeName || '')}" placeholder="e.g. Dome"></label>
        <label class="field"><span>Placement</span><select id="me-fplc"><option value="face-based" ${F.placement !== 'level-based' ? 'selected' : ''}>Face-based</option><option value="level-based" ${F.placement === 'level-based' ? 'selected' : ''}>Level-based</option></select></label>
        <label class="field" style="max-width:92px"><span>Offset Z (m)</span><input id="me-foff" inputmode="decimal" value="${Number.isFinite(F.offsetZ) ? F.offsetZ : 0}"></label>
        <label class="field" style="max-width:86px"><span>Facing (°)</span><input id="me-frot" inputmode="decimal" value="${Number.isFinite(F.rotationDeg) ? Math.round(F.rotationDeg) : 0}"></label>
      </div>
    </div>
    <label class="field"><span>Title</span><input id="me-title" class="${settings.inputMode === 'pencil' ? 'pencil-title' : ''}" autocorrect="on" spellcheck="true" enterkeyhint="done" value="${esc(draft.title)}" placeholder="${esc(markupTitle(draft))}"></label>
    <div class="field">
      <div class="field-head">
        <span>Note / Comment</span>
        <div class="input-mode-tabs" id="me-inmode" role="tablist" aria-label="Text input mode">
          <button type="button" data-im="type" class="${settings.inputMode !== 'pencil' ? 'on' : ''}" title="Standard keyboard typing">${icon('keyboard')}<span>Type</span></button>
          <button type="button" data-im="pencil" class="${settings.inputMode === 'pencil' ? 'on' : ''}" title="Apple Pencil handwriting pad (TH / EN Scribble)">${icon('pencil')}<span>Pencil</span></button>
        </div>
      </div>
      <textarea id="me-text" class="${settings.inputMode === 'pencil' ? 'pencil-pad' : ''}" rows="3" autocorrect="on" spellcheck="true" placeholder="${settings.inputMode === 'pencil' ? 'Write Thai / English here with Apple Pencil…' : 'Site observation, inspection note, or issue detail…'}">${esc(draft.text)}</textarea>
      <div class="pencil-hint" id="me-pencil-hint" ${settings.inputMode === 'pencil' ? '' : 'hidden'}>${icon('pencil')}<span>Apple Pencil Scribble ready — write directly in Thai or English (iPadOS 16+)</span></div>
    </div>
    <div class="field-row">
      <label class="field"><span>Checked Date &amp; Time</span><input type="datetime-local" id="me-checked" value="${toDatetimeLocal(draft.checkedAt)}"></label>
      <label class="field"><span>Status</span><select id="me-status">${opts(STATUSES, draft.status)}</select></label>
      <label class="field"><span>Priority</span><select id="me-prio">${opts(PRIORITIES, draft.priority)}</select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Group</span><select id="me-group"><option value="">— No group</option>${((app.project.groups) || []).map((g) => `<option value="${g.id}" ${g.id === draft.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Assigned to</span><input id="me-assign" value="${esc(draft.assignedTo)}" placeholder="—"></label>
    </div>
    <div class="field"><span>Photos · <code style="font-size:10.5px;color:var(--accent)">${esc(itemNaming(draft, groupName(draft.group)).folderPath)}/</code></span><div class="photos" id="me-photos"></div></div>
    <div class="meta-grid">
      <div><span>Code · Dataset</span><b class="mono">${esc(itemTag(draft))} · ${isObjectMark(draft) ? 'Object Mark (IFC)' : 'Read-Only Note'}</b></div>
      <div><span>Checked At</span><b class="mono">${esc(fmtDateTime(draft.checkedAt))}</b></div>
      <div class="span2"><span>Position · IFC (${esc(settings.units || 'm')}, Z-up — matches model)</span><b class="mono">X ${fmtCoord(draft.position.x)} · Y ${fmtCoord(draft.position.y)} · Z ${fmtCoord(draft.position.z)}</b>${draft.modelName ? `<code>Model: ${esc(draft.modelName)}</code>` : ''}</div>
      <div class="span2"><span>Host BIM element</span><b>${draft.element ? `${esc(draft.element.ifcType)} · ${esc(draft.element.name || '')}${draft.element.tag ? ` (Revit Id ${esc(draft.element.tag)})` : ''}` : '— (not linked to an element)'}</b>${draft.element && draft.element.guid ? `<code>${esc(draft.element.guid)}</code>` : ''}</div>
      <div><span>Author</span><b>${esc(draft.author || '—')}</b></div>
      <div><span>Surface Normal</span><b class="mono">${F.normal ? `${F.normal.x.toFixed(2)}, ${F.normal.y.toFixed(2)}, ${F.normal.z.toFixed(2)}` : '0, 0, 1'}</b></div>
    </div>
    <label class="switch"><input type="checkbox" id="me-lock" ${draft.locked ? 'checked' : ''}><i></i><span>${icon('lock')} Lock — prevent edit / move / delete</span></label>
    ${isNew ? '' : `<div class="replies"><div class="field-head" style="margin-bottom:8px"><div class="rep-head" style="margin:0">Replies</div>
        <div class="input-mode-tabs" id="me-repmode" role="tablist" aria-label="Reply input mode">
          <button type="button" data-im="type" class="${settings.inputMode !== 'pencil' ? 'on' : ''}">${icon('keyboard')}<span>Type</span></button>
          <button type="button" data-im="pencil" class="${settings.inputMode === 'pencil' ? 'on' : ''}">${icon('pencil')}<span>Pencil</span></button>
        </div>
      </div><div id="me-replies"></div>
      <div class="rep-input ${settings.inputMode === 'pencil' ? 'pencil-reply' : ''}" id="me-repwrap"><input id="me-reply" autocorrect="on" spellcheck="true" enterkeyhint="send" placeholder="${settings.inputMode === 'pencil' ? 'Write reply with Apple Pencil…' : 'Reply…'}"><button class="icon-btn accent" id="me-send">${icon('send')}</button></div></div>`}
    <input type="file" id="me-file" accept="image/*" multiple hidden>
  </div>`);
  const renderPhotos = () => {
    const el = body.querySelector('#me-photos');
    const nm = itemNaming(draft, groupName(draft.group));
    el.innerHTML = draft.photos.map((p, i) => {
      const fn = (nm.sitePhotos[i] && nm.sitePhotos[i].fileName) || `P${String(i + 1).padStart(2, '0')}.jpg`;
      return `<div class="ph" title="${esc(fn)}"><img src="${p}" alt=""><span class="ph-name">${esc(fn)}</span><button class="ph-x" data-i="${i}" ${lockedAtOpen ? 'hidden' : ''}>${icon('x')}</button></div>`;
    }).join('') +
      (lockedAtOpen ? '' : `<button class="ph add" id="me-addph">${icon('photo')}<span>Add photo</span></button>`) +
      (draft.snapshot ? `<div class="ph snap" title="${esc(nm.viewSnap ? nm.viewSnap.fileName : '3D view')}"><img src="${draft.snapshot}" alt=""><em>3D view</em></div>` : '');
  };
  const renderReplies = () => {
    const el = body.querySelector('#me-replies'); if (!el) return;
    el.innerHTML = draft.replies.length ? draft.replies.map((r) => `<div class="rep"><b>${esc(r.author)}</b><span>${timeAgo(r.date)}</span><p>${esc(r.text)}</p></div>`).join('') : '<p class="muted small">No replies yet</p>';
  };
  renderPhotos(); renderReplies();
  if (lockedAtOpen) body.querySelectorAll('#me-title,#me-text,#me-checked,#me-status,#me-prio,#me-assign,#me-preset,#me-fuf,#me-fcat,#me-fname,#me-ftype,#me-fplc,#me-foff,#me-frot').forEach((x) => (x.disabled = true));
  body.querySelector('#me-preset').onchange = (e) => {
    const p = presets.find((x) => x.id === e.target.value);
    if (!p) { F.presetId = ''; F.group = ''; return; }
    F.presetId = p.id; F.group = p.group || '';
    body.querySelector('#me-fuf').value = p.uniformat || '';
    body.querySelector('#me-fcat').value = p.category || '';
    body.querySelector('#me-fname').value = p.familyName || '';
    body.querySelector('#me-ftype').value = p.typeName || '';
    body.querySelector('#me-fplc').value = p.placement || 'face-based';
    body.querySelector('#me-foff').value = Number.isFinite(p.offsetZ) ? p.offsetZ : 0;
    body.querySelector('#me-title').placeholder = `${p.familyName} · ${p.typeName}`;
  };
  body.querySelector('#me-type').onclick = (e) => {
    if (lockedAtOpen) return;
    const b = e.target.closest('[data-t]'); if (!b) return;
    draft.type = normType(b.dataset.t);
    draft.kind = recordKind(draft);
    body.querySelectorAll('#me-type button').forEach((x) => x.classList.toggle('on', x === b));
    body.querySelector('#me-fambox').hidden = draft.type !== 'family';
  };
  body.querySelector('#me-photos').onclick = (e) => {
    const x = e.target.closest('.ph-x'); if (x) { draft.photos.splice(+x.dataset.i, 1); renderPhotos(); return; }
    if (e.target.closest('#me-addph')) body.querySelector('#me-file').click();
  };
  body.querySelector('#me-file').onchange = async (e) => {
    for (const f of e.target.files) { try { draft.photos.push(await fileToDataURL(f)); } catch (err) { toast(err.message, 'error'); } }
    e.target.value = ''; renderPhotos();
  };
  const send = body.querySelector('#me-send');
  if (send) {
    const doSend = () => {
      const inp = body.querySelector('#me-reply'); const t = inp.value.trim(); if (!t) return;
      draft.replies.push({ id: uuid(), author: settings.author || 'Site user', date: new Date().toISOString(), text: t });
      inp.value = ''; renderReplies();
    };
    send.onclick = doSend; body.querySelector('#me-reply').onkeydown = (e) => { if (e.key === 'Enter') doSend(); };
  }
  const collect = () => {
    if (!lockedAtOpen) {
      draft.title = body.querySelector('#me-title').value.trim();
      draft.text = body.querySelector('#me-text').value.trim();
      const chkVal = body.querySelector('#me-checked').value;
      if (chkVal) { const dt = new Date(chkVal); if (!Number.isNaN(dt.getTime())) draft.checkedAt = dt.toISOString(); }
      draft.status = body.querySelector('#me-status').value;
      draft.priority = body.querySelector('#me-prio').value;
      draft.assignedTo = body.querySelector('#me-assign').value.trim();
      draft.group = body.querySelector('#me-group').value || null;
      draft.kind = recordKind(draft);
      if (draft.type === 'family') {
        const fuf = body.querySelector('#me-fuf').value.trim().toUpperCase();
        const fcat = body.querySelector('#me-fcat').value.trim();
        const fname = body.querySelector('#me-fname').value.trim();
        const ftype = body.querySelector('#me-ftype').value.trim();
        const fplc = body.querySelector('#me-fplc').value;
        const foff = parseFloat(body.querySelector('#me-foff').value);
        const frot = parseFloat(body.querySelector('#me-frot').value);
        draft.family = {
          presetId: body.querySelector('#me-preset').value || '',
          uniformat: fuf,
          group: /^[A-G]/.test(fuf) ? fuf[0] : (F.group || ''),
          placement: fplc || 'face-based',
          category: fcat,
          familyName: fname,
          typeName: ftype,
          offsetZ: Number.isFinite(foff) ? foff : 0,
          hostSurface: F.hostSurface || 'Floor',
          normal: F.normal || { x: 0, y: 0, z: 1 },
          rotationDeg: Number.isFinite(frot) ? frot : 0
        };
      } else {
        draft.family = null;
      }
    }
    draft.locked = body.querySelector('#me-lock').checked;
    draft.modifiedAt = new Date().toISOString();
  };
  const actions = [];
  if (!isNew && !lockedAtOpen) actions.push({ label: 'Delete', icon: 'trash', kind: 'danger ghost', left: true, onClick: (c) => { c(); deleteMarkup(m); } });
  if (!isNew) actions.push({ label: 'Go to', icon: 'target', left: true, onClick: (c) => { c(); selectMarkup(m.id, true); } });
  actions.push({ label: 'Cancel', onClick: (c) => c() });
  actions.push({ label: isNew ? 'Create' : 'Save', icon: 'check', kind: 'primary', onClick: (c) => {
    collect();
    if (isNew) { app.project.markups.push(draft); app.sel = draft.id; }
    else Object.assign(m, draft);
    renumberMarkups(app.project);
    const saved = app.project.markups.find((x) => x.id === (isNew ? draft.id : m.id)) || draft;
    c(); save(); refreshMarkers(); if (app.wm) renderPanel(); else openPanel('markups'); syncToggles();
    toast(isNew ? `${itemTag(saved)} (${typeMeta(saved.type).label}) created` : `${itemTag(saved)} saved`, 'ok');
  } });
  const setEditorInputMode = (mode, focusInput = false) => {
    const isPen = mode === 'pencil';
    settings.inputMode = isPen ? 'pencil' : 'type';
    saveSettings();
    const ta = body.querySelector('#me-text'), ti = body.querySelector('#me-title'), hintEl = body.querySelector('#me-pencil-hint');
    if (ta) {
      ta.classList.toggle('pencil-pad', isPen);
      ta.placeholder = isPen ? 'Write Thai / English here with Apple Pencil…' : 'Site observation, inspection note, or issue detail…';
    }
    if (ti) ti.classList.toggle('pencil-title', isPen);
    if (hintEl) hintEl.hidden = !isPen;
    const rw = body.querySelector('#me-repwrap'), ri = body.querySelector('#me-reply');
    if (rw) rw.classList.toggle('pencil-reply', isPen);
    if (ri) ri.placeholder = isPen ? 'Write reply with Apple Pencil…' : 'Reply…';
    body.querySelectorAll('#me-inmode button, #me-repmode button').forEach((b) => b.classList.toggle('on', b.dataset.im === settings.inputMode));
    if (focusInput && ta && !isPen && !lockedAtOpen) ta.focus();
  };
  body.querySelector('#me-inmode').onclick = (e) => {
    const b = e.target.closest('[data-im]'); if (!b) return;
    setEditorInputMode(b.dataset.im, true);
  };
  const repMode = body.querySelector('#me-repmode');
  if (repMode) repMode.onclick = (e) => {
    const b = e.target.closest('[data-im]'); if (!b) return;
    setEditorInputMode(b.dataset.im, false);
  };
  // Auto-switch to Pencil pad immediately if the user touches a text input with Apple Pencil
  for (const elIn of [body.querySelector('#me-text'), body.querySelector('#me-title'), body.querySelector('#me-reply')]) {
    if (elIn) elIn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen' && settings.inputMode !== 'pencil') setEditorInputMode('pencil', false);
    });
  }
  const md = modal({ title: isNew ? `New ${typeMeta(draft.type).label}` : `${itemTag(m)} · ${typeMeta(m.type).label}`, body, actions, wide: true });
  if (openCamera) setTimeout(() => body.querySelector('#me-file').click(), 200);
  else if (isNew && settings.inputMode !== 'pencil' && !document.body.classList.contains('has-pencil')) setTimeout(() => body.querySelector('#me-text').focus(), 120);
  return md;
}

async function deleteMarkup(m) {
  if (m.locked) return toast('This item is locked — unlock it before deleting', 'warn');
  const tag = itemTag(m), kindLbl = isObjectMark(m) ? 'Marks' : 'Notes';
  if (!(await confirmBox('Delete item', `Delete ${tag} (${markupTitle(m)})? Remaining ${kindLbl} will automatically renumber.`, 'Delete', true))) return;
  app.project.markups = app.project.markups.filter((x) => x.id !== m.id);
  if (app.sel === m.id) app.sel = null;
  renumberMarkups(app.project);
  save(); refreshMarkers(); renderPanel(); syncToggles();
  toast(`Deleted ${tag} · remaining ${kindLbl} renumbered`, 'ok', 2800);
}

function selectMarkup(id, fly = true) {
  const m = app.project.markups.find((x) => x.id === id); if (!m) return;
  app.sel = id; app.elSel = null; hideSelChip();
  viewer.clearHighlight();
  if (m.element && m.element.modelId && m.element.expressID != null) viewer.highlightElement(m.element.modelId, m.element.expressID);
  refreshMarkers(); openPanel('markups'); syncToggles();
  if (fly) viewer.focusPoint(viewer.ifcToWorld(m.position), 7);
  setPickReadout(m.position);
}
function clearSelection() {
  app.sel = null; app.elSel = null; viewer.clearHighlight(); hideSelChip(); refreshMarkers(); renderPanel(); syncToggles();
}
async function selectElement(hit) {
  app.sel = null;
  viewer.highlightElement(hit.modelId, hit.eid);
  refreshMarkers();
  const ifc = viewer.worldToIfc(hit.point);
  setPickReadout(ifc);
  let info = null;
  try { info = await getIfcElementInfo(viewer.getModel(hit.modelId), hit.eid); } catch (e) { /* ignore */ }
  app.elSel = { modelId: hit.modelId, eid: hit.eid, info, hit, ifc };
  showSelChip();
  if (app.panelTab === 'info') renderPanel();
}
function showSelChip() {
  const s = app.elSel; const el = $('#selchip');
  if (!s) return hideSelChip();
  el.innerHTML = `<div class="sc-main"><b>${esc(s.info ? s.info.ifcType : 'Element')}</b><span>${esc(s.info ? (s.info.name || s.info.guid) : `#${s.eid}`)}</span></div>
    <button class="chip-btn" data-a="host" title="Lock this object and place Face-Based IFC Marks strictly on its faces">${icon('cube')}<span>Host Mark</span></button>
    <button class="chip-btn" data-a="note">${icon('note')}<span>Note</span></button>
    <button class="chip-btn" data-a="issue">${icon('issue')}<span>Issue</span></button>
    <button class="chip-btn" data-a="info">${icon('info')}</button>
    <button class="chip-btn" data-a="x">${icon('x')}</button>`;
  el.hidden = false;
  el.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'x') return clearSelection();
    if (a === 'info') return openPanel('info');
    if (a === 'host') {
      app.hostLock = { modelId: s.modelId, eid: s.eid, info: s.info };
      hideSelChip();
      viewer.highlightElement(s.modelId, s.eid);
      return startPlace('family', false, app.activePresetId);
    }
    createMarkupAt(s.hit, s.ifc, { type: a });
  };
}
function hideSelChip() { $('#selchip').hidden = true; }

function refreshMarkers() {
  const P = app.project;
  const list = P.markups.filter(filterFn()).map((m) => ({ id: m.id, number: m.number, label: pinLabel(m), position: m.position, color: statusColor(m) }));
  viewer.setMarkers(list, app.sel, settings.showMarkups);
  $('#mk-count').textContent = P.markups.length;
  renderBadges(); renderTrack(); updateGroupChip();
}
function filterFn() {
  const f = app.mkFilter, gsel = app.mkGroup || 'all';
  return (m) => (gsel === 'all' || m.group === gsel) &&
    (f === 'all' ? true
      : f === 'marks' ? isObjectMark(m)
      : f === 'notes' ? !isObjectMark(m)
      : f === 'open' ? m.status === 'open' || m.status === 'in-progress'
      : f === 'done' ? m.status === 'resolved' || m.status === 'closed'
      : normType(m.type) === f);
}

// ================================================================ Groups: captures / marks that belong together, in order
function activeGroup() { const P = app.project; return (P.groups || []).find((g) => g.id === P.app.activeGroup) || null; }
function ensureGroup() {
  const P = app.project; P.groups = P.groups || [];
  let g = activeGroup();
  if (!g) { g = { id: uuid(), name: `Group ${P.groups.length + 1}`, createdAt: new Date().toISOString() }; P.groups.push(g); P.app.activeGroup = g.id; save(); }
  updateGroupChip();
  return g;
}
function groupName(id) { const g = ((app.project && app.project.groups) || []).find((x) => x.id === id); return g ? g.name : ''; }
function updateGroupChip() { const g = app.project && activeGroup(); const el = $('#q-group-name'); if (el) el.textContent = g ? g.name : 'No group'; }
function groupDialog() {
  const P = app.project; P.groups = P.groups || [];
  const body = h('<div class="proj-list"></div>');
  const render = () => {
    body.innerHTML = P.groups.map((g) => {
      const n = P.markups.filter((m) => m.group === g.id).length, on = g.id === P.app.activeGroup;
      return `<div class="proj-item ${on ? 'current' : ''}" data-id="${g.id}"><div class="proj-icon">${icon('layers')}</div>
        <div class="proj-main"><b>${esc(g.name)}</b><span>${n} item${n === 1 ? '' : 's'}${on ? ' · active (new captures / marks go here)' : ' · tap to make active'}</span></div>
        <button class="icon-btn" data-a="ren" title="Rename">${icon('edit')}</button><button class="icon-btn" data-a="del" title="Delete group">${icon('trash')}</button></div>`;
    }).join('') || '<p class="muted">No groups yet — press "New group"</p>';
  };
  const refresh = () => { save(); updateGroupChip(); render(); refreshMarkers(); renderPanel(); };
  render();
  modal({ title: 'Groups', body, actions: [
    { label: 'Close', onClick: (c) => c() },
    { label: 'New group', icon: 'plus', kind: 'primary', onClick: async () => {
      const n = await promptBox('New group', 'Group name', `Group ${P.groups.length + 1}`); if (!n) return;
      const g = { id: uuid(), name: n, createdAt: new Date().toISOString() }; P.groups.push(g); P.app.activeGroup = g.id; refresh();
    } }] });
  body.onclick = async (e) => {
    const it = e.target.closest('.proj-item'); if (!it) return;
    const g = P.groups.find((x) => x.id === it.dataset.id), a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ren') { const n = await promptBox('Rename group', 'Name', g.name); if (n) { g.name = n; refresh(); } return; }
    if (a === 'del') {
      if (await confirmBox('Delete group', `Delete group "${g.name}"? Its captures and marks are kept, just ungrouped.`, 'Delete', true)) {
        P.markups.forEach((m) => { if (m.group === g.id) m.group = null; });
        P.groups = P.groups.filter((x) => x !== g); if (P.app.activeGroup === g.id) P.app.activeGroup = null; refresh();
      }
      return;
    }
    P.app.activeGroup = g.id; refresh();
  };
}

// ---------------- aim point = what is under the crosshair (centre of the screen)
function aimPoint() {
  viewer.raycaster.setFromCamera(new THREE.Vector2(0, 0), viewer.camera);
  viewer.raycaster.camera = viewer.camera;
  const hit = viewer.pickRay(viewer.raycaster, { markers: false });
  if (hit && hit.point) return { point: hit.point.clone(), hit };
  return { point: viewer.raycaster.ray.at(5, new THREE.Vector3()), hit: null };
}
// Capture: save a screenshot of the current 3D view into the active group straight away (no dialog) — like a game screenshot
async function captureView() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  const author = await ensureAuthor(), g = ensureGroup(), a = aimPoint();
  const shots = cam.on ? camShots() : null; // CAM on: model fitted into the site photo + the plain site photo
  const activeModel = (app.project.models || []).find((x) => !x.missing && x.visible !== false);
  const m = newMarkup(app.project, {
    type: 'capture', author, position: viewer.worldToIfc(a.point), group: g.id, source: shots ? 'capture-cam' : 'capture',
    checkedAt: new Date().toISOString(), modelName: activeModel ? activeModel.name : '',
    text: shots ? 'Model on site (overlay)' : '',
    viewpoint: viewer.getViewState(), snapshot: shots ? shots.overlay : viewer.snapshot(1280, 'image/jpeg', 0.85),
    photos: shots ? [shots.real] : []
  });
  app.project.markups.push(m); app.sel = m.id;
  renumberMarkups(app.project);
  const s = h('<div class="shutter"></div>'); $('#viewport').appendChild(s); setTimeout(() => s.remove(), 400);
  save(); refreshMarkers(); renderPanel();
  if (shots) showCompare(m); // show the comparison straight away
  else toast(`Captured ${itemTag(m)} · ${g.name}`, 'ok', 2000);
}

// ================================================================ CAM: live camera behind the model (Walk)
// No positioning system: you walk to where you stand with the sticks, turn the view with GYRO or the look stick,
// and line the model up with reality yourself. Model opacity + lens (FOV) sliders help the match.
async function toggleCam() {
  if (cam.on) return camOff(true);
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (viewer.mode !== 'walk') setMode('walk');
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) { return toast(`Camera: ${e.name === 'NotAllowedError' ? 'permission denied' : e.message}`, 'error', 4000); }
  const v = $('#camfeed'); v.srcObject = cam.stream; v.hidden = false;
  v.play().catch(() => {}); // don't wait: some cameras take a moment to deliver the first frame, the controls must work at once
  cam.on = true; cam.prevFov = viewer.persp.fov;
  viewer.persp.fov = settings.camFov; viewer.persp.updateProjectionMatrix();
  $('#cam-op').value = settings.camOpacity; $('#cam-op-v').textContent = `${Math.round(settings.camOpacity * 100)}%`;
  $('#cam-fov').value = settings.camFov; $('#cam-fov-v').textContent = `${Math.round(settings.camFov)}°`;
  $('#cam-h').value = settings.eye; $('#cam-h-v').textContent = `${settings.eye.toFixed(2)} m`;
  applyCamView();
  toast(viewer.walk.gyro
    ? 'CAM on — press PLACE and tap the ground, or aim at a QR and press QR LOCK'
    : 'CAM on — turn GYRO on, then PLACE the model on the ground (or QR LOCK to a printed QR)', 'ok', 5000);
}
function camOff(notify) {
  if (!cam.on) return;
  cam.on = false; setQrLock(false);
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  const v = $('#camfeed'); v.srcObject = null; v.hidden = true;
  viewer.persp.fov = cam.prevFov || 55; viewer.persp.updateProjectionMatrix();
  applyCamView();
  if (notify) toast('CAM off', 'info', 1200);
}
// OVERLAY = site video full screen behind a see-through model (like a native AR app)
// SPLIT   = model full screen, site video as a small window in the top-right corner
function applyCamView() {
  const overlay = cam.on && cam.view === 'overlay', split = cam.on && cam.view === 'split';
  document.body.classList.toggle('cam-on', overlay);
  document.body.classList.toggle('cam-pip', split);
  viewer.setOpacityFactor(overlay ? settings.camOpacity : 1);
  if (cam.on) viewer.grid.visible = !overlay && settings.grid; else viewer.setGrid(settings.grid);
  $('#pip-tag').hidden = !split;
  $('#cam-op-row').hidden = !overlay;
  $$('#cam-view [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === cam.view));
  syncModeUI();
}
function setCamView(v) { cam.view = v; settings.camView = v; saveSettings(); applyCamView(); }
$('#cam-view').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) setCamView(b.dataset.v); };
$('#camfeed').addEventListener('click', () => { if (cam.on && cam.view === 'split') setCamView('overlay'); }); // tap the small window to go full overlay
const fitPip = () => { const v = $('#camfeed'); if (v.videoWidth) v.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`; };
$('#camfeed').addEventListener('loadedmetadata', fitPip);
$('#camfeed').addEventListener('resize', fitPip); // iPad rotation changes the stream size

// draw the video into (w × h) the same way the screen shows it (object-fit: cover)
function drawCover(g, v, w, h) {
  if (!v.videoWidth) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); return; }
  const s = Math.max(w / v.videoWidth, h / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
  g.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
// Capture in CAM: the model fitted INTO the site photo (true scale, as seen on screen) + the plain site photo
function camShots() {
  const v = $('#camfeed'), cv = viewer.canvas;
  const prevOp = viewer.opacityFactor, prevGrid = viewer.grid.visible;
  viewer.setOpacityFactor(settings.camOpacity); viewer.grid.visible = false; // same look as OVERLAY, also when in SPLIT
  viewer.renderer.render(viewer.scene, viewer.camera);
  const k = Math.min(1, 1600 / Math.max(cv.width, cv.height)), w = Math.round(cv.width * k), hh = Math.round(cv.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const g = c.getContext('2d');
  drawCover(g, v, w, hh);
  const real = c.toDataURL('image/jpeg', 0.85);
  g.drawImage(cv, 0, 0, w, hh);
  const overlay = c.toDataURL('image/jpeg', 0.86);
  viewer.setOpacityFactor(prevOp); viewer.grid.visible = prevGrid;
  return { overlay, real };
}
function showCompare(m) {
  modal({ title: `Capture ${itemTag(m)} · ${groupName(m.group)}`, wide: true, body: `<img class="compare-img" src="${m.snapshot}" alt="Model on site">`,
    actions: [{ label: 'Close', onClick: (c) => c() }, { label: 'Add note', icon: 'note', kind: 'primary', onClick: (c) => { c(); openMarkupEditor(m, false); } }] });
}

// ================================================================ PLACE: stand the model on the real ground you tap
// No tracking needed: the real camera is HEIGHT above the ground and the gyro gives its tilt, so a tap on the
// ground in the video defines a point at true scale. The model's base centre is moved there (by moving the
// virtual camera). Turning around with GYRO keeps it standing there; walking away makes it drift.
function camHeight() { return settings.eye; }
function startPlaceModel() {
  if (!cam.on) return;
  setTool('place-model');
  hint('Tap the GROUND in the camera view where the model should stand', cancelTool);
  if (!viewer.walk.gyro) toast('Tip: turn GYRO on first so the model stays put when you look around', 'info', 3500);
}
function placeModelAt(x, y) {
  const c = viewer.persp;
  c.position.y = viewer.floorY + camHeight(); c.updateMatrixWorld();
  const rc = new THREE.Raycaster(); rc.setFromCamera(viewer.ndc(x, y), c);
  const pt = new THREE.Vector3();
  if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -viewer.floorY), pt) || pt.distanceTo(c.position) > 150) {
    return toast('That is not the ground — tap a point on the floor / ground below the horizon', 'warn', 3500);
  }
  const box = viewer.modelBox(), mid = box.getCenter(new THREE.Vector3());
  const A = new THREE.Vector3(mid.x, viewer.floorY, mid.z); // model base centre
  c.position.x += A.x - pt.x; c.position.z += A.z - pt.z;
  cam.anchor = A;
  toast('Model placed — look around with GYRO · ⟲ ⟳ rotate it · HEIGHT / FOV fix the scale', 'ok', 4500);
}
// rotate the model (relative to the real world) around its placed point, deg > 0 = clockwise seen from above
function rotateModel(deg) {
  const A = cam.anchor || (() => { const b = viewer.modelBox().getCenter(new THREE.Vector3()); return new THREE.Vector3(b.x, viewer.floorY, b.z); })();
  const th = THREE.MathUtils.degToRad(-deg); // the model turns clockwise = the camera orbits it counter-clockwise
  const p = viewer.persp.position.clone().sub(A).applyAxisAngle(new THREE.Vector3(0, 1, 0), -th).add(A);
  viewer.persp.position.copy(p);
  if (viewer.walk.gyro) viewer.headingTrim = (viewer.headingTrim || 0) - THREE.MathUtils.radToDeg(th);
  else viewer.walk.yaw -= th;
}
$('#cam-place').onclick = startPlaceModel;
for (const [id, d] of [['#cam-rotl', -5], ['#cam-rotr', 5]]) { // tap = 5°, hold = keep turning
  const b = $(id); let tm = null;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); rotateModel(d); tm = setInterval(() => rotateModel(d / 5), 60); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { clearInterval(tm); tm = null; });
}
$('#cam-h').oninput = (e) => { // camera height above the ground: sets the true scale of a placed model
  const nh = +e.target.value, dy = nh - settings.eye;
  settings.eye = nh; viewer.walk.eye = nh; saveSettings();
  viewer.persp.position.y += dy;
  $('#cam-h-v').textContent = `${nh.toFixed(2)} m`;
};

// ================================================================ QR LOCK (inside CAM): snap the camera to a printed QR
// Uses the QR pose solver: the QR's size, mounting and model position come from the QR itself / the project.
// Position + heading are applied once per detection (≤ 2 m: full, 2–3 m: half, further: quarter), then you
// can look around with GYRO. Walking away makes it drift again — aim at a QR (or use the sticks) to re-lock.
function setQrLock(on) {
  cam.qr = !!on; cam.qrT = 0; cam.qrLast = 0;
  if (on) viewer.hooks.add(camQrTick); else viewer.hooks.delete(camQrTick);
  $('#cam-qr').classList.toggle('on', cam.qr);
  $('#cam-qr-s').textContent = cam.qr ? 'looking…' : 'off';
}
$('#cam-qr').onclick = () => {
  if (!cam.qr && !app.project.geo.controlPoints.length) toast('No QR points yet — create one with Create QR and print it', 'warn', 4500);
  setQrLock(!cam.qr);
};
function camQrTick(dt) {
  if (!cam.on || !cam.qr) return;
  cam.qrT += dt; if (cam.qrT < 0.3) return; cam.qrT = 0;
  const v = $('#camfeed'), st = $('#cam-qr-s');
  let det = null; try { det = detectQR(v); } catch (e) { det = null; }
  if (!det) { if (performance.now() - cam.qrLast > 1500) st.textContent = 'looking…'; return; }
  const cp0 = decodeCP(det.text);
  if (!cp0) { st.textContent = 'not a NEXAR QR'; return; }
  const rec = findCP(cp0);
  const cp = { name: (rec && rec.name) || cp0.name, position: (rec && rec.position) || cp0.position, size: (rec && rec.size) || cp0.size,
    mount: (rec && rec.mount) || cp0.mount, heading: rec && Number.isFinite(rec.heading) ? rec.heading : cp0.heading };
  // camera intrinsics of the VIDEO, derived from the lens (FOV) slider and how the video fills the screen
  const cv = viewer.canvas, s = Math.max(cv.clientWidth / det.vw, cv.clientHeight / det.vh);
  const f = (cv.clientHeight / 2) / Math.tan(THREE.MathUtils.degToRad(settings.camFov) / 2) / s;
  const pose = poseFromDetection(det, cp.size, f, det.vw / 2, det.vh / 2);
  if (!pose) { st.textContent = 'cannot solve'; return; }
  if (pose.dist > 4) { st.textContent = `${pose.dist.toFixed(1)} m — come closer`; return; }
  if (pose.reproj > 8) { st.textContent = 'blurry / too oblique'; return; }
  const m = poseToModel(pose, cp);
  let gain = pose.dist <= 2 ? 1 : pose.dist <= 3 ? 0.5 : 0.25;
  if (performance.now() - cam.qrLast < 2500) gain = Math.min(gain, 0.5); // smooth repeated detections
  cam.qrLast = performance.now();
  // position: the camera itself (not eye height above the floor)
  viewer.persp.position.lerp(viewer.ifcToWorld(m.position), gain);
  // heading (+ pitch when not using the gyro)
  const w = viewer.walk;
  if (w.gyro) {
    let fw = new THREE.Vector3(0, 0, -1).applyQuaternion(viewer.persp.quaternion);
    if (Math.abs(fw.y) > 0.85) fw = new THREE.Vector3(0, 1, 0).applyQuaternion(viewer.persp.quaternion);
    viewer.headingTrim = (viewer.headingTrim || 0) + gain * 0.8 * normDeg180(modelHeadingOfRawDir(fw) - m.heading); // +trim turns CCW → heading drops
  } else {
    const yaw = -THREE.MathUtils.degToRad(m.heading);
    w.yaw += gain * Math.atan2(Math.sin(yaw - w.yaw), Math.cos(yaw - w.yaw));
    const fz = m.forward[2];
    if (Math.abs(fz) < 0.85) w.pitch += gain * (Math.asin(THREE.MathUtils.clamp(fz, -1, 1)) - w.pitch);
  }
  st.textContent = `${cp.name} ✓ ${pose.dist.toFixed(1)} m`;
}
$('#cam-btn').onclick = () => toggleCam();
$('#cam-op').oninput = (e) => {
  settings.camOpacity = +e.target.value; viewer.setOpacityFactor(settings.camOpacity);
  $('#cam-op-v').textContent = `${Math.round(settings.camOpacity * 100)}%`; saveSettings();
};
$('#cam-fov').oninput = (e) => { // match the phone's lens: if the model looks too big / small against reality, change this
  settings.camFov = +e.target.value; viewer.persp.fov = settings.camFov; viewer.persp.updateProjectionMatrix();
  $('#cam-fov-v').textContent = `${Math.round(settings.camFov)}°`; saveSettings();
};
async function markCenter() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  const a = aimPoint();
  await createMarkupAt(a.hit || { type: 'plane' }, viewer.worldToIfc(a.point), { type: 'note' });
}
$('#q-capture').onclick = captureView;
$('#q-mark').onclick = markCenter;
$('#q-group').onclick = groupDialog;

// ================================================================ views
async function saveView() {
  const n = await promptBox('Save view', 'View name', `View ${app.project.views.length + 1}`);
  if (n === null) return;
  const v = { id: uuid(), name: n || `View ${app.project.views.length + 1}`, createdAt: new Date().toISOString(), locked: false, ...viewer.getViewState(), thumb: viewer.snapshot(360) };
  app.project.views.push(v); save(); openPanel('views');
  toast('View saved', 'ok');
}

// ================================================================ panel
function openPanel(tab) {
  app.panelTab = tab;
  document.body.classList.add('panel-open');
  renderPanel();
  setTimeout(() => viewer.resize(), 260);
}
function renderPanel() {
  $$('#panel-tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === app.panelTab));
  const el = $('#panel-body');
  if (app.panelTab === 'markups') el.innerHTML = markupsHTML();
  else if (app.panelTab === 'views') el.innerHTML = viewsHTML();
  else el.innerHTML = infoHTML();
}
$('#panel-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) openPanel(b.dataset.tab); };
$('#btn-panel').onclick = () => { document.body.classList.toggle('panel-open'); renderPanel(); setTimeout(() => viewer.resize(), 260); };
$('#panel-close').onclick = () => { document.body.classList.remove('panel-open'); setTimeout(() => viewer.resize(), 260); };

function markupsHTML() {
  const P = app.project;
  const sel = P.markups.find((m) => m.id === app.sel);
  const markCount = P.markups.filter(isObjectMark).length;
  const noteCount = P.markups.length - markCount;
  const items = P.markups.filter(filterFn()).sort((a, b) => (isObjectMark(b) - isObjectMark(a)) || (b.number - a.number));
  const filters = [['all', `All (${P.markups.length})`], ['marks', `Marks · IFC (${markCount})`], ['notes', `Notes (${noteCount})`], ['issue', 'Issues'], ['capture', 'Captures'], ['open', 'Open'], ['done', 'Done']];
  const gsel = app.mkGroup || 'all';
  const groupPills = (P.groups && P.groups.length) ? `<div class="filters"><button class="pill ${gsel === 'all' ? 'on' : ''}" data-group="all">All groups</button>${P.groups.map((g) => `<button class="pill ${gsel === g.id ? 'on' : ''}" data-group="${g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const famBadge = (m) => (isObjectMark(m) && m.family && m.family.familyName) ? `<div class="mk-fam-badge">${esc([m.family.uniformat || m.family.discipline, m.family.familyName, m.family.hostSurface ? `${m.family.hostSurface} ${Math.round(m.family.rotationDeg || 0)}°` : ''].filter(Boolean).join(' · '))}</div>` : '';
  const coordLine = (m) => `<div class="mk-coord-line"><span>X ${fmtCoord(m.position.x)} · Y ${fmtCoord(m.position.y)} · Z ${fmtCoord(m.position.z)}</span><span>${esc(fmtDateTime(m.checkedAt || m.createdAt))}</span></div>`;
  const detail = sel ? `
    <div class="mk-detail">
      ${sel.photos[0] || sel.snapshot ? `<div class="mk-hero"><img src="${sel.photos[0] || sel.snapshot}" alt="">${sel.photos.length > 1 ? `<span class="badge">+${sel.photos.length - 1}</span>` : ''}</div>` : ''}
      <div class="mk-dh"><span class="mk-pin" style="--c:${statusColor(sel)}">${pinLabel(sel)}</span><div><b><span class="mk-tag-chip ${isObjectMark(sel) ? 'is-mark' : ''}">${itemTag(sel)}</span>${esc(markupTitle(sel))}</b>
        <span class="muted small">${typeMeta(sel.type).label} · ${STATUSES[sel.status].label} · ${esc(sel.author || 'Site user')}</span>${famBadge(sel)}${coordLine(sel)}</div>
        ${sel.locked ? `<span class="lock-ic" title="Locked">${icon('lock')}</span>` : `<button class="icon-btn sm" data-mk="del" title="Delete (auto-renumbers remaining)">${icon('trash')}</button>`}</div>
      ${sel.text ? `<p class="mk-text">${esc(sel.text)}</p>` : ''}
      ${sel.element ? `<div class="mk-el">${icon('layers')}<span>${esc(sel.element.ifcType)} · ${esc(sel.element.name || sel.element.guid)}</span></div>` : ''}
      <div class="mk-actions">
        <button class="btn sm" data-mk="edit">${icon('edit')}<span>Open</span></button>
        <button class="btn sm" data-mk="photo" ${sel.locked ? 'disabled' : ''} title="Snap / attach sequential site photo (${sel.photos.length} attached)">${icon('photo')}<span>Photo</span></button>
        <button class="btn sm" data-mk="goto">${icon('target')}<span>Go to</span></button>
        <button class="btn sm ${sel.locked ? 'on' : ''}" data-mk="lock">${icon(sel.locked ? 'lock' : 'unlock')}<span>${sel.locked ? 'Locked' : 'Lock'}</span></button>
      </div>
    </div>` : '';
  return `${detail}
    ${groupPills}
    <div class="filters">${filters.map(([k, l]) => `<button class="pill ${app.mkFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
    <div class="mk-list">${items.map((m) => `
      <button class="mk-item ${m.id === app.sel ? 'on' : ''}" data-id="${m.id}">
        <span class="mk-pin" style="--c:${statusColor(m)}">${pinLabel(m)}</span>
        <span class="mk-body"><span class="mk-title"><span class="mk-tag-chip ${isObjectMark(m) ? 'is-mark' : ''}">${itemTag(m)}</span>${esc(markupTitle(m))}</span>
        <span class="mk-meta">${typeMeta(m.type).label} · ${esc(fmtDateTime(m.checkedAt || m.createdAt))} · X ${fmtCoord(m.position.x)} Y ${fmtCoord(m.position.y)} Z ${fmtCoord(m.position.z)}</span>${famBadge(m)}</span>
        <span class="mk-icons">${m.photos.length ? icon('image', 'sm') : ''}${m.locked ? icon('lock', 'sm') : ''}</span>
      </button>`).join('') || `<div class="empty-list">${icon('pin')}<p>No items in this filter</p><span>Tap <b>Mark</b> below to place an IFC Object Mark (MK) or Site Note (NT)</span></div>`}</div>`;
}
function viewsHTML() {
  const V = app.project.views;
  return `<div class="views-head"><button class="btn sm primary" data-v="new">${icon('bookmark')}<span>Save current view</span></button></div>
    <div class="views-grid">${V.map((v) => `
      <div class="view-card" data-id="${v.id}">
        <button class="vc-img" data-v="go">${v.thumb ? `<img src="${v.thumb}" alt="">` : icon('views')}<span class="vc-mode">${v.mode}</span></button>
        <div class="vc-foot"><b title="${esc(v.name)}">${esc(v.name)}</b>
          <button class="icon-btn sm ${v.locked ? 'on' : ''}" data-v="lock" title="${v.locked ? 'Unlock' : 'Lock'}">${icon(v.locked ? 'lock' : 'unlock')}</button>
          <button class="icon-btn sm" data-v="ren" title="Rename" ${v.locked ? 'disabled' : ''}>${icon('edit')}</button>
          <button class="icon-btn sm" data-v="del" title="Delete" ${v.locked ? 'disabled' : ''}>${icon('trash')}</button></div>
      </div>`).join('') || `<div class="empty-list">${icon('views')}<p>No saved views yet</p><span>View → Save View</span></div>`}</div>`;
}
function infoHTML() {
  const P = app.project, a = P.geo.anchor, s = app.elSel;
  const el = s && s.info ? `
    <section><h4>Selected element</h4>
      <div class="kv"><span>Type</span><b>${esc(s.info.ifcType)}</b></div>
      <div class="kv"><span>Name</span><b>${esc(s.info.name || '—')}</b></div>
      ${s.info.objectType ? `<div class="kv"><span>Object type</span><b>${esc(s.info.objectType)}</b></div>` : ''}
      ${s.info.tag ? `<div class="kv"><span>Tag (Revit Id)</span><b class="mono">${esc(s.info.tag)}</b></div>` : ''}
      <div class="kv"><span>IFC GUID</span><b class="mono copy" data-copy="${esc(s.info.guid)}">${esc(s.info.guid)} ${icon('copy', 'sm')}</b></div>
      ${s.info.psets.map((ps) => `<details><summary>${esc(ps.name)}</summary>${ps.props.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</details>`).join('')}
    </section>` : '';
  return `${el}
    <section><h4>Models</h4>${P.models.map((m) => `
      <div class="model-row ${m.missing ? 'missing' : ''}" data-id="${m.id}">
        <button class="icon-btn sm" data-m="vis" title="Show/hide">${icon(m.visible === false ? 'eyeoff' : 'xray')}</button>
        <div><b>${esc(m.name)}</b><span>${(m.format || '').toUpperCase()}${m.info && m.info.schema ? ` · ${m.info.schema}` : ''}${m.info && m.info.elements ? ` · ${m.info.elements} elements` : ''}${m.missing ? ' · file missing' : ''}</span></div>
        <button class="icon-btn sm" data-m="del" title="Remove">${icon('trash')}</button>
      </div>`).join('') || '<p class="muted small">No models yet</p>'}
      <button class="btn sm" data-m="add">${icon('plus')}<span>Add model</span></button></section>
    ${LOCATION_FEATURES ? `<section><h4>Site location</h4>
      ${a ? `<div class="kv"><span>Anchor (IFC)</span><b class="mono">${fmtM(a.position.x, 2)}, ${fmtM(a.position.y, 2)}, ${fmtM(a.position.z, 2)}</b></div>
        <div class="kv"><span>GPS</span><b class="mono">${fmtLL(a.lat)}, ${fmtLL(a.lon)}</b></div>
        <div class="kv"><span>Project north</span><b class="mono">${a.bearing.toFixed(2)}° from true north</b></div>
        <div class="kv"><span>Method</span><b>${esc(a.method)}${a.accuracy ? ` · ±${a.accuracy.toFixed(1)} m` : ''}</b></div>`
      : '<p class="muted small">No location yet — Site → Set Location (one point)</p>'}
      <button class="btn sm" data-g="anchor">${icon('anchor')}<span>${a ? 'Re-set location' : 'Set location'}</span></button>
    </section>` : ''}
    <section><h4>QR control points</h4>
      ${P.geo.controlPoints.map((c) => `<div class="model-row" data-cp="${c.id}">
        <span class="cp-ic">${icon('qr')}</span><div><b>${esc(c.name)}</b><span class="mono">${fmtM(c.position.x, 3)}, ${fmtM(c.position.y, 3)}, ${fmtM(c.position.z, 3)}</span></div>
        <button class="icon-btn sm" data-c="show" title="QR">${icon('print')}</button>
        <button class="icon-btn sm" data-c="del" title="Delete">${icon('trash')}</button></div>`).join('') || '<p class="muted small">No QR points yet</p>'}
      <button class="btn sm" data-g="cp">${icon('qr')}<span>Create QR point</span></button>
    </section>
    <section><h4>Project</h4>
      <div class="kv"><span>Name</span><b>${esc(P.name)}</b></div>
      <div class="kv"><span>Markups / views</span><b>${P.markups.length} / ${P.views.length}</b></div>
      <div class="kv"><span>Schema</span><b class="mono">${SCHEMA}</b></div>
    </section>`;
}
$('#panel-body').onclick = async (e) => {
  const t = e.target;
  const f = t.closest('[data-filter]'); if (f) { app.mkFilter = f.dataset.filter; refreshMarkers(); return renderPanel(); }
  const gp = t.closest('[data-group]'); if (gp) { app.mkGroup = gp.dataset.group; refreshMarkers(); return renderPanel(); }
  const it = t.closest('.mk-item'); if (it) return selectMarkup(it.dataset.id, true);
  const mk = t.closest('[data-mk]');
  if (mk) {
    const act = mk.dataset.mk;
    if (act === 'edit') return withSel((m) => openMarkupEditor(m, false));
    if (act === 'photo') return withSel((m) => snapPhotoForMarkup(m));
    if (act === 'goto') return withSel((m) => { viewer.focusPoint(viewer.ifcToWorld(m.position), 7); });
    if (act === 'lock') return onCommand('mk-lock');
    if (act === 'del') return withSel((m) => deleteMarkup(m));
    if (act === 'resolve') return onCommand('mk-resolve');
  }
  const v = t.closest('[data-v]');
  if (v) {
    const act = v.dataset.v;
    if (act === 'new') return saveView();
    const card = v.closest('.view-card'); const view = app.project.views.find((x) => x.id === card.dataset.id);
    if (act === 'go') { viewer.setViewState(view); syncModeUI(); return; }
    if (act === 'lock') { view.locked = !view.locked; save(); return renderPanel(); }
    if (act === 'ren') { const n = await promptBox('Rename view', 'Name', view.name); if (n) { view.name = n; save(); renderPanel(); } return; }
    if (act === 'del') { if (await confirmBox('Delete view', `Delete view "${view.name}"?`, 'Delete', true)) { app.project.views = app.project.views.filter((x) => x !== view); save(); renderPanel(); } return; }
  }
  const md = t.closest('[data-m]');
  if (md) {
    const act = md.dataset.m;
    if (act === 'add') return $('#file-model').click();
    const id = md.closest('.model-row').dataset.id; const rec = app.project.models.find((x) => x.id === id);
    if (act === 'vis') { rec.visible = rec.visible === false; viewer.setModelVisible(id, rec.visible); save(); return renderPanel(); }
    if (act === 'del') {
      if (!(await confirmBox('Remove model', `Remove "${rec.name}" from the project? Markups are kept.`, 'Remove', true))) return;
      viewer.removeModel(id); app._cols = null; await store.deleteFile(rec.fileId);
      app.project.models = app.project.models.filter((x) => x !== rec); save(); updateEmptyState(); return renderPanel();
    }
  }
  const g = t.closest('[data-g]');
  if (g) return g.dataset.g === 'anchor' ? anchorWizard() : startCPCreate();
  const c = t.closest('[data-c]');
  if (c) {
    const cp = app.project.geo.controlPoints.find((x) => x.id === c.closest('[data-cp]').dataset.cp);
    if (c.dataset.c === 'show') return showCPSheet(cp);
    if (await confirmBox('Delete control point', `Delete point ${cp.name}?`, 'Delete', true)) { app.project.geo.controlPoints = app.project.geo.controlPoints.filter((x) => x !== cp); save(); renderBadges(); renderPanel(); }
  }
  const cp = t.closest('[data-copy]'); if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); toast('Copied GUID', 'ok'); }
};

// ================================================================ section / storeys
function storeys() {
  const all = [];
  for (const m of app.project.models) if (m.info && m.info.storeys) for (const s of m.info.storeys) if (!all.some((x) => Math.abs(x.elevation - s.elevation) < 0.05)) all.push(s);
  return all.sort((a, b) => a.elevation - b.elevation);
}
function updateFloorFromStoreys() {
  const st = storeys();
  const z = st.length ? st[0].elevation : null;
  if (z !== null) viewer.floorY = viewer.ifcToWorld({ x: 0, y: 0, z }).y;
}
function setSection(on) {
  if (on) {
    const st = storeys();
    const z = st.length ? st[0].elevation + 1.2 : viewer.worldToIfc(new THREE.Vector3(0, viewer.floorY + 1.2, 0)).z;
    viewer.setClip(true, viewer.ifcToWorld({ x: 0, y: 0, z }).y);
  } else viewer.setClip(false);
  renderClipCtl(); syncToggles();
}
function renderClipCtl() {
  const el = $('#clip-ctl');
  el.hidden = !viewer.clipOn;
  if (!viewer.clipOn) return;
  const box = viewer.modelBox();
  const minZ = viewer.worldToIfc(new THREE.Vector3(0, box.isEmpty() ? -1 : box.min.y, 0)).z;
  const maxZ = viewer.worldToIfc(new THREE.Vector3(0, box.isEmpty() ? 10 : box.max.y, 0)).z;
  const cur = viewer.worldToIfc(new THREE.Vector3(0, viewer.clipY, 0)).z;
  el.innerHTML = `<div class="clip-head">${icon('section')}<span>Cut</span><b class="mono" id="clip-v">${cur.toFixed(2)} m</b></div>
    <input type="range" id="clip-r" min="${minZ.toFixed(2)}" max="${(maxZ + 0.1).toFixed(2)}" step="0.05" value="${cur.toFixed(2)}" orient="vertical">
    <div class="storeys">${storeys().slice().reverse().map((s) => `<button data-z="${s.elevation}" title="${esc(s.name)}">${esc(s.name.length > 10 ? s.name.slice(0, 10) + '…' : s.name)}</button>`).join('')}</div>`;
  el.querySelector('#clip-r').oninput = (e) => {
    const z = +e.target.value; viewer.setClip(true, viewer.ifcToWorld({ x: 0, y: 0, z }).y);
    el.querySelector('#clip-v').textContent = `${z.toFixed(2)} m`;
  };
  el.querySelector('.storeys').onclick = (e) => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const z = +b.dataset.z;
    viewer.floorY = viewer.ifcToWorld({ x: 0, y: 0, z }).y;
    viewer.setClip(true, viewer.ifcToWorld({ x: 0, y: 0, z: z + 1.2 }).y);
    renderClipCtl();
    if (viewer.mode === 'walk') viewer.persp.position.y = viewer.floorY + viewer.walk.eye;
  };
}

// ================================================================ GPS / location
function getBearing() {
  const a = app.project && app.project.geo.anchor;
  if (a && Number.isFinite(a.bearing)) return a.bearing;
  const m = app.project && app.project.models.find((x) => x.info && Number.isFinite(x.info.trueNorthBearing));
  return m ? m.info.trueNorthBearing : 0;
}
function getRefs() {
  const P = app.project, out = [];
  for (const c of [...P.geo.controlPoints].reverse()) out.push({ id: `cp:${c.id}`, label: `QR ${c.name}`, raw: ifcToRaw(c.position) });
  if (P.geo.anchor) out.push({ id: 'anchor', label: 'Anchor point', raw: ifcToRaw(P.geo.anchor.position) });
  if (app.loc.raw) out.unshift({ id: 'me', label: app.loc.fix && app.loc.fix.id === 'self' && !gps.active ? 'My position (I\'m Here)' : 'My position', raw: app.loc.raw.clone() });
  if (app.loc.fix) out.sort((a, b) => (a.id === `cp:${app.loc.fix.id}` ? -1 : b.id === `cp:${app.loc.fix.id}` ? 1 : 0));
  if (!out.length) out.push({ id: 'origin', label: 'Model origin', raw: ifcToRaw({ x: 0, y: 0, z: 0 }) });
  return out;
}

async function toggleGPS() {
  if (gps.active) {
    gps.stop();
    const tr = app.project.tracks[app.project.tracks.length - 1]; if (tr && !tr.endedAt) tr.endedAt = new Date().toISOString();
    save();
  } else {
    try { await orient.requestPermission(); orient.start(); } catch (e) { /* compass optional */ }
    gps.start();
    app.project.tracks.push({ id: uuid(), startedAt: new Date().toISOString(), endedAt: null, points: [] });
    if (!app.project.geo.anchor && !app.loc.fix) toast('No location yet — use Site → Set Location or Scan QR first', 'warn', 5000);
  }
  syncToggles(); updateStatus();
}
// Link a self-mark / QR fix to GPS on the first good reading, whatever order the user did things in:
// from then on the position = fix + GPS movement since the fix (walking moves you on the plan / in AR).
function linkFixToGps() {
  const f = app.loc.fix, g = gps.last, P = app.project;
  if (!f || f.linked || settings.trackMode === 'steps' || !g || !gps.active || !(g.acc <= GOOD_GPS_M)) return;
  if (Date.now() - f.t > 3 * 60 * 1000) return; // fix too old: user has probably walked away from it
  if (P.geo.anchor) {
    const pg = gpsToModel(P.geo.anchor, g.lat, g.lon);
    app.loc.corr = { x: f.position.x - pg.x, y: f.position.y - pg.y };
  } else {
    P.geo.anchor = { position: { ...f.position }, lat: g.lat, lon: g.lon, alt: g.alt, bearing: getBearing(), method: 'self', accuracy: g.acc, createdAt: new Date().toISOString() };
    app.loc.corr = { x: 0, y: 0 };
    renderBadges(); save();
  }
  f.linked = true; f.t = g.t;
  toast('GPS linked to your I\'m Here point — your position now follows as you walk', 'ok', 3500);
}
// Hybrid tracking: steps move you smoothly; each good GPS reading gently pulls the position back toward GPS,
// so step drift can never grow without limit (and GPS jitter is averaged out instead of shown directly).
function fuseGps() {
  if (settings.trackMode !== 'hybrid' || !app.loc.stepMode || app.loc.tripod) return;
  const a = app.project.geo.anchor, g = gps.last, f = app.loc.fix;
  if (!a || !g || !f || !f.linked || !gps.active || !(g.acc <= 12) || Date.now() - g.t > 5000) return;
  if (g.t === f.lastFuse) return; f.lastFuse = g.t;
  const pg = gpsToModel(a, g.lat, g.lon);
  const ex = pg.x + app.loc.corr.x - f.position.x, ey = pg.y + app.loc.corr.y - f.position.y;
  if (Math.hypot(ex, ey) > Math.max(30, 4 * g.acc)) return; // wild reading: ignore
  const k = g.acc <= 5 ? 0.08 : g.acc <= 8 ? 0.05 : 0.025;
  f.position = { ...f.position, x: f.position.x + ex * k, y: f.position.y + ey * k };
}
gps.addEventListener('update', () => {
  linkFixToGps();
  fuseGps();
  computeLoc();
  recordTrack();
  updateStatus();
  if (gps.error && !gps._errShown) { gps._errShown = true; toast(`GPS: ${gps.error}`, 'error', 5000); }
});

const GOOD_GPS_M = 20;
function computeLoc() {
  const a = app.project && app.project.geo.anchor, g = gps.last;
  let ifc = null, acc = null;
  // GPS only wins when it is genuinely good (phones outdoors ≈ 3–15 m). PC/Wi-Fi/IP locations
  // (hundreds of metres) must never override a self-mark or QR fix.
  const gpsGood = g && gps.active && Number.isFinite(g.acc) && g.acc <= GOOD_GPS_M && Date.now() - g.t < 15000;
  if (a && gpsGood && !app.loc.stepMode && (!app.loc.fix || g.t > app.loc.fix.t)) { // step tracking has priority over GPS
    const p = gpsToModel(a, g.lat, g.lon);
    ifc = { x: p.x + app.loc.corr.x, y: p.y + app.loc.corr.y, z: app.loc.fixZ ?? a.position.z };
    // GPS-only mode: smooth the jitter (blend 35 % toward each new reading)
    const prev = app.loc._gpsSm;
    if (prev && g.t - prev.t < 5000) { ifc.x = prev.x + (ifc.x - prev.x) * 0.35; ifc.y = prev.y + (ifc.y - prev.y) * 0.35; }
    app.loc._gpsSm = { x: ifc.x, y: ifc.y, t: g.t };
    acc = g.acc;
  } else if (app.loc.fix) { ifc = { ...app.loc.fix.position }; acc = 0.05; }
  app.loc.ifc = ifc; app.loc.acc = acc; app.loc.raw = ifc ? ifcToRaw(ifc) : null;
  const hd = orient.ready && orient.hasTrueNorth ? orient.getHeading() : (g && Number.isFinite(g.heading) ? g.heading : null);
  app.loc.heading = hd;
  const hmWM = app.wm ? headingModelNow() : null; // Walk&Mark: arrow = phone heading, or the last heading you set
  viewer.setYou(app.loc.raw, acc, hmWM != null ? hmWM : hd == null ? null : hd - getBearing());
}
function recordTrack() {
  const tr = app.project.tracks[app.project.tracks.length - 1];
  if (!tr || tr.endedAt || !app.loc.ifc || !gps.last) return;
  const last = tr.points[tr.points.length - 1];
  const p = app.loc.ifc;
  if (last && Math.hypot(last.position.x - p.x, last.position.y - p.y) < 1 && Date.now() - last.t < 15000) return;
  tr.points.push({ t: Date.now(), lat: gps.last.lat, lon: gps.last.lon, acc: gps.last.acc, position: { ...p } });
  renderTrack();
  if (tr.points.length % 5 === 0) save();
}
function renderTrack() {
  const P = app.project;
  if (!LOCATION_FEATURES) { // GPS path shelved: draw the ACTIVE GROUP as a line through its captures / marks, in order ("connected")
    const g = activeGroup();
    const pts = g ? P.markups.filter((m) => m.group === g.id).sort((a, b) => a.number - b.number).map((m) => ifcToRaw(m.position)) : [];
    viewer.setTrack(pts, settings.showMarkups);
    return;
  }
  const tr = [...P.tracks].reverse().find((t) => t.points.length > 1);
  viewer.setTrack(tr ? tr.points.map((p) => ifcToRaw(p.position)) : [], settings.showTrack);
}
function renderBadges() {
  const P = app.project, items = [];
  if (P.geo.anchor) items.push({ raw: ifcToRaw(P.geo.anchor.position), label: 'A', color: '#60a5fa', kind: 'anchor' });
  for (const c of P.geo.controlPoints) items.push({ raw: ifcToRaw(c.position), label: 'QR', color: '#7aa7e8', kind: 'cp', id: c.id });
  if (P.geo.face) items.push({ raw: ifcToRaw(P.geo.face), label: 'F', color: '#9cc2f5', kind: 'face' });
  viewer.setBadges(items);
}

function suggestSiteAnchor(info) {
  const s = info.site;
  modal({ title: 'Location found in the IFC file', body: `<p>The IFC file contains a site location: <b class="mono">${fmtLL(s.lat)}, ${fmtLL(s.lon)}</b>${Number.isFinite(info.trueNorthBearing) ? ` and True North <b class="mono">${info.trueNorthBearing.toFixed(2)}°</b>` : ''}.</p>
    <p class="muted">It can be used as the starting location (model origin 0,0,0). Accuracy depends on the Survey Point / Project Base Point setup in Revit — for precision use Set Location or Scan QR on site.</p>`,
  actions: [{ label: 'Later', onClick: (c) => c() }, { label: 'Use IFC location', kind: 'primary', icon: 'anchor', onClick: (c) => {
    app.project.geo.anchor = { position: { x: 0, y: 0, z: s.elevation ? 0 : 0 }, lat: s.lat, lon: s.lon, alt: s.elevation, bearing: info.trueNorthBearing ?? 0, method: 'ifc-site', accuracy: null, createdAt: new Date().toISOString() };
    app.loc.corr = { x: 0, y: 0 }; save(); renderBadges(); computeLoc(); renderPanel(); c(); toast('Location set from IFC site', 'ok');
  } }] });
}

// ---------------- anchor wizard (ONE point)
function anchorWizard() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  const site = app.project.models.map((m) => m.info && m.info.site).find(Boolean);
  modal({ title: 'Set Location · one point', wide: false, body: `
    <ol class="steps">
      <li><b>Stand on a point you can identify on the drawings</b><span>e.g. a column corner, grid intersection, wall corner or a surveyed point</span></li>
      <li><b>Tap the same point on the model / plan</b><span>Plan view is the most precise</span></li>
      <li><b>Capture GPS</b><span>Readings are averaged over several seconds · refine the heading with “2nd Point” or a QR scan</span></li>
    </ol>`,
  actions: [
    ...(site ? [{ label: 'Use IFC site', icon: 'sample', left: true, onClick: (c) => { c(); suggestSiteAnchor(app.project.models.find((m) => m.info && m.info.site).info); } }] : []),
    { label: 'Cancel', onClick: (c) => c() },
    { label: 'Tap point on model', icon: 'target', kind: 'primary', onClick: (c) => {
      c(); goPlanForPicking();
      setTool('anchor'); hint('Tap where you are standing on the model / plan', cancelTool);
    } }] });
}
function anchorStep2(ifc) {
  const old = app.project.geo.anchor;
  const bearing0 = getBearing();
  const body = h(`<div>
    <div class="kv"><span>Model point (IFC)</span><b class="mono">${fmtM(ifc.x)}, ${fmtM(ifc.y)}, ${fmtM(ifc.z)}</b></div>
    <div class="gps-box"><div class="gps-read" id="aw-read">${icon('gps')}<span>No GPS fix yet</span></div>
      <button class="btn primary" id="aw-cap">${icon('gps')}<span>Capture GPS (${settings.gpsAvg}s)</span></button></div>
    <div class="field-row">
      <label class="field"><span>Latitude</span><input id="aw-lat" inputmode="decimal" value="${old ? old.lat.toFixed(8) : ''}" placeholder="13.7563"></label>
      <label class="field"><span>Longitude</span><input id="aw-lon" inputmode="decimal" value="${old ? old.lon.toFixed(8) : ''}" placeholder="100.5018"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Project north (° from true north)</span><input id="aw-bear" inputmode="decimal" value="${bearing0.toFixed(2)}"></label>
      <button class="btn" id="aw-compass" style="align-self:end">${icon('compass')}<span>From compass</span></button>
    </div>
    <p class="muted small">From compass: point the top of the device along the model +Y axis (project north / vertical grid lines on the plan) and press · on a PC you can type lat/lon (e.g. from Google Maps)</p>
  </div>`);
  let acc = null;
  body.querySelector('#aw-cap').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const read = body.querySelector('#aw-read span');
    try {
      const r = await gps.average(settings.gpsAvg, (n, l) => { read.textContent = `Averaging… ${n} readings · ±${l.acc.toFixed(1)} m`; });
      body.querySelector('#aw-lat').value = r.lat.toFixed(8); body.querySelector('#aw-lon').value = r.lon.toFixed(8);
      acc = r.acc; read.textContent = `${r.n} samples · best ±${r.acc.toFixed(1)} m`;
    } catch (err) { read.textContent = err.message; toast(err.message, 'error'); }
    b.disabled = false;
  };
  body.querySelector('#aw-compass').onclick = async () => {
    try { await orient.requestPermission(); orient.start(); } catch (e) { return toast(e.message, 'error'); }
    setTimeout(() => {
      if (!orient.ready || !orient.hasTrueNorth) return toast('This device has no compass', 'warn');
      body.querySelector('#aw-bear').value = orient.getHeading().toFixed(1);
    }, 400);
  };
  modal({ title: 'Set Location · Step 2', body, actions: [
    { label: 'Cancel', onClick: (c) => c() },
    { label: 'Save location', icon: 'check', kind: 'primary', onClick: (c) => {
      const lat = parseFloat(body.querySelector('#aw-lat').value), lon = parseFloat(body.querySelector('#aw-lon').value);
      const bearing = normDeg(parseFloat(body.querySelector('#aw-bear').value) || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return toast('Latitude and longitude are required', 'warn');
      app.project.geo.anchor = { position: ifc, lat, lon, alt: null, bearing, method: acc != null ? 'gps' : 'manual', accuracy: acc, createdAt: new Date().toISOString() };
      app.loc.corr = { x: 0, y: 0 }; app.loc.fixZ = ifc.z;
      save(); renderBadges(); computeLoc(); renderPanel(); c();
      toast('Location saved — turn on Locate Me to see your position on the plan', 'ok', 4000);
    } }] });
}

// ---------------- 2-point heading refinement
function twoPointWizard() {
  if (!app.project.geo.anchor) return toast('Set Location first', 'warn');
  modal({ title: 'Refine heading · second point', body: `<p>Walk to another identifiable point <b>at least 15–30 m</b> from the first one and tap it on the model. Project north is computed from the two GPS points (more accurate than the phone compass).</p>`,
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Tap 2nd point', icon: 'target', kind: 'primary', onClick: (c) => { c(); setTool('second'); hint('Tap the second point where you are standing', cancelTool); } }] });
}
function twoPointStep2(ifc) {
  const a = app.project.geo.anchor;
  const body = h(`<div><div class="gps-box"><div class="gps-read" id="tp-read">${icon('gps')}<span>Stand still on the second point and press Capture</span></div>
    <button class="btn primary" id="tp-cap">${icon('gps')}<span>Capture GPS (${settings.gpsAvg}s)</span></button></div><div id="tp-res"></div></div>`);
  let newB = null;
  body.querySelector('#tp-cap').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const read = body.querySelector('#tp-read span');
    try {
      const r = await gps.average(settings.gpsAvg, (n, l) => { read.textContent = `Averaging… ${n} · ±${l.acc.toFixed(1)} m`; });
      const dM = { x: ifc.x - a.position.x, y: ifc.y - a.position.y };
      const dEN = gpsToEN(r.lat, r.lon, a.lat, a.lon);
      const dist = Math.hypot(dM.x, dM.y), gdist = Math.hypot(dEN.e, dEN.n);
      newB = bearingFromPair(dM, dEN);
      read.textContent = `±${r.acc.toFixed(1)} m`;
      body.querySelector('#tp-res').innerHTML = `<div class="kv"><span>Distance model / GPS</span><b class="mono">${dist.toFixed(1)} m / ${gdist.toFixed(1)} m</b></div>
        <div class="kv"><span>Heading old → new</span><b class="mono">${a.bearing.toFixed(2)}° → ${newB.toFixed(2)}°</b></div>
        ${dist < 10 ? '<p class="warn-text">Less than 10 m apart — the result may be inaccurate</p>' : ''}`;
    } catch (err) { read.textContent = err.message; }
    e.currentTarget.disabled = false;
  };
  modal({ title: 'Refine heading · Step 2', body, actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Apply', kind: 'primary', icon: 'check', onClick: (c) => {
    if (newB == null) return toast('Capture GPS first', 'warn');
    a.bearing = newB; a.method += '+2pt'; save(); computeLoc(); renderPanel(); c(); toast(`Project north = ${newB.toFixed(2)}°`, 'ok');
  } }] });
}

// ---------------- compass
async function compassDialog() {
  try { await orient.requestPermission(); orient.start(); } catch (e) { return toast(e.message, 'error'); }
  const body = h(`<div class="compass-dlg"><div class="cdial"><div class="cneedle" id="cd-n"></div><b id="cd-v">—</b></div>
    <p class="muted small" id="cd-s"></p><p class="muted small">If readings drift, move the device in a figure 8 to calibrate and keep away from steel and vehicles</p></div>`);
  const upd = () => {
    const hd = orient.getHeading();
    body.querySelector('#cd-v').textContent = hd == null ? '—' : `${hd.toFixed(0)}°`;
    body.querySelector('#cd-n').style.transform = `rotate(${-(hd || 0)}deg)`;
    body.querySelector('#cd-s').textContent = !orient.ready ? 'No orientation sensor' : orient.hasTrueNorth ? 'Absolute compass ✓' : 'Relative only (no compass) — use heading trim / 2nd point';
  };
  orient.addEventListener('update', upd); upd();
  modal({ title: 'Compass', body, onClose: () => orient.removeEventListener('update', upd), actions: [{ label: 'Recalibrate', onClick: () => orient.recalibrate() }, { label: 'Close', kind: 'primary', onClick: (c) => c() }] });
}

// ---------------- QR control points
function startCPCreate() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  goPlanForPicking();
  setTool('cp'); hint('Tap where the surveyor should set out the QR (fine-tune the coordinates next)', cancelTool);
}
function cpDialog(ifc) {
  const n = app.project.geo.controlPoints.length + 1;
  const body = h(`<div>
    <label class="field"><span>Name</span><input id="cp-n" value="CP-${String(n).padStart(2, '0')}"></label>
    <div class="field-row">
      <label class="field"><span>X (m)</span><input id="cp-x" inputmode="decimal" value="${ifc.x.toFixed(3)}"></label>
      <label class="field"><span>Y (m)</span><input id="cp-y" inputmode="decimal" value="${ifc.y.toFixed(3)}"></label>
      <label class="field"><span>Z (m)</span><input id="cp-z" inputmode="decimal" value="${ifc.z.toFixed(3)}"></label>
    </div>
    <p class="muted small">Same coordinate system as the IFC export from Revit · round to what the surveyor will set out · X/Y/Z = <b>centre of the QR</b></p>
    <div class="field-row">
      <label class="field"><span>Mounting</span><select id="cp-m"><option value="floor">On the floor</option><option value="wall">On a wall (upright)</option></select></label>
      <label class="field"><span>Direction (°) 0=+Y · 90=+X</span><input id="cp-h" inputmode="decimal" value="0"></label>
      <label class="field"><span>Printed QR size (cm)</span><input id="cp-s" inputmode="decimal" value="${Math.round(settings.qrSize * 100)}"></label>
    </div>
    <p class="muted small">Lets the app compute the <b>camera position + heading</b> from the QR image: floor → where the top of the QR points · wall → where the QR faces · 20 cm QR recommended, view from ≤ ~2 m · print at 100% and enter the measured size (a wrong size scales the distance)</p></div>`);
  modal({ title: 'Create QR control point', body, actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Create QR', icon: 'qr', kind: 'primary', onClick: (c) => {
    const p = { x: parseFloat(body.querySelector('#cp-x').value), y: parseFloat(body.querySelector('#cp-y').value), z: parseFloat(body.querySelector('#cp-z').value) };
    if (![p.x, p.y, p.z].every(Number.isFinite)) return toast('Invalid coordinates', 'warn');
    const size = Math.min(0.19, Math.max(0.05, (parseFloat(body.querySelector('#cp-s').value) || 15) / 100)); // A4 sheet limits the symbol to 19 cm
    const cp = { id: uuid(), name: body.querySelector('#cp-n').value.trim() || `CP-${n}`, position: p, createdAt: new Date().toISOString(),
      mount: body.querySelector('#cp-m').value, heading: normDeg(parseFloat(body.querySelector('#cp-h').value) || 0), size };
    if (app.project.geo.anchor) { const g = modelToGps(app.project.geo.anchor, p); cp.lat = g.lat; cp.lon = g.lon; }
    app.project.geo.controlPoints.push(cp); save(); renderBadges(); renderPanel(); c(); showCPSheet(cp);
  } }] });
}
async function showCPSheet(cp) {
  if (!cp) return;
  const url = await cpSheet(cp, app.project.name, encodeCP(cp, app.project.id));
  const body = h(`<div class="qr-sheet"><img src="${url}" alt="QR ${esc(cp.name)}"></div>`);
  modal({ title: `QR · ${cp.name}`, body, actions: [
    // A4 at 100 %: the sheet is drawn at real scale, so the QR prints at exactly cp.size (check the 10 cm ruler on the sheet)
    { label: 'Print A4', icon: 'print', left: true, onClick: () => { const w = window.open(''); if (w) { w.document.write(`<title>${esc(cp.name)}</title><style>@page{size:A4;margin:0}html,body{margin:0}img{display:block;width:210mm;height:297mm}</style><img src="${url}" onload="print()">`); w.document.close(); } } },
    { label: 'Download PNG', icon: 'import', kind: 'primary', onClick: () => download(url, `${slug(app.project.name)}_${slug(cp.name)}.png`) }] });
}
async function scanQR() {
  const body = h(`<div class="scan"><video playsinline muted></video><div class="scan-frame"></div>
    <p class="muted small" id="sq-msg">Point the camera at a QR control point — or use the buttons below</p>
    <div class="scan-alt">
      <button class="btn sm" id="sq-img">${icon('image')}<span>Choose QR image</span></button>
      <button class="btn sm" id="sq-list">${icon('qr')}<span>Pick from list</span></button>
    </div>
    <input type="file" id="sq-file" accept="image/*" hidden></div>`);
  let stop = null;
  const md = modal({ title: 'Scan QR', body, cls: 'scan-modal', onClose: () => stop && stop() });
  const done = (cp) => { if (stop) { stop(); stop = null; } md.close(); applyCPFix(cp); };
  const noCamera = (why) => { // camera unavailable → keep the dialog, offer the other two ways
    body.querySelector('video').hidden = true; body.querySelector('.scan-frame').hidden = true;
    body.querySelector('#sq-msg').textContent = `Camera unavailable (${why}) — choose a QR image or pick a point from the list`;
  };
  // 1) pick an image of the QR (gallery / file / screenshot)
  body.querySelector('#sq-img').onclick = () => body.querySelector('#sq-file').click();
  body.querySelector('#sq-file').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    body.querySelector('#sq-msg').textContent = 'Reading the QR image…';
    try {
      const text = await decodeImageFile(f);
      const cp = text && decodeCP(text);
      if (cp) return done(cp);
      body.querySelector('#sq-msg').textContent = text ? 'This QR is not a NEXAR control point' : 'No QR found — use a sharp image with the whole QR visible';
    } catch (err) { body.querySelector('#sq-msg').textContent = 'Cannot open the image'; }
  };
  // 2) choose a control point from the project list (no QR needed)
  body.querySelector('#sq-list').onclick = () => {
    const list = app.project.geo.controlPoints;
    if (!list.length) return toast('No QR points in this project — create one with Site → Create QR', 'warn', 4000);
    if (stop) { stop(); stop = null; }
    md.close();
    const pb = h(`<div class="proj-list">${list.map((c) => `<div class="proj-item" data-id="${c.id}"><div class="proj-icon">${icon('qr')}</div>
      <div class="proj-main"><b>${esc(c.name)}</b><span class="mono">${fmtM(c.position.x, 2)}, ${fmtM(c.position.y, 2)}, ${fmtM(c.position.z, 2)}</span></div></div>`).join('')}</div>`);
    const pm = modal({ title: 'Where are you?', body: pb });
    pb.onclick = (e) => {
      const it = e.target.closest('.proj-item'); if (!it) return;
      const c = list.find((x) => x.id === it.dataset.id); pm.close();
      applyCPFix({ id: c.id, name: c.name, position: c.position, projectId: app.project.id });
    };
  };
  try {
    stop = await startScan(body.querySelector('video'), (text) => { const cp = decodeCP(text); if (cp) done(cp); });
  } catch (e) { noCamera(e.name === 'NotAllowedError' ? 'camera permission denied' : e.message); }
}
// ---------------- self-marking: "I'm here" — tap where you stand (e.g. beside a column). No survey needed.
function startSelfMark() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  goPlanForPicking();
  setTool('self');
  hint("Tap where you stand on the plan — a column snaps to its centre", cancelTool);
}
// cached world boxes of every IFC column: [{modelId, eid, box}]
function columnBoxes() {
  if (app._cols) return app._cols;
  app._cols = [];
  for (const m of viewer.models.children) {
    for (const eid of ifcColumnIds(m)) {
      const box = viewer.elementBox(m.userData.modelId, eid);
      if (!box.isEmpty()) app._cols.push({ modelId: m.userData.modelId, eid, box });
    }
  }
  return app._cols;
}
async function selfMarkAt(hit, ifc) {
  let pos = { ...ifc }, label = 'tapped point';
  // snap to the nearest column (within 0.75 m on plan) whose height spans the tapped level
  const w = hit.point, SNAP = 0.75;
  let best = null, bestD = SNAP;
  for (const c of columnBoxes()) {
    if (w.y < c.box.min.y - 0.6 || w.y > c.box.max.y + 0.1) continue;
    const dx = Math.max(c.box.min.x - w.x, 0, w.x - c.box.max.x), dz = Math.max(c.box.min.z - w.z, 0, w.z - c.box.max.z);
    const d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) {
    const b = best.box;
    pos = viewer.worldToIfc(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2));
    const info = await getIfcElementInfo(viewer.getModel(best.modelId), best.eid).catch(() => null);
    label = `column ${info ? (info.tag || info.name) : ''}`.trim();
    viewer.highlightElement(best.modelId, best.eid);
    setTimeout(() => viewer.clearHighlight(), 1500);
  } else if (viewer.clipOn) {
    // tapped the floor in a cut plan: keep the floor height
    pos.z = Math.min(pos.z, viewer.worldToIfc(new THREE.Vector3(0, viewer.clipY, 0)).z);
  }
  // record in the walked path (self-marks have no GPS)
  const P = app.project;
  let tr = P.tracks[P.tracks.length - 1];
  if (!tr || tr.endedAt) { tr = { id: uuid(), startedAt: new Date().toISOString(), endedAt: null, points: [] }; P.tracks.push(tr); }
  tr.points.push({ t: Date.now(), lat: null, lon: null, acc: null, position: { ...pos }, self: true });
  applyFix({ id: 'self', name: label, position: pos }, 'self');
  renderTrack();
}

// ================================================================ Walk & Mark — the simple mode
// Plan view. 1) tap where you stand  2) tap the point you are facing  3) walk (steps move the dot) and press Mark.
// The marker goes exactly where the dot is (optionally 1–3 m ahead). No camera overlay, no compass dependence:
// the heading comes from tap #2, then the phone's gyro keeps it (or the ⟲ ⟳ buttons / the ▲ walk button).
function headingModelNow() { // model heading (deg clockwise from +Y): phone if available, else the last set value
  const d = deviceModelHeading();
  if (d != null) return d;
  return app.wm ? app.wm.heading : null;
}
async function startWalkMark() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (ar.active) ar.stop();
  try { await orient.requestPermission(); orient.start(); } // inside the button tap: iOS needs the gesture
  catch (e) { toast('Sensor permission denied — use the ⟲ ⟳ buttons to turn', 'warn', 4500); }
  app.wm = { state: 'pos', heading: (app.wm && app.wm.heading) || 0, ahead: 0,
    prev: { mode: viewer.mode, clip: viewer.clipOn, panel: document.body.classList.contains('panel-open') } };
  document.body.classList.add('wm'); document.body.classList.remove('panel-open');
  viewer.headingTrim = 0; viewer.setNavLocked(false);
  setMode('plan'); if (!viewer.clipOn) setSection(true);
  $('#wm').hidden = false;
  $$('#wm-ahead [data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === '0'));
  setTimeout(() => { viewer.resize(); viewer.ortho.zoom = Math.max(viewer.ortho.zoom, 2.6); viewer.ortho.updateProjectionMatrix(); }, 320);
  wmState(app.loc.fix ? 'face' : 'pos');
  syncModeUI();
}
function wmState(s) {
  const wm = app.wm; if (!wm) return;
  wm.state = s;
  const msg = $('#wm-msg');
  if (s === 'pos') { setTool('wmpos'); msg.innerHTML = '<b>1/2</b> Tap where you are <b>standing</b> on the plan (a column snaps to its centre)'; }
  else if (s === 'face') { setTool('wmface'); msg.innerHTML = '<b>2/2</b> Hold the phone the way you face, then tap the point you are <b>looking at</b> (e.g. the next column)'; }
  else { setTool('select'); msg.innerHTML = 'Walk — the blue dot follows your steps (hold <b>▲ Step</b> if one is missed) · press <b>Mark here</b> to drop a pin · at a column press <b>Reset position</b>'; }
  $('#wm-mark').disabled = s !== 'walk';
  syncModeUI();
}
async function wmSetFacing(ifc) {
  const f = app.loc.fix;
  if (!f) return wmState('pos');
  const dx = ifc.x - f.position.x, dy = ifc.y - f.position.y;
  if (Math.hypot(dx, dy) < 0.5) { toast('Too close — tap a point at least 1 m ahead', 'warn'); return wmState('face'); }
  const hm = normDeg((Math.atan2(dx, dy) * 180) / Math.PI);
  app.wm.heading = hm; viewer.headingTrim = 0;
  if (orient.ready) orient.setHeadingNow(normDeg(hm + getBearing())); // phone heading := this direction (compass not needed)
  await toggleSteps(true);
  wmState('walk');
  computeLoc();
}
function nudgeHeading(d) { // d>0 = clockwise
  if (orient.ready) { orient.yawOffset = (orient.yawOffset || 0) + d; orient.manual = true; }
  else if (app.wm) app.wm.heading = normDeg(app.wm.heading + d);
  computeLoc();
}
async function wmMark() {
  const f = app.loc.fix;
  if (!f || !app.wm) return toast('Set your position first', 'warn');
  const pos = { ...f.position }, d = app.wm.ahead, h = headingModelNow();
  if (d > 0 && h != null) { const r = (h * Math.PI) / 180; pos.x += Math.sin(r) * d; pos.y += Math.cos(r) * d; }
  await createMarkupAt({ type: 'plane' }, pos, { type: 'note', source: 'walkmark' });
}
function wmExit() {
  const wm = app.wm; if (!wm) return;
  app.wm = null; document.body.classList.remove('wm'); $('#wm').hidden = true;
  setTool('select'); restorePickMode();
  if (wm.prev.mode !== 'plan') setMode(wm.prev.mode);
  if (!wm.prev.clip && viewer.clipOn) setSection(false);
  if (wm.prev.panel && window.innerWidth >= 900) document.body.classList.add('panel-open');
  setTimeout(() => viewer.resize(), 300);
  syncModeUI();
}
$('#wm-exit').onclick = wmExit;
$('#wm-reset').onclick = () => wmState('pos');
$('#wm-mark').onclick = wmMark;
$('#wm-rotl').onclick = () => nudgeHeading(-10);
$('#wm-rotr').onclick = () => nudgeHeading(10);
$('#wm-ahead').onclick = (e) => {
  const b = e.target.closest('[data-d]'); if (!b || !app.wm) return;
  app.wm.ahead = +b.dataset.d;
  $$('#wm-ahead [data-d]').forEach((x) => x.classList.toggle('on', x === b));
};

// ---------------- Face Point: "I'm looking at THIS point of the plan" → locks the view direction without a compass
function startFacePoint() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  goPlanForPicking();
  setTool('face');
  hint('Tap the point you are facing (e.g. the next column) — in AR press Face when the camera points at it', cancelTool);
}
function facePointAt(ifc) {
  app.project.geo.face = { x: ifc.x, y: ifc.y, z: ifc.z };
  save(); renderBadges(); syncToggles();
  toast('Face Point set — in AR, point the camera at it and press Face', 'ok', 5000);
}
// heading (deg clockwise from model +Y) from where the user stands to the Face Point
function getFaceHeading() {
  const f = app.project.geo.face, me = app.loc.ifc || (app.loc.fix && app.loc.fix.position);
  if (!f || !me) return null;
  const dx = f.x - me.x, dy = f.y - me.y;
  if (Math.hypot(dx, dy) < 0.3) return null;
  return normDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}

// ---------------- Step tracking (dead reckoning): every real step moves "you" along the direction the phone faces
function deviceModelHeading() { // heading of the phone relative to model +Y, deg clockwise
  if (!orient.ready) return null;
  const q = orient.getQuaternion();
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(getBearing() + (viewer.headingTrim || 0))));
  let f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  if (Math.abs(f.y) > 0.85) f = new THREE.Vector3(0, 1, 0).applyQuaternion(q); // pointing at floor/sky: use the device top
  return modelHeadingOfRawDir(f);
}
async function toggleSteps(force) {
  if (steps.active && force !== true) {
    steps.stop(); app.loc.stepMode = false; syncModeUI(); updateStatus();
    toast('Step tracking off', 'info'); return false;
  }
  if (steps.active) return true;
  if (app.loc.tripod) { toast('Tripod mode holds the position — release the tripod to count steps', 'info'); return false; }
  // no I'm-Here yet but we know where GPS puts us: start from that
  if (!app.loc.fix && app.loc.ifc) app.loc.fix = { id: 'gps', position: { ...app.loc.ifc }, t: Date.now(), linked: true };
  if (!app.loc.fix) { toast('Set where you stand first: Site → I\'m Here (or Scan QR)', 'warn', 4500); return false; }
  try { await orient.requestPermission(); orient.start(); await steps.requestPermission(); }
  catch (e) { toast(e.message, 'error'); return false; }
  if (!steps.supported) { toast('This device has no motion sensor', 'warn'); return false; }
  steps.start(); app.loc.stepMode = true;
  syncModeUI(); updateStatus();
  toast(`Step tracking on — your position follows your steps (${settings.stepLen} m per step)`, 'ok', 3500);
  return true;
}
// one step forward along the phone's facing direction (called by the step counter AND by the manual ▲ button)
function doStep(auto = true) {
  if (app.loc.tripod) { if (!auto) toast('Tripod mode holds the position — press Tripod to release', 'info'); return; }
  const f = app.loc.fix;
  if (!f) { toast('Set where you stand first: Site → I\'m Here', 'warn'); return; }
  const h = headingModelNow();
  if (h == null) { if (!auto) toast('No heading from the device yet — move it slightly or allow Motion access', 'warn'); return; }
  const r = THREE.MathUtils.degToRad(h), L = settings.stepLen;
  const pos = { x: f.position.x + Math.sin(r) * L, y: f.position.y + Math.cos(r) * L, z: f.position.z };
  app.loc.fix = { ...f, position: pos, t: Date.now() };
  app.loc.stepMode = true;
  app.project.geo.here = { id: f.id, name: 'steps', method: 'steps', position: { ...pos }, t: Date.now() };
  app._stepN = (app._stepN || 0) + 1;
  computeLoc(); updateStatus();
  if (app._stepN % 10 === 0) save();
}
steps.addEventListener('step', () => doStep(true));
steps.threshold = settings.stepSens;
// floating ▲ button (Walk Track): tap = 1 step, hold = keep walking
(() => {
  const b = $('#step-btn'); let tm = null;
  const stop = () => { clearInterval(tm); tm = null; };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); doStep(false); tm = setInterval(() => doStep(false), 450); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
})();

// ---------------- Tripod: the most accurate setup for AR on the web.
// Position is LOCKED (no steps, no GPS) at a known point and the camera height is FIXED, so the only unknown
// left is the heading — set it once with drag / Face / QR, then just pan and tilt the phone on the tripod.
async function toggleTripod() {
  if (app.loc.tripod) { app.loc.tripod = false; toast('Tripod released — normal tracking resumed', 'info'); updateStatus(); return false; }
  if (!app.loc.fix && app.loc.ifc) app.loc.fix = { id: 'tripod', position: { ...app.loc.ifc }, t: Date.now() };
  if (!app.loc.fix) { toast('Set the tripod position first: Site → I\'m Here or the QR button in AR', 'warn', 5000); return false; }
  const v = await promptBox('Camera height on the tripod (m)', 'Floor to phone camera — keep it the same every setup', String(settings.eye));
  if (v === null) return false;
  const h = parseFloat(v);
  if (!Number.isFinite(h) || h < 0.3 || h > 3) { toast('Invalid height (0.3–3 m)', 'warn'); return false; }
  settings.eye = h; viewer.walk.eye = h; saveSettings();
  steps.stop(); app.loc.stepMode = true; app.loc.tripod = true;
  computeLoc(); updateStatus(); syncToggles();
  toast(`Tripod locked · ${h.toFixed(2)} m high · position fixed — drag or press Face / QR once to align the heading`, 'ok', 6000);
  return true;
}

// ---------------- tracking mode: Hybrid (steps + GPS pull-back) · Steps only · GPS only
const TRACK_LABEL = { hybrid: 'Hybrid', steps: 'Steps', gps: 'GPS' };
const TRACK_HELP = {
  hybrid: 'Hybrid: steps move you smoothly, GPS slowly pulls back drift',
  steps: 'Steps: step counting only (no GPS) — works indoors but drifts; press I\'m Here at a column to reset',
  gps: 'GPS: GPS only — best outdoors (±3–10 m); needs Set Location / I\'m Here first'
};
async function setTrackMode(m, quiet) {
  settings.trackMode = m; saveSettings();
  if (m === 'gps') {
    steps.stop(); app.loc.stepMode = false;
    try { await orient.requestPermission(); orient.start(); } catch (e) { /* compass optional */ }
    if (!gps.active) await toggleGPS();
  } else {
    const ok = await toggleSteps(true);
    if (!ok) { if (m === 'hybrid' && !gps.active && app.project.geo.anchor) await toggleGPS(); return false; }
    if (m === 'hybrid' && !gps.active) await toggleGPS();
    if (m === 'steps' && gps.active) await toggleGPS();
  }
  syncModeUI(); updateStatus();
  if (!quiet) toast(TRACK_HELP[m], 'ok', 5000);
  return true;
}
async function cycleTrack() {
  const order = ['hybrid', 'steps', 'gps'];
  await setTrackMode(order[(order.indexOf(settings.trackMode) + 1) % order.length]);
  return true;
}

// "Walk Track": virtual walkthrough that follows the real walk (steps) and the phone's direction
async function startWalkTrack() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (!app.loc.fix) return toast('Set where you stand first: Site → I\'m Here', 'warn', 4500);
  try { await orient.requestPermission(); orient.start(); } catch (e) { return toast(e.message, 'error'); }
  if (!(await toggleSteps(true))) return;
  setMode('walk');
  viewer.bearing = getBearing();
  viewer.walk.gyro = true; viewer.walk.follow = true;
  computeLoc();
  viewer.persp.position.copy(viewer.ifcToWorld(app.loc.fix.position)).add(new THREE.Vector3(0, viewer.walk.eye, 0));
  syncToggles();
  toast('Walk Track: walk for real and the model follows · drag left / right to line the model up with reality', 'ok', 5000);
}

function applyCPFix(cp) {
  const P = app.project;
  if (cp.projectId && cp.projectId !== P.id) toast('This QR belongs to another project — using its coordinates', 'warn', 4000);
  let rec = findCP(cp);
  if (!rec) { rec = { id: cp.id || uuid(), name: cp.name, position: cp.position, size: cp.size, mount: cp.mount, heading: cp.heading, createdAt: new Date().toISOString() }; P.geo.controlPoints.push(rec); }
  applyFix(rec, 'qr');
}
// QR payloads carry only the first 8 characters of the id (compact = bigger modules), so match by prefix
function findCP(cp) {
  const id = String(cp.id || '').replace(/-/g, '');
  return app.project.geo.controlPoints.find((c) => c.id === cp.id || (id && c.id.replace(/-/g, '').startsWith(id)));
}

// ---------------- QR pose: camera position + heading from the QR image (called by the AR overlay's QR Lock)
function onQrDetect(det, K) {
  const cp0 = decodeCP(det.text);
  if (!cp0) return { ok: false, msg: 'This QR is not from NEXAR' };
  const rec = findCP(cp0);
  const cp = { name: (rec && rec.name) || cp0.name, position: (rec && rec.position) || cp0.position, size: cp0.size, mount: cp0.mount, heading: cp0.heading };
  // the QR itself carries the size/mount/heading that were printed; use the project's value if it was corrected later
  if (rec) { cp.size = rec.size || cp.size; cp.mount = rec.mount || cp.mount; cp.heading = rec.heading ?? cp.heading; }
  const pose = poseFromDetection(det, cp.size, K.f, K.cx, K.cy);
  if (!pose) return { ok: false, msg: `${cp.name}: cannot compute the pose` };
  if (pose.dist > 4) return { ok: false, msg: `${cp.name} too far (${pose.dist.toFixed(1)} m) — move within 2 m` };
  if (pose.reproj > 8) return { ok: false, msg: `${cp.name}: image unclear or too oblique` };
  const m = poseToModel(pose, cp);
  // trust falls with distance: ≤2 m full, 2–3 m half, beyond a quarter
  const gain = pose.dist <= 2 ? 1 : pose.dist <= 3 ? 0.5 : 0.25;
  const target = { x: m.position.x, y: m.position.y, z: m.position.z - settings.eye };
  const f = app.loc.fix, recent = f && f.src === 'qr' && Date.now() - f.t < 2500;
  const g = recent ? Math.min(gain, 0.5) : gain;
  const cur = (f && f.position) || target;
  const pos = { x: cur.x + (target.x - cur.x) * g, y: cur.y + (target.y - cur.y) * g, z: cur.z + (target.z - cur.z) * g };
  app.loc.fix = { id: (rec && rec.id) || cp0.id, position: pos, t: Date.now(), src: 'qr', linked: f && f.linked };
  if (settings.trackMode !== 'gps') app.loc.stepMode = true; // hold the QR position; steps continue from here
  app.project.geo.here = { id: app.loc.fix.id, name: cp.name, method: 'qr-pose', position: { ...pos }, t: Date.now() };
  computeLoc(); updateStatus();
  return { ok: true, heading: m.heading, gain: g, msg: `${cp.name} ✓ ${pose.dist.toFixed(1)} m` };
}
// Lock "my position" to a known model point (QR scan or self-mark). With GPS on it also corrects GPS drift.
function applyFix(rec, method) {
  const P = app.project;
  app.loc.fix = { id: rec.id, position: { ...rec.position }, t: Date.now() };
  P.geo.here = { id: rec.id, name: rec.name, method, position: { ...rec.position }, t: Date.now() }; // survives reload
  app.loc.fixZ = rec.position.z;
  const g = gps.active && gps.last && Date.now() - gps.last.t < 10000 && gps.last.acc <= GOOD_GPS_M ? gps.last : null;
  if (g) app.loc.fix.linked = true;
  if (g && P.geo.anchor) {
    const pg = gpsToModel(P.geo.anchor, g.lat, g.lon);
    app.loc.corr = { x: rec.position.x - pg.x, y: rec.position.y - pg.y };
    toast(`Position locked to ${rec.name} (GPS corrected by ${Math.hypot(app.loc.corr.x, app.loc.corr.y).toFixed(1)} m)`, 'ok', 4000);
  } else if (g && !P.geo.anchor) {
    P.geo.anchor = { position: { ...rec.position }, lat: g.lat, lon: g.lon, alt: g.alt, bearing: getBearing(), method, accuracy: g.acc, createdAt: new Date().toISOString() };
    app.loc.corr = { x: 0, y: 0 };
    toast(`Location set from ${method === 'self' ? 'self-mark' : 'QR'} ${rec.name} — refine the heading with 2nd Point`, 'ok', 4500);
  } else toast(method === 'self' ? `You are at ${rec.name} (tap I'm Here again at the next point)` : `Position locked to ${rec.name}`, 'ok', 4000);
  save(); renderBadges(); computeLoc(); renderPanel(); updateStatus();
  if (viewer.mode === 'plan') viewer.focusPoint(viewer.ifcToWorld(rec.position), 10);
  else if (viewer.mode === 'orbit') viewer.focusPoint(viewer.ifcToWorld(rec.position), 10);
  if (viewer.mode === 'walk') viewer.persp.position.copy(viewer.ifcToWorld(rec.position)).add(new THREE.Vector3(0, viewer.walk.eye, 0));
}

// ---------------- gyro / AR
// Optional "turn with the phone" in Walk. RELATIVE to the current view (no compass needed): at switch-on the
// heading offset is chosen so the view does not jump sideways; after that the view follows the phone.
function gyroOff() {
  const w = viewer.walk; if (!w.gyro) return;
  w.gyro = false;
  const e = new THREE.Euler().setFromQuaternion(viewer.persp.quaternion, 'YXZ'); // keep looking where we are now
  w.yaw = e.y; w.pitch = THREE.MathUtils.clamp(e.x, -1.45, 1.45);
  syncModeUI();
}
async function toggleGyro() {
  if (viewer.walk.gyro) { gyroOff(); toast('Gyro off — use the look stick', 'info', 1800); return; }
  try { await orient.requestPermission(); orient.start(); } catch (e) { return toast('Motion & Orientation permission denied', 'error', 4000); }
  for (let i = 0; i < 15 && !orient.ready; i++) await new Promise((r) => setTimeout(r, 100)); // wait for the first sensor reading
  if (!orient.ready) return toast('This device has no orientation sensor', 'warn');
  if (viewer.mode !== 'walk') setMode('walk');
  const q = viewer.persp.quaternion;
  let f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  if (Math.abs(f.y) > 0.85) f = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const camH = normDeg((Math.atan2(f.x, -f.z) * 180) / Math.PI);
  viewer.bearing = normDeg(orient.getHeading() - camH); // view heading = phone heading − bearing  → no sideways jump
  viewer.headingTrim = 0;
  viewer.walk.gyro = true;
  syncModeUI();
  toast('Gyro on: turn the device to look around · drag or use the look stick to adjust · press again to turn off', 'ok', 4500);
}
async function startXR() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  if (!(await xrARSupported())) {
    return modal({ title: 'WebXR AR not available', body: `<p>This device / browser does not support WebXR AR.</p><ul class="muted"><li><b>Android</b>: Chrome + Google Play Services for AR (ARCore) over HTTPS</li><li><b>iPhone / iPad</b>: Safari does not support WebXR AR yet — use <b>Camera AR</b> instead (or the future Unity / ARKit app)</li></ul>`,
      actions: [{ label: 'Close', onClick: (c) => c() }, { label: 'Use Camera AR', kind: 'primary', icon: 'camera', onClick: (c) => { c(); startCamAR(); } }] });
  }
  try {
    try { await orient.requestPermission(); orient.start(); } catch (e) { /* optional */ }
    clearSelection(); setTool('select');
    await ar.startXR();
    syncModeUI();
  } catch (e) { console.error(e); toast(`AR: ${e.message}`, 'error', 5000); }
}
async function startCamAR() {
  if (!viewer.models.children.length) return toast('Open a model first', 'warn');
  try {
    clearSelection(); setTool('select');
    await ar.startCamera();
    if (app.loc.fix || app.project.geo.anchor) setTrackMode(settings.trackMode, true); // follow the user's walking automatically
    syncModeUI();
  } catch (e) { console.error(e); toast(`Camera AR: ${e.message}`, 'error', 5000); }
}

// ================================================================ export
async function cmdExportBCF() {
  if (!app.project.markups.length) return toast('No markups to export yet', 'warn');
  busy('Creating BCF…');
  try { download(await exportBCF(app.project, settings.author || 'NEXAR'), `${slug(app.project.name)}.bcfzip`); toast(`Exported ${app.project.markups.length} topics (BCF 3.0)`, 'ok'); }
  catch (e) { toast(e.message, 'error'); }
  busy(false);
}
async function cmdExportHTML() {
  if (!viewer.models.children.length && !app.project.markups.length) return toast('Open a model first', 'warn');
  busy('Creating interactive HTML…');
  try {
    const { exportInteractiveHTML } = await import('../../Exporters/htmlexport.js');
    const r = await exportInteractiveHTML(app.project, viewer, { groupName, onProgress: (t) => busy(t) });
    download(r.blob, `${slug(app.project.name)}_NEXAR.html`);
    toast(`Interactive HTML: model + ${r.count} marks (${r.sizeMB.toFixed(1)} MB) — open it in any browser`, 'ok', 5000);
  } catch (e) { console.error(e); toast(`HTML export: ${e.message}`, 'error', 6000); }
  busy(false);
}
async function cmdExportIFC() {
  const P = app.project;
  const objMarks = (P.markups || []).filter(isObjectMark);
  if (!objMarks.length) return toast('No Object Marks (MK-###) to export to IFC yet — Notes are exported separately', 'warn', 4500);
  busy('Creating IFC with Object Marks…');
  try {
    const { exportIfcWithMarks } = await import('../../Exporters/ifcmarks.js');
    // append to the first loaded IFC model (same units / storeys / origin); otherwise a stand-alone IFC with the marks only
    // (hide the IFC in View → Models to get a marks-only file)
    const rec = P.models.find((m) => m.format === 'ifc' && !m.missing && m.visible !== false);
    const f = rec ? await store.getFile(rec.fileId) : null;
    const r = exportIfcWithMarks(P, f ? f.data : null, { author: settings.author || 'NEXAR', groupName });
    const base = f ? rec.name.replace(/\.ifc$/i, '') : slug(P.name);
    download(r.blob, `${base}_Marks.ifc`);
    toast(r.merged ? `${r.count} Object Mark${r.count === 1 ? '' : 's'} (MK) added into ${rec.name} (${r.schema}) — Notes excluded` : `IFC with ${r.count} Object Mark${r.count === 1 ? '' : 's'} (MK) — same model coordinates`, 'ok', 6000);
  } catch (e) { console.error(e); toast(`IFC export: ${e.message}`, 'error', 6000); }
  busy(false);
}
async function cmdExportXLSX() {
  const P = app.project;
  const objMarks = (P && P.markups ? P.markups : []).filter(isObjectMark);
  if (!objMarks.length) return toast('No Object Marks (MK-###) to export to UniFormat Excel yet', 'warn', 4000);
  busy('Building UniFormat Excel (Marks only)…');
  try {
    const { exportUniformatExcel } = await import('../../Exporters/xlsxexport.js');
    const r = await exportUniformatExcel(P, { groupName });
    download(r.blob, `${slug(P.name)}_Marks_UniFormat.xlsx`);
    toast(`Marks Excel exported · ${r.summaryCount} UniFormat group${r.summaryCount === 1 ? '' : 's'} · ${r.itemCount} Object Mark${r.itemCount === 1 ? '' : 's'}`, 'ok', 4500);
  } catch (e) { console.error(e); toast(`Excel export: ${e.message}`, 'error', 6000); }
  busy(false);
}
async function cmdExportNotesXLSX() {
  const P = app.project;
  const notes = (P && P.markups ? P.markups : []).filter((m) => !isObjectMark(m));
  if (!notes.length) return toast('No Notes / Comments (NT-###) in this project yet', 'warn', 4000);
  busy('Building Site Notes Excel (.xlsx)…');
  try {
    const { exportNotesExcel } = await import('../../Exporters/xlsxexport.js');
    const r = await exportNotesExcel(P, { groupName });
    download(r.blob, `${slug(P.name)}_Notes.xlsx`);
    toast(`Notes Excel exported · ${r.itemCount} read-only note${r.itemCount === 1 ? '' : 's'} (NT)`, 'ok', 4500);
  } catch (e) { console.error(e); toast(`Notes Excel: ${e.message}`, 'error', 6000); }
  busy(false);
}
function cmdExportNotesCSV() {
  const P = app.project;
  const notes = (P && P.markups ? P.markups : []).filter((m) => !isObjectMark(m));
  if (!notes.length) return toast('No Notes / Comments (NT-###) to export yet', 'warn', 4000);
  const rows = [['Tag', 'Number', 'Type', 'Status', 'Priority', 'Group', 'Title', 'Note / Comment', 'CheckedAt', 'ModelFile', 'X (m)', 'Y (m)', 'Z (m)', 'HostElement', 'IFC GUID', 'PhotoFolder', 'PhotoFiles', 'Author', 'Replies']];
  for (const m of notes) {
    const gn = groupName(m.group);
    const nm = itemNaming(m, gn);
    const files = [];
    if (nm.viewSnap) files.push(nm.viewSnap.fileName);
    nm.sitePhotos.forEach((f) => files.push(f.fileName));
    rows.push([
      itemTag(m), m.number, typeMeta(m.type).label, m.status, m.priority, gn,
      markupTitle(m), m.text || '', fmtDateTime(m.checkedAt || m.createdAt), m.modelName || '',
      m.position.x.toFixed(4), m.position.y.toFixed(4), m.position.z.toFixed(4),
      m.element ? m.element.name : '', m.element ? m.element.guid : '',
      nm.folderPath, files.join('; '), m.author || '', (m.replies || []).length
    ]);
  }
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slug(P.name)}_Notes.csv`);
  toast(`Notes CSV exported · ${notes.length} note${notes.length === 1 ? '' : 's'} (NT)`, 'ok', 3500);
}
function cmdExportSplitJSON(kind) {
  const P = app.project;
  const wantMark = kind === 'mark';
  const items = (P && P.markups ? P.markups : []).filter((m) => wantMark ? isObjectMark(m) : !isObjectMark(m));
  if (!items.length) return toast(wantMark ? 'No Object Marks (MK-###) to export yet' : 'No Notes / Comments (NT-###) to export yet', 'warn', 4000);
  const payload = {
    schema: wantMark ? 'nexar.marks/1.0' : 'nexar.notes/1.0',
    recordKind: wantMark ? 'mark' : 'note',
    projectId: P.id,
    projectName: P.name,
    exportedAt: new Date().toISOString(),
    coordinateSystem: 'IFC metres Z-up (matches imported model)',
    models: (P.models || []).map((x) => ({ name: x.name, format: x.format, visible: x.visible !== false })),
    count: items.length,
    items: items.map((m) => ({
      tag: itemTag(m),
      number: m.number,
      kind: recordKind(m),
      type: normType(m.type),
      status: m.status,
      priority: m.priority,
      group: groupName(m.group),
      title: markupTitle(m),
      note: m.text || '',
      checkedAt: m.checkedAt || m.createdAt,
      createdAt: m.createdAt,
      modifiedAt: m.modifiedAt,
      author: m.author || '',
      modelName: m.modelName || '',
      position: { x: +m.position.x.toFixed(4), y: +m.position.y.toFixed(4), z: +m.position.z.toFixed(4) },
      family: wantMark ? (m.family || null) : undefined,
      element: m.element || null,
      gps: m.gps || null,
      photoCount: (m.photos || []).length,
      replies: m.replies || []
    }))
  };
  const suffix = wantMark ? '_Marks.json' : '_Notes.json';
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${slug(P.name)}${suffix}`);
  toast(`${wantMark ? 'Marks' : 'Notes'} JSON exported · ${items.length} item${items.length === 1 ? '' : 's'}`, 'ok', 3500);
}
async function cmdExportPhotoZip() {
  const P = app.project;
  if (!P || !P.markups.length) return toast('No markups in this project to export yet', 'warn');
  busy('Packing UniFormat photo folders + CSV…');
  try {
    const r = await exportPhotoPackZip(P, { groupName, include3D: true });
    download(r.blob, `${slug(P.name)}_Photos_UniFormat.zip`);
    toast(`Photo Pack exported · ${r.photoCount} site photo${r.photoCount === 1 ? '' : 's'} + ${r.snapCount} 3D views + Photo_Directory.csv`, 'ok', 5000);
  } catch (e) { console.error(e); toast(`Photo Pack: ${e.message}`, 'error', 6000); }
  busy(false);
}
function cmdExportPhotoCSV() {
  const P = app.project;
  if (!P || !P.markups.length) return toast('No markups in this project to export yet', 'warn');
  const r = buildPhotoDirectoryCSV(P, { groupName, include3D: true });
  download(r.blob, `${slug(P.name)}_Photo_Directory.csv`);
  toast(`Photo Directory CSV · ${r.rowCount} rows (${r.itemCount} items)`, 'ok', 3500);
}
function cmdExportCSV() {
  const rows = [['ItemTag', 'RecordKind', 'Number', 'Group', 'Type', 'Status', 'Priority', 'Title', 'Description', 'Author', 'CheckedAt', 'Created', 'Modified', 'ModelFile', 'X', 'Y', 'Z', 'UniformatCode', 'UniformatGroup', 'PlacementMode', 'FamilyCategory', 'FamilyName', 'FamilyType', 'HostSurface', 'RotationDeg', 'OffsetZ', 'NormalX', 'NormalY', 'NormalZ', 'Latitude', 'Longitude', 'HostRevitId', 'IFC GUID', 'Element', 'IFC Type', 'Source', 'Locked', 'Photos', 'Replies']];
  for (const m of app.project.markups) {
    const F = isObjectMark(m) ? (m.family || {}) : {};
    rows.push([itemTag(m), isObjectMark(m) ? 'Mark' : 'Note', m.number, groupName(m.group), typeMeta(m.type).label, m.status, m.priority, markupTitle(m), m.text, m.author, fmtDateTime(m.checkedAt || m.createdAt), m.createdAt, m.modifiedAt, m.modelName || '',
      m.position.x.toFixed(4), m.position.y.toFixed(4), m.position.z.toFixed(4),
      F.uniformat || F.discipline || '', F.group || '', F.placement || '', F.category || '', F.familyName || '', F.typeName || '', F.hostSurface || '',
      Number.isFinite(F.rotationDeg) ? F.rotationDeg : '', Number.isFinite(F.offsetZ) ? F.offsetZ : '',
      F.normal ? F.normal.x : '', F.normal ? F.normal.y : '', F.normal ? F.normal.z : '',
      m.gps ? m.gps.lat.toFixed(8) : '', m.gps ? m.gps.lon.toFixed(8) : '',
      m.element && m.element.tag ? m.element.tag : '', m.element ? m.element.guid : '', m.element ? m.element.name : '', m.element ? m.element.ifcType : '', m.source, m.locked ? 'yes' : '', m.photos.length, m.replies.length]);
  }
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slug(app.project.name)}_all_items.csv`);
}
$('#file-project').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    if (/\.(bcf|bcfzip|zip)$/i.test(file.name)) {
      const list = await importBCF(file);
      let added = 0, updated = 0;
      for (const m of list) {
        m.type = normType(m.type);
        m.kind = recordKind(m);
        if (!m.checkedAt) m.checkedAt = m.createdAt || new Date().toISOString();
        const ex = app.project.markups.find((x) => x.id === m.id);
        if (ex) { Object.assign(ex, m); updated++; } else { app.project.markups.push(m); added++; }
      }
      renumberMarkups(app.project);
      save(); refreshMarkers(); openPanel('markups');
      toast(`BCF: ${added} added, ${updated} updated`, 'ok');
    } else {
      const p = JSON.parse(await file.text());
      if (!p.schema || (!String(p.schema).startsWith('nexar.project') && !String(p.schema).startsWith('sitear.project'))) throw new Error('Not a NEXAR project file');
      const exists = await store.getProject(p.id);
      if (exists && !(await confirmBox('Replace project', `A project "${exists.name}" already exists — replace it with this file?`, 'Replace', true))) return;
      await store.putProject(p); await openProject(p);
      toast('Project imported', 'ok');
    }
  } catch (err) { console.error(err); toast(err.message, 'error', 5000); }
};

function revitGuide() {
  modal({ title: 'Revit ⇄ NEXAR workflow', wide: true, body: `
    <div class="guide">
      <h4>1 · Revit → NEXAR</h4>
      <ol><li>Revit: <b>File → Export → IFC</b> (IFC4 Reference View or IFC2x3 Coordination View 2.0)</li>
        <li>Setup → <b>Coordinate Base: Shared Coordinates</b> (or Survey Point) so coordinates match the surveyor</li>
        <li>Tick <i>Export IFC common property sets</i> and <i>Export base quantities</i> as needed</li>
        <li>Open the .ifc in NEXAR (Open Model)</li></ol>
      <h4>2 · Review</h4>
      <ol><li><b>Walk</b> through the model with the sticks (or W A S D on a PC)</li>
        <li><b>Capture</b> views and <b>Mark</b> points (Comment / Note / Issue + photos)</li>
        <li>Keep related captures and marks together in <b>Groups</b></li></ol>
      <h4>3 · NEXAR → Revit</h4>
      <ol><li><b>Export BCF</b> (.bcfzip, BCF 3.0) — each markup carries the camera view, images, the element IFC GUID and coordinates</li>
        <li>Revit: install a BCF add-in such as <b>BIMcollab Zoom / BCF Manager for Revit</b> or <b>Revizto / BIM Track</b>, import the BCF, click a topic and Revit zooms to the element</li>
        <li>Open source: <b>Bonsai (BlenderBIM)</b>, <b>xBIM / BIMvision</b> and <b>IfcOpenShell</b> read BCF</li>
        <li>To place pins as real Revit elements, use the <b>Project JSON</b> with the Dynamo / pyRevit script (see docs/REVIT.md)</li></ol>
      <p class="muted small">All coordinates are IFC coordinates (metres, Z up) — they match Revit when exported with Shared Coordinates</p>
    </div>`, actions: [{ label: 'Close', kind: 'primary', onClick: (c) => c() }] });
}

function applyAllSettings() {
  document.body.classList.toggle('ui-clean', settings.uiMode !== 'ribbon');
  document.body.dataset.density = settings.density || 'standard';
  document.body.classList.toggle('no-compass', settings.showCompass === false);
  const acc = settings.accent || 'yellow';
  if (acc === 'yellow') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', acc);
  applyTheme(settings.theme || 'dark');
  viewer.setGrid(settings.grid !== false);
  viewer.scopeOn = settings.scope !== false;
  viewer.scopeFactor = settings.scopeFactor || 3;
  viewer.invalidateScope();
  viewer.walk.eye = settings.eye || 1.6;
  steps.threshold = settings.stepSens || 0.8;
  viewer.applyPrefs({
    mousePreset: settings.mousePreset || 'nexar',
    invertZoom: !!settings.invertZoom,
    orbitSpeed: settings.orbitSpeed || 1,
    zoomSpeed: settings.zoomSpeed || 1,
    invertLookY: !!settings.invertLookY,
    pinScale: settings.pinScale || 1,
    quality: settings.quality || 'high',
    fov3d: settings.fov3d || 55
  }, cam.on);
  const su = $('#st-units');
  if (su) su.textContent = `IFC · ${settings.units || 'm'} · Z-up`;
  if (app.project) { refreshMarkers(); refreshMeasures(); syncModeUI(); }
  setTimeout(() => { viewer.resize(); if (settings.uiMode === 'ribbon') ribbon._ink(); }, 60);
}

function settingsDialog(initialTab = 'general') {
  let tab = initialTab;
  const TABS = [
    ['general', 'General', 'sliders'],
    ['appearance', 'Appearance', 'sun'],
    ['navigation', 'Navigation', 'orbit'],
    ['graphics', 'Graphics & AR', 'camera'],
    ['families', 'Family Presets', 'cube'],
    ['shortcuts', 'Shortcuts & Data', 'info']
  ];
  const MOUSE_DESC = {
    nexar: 'Left-drag: Orbit · Middle / Right-drag: Pan · Scroll: Zoom · Double-mid: Fit',
    revit: 'Middle-drag: Pan · Shift+Middle / Right-drag: Orbit · Left-click: Select / Mark',
    sketchup: 'Middle-drag: Orbit · Shift+Middle / Right-drag: Pan · Left-click: Select / Mark'
  };
  const ACCENTS = [
    ['yellow', '#DFB73A', 'Soft Site Yellow'],
    ['blue', '#3B82F6', 'Engineering Blue'],
    ['emerald', '#4CB884', 'Emerald'],
    ['mono', '#A1A1AA', 'Monochrome']
  ];
  const body = h(`<div class="set-layout"><nav class="set-nav" id="set-nav"></nav><div class="set-pane" id="set-pane"></div></div>`);
  const nav = body.querySelector('#set-nav'), pane = body.querySelector('#set-pane');
  const seg = (id, opts, cur) => `<div class="set-seg" data-seg="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (id, on) => `<label class="switch" style="margin:0"><input type="checkbox" data-sw="${id}" ${on ? 'checked' : ''}><i></i></label>`;

  const renderNav = () => {
    nav.innerHTML = TABS.map(([k, l, ic]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('');
  };

  const renderPane = () => {
    if (tab === 'general') {
      pane.innerHTML = `<h3>General</h3>
        <div class="set-row"><div class="set-info"><b>Author name</b><span>Stamped on new markups, BCF topics and Revit IFC exports</span></div>
          <div class="set-ctl"><input type="text" data-inp="author" value="${esc(settings.author)}" placeholder="Site engineer"></div></div>
        <div class="set-row"><div class="set-info"><b>Interface layout</b><span>Clean Field UI is optimized for iPad / mobile site work</span></div>
          <div class="set-ctl">${seg('uiMode', [['clean', 'Clean Field'], ['ribbon', 'Classic Ribbon']], settings.uiMode || 'clean')}</div></div>
        <h4>Units &amp; Coordinates</h4>
        <div class="set-row"><div class="set-info"><b>Display units</b><span>Converts IFC metres for coordinate readouts (stored data stays IFC metres)</span></div>
          <div class="set-ctl">${seg('units', [['m', 'm'], ['mm', 'mm'], ['cm', 'cm'], ['ft', 'ft']], settings.units || 'm')}</div></div>
        <div class="set-row"><div class="set-info"><b>Decimal places</b><span>Precision shown in status bar &amp; markup coordinates</span></div>
          <div class="set-ctl">${seg('precision', [[1, '0.0'], [2, '0.00'], [3, '0.000']], settings.precision ?? 2)}</div></div>`;
    } else if (tab === 'appearance') {
      pane.innerHTML = `<h3>Appearance</h3>
        <div class="set-row"><div class="set-info"><b>Theme</b><span>Light theme improves readability in outdoor daylight</span></div>
          <div class="set-ctl">${seg('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], settings.theme || 'dark')}</div></div>
        <div class="set-row"><div class="set-info"><b>UI accent color</b><span>Active buttons &amp; highlights (NEXAR yellow logo stays consistent)</span></div>
          <div class="set-ctl"><div class="set-swatches">${ACCENTS.map(([k, col, lbl]) => `<button type="button" class="set-dot ${(settings.accent || 'yellow') === k ? 'on' : ''}" data-acc="${k}" title="${lbl}" style="background:${col}"></button>`).join('')}</div></div></div>
        <div class="set-row"><div class="set-info"><b>Button size / density</b><span>Use Touch mode for iPad, tablet or gloved hands on site</span></div>
          <div class="set-ctl">${seg('density', [['compact', 'Compact'], ['standard', 'Standard'], ['touch', 'Touch / iPad']], settings.density || 'standard')}</div></div>
        <h4>Viewport Overlays</h4>
        <div class="set-row"><div class="set-info"><b>Show 3D ViewCube</b><span>Compact 3D orientation cube &amp; North ring in top-right (drag to orbit, tap face to snap)</span></div>
          <div class="set-ctl">${sw('showCompass', settings.showCompass !== false)}</div></div>
        <div class="set-row"><div class="set-info"><b>Show floor grid</b><span>Reference 1 m ground grid in 3D view</span></div>
          <div class="set-ctl">${sw('grid', settings.grid !== false)}</div></div>
        <div class="set-row"><div class="set-info"><b>Show markup pins</b><span>Display 3D numbered pins over the model</span></div>
          <div class="set-ctl">${sw('showMarkups', settings.showMarkups !== false)}</div></div>
        <div class="set-row"><div class="set-info"><b>Pin size</b><span>Scale of 3D markers in the viewport</span></div>
          <div class="set-ctl">${seg('pinScale', [[0.75, 'Small'], [1, 'Normal'], [1.3, 'Large']], settings.pinScale || 1)}</div></div>`;
    } else if (tab === 'navigation') {
      const mp = settings.mousePreset || 'nexar';
      pane.innerHTML = `<h3>Navigation &amp; Mouse</h3>
        <div class="set-row"><div class="set-info"><b>Mouse control preset</b><span id="set-mp-desc">${MOUSE_DESC[mp] || MOUSE_DESC.nexar}</span></div>
          <div class="set-ctl">${seg('mousePreset', [['nexar', 'NEXAR / Web'], ['revit', 'Revit'], ['sketchup', 'SketchUp / Blender']], mp)}</div></div>
        <div class="set-row"><div class="set-info"><b>Invert scroll zoom</b><span>Reverse mouse wheel zoom direction</span></div>
          <div class="set-ctl">${sw('invertZoom', !!settings.invertZoom)}</div></div>
        <div class="set-row"><div class="set-info"><b>Orbit sensitivity</b><span>Speed when rotating the 3D view</span></div>
          <div class="set-ctl"><input type="range" data-rng="orbitSpeed" min="0.4" max="2" step="0.1" value="${settings.orbitSpeed || 1}"><span class="set-val">${(settings.orbitSpeed || 1).toFixed(1)}×</span></div></div>
        <div class="set-row"><div class="set-info"><b>Zoom sensitivity</b><span>Speed when scrolling or pinching</span></div>
          <div class="set-ctl"><input type="range" data-rng="zoomSpeed" min="0.4" max="2" step="0.1" value="${settings.zoomSpeed || 1}"><span class="set-val">${(settings.zoomSpeed || 1).toFixed(1)}×</span></div></div>
        <h4>Walkthrough &amp; Touch Pads</h4>
        <div class="set-row"><div class="set-info"><b>Touch joysticks (MOVE / LOOK)</b><span>Sleek thumb pads in Walk mode — set "Always On" to preview &amp; use on PC</span></div>
          <div class="set-ctl">${seg('touchControls', [['auto', 'Auto (iPad)'], ['always', 'Always On'], ['off', 'Off']], settings.touchControls || 'auto')}</div></div>
        <div class="set-row"><div class="set-info"><b>Eye height (m)</b><span>Camera height above floor in Walk &amp; CAM modes</span></div>
          <div class="set-ctl"><input type="number" step="0.05" min="0.4" max="2.8" data-num="eye" value="${settings.eye || 1.6}"></div></div>
        <div class="set-row"><div class="set-info"><b>Invert look Y (Walk)</b><span>Flip vertical look drag direction in Walk mode</span></div>
          <div class="set-ctl">${sw('invertLookY', !!settings.invertLookY)}</div></div>
        <div class="set-row"><div class="set-info"><b>Scope box limit</b><span>Keeps the model from drifting off screen</span></div>
          <div class="set-ctl">${sw('scope', settings.scope !== false)}</div></div>
        <div class="set-row"><div class="set-info"><b>Scope max distance (× model)</b><span>Default 3× model radius</span></div>
          <div class="set-ctl"><input type="number" step="0.5" min="1.5" max="20" data-num="scopeFactor" value="${settings.scopeFactor || 3}"></div></div>`;
    } else if (tab === 'graphics') {
      pane.innerHTML = `<h3>Graphics &amp; Performance</h3>
        <div class="set-row"><div class="set-info"><b>Render quality</b><span>Use Lite on older phones or very large IFC models to save battery</span></div>
          <div class="set-ctl">${seg('quality', [['lite', 'Lite 1×'], ['balanced', 'Balanced'], ['high', 'High 2×']], settings.quality || 'high')}</div></div>
        <div class="set-row"><div class="set-info"><b>3D Perspective FOV</b><span>Field of view lens angle in 3D / Walk modes</span></div>
          <div class="set-ctl"><input type="range" data-rng="fov3d" min="35" max="75" step="1" value="${settings.fov3d || 55}"><span class="set-val">${Math.round(settings.fov3d || 55)}°</span></div></div>
        <h4>Live Camera AR &amp; Field Sensors</h4>
        <div class="set-row"><div class="set-info"><b>Camera AR vertical FOV (°)</b><span>Match real phone lens (most phones 40–50°)</span></div>
          <div class="set-ctl"><input type="range" data-rng="camFov" min="28" max="75" step="1" value="${settings.camFov || 45}"><span class="set-val">${Math.round(settings.camFov || 45)}°</span></div></div>
        <div class="set-row"><div class="set-info"><b>AR model opacity</b><span>Transparency when overlaying BIM onto live camera</span></div>
          <div class="set-ctl"><input type="range" data-rng="arOpacity" min="0.1" max="1" step="0.05" value="${settings.arOpacity || 0.75}"><span class="set-val">${Math.round((settings.arOpacity || 0.75) * 100)}%</span></div></div>
        <div class="set-row"><div class="set-info"><b>Step length (m)</b><span>Estimated distance per step</span></div>
          <div class="set-ctl"><input type="number" step="0.05" min="0.3" max="1.2" data-num="stepLen" value="${settings.stepLen || 0.7}"></div></div>
        <div class="set-row"><div class="set-info"><b>Step sensitivity</b><span>Left = more sensitive · Right = stricter</span></div>
          <div class="set-ctl"><input type="range" data-rng="stepSens" min="0.3" max="2" step="0.1" value="${settings.stepSens || 0.8}"><span class="set-val">${(settings.stepSens || 0.8).toFixed(1)}</span></div></div>
        <div class="set-row"><div class="set-info"><b>GPS averaging (s)</b><span>Seconds to average when setting anchor</span></div>
          <div class="set-ctl"><input type="number" step="1" min="2" max="60" data-num="gpsAvg" value="${settings.gpsAvg || 8}"></div></div>`;
    } else if (tab === 'families') {
      const list = getFamilyPresets();
      const uf = app._ufFilter || 'ALL';
      const l2 = app._ufL2 || 'ALL';
      const q = (app._ufSearch || '').trim().toLowerCase();
      const l2Opts = uf !== 'ALL' ? UNIFORMAT_L2.filter((x) => x.group === uf) : [];
      const filtered = list.map((p, idx) => ({ p, idx })).filter(({ p }) => {
        if (uf === 'PINNED' && !p.pinned) return false;
        if (uf !== 'ALL' && uf !== 'PINNED' && p.group !== uf) return false;
        if (uf !== 'ALL' && uf !== 'PINNED' && l2 !== 'ALL' && p.l2 !== l2) return false;
        if (q) {
          const hay = `${p.uniformat} ${p.l3Name} ${p.category} ${p.familyName} ${p.typeName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const pinnedCount = list.filter((p) => p.pinned).length;
      pane.innerHTML = `<h3>UniFormat II Catalog (${list.length} items · ${pinnedCount} pinned)</h3>
        <p class="muted small" style="margin-bottom:8px">Full ASTM E1557 UniFormat II (Level 1 A–G → Level 3). Tick items to show clean short names on the field Mark bar; full UniFormat codes export automatically to Revit / NEXBIM.</p>
        <div class="uf-search-row">
          <input type="text" id="uf-search" value="${esc(app._ufSearch || '')}" placeholder="Search UniFormat code (D5030), name, or Revit category…">
          <button type="button" class="btn sm" id="uf-clear-pins" title="Unpin all items">Unpin all</button>
        </div>
        <div class="uf-tabs">
          <button type="button" data-uf="PINNED" class="${uf === 'PINNED' ? 'on' : ''}">Pinned (${pinnedCount})</button>
          <button type="button" data-uf="ALL" class="${uf === 'ALL' ? 'on' : ''}">All (${list.length})</button>
          ${UNIFORMAT_GROUPS.map((g) => {
            const cnt = list.filter((p) => p.group === g.code).length;
            return `<button type="button" data-uf="${g.code}" class="${uf === g.code ? 'on' : ''}" title="${esc(g.name)}">${g.code} (${cnt})</button>`;
          }).join('')}
        </div>
        ${l2Opts.length ? `<div class="uf-l2">
          <button type="button" data-ufl2="ALL" class="${l2 === 'ALL' ? 'on' : ''}">All ${uf}</button>
          ${l2Opts.map((x) => `<button type="button" data-ufl2="${x.code}" class="${l2 === x.code ? 'on' : ''}">${x.code} · ${esc(x.name)}</button>`).join('')}
        </div>` : ''}
        <div class="preset-list scroll">${filtered.map(({ p, idx }) => `
          <div class="preset-item">
            <input type="checkbox" class="preset-chk" data-ppin="${idx}" ${p.pinned ? 'checked' : ''} title="Pin to quick Mark bar">
            <span class="preset-tag">${esc(p.uniformat)}</span>
            <div class="preset-main"><b>${esc(p.familyName)}${p.typeName ? ` · ${esc(p.typeName)}` : ''}</b>
              <span>${p.l3Name ? `${esc(p.l3Name)} · ` : ''}${esc(p.category)} · ${esc(p.placement)}${p.offsetZ ? ` · +${p.offsetZ} m` : ''}</span></div>
            <button type="button" class="icon-btn sm" data-pdel="${idx}" title="Remove">${icon('trash')}</button>
          </div>`).join('') || '<p class="muted small">No matching UniFormat items.</p>'}</div>
        <h4>Add Custom UniFormat Family</h4>
        <div class="field-row">
          <label class="field" style="max-width:124px"><span>UniFormat L3/L4</span><input id="np-uf" placeholder="D5030 / D5030.10" value="${uf !== 'ALL' && uf !== 'PINNED' ? (l2 !== 'ALL' ? l2 + '10' : uf + '1010') : 'D5030'}"></label>
          <label class="field"><span>Revit Category</span><input id="np-cat" placeholder="e.g. Security Devices"></label>
          <label class="field" style="max-width:125px"><span>Placement</span><select id="np-plc"><option value="face-based">Face-based</option><option value="level-based">Level-based</option></select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Family Name</span><input id="np-fam" placeholder="e.g. CCTV_Camera"></label>
          <label class="field"><span>Type Name</span><input id="np-type" placeholder="e.g. Dome"></label>
          <label class="field" style="max-width:95px"><span>Offset Z (m)</span><input id="np-off" inputmode="decimal" value="0"></label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn sm primary" id="np-add">${icon('plus')}<span>Add &amp; Pin</span></button>
          <button type="button" class="btn sm" id="np-reset">Reset full catalog</button>
        </div>`;
    } else {
      pane.innerHTML = `<h3>Keyboard Shortcuts</h3>
        <div class="kbd-grid">
          <div class="kbd-row"><span>3D / Plan / Walk</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></span></div>
          <div class="kbd-row"><span>Place Mark / Family</span><kbd>M</kbd></div>
          <div class="kbd-row"><span>Measure 3D Distance</span><kbd>R</kbd></div>
          <div class="kbd-row"><span>Quick Capture</span><kbd>C</kbd></div>
          <div class="kbd-row"><span>Home / Fit All</span><span><kbd>H</kbd> <kbd>F</kbd></span></div>
          <div class="kbd-row"><span>Walk Move / Up-Down</span><span><kbd>WASD</kbd> <kbd>Q</kbd><kbd>E</kbd></span></div>
          <div class="kbd-row"><span>Open Settings</span><kbd>Ctrl+,</kbd></div>
          <div class="kbd-row"><span>Cancel Tool / Menu</span><kbd>Esc</kbd></div>
          <div class="kbd-row"><span>Delete Selected Mark</span><kbd>Del</kbd></div>
        </div>
        <h4>Backup &amp; Reset</h4>
        <div class="set-row"><div class="set-info"><b>Export / Import Settings</b><span>Share your mouse preset, units, and Family Catalog with your team</span></div>
          <div class="set-ctl"><button type="button" class="btn sm" id="set-exp">${icon('export')}<span>Export</span></button><button type="button" class="btn sm" id="set-imp">${icon('import')}<span>Import</span></button></div></div>
        <div class="set-row"><div class="set-info"><b>Reset all preferences</b><span>Restore NEXAR defaults (projects &amp; markups are kept safe)</span></div>
          <div class="set-ctl"><button type="button" class="btn sm danger" id="set-reset">Reset defaults</button></div></div>
        <input type="file" id="set-imp-file" accept=".json,application/json" hidden>`;
    }
  };

  nav.onclick = (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.dataset.tab; renderNav(); renderPane();
  };
  pane.onclick = async (e) => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      const k = segBtn.closest('[data-seg]').dataset.seg;
      let v = segBtn.dataset.v;
      if (k === 'precision' || k === 'pinScale') v = parseFloat(v);
      settings[k] = v; saveSettings(); applyAllSettings(); renderPane(); return;
    }
    const accBtn = e.target.closest('[data-acc]');
    if (accBtn) {
      settings.accent = accBtn.dataset.acc; saveSettings(); applyAllSettings(); renderPane(); return;
    }
    const ufBtn = e.target.closest('[data-uf]');
    if (ufBtn) { app._ufFilter = ufBtn.dataset.uf; app._ufL2 = 'ALL'; renderPane(); return; }
    const l2Btn = e.target.closest('[data-ufl2]');
    if (l2Btn) { app._ufL2 = l2Btn.dataset.ufl2; renderPane(); return; }
    if (e.target.closest('#uf-clear-pins')) {
      const list = getFamilyPresets().map((p) => ({ ...p, pinned: false }));
      settings.familyPresets = list; settings.catalogVer = CATALOG_VERSION; saveSettings(); renderFamilyBar(); renderPane();
      toast('All pins cleared — tick items to show on Mark bar', 'info', 2200); return;
    }
    const delBtn = e.target.closest('[data-pdel]');
    if (delBtn) {
      const list = [...getFamilyPresets()];
      list.splice(+delBtn.dataset.pdel, 1);
      settings.familyPresets = list.length ? list : null; settings.catalogVer = CATALOG_VERSION;
      saveSettings(); renderFamilyBar(); renderPane(); return;
    }
    if (e.target.closest('#np-add')) {
      const fam = pane.querySelector('#np-fam').value.trim();
      if (!fam) return toast('Enter a Family Name first', 'warn');
      const uf = (pane.querySelector('#np-uf').value.trim() || 'D5030').toUpperCase();
      const list = [...getFamilyPresets()];
      list.unshift(normalizePreset({
        id: 'custom-' + Date.now().toString(36),
        uniformat: uf,
        l2: uf.slice(0, 3),
        group: /^[A-G]/.test(uf) ? uf[0] : 'D',
        category: pane.querySelector('#np-cat').value.trim() || 'Generic Models',
        familyName: fam,
        typeName: pane.querySelector('#np-type').value.trim(),
        placement: pane.querySelector('#np-plc').value || 'face-based',
        offsetZ: parseFloat(pane.querySelector('#np-off').value) || 0,
        pinned: true
      }));
      settings.familyPresets = list; settings.catalogVer = CATALOG_VERSION; saveSettings(); renderFamilyBar(); renderPane();
      toast(`Added [${uf}] ${fam}`, 'ok'); return;
    }
    if (e.target.closest('#np-reset')) {
      settings.familyPresets = null; settings.catalogVer = CATALOG_VERSION; saveSettings(); renderFamilyBar(); renderPane();
      toast('Full UniFormat II catalog restored', 'ok'); return;
    }
    if (e.target.closest('#set-exp')) {
      download(new Blob([JSON.stringify({ schema: 'nexar.settings/2.0', settings }, null, 2)], { type: 'application/json' }), 'nexar-settings.json');
      return;
    }
    if (e.target.closest('#set-imp')) { pane.querySelector('#set-imp-file').click(); return; }
    if (e.target.closest('#set-reset')) {
      if (!(await confirmBox('Reset settings', 'Restore all NEXAR preferences to default? Your projects and markups will not be affected.', 'Reset', true))) return;
      Object.assign(settings, DEFAULT_SETTINGS);
      saveSettings(); applyAllSettings(); renderPane();
      toast('Settings reset to defaults', 'ok');
    }
  };
  pane.oninput = (e) => {
    const t = e.target;
    if (t.id === 'uf-search') {
      app._ufSearch = t.value;
      const pos = t.selectionStart;
      renderPane();
      const inp = pane.querySelector('#uf-search');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
      return;
    }
    if (t.dataset.inp) { settings[t.dataset.inp] = t.value.trim(); saveSettings(); return; }
    if (t.dataset.num) {
      const v = parseFloat(t.value); if (!Number.isFinite(v)) return;
      settings[t.dataset.num] = v; saveSettings(); applyAllSettings(); return;
    }
    if (t.dataset.rng) {
      const k = t.dataset.rng, v = parseFloat(t.value);
      settings[k] = v; saveSettings(); applyAllSettings();
      const valEl = t.nextElementSibling;
      if (valEl) valEl.textContent = k === 'fov3d' || k === 'camFov' ? `${Math.round(v)}°` : k === 'arOpacity' ? `${Math.round(v * 100)}%` : k === 'stepSens' ? v.toFixed(1) : `${v.toFixed(1)}×`;
    }
  };
  pane.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.ppin !== undefined) {
      const list = [...getFamilyPresets()];
      const idx = +t.dataset.ppin;
      if (list[idx]) { list[idx] = { ...list[idx], pinned: t.checked }; settings.familyPresets = list; settings.catalogVer = CATALOG_VERSION; saveSettings(); renderFamilyBar(); renderPane(); }
      return;
    }
    if (t.dataset.sw) { settings[t.dataset.sw] = t.checked; saveSettings(); applyAllSettings(); return; }
    if (t.id === 'set-imp-file' && t.files[0]) {
      try {
        const d = JSON.parse(await t.files[0].text());
        const src = d.settings || d;
        Object.assign(settings, DEFAULT_SETTINGS, src);
        saveSettings(); applyAllSettings(); renderPane();
        toast('Settings imported', 'ok');
      } catch (err) { toast('Invalid settings JSON', 'error'); }
      t.value = '';
    }
  };

  renderNav(); renderPane();
  const dlg = modal({ title: 'Settings', body, wide: true, actions: [{ label: 'Done', kind: 'primary', icon: 'check', onClick: (c) => c() }] });
  const mEl = $('#modal-root .modal'); if (mEl) mEl.classList.add('settings-modal');
  return dlg;
}

// ================================================================ status bar & compass
function setPickReadout(ifc) {
  $('#st-xyz').innerHTML = ifc ? `<b>X</b> ${fmtCoord(ifc.x)} <b>Y</b> ${fmtCoord(ifc.y)} <b>Z</b> ${fmtCoord(ifc.z)}` : '—';
}
function updateStatus() {
  const g = $('#st-gps');
  if (!gps.active) { g.dataset.s = 'off'; g.innerHTML = `${icon('gps')}<span>GPS off</span>`; }
  else if (!gps.last) { g.dataset.s = 'wait'; g.innerHTML = `${icon('gps')}<span>GPS…</span>`; }
  else { g.dataset.s = gps.last.acc < 5 ? 'good' : gps.last.acc < 15 ? 'mid' : 'bad'; g.innerHTML = `${icon('gps')}<span>±${gps.last.acc.toFixed(1)} m</span>`; }
  const a = app.project && app.project.geo.anchor;
  const an = $('#st-anchor');
  an.dataset.s = a || app.loc.fix ? 'good' : 'off';
  const fixLabel = app.loc.tripod ? ` · Tripod ${settings.eye.toFixed(2)} m` : app.loc.fix ? (app.loc.stepMode ? (settings.trackMode === 'hybrid' ? ' · Hybrid' : ' · Steps') : app.loc.fix.id === 'self' ? ' · Self' : ' · QR') : '';
  an.innerHTML = `${icon('anchor')}<span>${a ? `N ${getBearing().toFixed(1)}°` : app.loc.fix ? 'Here' : 'No location'}${fixLabel}</span>`;
}
const _vcQ = new THREE.Quaternion(), _vcM = new THREE.Matrix4();
viewer.addEventListener('frame', () => {
  const rot = viewer.screenNorth(getBearing());
  const cn = $('#compass-needle'); if (cn) cn.style.transform = `rotate(${rot}deg)`;
  const vcRing = $('.vc-ring'); if (vcRing) vcRing.style.transform = `rotate(${rot}deg)`;
  const vcCube = $('#vc-cube');
  if (vcCube) {
    _vcQ.copy(viewer.camera.quaternion).invert();
    _vcM.makeRotationFromQuaternion(_vcQ);
    const e = _vcM.elements;
    vcCube.style.transform = `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
  }
  if (gps.active || app.loc.fix || orient.listening) computeLoc();
  if (app.wm && app.wm.state === 'walk' && viewer.youWorld) viewer.followPlan(viewer.youWorld, 0.25);
});
viewer.addEventListener('mode', (e) => { if (e.detail.mode !== 'walk') { gyroOff(); camOff(); } syncModeUI(); });
$('#gyro-btn').onclick = () => toggleGyro();
document.body.classList.toggle('touch', isTouch);
// Auto-detect Apple Pencil / Stylus on first use (no setup needed)
(() => {
  const onPen = (e) => {
    if (e.pointerType === 'pen' && !document.body.classList.contains('has-pencil')) {
      document.body.classList.add('has-pencil');
    }
  };
  window.addEventListener('pointerdown', onPen, { passive: true });
  window.addEventListener('pointermove', onPen, { passive: true });
  const reticle = $('#pen-reticle');
  let hoverT = 0;
  viewer.addEventListener('penhover', (e) => {
    if (!reticle) return;
    if (!e.detail || !e.detail.active) { reticle.hidden = true; return; }
    const r = viewer.canvas.getBoundingClientRect();
    reticle.style.transform = `translate3d(${(e.detail.x - r.left).toFixed(1)}px, ${(e.detail.y - r.top).toFixed(1)}px, 0)`;
    reticle.hidden = false;
    const now = performance.now();
    if (now - hoverT > 60 && viewer.models.children.length) {
      hoverT = now;
      const hit = viewer.pick(e.detail.x, e.detail.y, { markers: false });
      if (hit && hit.point) setPickReadout(viewer.worldToIfc(hit.point));
    }
  });
})();
viewer.addEventListener('clip', () => syncToggles());
$('#home-btn').onclick = () => goHome();
$('#home-btn').oncontextmenu = (e) => { e.preventDefault(); setHome(); };
$('#vc-rotl').onclick = () => viewer.orbitStep(45);
$('#vc-rotr').onclick = () => viewer.orbitStep(-45);

// 3D ViewCube: drag to smoothly orbit/rotate (iPad & PC), tap any face to snap view
(() => {
  const stage = $('#vc-stage');
  if (!stage) return;
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0, face: e.target.closest('[data-view]'), pen: e.pointerType === 'pen' };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
    drag.lx = e.clientX; drag.ly = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved >= (drag.pen ? 10 : 4)) viewer.orbitDrag(dx, dy);
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    if (d.moved < (d.pen ? 12 : 6) && d.face) { viewer.setStandardView(d.face.dataset.view); syncModeUI(); }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { drag = null; });
})();

// Unified Bottom Dock buttons (direct handlers for maximum reliability on touch & mouse)
$('#modebar').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) {
    const m = b.dataset.mode;
    if (m === 'ar') return xrARSupported().then((ok) => (ok ? startXR() : startCamAR()));
    return setMode(m);
  }
};
$('#dock-cam').onclick = (e) => { e.stopPropagation(); toggleCam(); };
$('#dock-measure').onclick = (e) => { e.stopPropagation(); toggleMeasure(); };
$('#dock-section').onclick = (e) => { e.stopPropagation(); setSection(!viewer.clipOn); };
$('#dock-xray').onclick = (e) => { e.stopPropagation(); viewer.setXray(!viewer.xray); syncToggles(); };
$('#dock-mark').onclick = (e) => { e.stopPropagation(); toggleQuickMark(); };
$('#dock-capture').onclick = (e) => { e.stopPropagation(); captureView(); };
$('#dock-more').onclick = (e) => {
  e.stopPropagation();
  openPopover(e.currentTarget, [
    { sec: 'View & Camera' },
    { icon: 'home', label: 'Home View', sub: 'H', onClick: () => goHome() },
    { icon: 'fit', label: 'Fit Whole Model', sub: 'F', onClick: () => viewer.fitAll() },
    { icon: 'sethome', label: 'Set Current as Home', onClick: () => setHome() },
    { icon: 'bookmark', label: 'Save View', onClick: () => saveView() },
    { sep: true },
    { sec: 'Display & Site' },
    { icon: 'grid', label: 'Floor Grid', on: settings.grid !== false, sub: settings.grid !== false ? 'ON' : 'OFF', onClick: () => onCommand('grid') },
    { icon: 'pin', label: 'Markup Pins', on: settings.showMarkups !== false, sub: settings.showMarkups !== false ? 'ON' : 'OFF', onClick: () => onCommand('toggle-markups') },
    { icon: 'scope', label: 'Scope Box', on: settings.scope !== false, sub: settings.scope !== false ? 'ON' : 'OFF', onClick: () => onCommand('scope') },
    { icon: 'navlock', label: 'Lock View', on: viewer.navLocked, sub: viewer.navLocked ? 'LOCKED' : 'OFF', onClick: () => onCommand('nav-lock') },
    { icon: 'gyro', label: 'Gyro Look (Walk)', on: !!viewer.walk.gyro, sub: viewer.walk.gyro ? 'ON' : 'OFF', onClick: () => toggleGyro() },
    { sep: true },
    { icon: 'layers', label: 'Groups', sub: activeGroup()?.name || 'None', onClick: () => groupDialog() },
    { icon: 'qr', label: 'Create Site QR', onClick: () => startCPCreate() }
  ], { align: 'center', above: true });
};

// ---- game-style Walk controls: left stick = move, right stick = look, ▲▼ = fly up / down, speed button
function makeStick(el, onChange) {
  const knob = el.querySelector('.knob');
  let id = null, cx = 0, cy = 0;
  const move = (e) => {
    if (e.pointerId !== id) return;
    const R = Math.max(16, el.clientWidth / 2 - knob.offsetWidth / 2); // travel follows the (CSS) stick size
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; onChange(dx / R, dy / R);
  };
  const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; el.classList.remove('active'); onChange(0, 0); };
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.classList.add('active'); try { el.setPointerCapture(id); } catch (err) { /* synthetic pointer */ } const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); });
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
makeStick($('#joystick'), (x, y) => { viewer.walk.joy.x = x; viewer.walk.joy.y = y; });
makeStick($('#joystick-look'), (x, y) => { viewer.walk.look.x = x; viewer.walk.look.y = y; });
for (const [id, dir] of [['#fly-up', 1], ['#fly-down', -1]]) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); viewer.walk.vert = dir; try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => { viewer.walk.vert = 0; });
}
const SPEEDS = [[1.4, 'WALK'], [3, 'RUN'], [6, 'FAST'], [12, 'FLY']];
let speedIdx = 0;
$('#speed-btn').onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; viewer.walk.speed = SPEEDS[speedIdx][0]; $('#speed-btn').textContent = SPEEDS[speedIdx][1]; toast(`Speed: ${SPEEDS[speedIdx][1]} (${SPEEDS[speedIdx][0]} m/s)`, 'info', 1200); };

$('#st-ver').textContent = `v${APP_VERSION}`;

// shelved UI
if (!LOCATION_FEATURES) { $('#st-anchor').hidden = true; $('#st-gps').hidden = true; const ar = $('#modebar [data-mode=ar]'); if (ar) ar.hidden = true; }

// ================================================================ file inputs, drag & drop, sample
$('#file-model').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; onModelFiles(f); };
const vp = $('#viewport');
vp.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
vp.addEventListener('dragleave', (e) => { if (e.target === vp || !vp.contains(e.relatedTarget)) document.body.classList.remove('dragging'); });
vp.addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files];
  const proj = files.find((f) => /\.(json|bcf|bcfzip)$/i.test(f.name));
  if (proj) { const dt = new DataTransfer(); dt.items.add(proj); $('#file-project').files = dt.files; $('#file-project').dispatchEvent(new Event('change')); }
  onModelFiles(files.filter((f) => !/\.(json|bcf|bcfzip)$/i.test(f.name)));
});
$('#empty').onclick = async (e) => {
  const b = e.target.closest('[data-e]'); if (!b) return;
  if (b.dataset.e === 'open') return $('#file-model').click();
  if (b.dataset.e === 'import') { $('#file-project').dataset.kind = 'json-import'; return $('#file-project').click(); }
  if (b.dataset.e === 'sample') {
    busy('Downloading sample…');
    try {
      const r = await fetch('samples/sample-building.ifc');
      if (!r.ok) throw new Error('sample not found');
      const blob = await r.blob();
      await onModelFiles([new File([blob], 'sample-building.ifc')]);
    } catch (err) { busy(false); toast(err.message, 'error'); }
  }
};

// ================================================================ helpers
function slug(s) { return String(s || 'project').replace(/[^\w฀-๿.-]+/g, '_').slice(0, 60); }
function refreshAll() { refreshMarkers(); renderBadges(); renderTrack(); renderPanel(); updateStatus(); syncModeUI(); renderClipCtl(); computeLoc(); }

// ================================================================ boot
// ================================================================ orientation auto-detect
const mqLand = matchMedia('(orientation: landscape)');
function onOrientation() {
  const land = mqLand.matches;
  const phone = Math.min(window.innerWidth, window.innerHeight) < 520;
  document.body.dataset.orient = land ? 'landscape' : 'portrait';
  document.body.dataset.device = phone ? 'phone' : window.innerWidth < 1100 ? 'tablet' : 'desktop';
  setTimeout(() => { viewer.resize(); if (settings.uiMode === 'ribbon') ribbon._ink(); }, 280);
}
(mqLand.addEventListener ? mqLand.addEventListener('change', onOrientation) : mqLand.addListener(onOrientation));
window.addEventListener('resize', () => { clearTimeout(onOrientation._t); onOrientation._t = setTimeout(onOrientation, 150); });
onOrientation();

window.nexar = { app, viewer, gps, orient, ar, settings, steps }; // handy for debugging in the browser console

const mqDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme) {
  const pref = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'dark';
  const t = pref === 'system' ? (mqDark.matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#FFFFFF' : '#0A0A0C');
  const btn = $('#btn-theme');
  if (btn) {
    btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    btn.title = t === 'dark' ? 'Switch to Light theme (daylight / site)' : 'Switch to Dark theme';
  }
  if (viewer.setTheme) viewer.setTheme(t);
  try { localStorage.setItem('nx-theme', t); } catch (e) { /* ignore */ }
}
if (mqDark.addEventListener) mqDark.addEventListener('change', () => { if (settings.theme === 'system') applyTheme('system'); });

(async function boot() {
  $('#brand').innerHTML = `${LOGO_LOCKUP}${LOGO}`;
  const elLogo = $('#empty-logo'); if (elLogo) elLogo.innerHTML = LOGO_HERO;
  const openBtn = $('#btn-open');
  if (openBtn) { openBtn.innerHTML = `${icon('open')}<span>Open</span>`; openBtn.onclick = () => $('#file-model').click(); }
  const expBtn = $('#btn-export');
  if (expBtn) {
    expBtn.innerHTML = `${icon('export')}<span>Export</span>${icon('chevDown', 'chev')}`;
    expBtn.onclick = (e) => openPopover(e.currentTarget, [
      { sec: 'Object Marks (MK · IFC / Revit)' },
      { icon: 'ifc', label: 'IFC + Marks (Objects only)', sub: '.ifc', onClick: () => onCommand('ifc-export') },
      { icon: 'table', label: 'UniFormat Excel (Marks only)', sub: '.xlsx', onClick: () => onCommand('xlsx-export') },
      { icon: 'json', label: 'Marks JSON (Objects only)', sub: '_Marks.json', onClick: () => onCommand('marks-json') },
      { sep: true },
      { sec: 'Site Notes (NT · Read-Only)' },
      { icon: 'table', label: 'Notes Excel (Notes only)', sub: '.xlsx', onClick: () => onCommand('notes-xlsx') },
      { icon: 'table', label: 'Notes CSV (Notes only)', sub: '.csv', onClick: () => onCommand('notes-csv') },
      { icon: 'json', label: 'Notes JSON (Notes only)', sub: '_Notes.json', onClick: () => onCommand('notes-json') },
      { sep: true },
      { sec: 'Photos & Full Project' },
      { icon: 'photo', label: 'Photo Pack + Directory CSV', sub: '.zip', onClick: () => onCommand('photo-zip') },
      { icon: 'table', label: 'Photo Directory CSV', sub: '.csv', onClick: () => onCommand('photo-csv') },
      { icon: 'html', label: 'Interactive HTML (1-file)', sub: '.html', onClick: () => onCommand('html-export') },
      { icon: 'bcf', label: 'Export BCF 3.0', sub: '.bcfzip', onClick: () => onCommand('bcf-export') },
      { icon: 'json', label: 'Full Project Backup', sub: '.nexar.json', onClick: () => onCommand('json-export') },
      { icon: 'import', label: 'Import BCF / Project JSON', onClick: () => onCommand('json-import') },
      { sep: true },
      { icon: 'bcf', label: 'Revit Workflow Guide', onClick: () => revitGuide() },
      { icon: 'info', label: 'Open Manual', onClick: () => onCommand('manual') }
    ], { align: 'right' });
  }
  const setBtn = $('#btn-settings');
  if (setBtn) { setBtn.innerHTML = icon('settings'); setBtn.onclick = () => settingsDialog(); }
  const tbtn = $('#btn-theme');
  if (tbtn) tbtn.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    settings.theme = cur; saveSettings(); applyTheme(cur);
  };
  applyAllSettings();
  setSaveState('saved');
  if (window.innerWidth >= 900) document.body.classList.add('panel-open');
  await store.persist();
  let p = null;
  try { const id = localStorage.getItem(LAST_KEY); if (id) p = await store.getProject(id); } catch (e) { /* ignore */ }
  if (!p) { p = newProject('My first project'); await store.putProject(p); }
  await openProject(p);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  xrARSupported().then((ok) => { if (ok) document.body.classList.add('has-xr'); });
})();
