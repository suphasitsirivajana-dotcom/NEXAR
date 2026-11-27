// NEXAR Single-File 3D IFC Exporter (2 modes: Export All = Model + Spots | Export Spot = Spots Only with synced Base Point).
// Visual 3D shapes & colors linked directly to NEXAR:
//   • Mark  (MK-###) → Yellow Sphere                (#DFB73A)  ObjectType = NEXAR_MARK
//   • Note  (NT-###) → Blue Cube                    (#5B8CFF)  ObjectType = NEXAR_NOTE
//   • Issue (IS-###) → Red Equilateral Tetrahedron  (#E56565)  ObjectType = NEXAR_ISSUE
// Uses IFCMAPPEDITEM shared geometry so even 500+ spots stay tiny & load fast in Revit / Navisworks / NEXBIM.
import { MARKUP_TYPES, typeMeta, recordKind, itemTag, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';
import { itemNaming } from './photopack.js';

const SPHERE_R = 0.09;  // Mark: Ø180 mm sphere
const CUBE_S   = 0.16;  // Note: 160 x 160 x 160 mm cube
const TRI_A    = 0.24;  // Issue: 240 mm edge equilateral tetrahedron

// ---------------------------------------------------------------- STEP helpers
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
export function ifcGuid(uuid) {
  let hex = String(uuid || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 32) hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  let n = BigInt('0x' + hex), s = '';
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
const newGuid = () => ifcGuid(crypto.randomUUID ? crypto.randomUUID() : '');

export function stepStr(v) {
  const s = String(v ?? '');
  let out = '', wide = '';
  const flush = () => { if (wide) { out += '\\X2\\' + wide + '\\X0\\'; wide = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c <= 126) { flush(); out += c === 39 ? "''" : c === 92 ? '\\\\' : s[i]; }
    else wide += c.toString(16).toUpperCase().padStart(4, '0');
  }
  flush();
  return `'${out}'`;
}
const R = (n) => {
  let s = (Number.isFinite(n) ? n : 0).toFixed(6).replace(/0+$/, '');
  if (s === '-0.') s = '0.';
  return s;
};

function readArgs(text, i) {
  const args = []; let depth = 0, cur = '', inStr = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (inStr) { cur += c; if (c === "'") { if (text[k + 1] === "'") { cur += "'"; k++; } else inStr = false; } continue; }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === '(') { if (depth++ > 0) cur += c; continue; }
    if (c === ')') { if (--depth === 0) { args.push(cur.trim()); return args; } cur += c; continue; }
    if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return args;
}
function findEntities(text, type) {
  const re = new RegExp(`#(\\d+)\\s*=\\s*${type}\\s*\\(`, 'gi'), out = [];
  let m;
  while ((m = re.exec(text))) out.push({ id: +m[1], args: readArgs(text, m.index + m[0].length - 1) });
  return out;
}
function entityById(text, ref) {
  if (!ref || !ref.startsWith('#')) return null;
  const id = ref.slice(1);
  const re = new RegExp(`#${id}\\s*=\\s*([A-Z0-9_]+)\\s*\\(`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  return { id: +id, type: m[1].toUpperCase(), args: readArgs(text, m.index + m[0].length - 1) };
}
function parseTupleNums(s) {
  if (!s || !s.startsWith('(')) return null;
  const nums = s.slice(1, -1).split(',').map((x) => parseFloat(x.trim()));
  return nums.every(Number.isFinite) ? nums : null;
}
const unq = (a) => (a && a.startsWith("'") ? a.slice(1, -1).replace(/''/g, "'") : a);

function resolveAxis3D(text, axisRef) {
  const ax = entityById(text, axisRef);
  if (!ax || ax.type !== 'IFCAXIS2PLACEMENT3D') return null;
  const ptEnt = entityById(text, ax.args[0]);
  const zEnt = entityById(text, ax.args[1]);
  const xEnt = entityById(text, ax.args[2]);
  return {
    loc: (ptEnt && parseTupleNums(ptEnt.args[0])) || [0, 0, 0],
    axis: zEnt ? parseTupleNums(zEnt.args[0]) : null,
    refDir: xEnt ? parseTupleNums(xEnt.args[0]) : null
  };
}
function resolveLocalPlacement(text, lpRef) {
  const lp = entityById(text, lpRef);
  if (!lp || lp.type !== 'IFCLOCALPLACEMENT') return null;
  return resolveAxis3D(text, lp.args[1]);
}

// Extract schema, length unit, base point / WorldCoordinateSystem, TrueNorth, Site/Building placements & Storeys
export function analyseIfc(text) {
  const schemaM = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text);
  const schema = schemaM ? schemaM[1].toUpperCase() : 'IFC4';
  let lenScale = 1, lenPrefix = '$', unitKind = 'SI';
  for (const u of findEntities(text, 'IFCSIUNIT')) {
    if (u.args[1] === '.LENGTHUNIT.') {
      const pre = u.args[2];
      lenPrefix = pre || '$';
      lenScale = pre === '.MILLI.' ? 0.001 : pre === '.CENTI.' ? 0.01 : pre === '.DECI.' ? 0.1 : pre === '.KILO.' ? 1000 : 1;
    }
  }
  for (const u of findEntities(text, 'IFCCONVERSIONBASEDUNIT')) {
    if (u.args[1] === '.LENGTHUNIT.') {
      const nm = (unq(u.args[2]) || '').toUpperCase();
      if (nm.includes('FOOT') || nm.includes('FEET')) { lenScale = 0.3048; unitKind = 'FOOT'; }
      if (nm.includes('INCH')) { lenScale = 0.0254; unitKind = 'INCH'; }
    }
  }
  const oh = findEntities(text, 'IFCOWNERHISTORY')[0];
  const subs = findEntities(text, 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT');
  const ctxs = findEntities(text, 'IFCGEOMETRICREPRESENTATIONCONTEXT');
  const modelCtx = ctxs.find((c) => /^'model'$/i.test(c.args[1])) || ctxs[0];
  const ctx = subs.find((c) => /^'body'$/i.test(c.args[0])) || modelCtx || subs[0];
  const wcs = modelCtx ? resolveAxis3D(text, modelCtx.args[4]) : null;
  const tnEnt = modelCtx ? entityById(text, modelCtx.args[5]) : null;
  const trueNorth = tnEnt ? parseTupleNums(tnEnt.args[0]) : null;

  const site = findEntities(text, 'IFCSITE')[0];
  const building = findEntities(text, 'IFCBUILDING')[0];
  const siteInfo = site ? {
    name: unq(site.args[2]) || 'Site',
    placement: resolveLocalPlacement(text, site.args[5]),
    refLat: site.args[9] || '$',
    refLon: site.args[10] || '$',
    refElev: site.args[11] || '$'
  } : null;
  const buildingInfo = building ? {
    name: unq(building.args[2]) || 'Building',
    placement: resolveLocalPlacement(text, building.args[5])
  } : null;

  const storeys = findEntities(text, 'IFCBUILDINGSTOREY').map((s) => ({
    id: s.id,
    name: unq(s.args[2]) || `Storey ${s.id}`,
    elevation: (parseFloat(s.args[9]) || 0) * lenScale,
    rawElevation: parseFloat(s.args[9]) || 0
  })).sort((a, b) => a.elevation - b.elevation);

  let maxId = 0;
  const idRe = /#(\d+)\s*=/g; let m;
  while ((m = idRe.exec(text))) { const v = +m[1]; if (v > maxId) maxId = v; }

  return {
    schema, ifc2x3: schema.startsWith('IFC2X'), lenScale, lenPrefix, unitKind,
    oh: oh ? `#${oh.id}` : '$',
    ctx: ctx ? `#${ctx.id}` : null,
    wcs, trueNorth, siteInfo, buildingInfo, storeys,
    fallbackContainer: building ? building.id : site ? site.id : null,
    maxId
  };
}

// ---------------------------------------------------------------- 3D Geometry Builders (BRep + Extruded Solid)
function buildFacetedBrep(add, verts, faces) {
  const pts = verts.map(([x, y, z]) => add(`IFCCARTESIANPOINT((${R(x)},${R(y)},${R(z)}))`));
  const fRefs = faces.map((idxList) => {
    const loop = add(`IFCPOLYLOOP((${idxList.map((i) => pts[i]).join(',')}))`);
    const bound = add(`IFCFACEOUTERBOUND(${loop},.T.)`);
    return add(`IFCFACE((${bound}))`);
  });
  const shell = add(`IFCCLOSEDSHELL((${fRefs.join(',')}))`);
  return add(`IFCFACETEDBREP(${shell})`);
}

// UV-Sphere centered at (0,0,0) — 100% valid IFC2x3 & IFC4 watertight BRep
function buildSphereBrep(add, r, segs = 12, rings = 6) {
  const verts = [[0, 0, r]]; // 0 = north pole
  for (let j = 1; j < rings; j++) {
    const phi = (Math.PI * j) / rings;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let i = 0; i < segs; i++) {
      const th = (2 * Math.PI * i) / segs;
      verts.push([r * sp * Math.cos(th), r * sp * Math.sin(th), r * cp]);
    }
  }
  const southIdx = verts.length;
  verts.push([0, 0, -r]);
  const faces = [];
  // North cap
  for (let i = 0; i < segs; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % segs);
    faces.push([0, a, b]);
  }
  // Middle bands
  for (let j = 0; j < rings - 2; j++) {
    const r0 = 1 + j * segs, r1 = 1 + (j + 1) * segs;
    for (let i = 0; i < segs; i++) {
      const n = (i + 1) % segs;
      faces.push([r0 + i, r1 + i, r1 + n, r0 + n]);
    }
  }
  // South cap
  const lastRing = 1 + (rings - 2) * segs;
  for (let i = 0; i < segs; i++) {
    const a = lastRing + i, b = lastRing + ((i + 1) % segs);
    faces.push([southIdx, b, a]);
  }
  return buildFacetedBrep(add, verts, faces);
}

