// IFC + Marks export.
// Every markup becomes a small real object (IfcBuildingElementProxy, a Ø150 mm puck) at its exact model position,
// named after the comment, with all its data in the property set "NEXAR_Markup".
//  • An IFC model is loaded  → the marks are APPENDED to that IFC (original bytes untouched, same units / storeys / origin)
//  • No IFC (DXF / GLB only) → a small stand-alone IFC4 with only the marks, in the same model coordinates
// Revit: Insert → Link IFC (or Open IFC) → the marks come in as Generic Models with the Pset as parameters.
import { MARKUP_TYPES, typeMeta, isObjectMark, itemTag, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';

const MARK_D = 0.15; // puck diameter / height in metres

// ---------------------------------------------------------------- STEP helpers
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
export function ifcGuid(uuid) { // 128-bit uuid → IFC compressed 22-char GlobalId
  let hex = String(uuid || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 32) hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  let n = BigInt('0x' + hex), s = '';
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
const newGuid = () => ifcGuid(crypto.randomUUID ? crypto.randomUUID() : '');
// STEP string: '' for quotes, \\ for backslash, anything outside printable ASCII (Thai, new lines…) as \X2\hhhh\X0\
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
const R = (n) => { // STEP real (always with a decimal point)
  let s = (Number.isFinite(n) ? n : 0).toFixed(6).replace(/0+$/, '');
  if (s === '-0.') s = '0.';
  return s;
};

// read the top-level arguments of the entity whose '(' is at text[i]
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
  const re = new RegExp(`#(\\d+)\\s*=\\s*${type}\\s*\\(`, 'g'), out = [];
  let m;
  while ((m = re.exec(text))) out.push({ id: +m[1], args: readArgs(text, m.index + m[0].length - 1) });
  return out;
}
const unq = (a) => (a && a.startsWith("'") ? a.slice(1, -1).replace(/''/g, "'") : a);

// what we need from the existing IFC: schema, length unit, owner history, Body context, storeys
function analyse(text) {
  const schemaM = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text);
  const schema = schemaM ? schemaM[1].toUpperCase() : 'IFC4';
  let lenScale = 1;
  for (const u of findEntities(text, 'IFCSIUNIT')) {
    if (u.args[1] === '.LENGTHUNIT.') {
      const pre = u.args[2];
      lenScale = pre === '.MILLI.' ? 0.001 : pre === '.CENTI.' ? 0.01 : pre === '.DECI.' ? 0.1 : pre === '.KILO.' ? 1000 : 1;
    }
  }
  for (const u of findEntities(text, 'IFCCONVERSIONBASEDUNIT')) {
    if (u.args[1] === '.LENGTHUNIT.') {
      const nm = (unq(u.args[2]) || '').toUpperCase();
      if (nm.includes('FOOT') || nm.includes('FEET')) lenScale = 0.3048;
      if (nm.includes('INCH')) lenScale = 0.0254;
    }
  }
  const oh = findEntities(text, 'IFCOWNERHISTORY')[0];
  const subs = findEntities(text, 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT');
  const ctxs = findEntities(text, 'IFCGEOMETRICREPRESENTATIONCONTEXT');
  const ctx = subs.find((c) => /^'body'$/i.test(c.args[0])) || ctxs.find((c) => /^'model'$/i.test(c.args[1])) || ctxs[0] || subs[0];
  const storeys = findEntities(text, 'IFCBUILDINGSTOREY').map((s) => ({ id: s.id, name: unq(s.args[2]) || `Storey ${s.id}`, elevation: (parseFloat(s.args[9]) || 0) * lenScale }))
    .sort((a, b) => a.elevation - b.elevation);
  const building = findEntities(text, 'IFCBUILDING')[0], site = findEntities(text, 'IFCSITE')[0];
  let maxId = 0;
  const idRe = /#(\d+)\s*=/g; let m;
  while ((m = idRe.exec(text))) { const v = +m[1]; if (v > maxId) maxId = v; }
  return { schema, ifc2x3: schema.startsWith('IFC2X'), lenScale, oh: oh ? `#${oh.id}` : '$', ctx: ctx ? `#${ctx.id}` : null, storeys,
    fallbackContainer: building ? building.id : site ? site.id : null, maxId };
}

// ---------------------------------------------------------------- the mark entities
function markLines(project, a, groupNames) {
  let id = a.maxId;
  const L = [];
  const add = (s) => { id++; L.push(`#${id}=${s};`); return `#${id}`; };
  const u = (m) => m / a.lenScale; // metres → file units
  const oh = a.oh;
  // shared geometry: a Ø150 mm x 150 mm cylinder centred on the mark point
  const dirZ = add('IFCDIRECTION((0.,0.,1.))');
  const ax2d = add(`IFCAXIS2PLACEMENT2D(${add('IFCCARTESIANPOINT((0.,0.))')},$)`);
  const prof = add(`IFCCIRCLEPROFILEDEF(.AREA.,'NEXAR mark',${ax2d},${R(u(MARK_D / 2))})`);
  const solidAx = add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((0.,0.,${R(u(-MARK_D / 2))}))`)},$,$)`);
  // one colour per markup type
  const style = {};
  for (const [k, t] of Object.entries(MARKUP_TYPES)) {
    const hex = parseInt(t.color.slice(1), 16);
    const col = add(`IFCCOLOURRGB($,${R(((hex >> 16) & 255) / 255)},${R(((hex >> 8) & 255) / 255)},${R((hex & 255) / 255)})`);
    const rend = add(`IFCSURFACESTYLERENDERING(${col},0.,$,$,$,$,$,$,.NOTDEFINED.)`);
    const ss = add(`IFCSURFACESTYLE(${stepStr('NEXAR ' + t.label)},.BOTH.,(${rend}))`);
    style[k] = a.ifc2x3 ? add(`IFCPRESENTATIONSTYLEASSIGNMENT((${ss}))`) : ss;
  }
  const byContainer = new Map(), byGroup = new Map(), elems = [];
  // Export ONLY Object Marks (MK-###) into IFC — Read-Only Notes/Comments (NT-###) are exported separately
  const objMarks = (project.markups || []).filter(isObjectMark).sort((a, b) => (a.number || 0) - (b.number || 0));
  for (const m of objMarks) {
    const p = m.position || { x: 0, y: 0, z: 0 };
    const t = typeMeta(m.type);
    const tag = itemTag(m);
    const title = markupTitle(m);
    const place = add(`IFCLOCALPLACEMENT($,${add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((${R(u(p.x))},${R(u(p.y))},${R(u(p.z))}))`)},$,$)`)})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(${prof},${solidAx},${dirZ},${R(u(MARK_D))})`);
    add(`IFCSTYLEDITEM(${solid},(${style[m.type] || style.family || style.note}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${a.ctx},'Body','SweptSolid',(${solid}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const last = a.ifc2x3 ? '$' : '.USERDEFINED.';
    const el = add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(m.id)}',${oh},${stepStr(`${tag} ${title}`)},${stepStr(m.text || title)},${stepStr('NEXAR ' + t.label)},${place},${pds},${stepStr(tag)},${last})`);
    elems.push(el);
    // parameters (Revit shows these on the element)
    const P = [];
    const prop = (name, val) => P.push(add(`IFCPROPERTYSINGLEVALUE(${stepStr(name)},$,${val},$)`));
    const lab = (v) => `IFCLABEL(${stepStr(v)})`, txt = (v) => `IFCTEXT(${stepStr(v)})`;
    prop('Number', `IFCINTEGER(${m.number | 0})`);
    prop('Tag', lab(tag));
    prop('RecordKind', lab('Mark'));
    prop('Type', lab(t.label));
    prop('Title', lab(title));
    prop('Description', txt(m.text || ''));
    prop('Status', lab(m.status || 'open'));
    prop('Priority', lab(m.priority || 'normal'));
    prop('Author', lab(m.author || ''));
    prop('AssignedTo', lab(m.assignedTo || ''));
    prop('Group', lab(groupNames(m.group)));
    prop('CheckedAt', lab(fmtDateTime(m.checkedAt || m.createdAt)));
    prop('CheckedAtISO', lab(m.checkedAt || m.createdAt || ''));
    if (m.modelName) prop('ModelFile', lab(m.modelName));
    prop('Created', lab(m.createdAt || ''));
    prop('Modified', lab(m.modifiedAt || ''));
    prop('X', `IFCLENGTHMEASURE(${R(u(p.x))})`);
    prop('Y', `IFCLENGTHMEASURE(${R(u(p.y))})`);
    prop('Z', `IFCLENGTHMEASURE(${R(u(p.z))})`);
    if (m.element && m.element.guid) {
      prop('HostElementGuid', `IFCIDENTIFIER(${stepStr(m.element.guid)})`);
      prop('HostElementName', lab(m.element.name || ''));
      prop('HostIfcType', lab(m.element.ifcType || ''));
      if (m.element.tag) prop('HostRevitId', lab(String(m.element.tag)));
    }
    if (m.family) {
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
    if (m.gps) { prop('Latitude', `IFCREAL(${R(m.gps.lat)})`); prop('Longitude', `IFCREAL(${R(m.gps.lon)})`); }
    prop('Photos', `IFCINTEGER(${(m.photos || []).length})`);
    if ((m.replies || []).length) prop('Replies', txt(m.replies.map((r) => `${r.author || ''}: ${r.text || ''}`).join('\n')));
    prop('Locked', `IFCBOOLEAN(${m.locked ? '.T.' : '.F.'})`);
    prop('NEXAR_Id', `IFCIDENTIFIER(${stepStr(m.id)})`);
    const pset = add(`IFCPROPERTYSET('${newGuid()}',${oh},'NEXAR_Markup',$,(${P.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES('${newGuid()}',${oh},$,$,(${el}),${pset})`);
    // spatial container: the storey at or just below the mark
    let st = null;
    for (const s of a.storeys) if (s.elevation <= p.z + 0.05) st = s;
    const cid = st ? st.id : a.storeys.length ? a.storeys[0].id : a.fallbackContainer;
    if (cid) { if (!byContainer.has(cid)) byContainer.set(cid, []); byContainer.get(cid).push(el); }
    const gk = m.group || ''; if (gk) { if (!byGroup.has(gk)) byGroup.set(gk, []); byGroup.get(gk).push(el); }
  }
  for (const [cid, list] of byContainer) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',${oh},'NEXAR markups',$,(${list.join(',')}),#${cid})`);
  // NEXAR groups → IfcGroup (one per group, plus one with every mark)
  const grp = (name, list) => {
    const g = add(`IFCGROUP('${newGuid()}',${oh},${stepStr(name)},$,'NEXAR')`);
    add(`IFCRELASSIGNSTOGROUP('${newGuid()}',${oh},$,$,(${list.join(',')}),$,${g})`);
  };
  if (elems.length) grp('NEXAR markups', elems);
  for (const [gk, list] of byGroup) grp(`NEXAR: ${groupNames(gk)}`, list);
  return L.join('\n') + '\n';
}