// Regular Equilateral Tetrahedron (4 congruent 60° equilateral triangular faces, centered at (0,0,0), apex +Z)
function buildEquilateralTriangleBrep(add, edge) {
  const rb = edge / Math.sqrt(3);
  const h = edge * Math.sqrt(2 / 3);
  const zb = -h / 4;
  const zt = (3 * h) / 4;
  const verts = [
    [0, rb, zb],
    [-edge / 2, -rb / 2, zb],
    [edge / 2, -rb / 2, zb],
    [0, 0, zt]
  ];
  const faces = [
    [0, 2, 1], // base (-Z)
    [0, 1, 3], // side 1
    [1, 2, 3], // side 2
    [2, 0, 3]  // side 3
  ];
  return buildFacetedBrep(add, verts, faces);
}

function makeStyle(add, label, hexColor, ifc2x3) {
  const hex = parseInt(String(hexColor || '#DFB73A').slice(1), 16);
  const col = add(`IFCCOLOURRGB($,${R(((hex >> 16) & 255) / 255)},${R(((hex >> 8) & 255) / 255)},${R((hex & 255) / 255)})`);
  const rend = add(`IFCSURFACESTYLERENDERING(${col},0.,$,$,$,$,$,$,.NOTDEFINED.)`);
  const ss = add(`IFCSURFACESTYLE(${stepStr(label)},.BOTH.,(${rend}))`);
  return ifc2x3 ? add(`IFCPRESENTATIONSTYLEASSIGNMENT((${ss}))`) : ss;
}