// stand-alone IFC4 (metres, origin = model origin) when there is no IFC model to append to
function baseIfc(project, author) {
  const now = new Date(), t = Math.floor(now.getTime() / 1000);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME(${stepStr(project.name + '_marks.ifc')},'${now.toISOString().slice(0, 19)}',(${stepStr(author)}),(''),'NEXAR','NEXAR','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,${stepStr(author)},$,$,$,$,$);
#2=IFCORGANIZATION($,'NEXAR',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'2.0','NEXAR','NEXAR');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,${t});
#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#7=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#8=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#9=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#10=IFCUNITASSIGNMENT((#6,#7,#8,#9));
#11=IFCCARTESIANPOINT((0.,0.,0.));
#12=IFCAXIS2PLACEMENT3D(#11,$,$);
#13=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#12,$);
#14=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#13,$,.MODEL_VIEW.,$);
#15=IFCPROJECT('${newGuid()}',#5,${stepStr(project.name)},$,$,$,$,(#13),#10);
#16=IFCLOCALPLACEMENT($,#12);
#17=IFCSITE('${newGuid()}',#5,'Site',$,$,#16,$,$,.ELEMENT.,$,$,$,$,$);
#18=IFCLOCALPLACEMENT(#16,#12);
#19=IFCBUILDING('${newGuid()}',#5,'Building',$,$,#18,$,$,.ELEMENT.,$,$,$);
#20=IFCLOCALPLACEMENT(#18,#12);
#21=IFCBUILDINGSTOREY('${newGuid()}',#5,'NEXAR marks',$,$,#20,$,$,.ELEMENT.,0.);
#22=IFCRELAGGREGATES('${newGuid()}',#5,$,$,#15,(#17));
#23=IFCRELAGGREGATES('${newGuid()}',#5,$,$,#17,(#19));
#24=IFCRELAGGREGATES('${newGuid()}',#5,$,$,#19,(#21));
ENDSEC;
END-ISO-10303-21;
`;
}

const ascii = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f; return b; };

// ifcBytes: the loaded IFC file (Uint8Array / ArrayBuffer) or null → stand-alone file
export function exportIfcWithMarks(project, ifcBytes, { author = 'NEXAR', groupName = () => '' } = {}) {
  let bytes = ifcBytes ? new Uint8Array(ifcBytes) : ascii(baseIfc(project, author));
  // 1 char per byte (positions match the bytes; the original bytes are copied untouched)
  const text = new TextDecoder('latin1').decode(bytes);
  const a = analyse(text);
  if (!a.ctx) throw new Error('This IFC has no 3D representation context');
  const end = text.lastIndexOf('END-ISO-10303-21');
  const at = text.lastIndexOf('ENDSEC;', end < 0 ? text.length : end);
  if (at < 0) throw new Error('Not a valid IFC (STEP) file');
  const add = ascii(markLines(project, a, groupName));
  const out = new Uint8Array(bytes.length + add.length);
  out.set(bytes.subarray(0, at), 0); out.set(add, at); out.set(bytes.subarray(at), at + add.length);
  const objCount = (project.markups || []).filter(isObjectMark).length;
  return { blob: new Blob([out], { type: 'application/x-step' }), schema: a.schema, unit: a.lenScale, count: objCount, merged: !!ifcBytes };
}