// ---------------------------------------------------------------- Spot entities (Marks + Notes + Issues in 1 IFC)
function markLines(project, a, groupNames) {
  let id = a.maxId;
  const L = [];
  const add = (s) => { id++; L.push(`#${id}=${s};`); return `#${id}`; };
  const u = (m) => m / a.lenScale; // metres → file units
  const oh = a.oh;

  const origin0 = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const mapOrigin = add(`IFCAXIS2PLACEMENT3D(${origin0},$,$)`);
  const identityOp = add(`IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,${origin0},1.,$)`);

  // 1) Mark (MK) — Yellow Sphere
  const markStyle = makeStyle(add, 'NEXAR Mark (Yellow Sphere)', MARKUP_TYPES.family.color, a.ifc2x3);
  const sphereBrep = buildSphereBrep(add, u(SPHERE_R));
  add(`IFCSTYLEDITEM(${sphereBrep},(${markStyle}),$)`);
  const sphereRep = add(`IFCSHAPEREPRESENTATION(${a.ctx},'Body','Brep',(${sphereBrep}))`);
  const markMap = add(`IFCREPRESENTATIONMAP(${mapOrigin},${sphereRep})`);

  // 2) Note (NT) — Blue Cube
  const noteStyle = makeStyle(add, 'NEXAR Note (Blue Cube)', MARKUP_TYPES.note.color, a.ifc2x3);
  const dirZ = add('IFCDIRECTION((0.,0.,1.))');
  const ax2d = add(`IFCAXIS2PLACEMENT2D(${add('IFCCARTESIANPOINT((0.,0.))')},$)`);
  const rectProf = add(`IFCRECTANGLEPROFILEDEF(.AREA.,'NEXAR Note Cube',${ax2d},${R(u(CUBE_S))},${R(u(CUBE_S))})`);
  const cubeAx = add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((0.,0.,${R(u(-CUBE_S / 2))}))`)},$,$)`);
  const cubeSolid = add(`IFCEXTRUDEDAREASOLID(${rectProf},${cubeAx},${dirZ},${R(u(CUBE_S))})`);
  add(`IFCSTYLEDITEM(${cubeSolid},(${noteStyle}),$)`);
  const cubeRep = add(`IFCSHAPEREPRESENTATION(${a.ctx},'Body','SweptSolid',(${cubeSolid}))`);
  const noteMap = add(`IFCREPRESENTATIONMAP(${mapOrigin},${cubeRep})`);

  // 3) Issue (IS) — Red Equilateral Tetrahedron (3D Equilateral Triangle)
  const issueStyle = makeStyle(add, 'NEXAR Issue (Red Triangle)', MARKUP_TYPES.issue.color, a.ifc2x3);
  const triBrep = buildEquilateralTriangleBrep(add, u(TRI_A));
  add(`IFCSTYLEDITEM(${triBrep},(${issueStyle}),$)`);
  const triRep = add(`IFCSHAPEREPRESENTATION(${a.ctx},'Body','Brep',(${triBrep}))`);
  const issueMap = add(`IFCREPRESENTATIONMAP(${mapOrigin},${triRep})`);

  const KIND_CFG = {
    mark:  { map: markMap,  objType: 'NEXAR_MARK',  kindLbl: 'Mark',  shapeLbl: 'Sphere',              color: MARKUP_TYPES.family.color },
    note:  { map: noteMap,  objType: 'NEXAR_NOTE',  kindLbl: 'Note',  shapeLbl: 'Cube',                color: MARKUP_TYPES.note.color   },
    issue: { map: issueMap, objType: 'NEXAR_ISSUE', kindLbl: 'Issue', shapeLbl: 'EquilateralTriangle', color: MARKUP_TYPES.issue.color  }
  };

  const kindOrder = { mark: 0, issue: 1, note: 2 };
  const allItems = (project.markups || []).slice().sort((x, y) => ((kindOrder[recordKind(x)] ?? 9) - (kindOrder[recordKind(y)] ?? 9)) || ((x.number || 0) - (y.number || 0)));

  const byContainer = new Map(), byGroup = new Map();
  const byKind = { mark: [], note: [], issue: [] };
  const allElems = [];

  for (const m of allItems) {
    const p = m.position || { x: 0, y: 0, z: 0 };
    const k = recordKind(m);
    const cfg = KIND_CFG[k] || KIND_CFG.note;
    const t = typeMeta(m.type);
    const tag = itemTag(m);
    const title = markupTitle(m);
    const gn = groupNames(m.group);
    const nm = itemNaming(m, gn);

    // Find matching storey (at or just below p.z)
    let st = null;
    for (const s of a.storeys) if (s.elevation <= p.z + 0.05) st = s;
    const levelName = st ? st.name : (a.storeys[0] ? a.storeys[0].name : '');

    const place = add(`IFCLOCALPLACEMENT($,${add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((${R(u(p.x))},${R(u(p.y))},${R(u(p.z))}))`)},$,$)`)})`);
    const mapped = add(`IFCMAPPEDITEM(${cfg.map},${identityOp})`);
    const rep = add(`IFCSHAPEREPRESENTATION(${a.ctx},'Body','MappedRepresentation',(${mapped}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const last = a.ifc2x3 ? '$' : '.USERDEFINED.';
    const el = add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(m.id)}',${oh},${stepStr(`${tag} ${title}`)},${stepStr(m.text || title)},${stepStr(cfg.objType)},${place},${pds},${stepStr(tag)},${last})`);
    allElems.push(el);
    byKind[k].push(el);

    // Plugin-ready parameters in Pset "NEXAR_Markup"
    const P = [];
    const prop = (name, val) => P.push(add(`IFCPROPERTYSINGLEVALUE(${stepStr(name)},$,${val},$)`));
    const lab = (v) => `IFCLABEL(${stepStr(v)})`, txt = (v) => `IFCTEXT(${stepStr(v)})`;
    prop('Tag', lab(tag));
    prop('Number', `IFCINTEGER(${m.number | 0})`);
    prop('RecordKind', lab(cfg.kindLbl));
    prop('Shape3D', lab(cfg.shapeLbl));
    prop('ColorHex', lab(cfg.color));
    prop('Type', lab(t.label));
    prop('Title', lab(title));
    prop('Description', txt(m.text || ''));
    prop('Status', lab(m.status || 'open'));
    prop('Priority', lab(m.priority || 'normal'));
    prop('Author', lab(m.author || ''));
    prop('AssignedTo', lab(m.assignedTo || ''));
    prop('Group', lab(gn));
    if (levelName) prop('Level', lab(levelName));
    prop('CheckedAt', lab(fmtDateTime(m.checkedAt || m.createdAt)));
    prop('CheckedAtISO', lab(m.checkedAt || m.createdAt || ''));
    if (m.modelName) prop('ModelFile', lab(m.modelName));
    prop('Created', lab(m.createdAt || ''));
    prop('Modified', lab(m.modifiedAt || ''));
    prop('X', `IFCLENGTHMEASURE(${R(u(p.x))})`);
    prop('Y', `IFCLENGTHMEASURE(${R(u(p.y))})`);
    prop('Z', `IFCLENGTHMEASURE(${R(u(p.z))})`);
    // Saved camera eye & look target (in metres, IFC Z-up) for downstream Revit / NEXBIM plugin view creation
    if (m.viewpoint && m.viewpoint.position) {
      const vp = m.viewpoint.position;
      prop('CamEyeX', `IFCLENGTHMEASURE(${R(u(vp.x))})`);
      prop('CamEyeY', `IFCLENGTHMEASURE(${R(u(vp.y))})`);
      prop('CamEyeZ', `IFCLENGTHMEASURE(${R(u(vp.z))})`);
    }
    if (m.element && m.element.guid) {
      prop('HostElementGuid', `IFCIDENTIFIER(${stepStr(m.element.guid)})`);
      prop('HostElementName', lab(m.element.name || ''));
      prop('HostIfcType', lab(m.element.ifcType || ''));
      if (m.element.tag) prop('HostRevitId', lab(String(m.element.tag)));
    }
    if (k === 'mark' && m.family) {
      const F = m.family;
      if (F.uniformat) prop('UniformatCode', lab(F.uniformat));
      if (F.group) prop('UniformatGroup', lab(F.group));
      if (F.placement) prop('PlacementMode', lab(F.placement));
      if (F.category) prop('FamilyCategory', lab(F.category));
      if (F.familyName) prop('FamilyName', lab(F.familyName));
      if (F.typeName) prop('FamilyType', lab(F.typeName));
      if (F.hostSurface) prop('HostSurface', lab(F.hostSurface));
      if (Number.isFinite(F.rotationDeg)) prop('RotationDeg', `IFCREAL(${R(F.rotationDeg)})`);
      if (Number.isFinite(F.offsetZ)) prop('OffsetZ', `IFCLENGTHMEASURE(${R(u(F.offsetZ))})`);
      if (F.normal) {
        prop('NormalX', `IFCREAL(${R(F.normal.x)})`);
        prop('NormalY', `IFCREAL(${R(F.normal.y)})`);
        prop('NormalZ', `IFCREAL(${R(F.normal.z)})`);
      }
    }
    prop('PhotoFolder', lab(nm.folderPath));
    prop('Photos', `IFCINTEGER(${(m.photos || []).length})`);
    if (m.gps) { prop('Latitude', `IFCREAL(${R(m.gps.lat)})`); prop('Longitude', `IFCREAL(${R(m.gps.lon)})`); }
    if ((m.replies || []).length) prop('Replies', txt(m.replies.map((r) => `${r.author || ''}: ${r.text || ''}`).join('\n')));
    prop('Locked', `IFCBOOLEAN(${m.locked ? '.T.' : '.F.'})`);
    prop('NEXAR_Id', `IFCIDENTIFIER(${stepStr(m.id)})`);
    const pset = add(`IFCPROPERTYSET('${newGuid()}',${oh},'NEXAR_Markup',$,(${P.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES('${newGuid()}',${oh},$,$,(${el}),${pset})`);

    const cid = st ? st.id : a.storeys.length ? a.storeys[0].id : a.fallbackContainer;
    if (cid) { if (!byContainer.has(cid)) byContainer.set(cid, []); byContainer.get(cid).push(el); }
    const gk = m.group || ''; if (gk) { if (!byGroup.has(gk)) byGroup.set(gk, []); byGroup.get(gk).push(el); }
  }

  for (const [cid, list] of byContainer) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',${oh},'NEXAR spots',$,(${list.join(',')}),#${cid})`);

  const grp = (name, list) => {
    if (!list.length) return;
    const g = add(`IFCGROUP('${newGuid()}',${oh},${stepStr(name)},$,'NEXAR')`);
    add(`IFCRELASSIGNSTOGROUP('${newGuid()}',${oh},$,$,(${list.join(',')}),$,${g})`);
  };
  grp('NEXAR: All Spots', allElems);
  grp('NEXAR: Marks (MK - Yellow Sphere)', byKind.mark);
  grp('NEXAR: Notes (NT - Blue Cube)', byKind.note);
  grp('NEXAR: Issues (IS - Red Triangle)', byKind.issue);
  for (const [gk, list] of byGroup) grp(`NEXAR Group: ${groupNames(gk)}`, list);

  return { text: L.join('\n') + '\n', counts: { total: allElems.length, mark: byKind.mark.length, note: byKind.note.length, issue: byKind.issue.length } };
}

// Build a clean Spot-Only IFC skeleton SYNCED to the loaded model's Base Point, Units, Schema, Site & Storeys
function syncedBaseIfc(project, author, ref) {
  const now = new Date(), t = Math.floor(now.getTime() / 1000);
  const schema = (ref && ref.schema) || 'IFC4';
  const lines = [];
  let nid = 0;
  const put = (s) => { nid++; lines.push(`#${nid}=${s};`); return `#${nid}`; };
  const putAxis3D = (ax) => {
    const loc = (ax && ax.loc) || [0, 0, 0];
    const pRef = put(`IFCCARTESIANPOINT((${R(loc[0])},${R(loc[1])},${R(loc[2] || 0)}))`);
    const zRef = ax && ax.axis ? put(`IFCDIRECTION((${R(ax.axis[0])},${R(ax.axis[1])},${R(ax.axis[2] || 0)}))`) : '$';
    const xRef = ax && ax.refDir ? put(`IFCDIRECTION((${R(ax.refDir[0])},${R(ax.refDir[1])},${R(ax.refDir[2] || 0)}))`) : '$';
    return put(`IFCAXIS2PLACEMENT3D(${pRef},${zRef},${xRef})`);
  };

  const person = put(`IFCPERSON($,$,${stepStr(author)},$,$,$,$,$)`);
  const org = put(`IFCORGANIZATION($,'NEXAR',$,$,$)`);
  const po = put(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = put(`IFCAPPLICATION(${org},'2.7','NEXAR','NEXAR')`);
  const oh = put(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,$,$,${t})`);

  // Match exact length unit of the loaded IFC model so Base Point & coordinates align 1:1
  let lenUnit;
  if (ref && (ref.unitKind === 'FOOT' || ref.unitKind === 'INCH')) {
    const siMetre = put('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
    const dim = put('IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)');
    const factor = ref.unitKind === 'FOOT' ? 0.3048 : 0.0254;
    const meas = put(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(${R(factor)}),${siMetre})`);
    lenUnit = put(`IFCCONVERSIONBASEDUNIT(${dim},.LENGTHUNIT.,'${ref.unitKind}',${meas})`);
  } else {
    const pre = (ref && ref.lenPrefix) || '$';
    lenUnit = put(`IFCSIUNIT(*,.LENGTHUNIT.,${pre},.METRE.)`);
  }
  const areaUnit = put('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const volUnit = put('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const angUnit = put('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = put(`IFCUNITASSIGNMENT((${lenUnit},${areaUnit},${volUnit},${angUnit}))`);

  // Match WorldCoordinateSystem & TrueNorth from loaded model
  const wcsRef = putAxis3D(ref && ref.wcs);
  const tnRef = ref && ref.trueNorth ? put(`IFCDIRECTION((${R(ref.trueNorth[0])},${R(ref.trueNorth[1])}))`) : '$';
  const ctx = put(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcsRef},${tnRef})`);
  put(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);

  const proj = put(`IFCPROJECT('${newGuid()}',${oh},${stepStr(project.name + ' (NEXAR Spots)')},$,$,$,$,(${ctx}),${units})`);

  const sitePl = put(`IFCLOCALPLACEMENT($,${putAxis3D(ref && ref.siteInfo && ref.siteInfo.placement)})`);
  const sLat = (ref && ref.siteInfo && ref.siteInfo.refLat) || '$';
  const sLon = (ref && ref.siteInfo && ref.siteInfo.refLon) || '$';
  const sElev = (ref && ref.siteInfo && ref.siteInfo.refElev) || '$';
  const siteName = (ref && ref.siteInfo && ref.siteInfo.name) || 'Site';
  const site = put(`IFCSITE('${newGuid()}',${oh},${stepStr(siteName)},$,$,${sitePl},$,$,.ELEMENT.,${sLat},${sLon},${sElev},$,$)`);

  const bldgPl = put(`IFCLOCALPLACEMENT(${sitePl},${putAxis3D(ref && ref.buildingInfo && ref.buildingInfo.placement)})`);
  const bldgName = (ref && ref.buildingInfo && ref.buildingInfo.name) || 'Building';
  const bldg = put(`IFCBUILDING('${newGuid()}',${oh},${stepStr(bldgName)},$,$,${bldgPl},$,$,.ELEMENT.,$,$,$)`);

  const storeyRefs = [];
  const srcStoreys = (ref && ref.storeys && ref.storeys.length)
    ? ref.storeys
    : [{ name: 'NEXAR Spots', rawElevation: 0 }];
  for (const st of srcStoreys) {
    const stAx = putAxis3D({ loc: [0, 0, st.rawElevation || 0] });
    const stPl = put(`IFCLOCALPLACEMENT(${bldgPl},${stAx})`);
    storeyRefs.push(put(`IFCBUILDINGSTOREY('${newGuid()}',${oh},${stepStr(st.name)},$,$,${stPl},$,$,.ELEMENT.,${R(st.rawElevation || 0)})`));
  }

  put(`IFCRELAGGREGATES('${newGuid()}',${oh},$,$,${proj},(${site}))`);
  put(`IFCRELAGGREGATES('${newGuid()}',${oh},$,$,${site},(${bldg}))`);
  put(`IFCRELAGGREGATES('${newGuid()}',${oh},$,$,${bldg},(${storeyRefs.join(',')}))`);

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME(${stepStr(project.name + '_NEXAR_Spots.ifc')},'${now.toISOString().slice(0, 19)}',(${stepStr(author)}),(''),'NEXAR','NEXAR','');
FILE_SCHEMA(('${schema}'));
ENDSEC;
DATA;
${lines.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}

const ascii = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f; return b; };

// mode: 'all' (Model + Spots merged into loaded IFC) | 'spot' (Spots Only, synced to loaded IFC Base Point/Units/Storeys)
export function exportIfcWithMarks(project, ifcBytes, { author = 'NEXAR', groupName = () => '', mode = 'all' } = {}) {
  const refAnalysis = ifcBytes ? analyseIfc(new TextDecoder('latin1').decode(new Uint8Array(ifcBytes))) : null;
  const merged = mode === 'all' && !!ifcBytes;
  const bytes = merged ? new Uint8Array(ifcBytes) : ascii(syncedBaseIfc(project, author, refAnalysis));
  const text = new TextDecoder('latin1').decode(bytes);
  const a = analyseIfc(text);
  if (!a.ctx) throw new Error('This IFC has no 3D representation context');
  const end = text.lastIndexOf('END-ISO-10303-21');
  const at = text.lastIndexOf('ENDSEC;', end < 0 ? text.length : end);
  if (at < 0) throw new Error('Not a valid IFC (STEP) file');
  const built = markLines(project, a, groupName);
  const addBytes = ascii(built.text);
  const out = new Uint8Array(bytes.length + addBytes.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(addBytes, at);
  out.set(bytes.subarray(at), at + addBytes.length);
  return {
    blob: new Blob([out], { type: 'application/x-step' }),
    schema: a.schema,
    unit: a.lenScale,
    count: built.counts.total,
    counts: built.counts,
    merged,
    syncedBasePoint: !!refAnalysis
  };
}
