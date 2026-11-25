// Interactive HTML export: ONE self-contained .html file (model as embedded GLB + every markup with its photos).
// Open it in any browser (PC / iPad / phone), no install, no NEXAR needed. three.js is loaded from the CDN.
import * as THREE from 'three';
import { STATUSES, typeMeta, itemTag, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';

const LS = new RegExp(String.fromCharCode(0x2028), 'g'), PS = new RegExp(String.fromCharCode(0x2029), 'g');
const J = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toB64(buf) {
  const u8 = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// copy what is on screen into a clean scene (world coordinates, plain materials, no picking attributes)
function buildScene(viewer) {
  const scene = new THREE.Scene();
  viewer.models.updateMatrixWorld(true);
  for (const model of viewer.models.children) {
    if (!model.visible) continue;
    model.traverse((o) => {
      if (!(o.isMesh || o.isLineSegments || o.isLine) || !o.geometry) return;
      const src = o.geometry, g = new THREE.BufferGeometry();
      g.setAttribute('position', src.getAttribute('position'));
      if (o.isMesh && src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal'));
      if (src.getAttribute('uv') && o.isMesh) g.setAttribute('uv', src.getAttribute('uv'));
      if (src.index) g.setIndex(src.index);
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const op = m.userData && m.userData.baseOpacity != null ? m.userData.baseOpacity : m.opacity;
        if (o.isMesh) return new THREE.MeshStandardMaterial({ color: m.color ? m.color.clone() : 0xcccccc, map: m.map || null, roughness: 0.85, metalness: 0, transparent: op < 0.99, opacity: op, side: THREE.DoubleSide });
        return new THREE.LineBasicMaterial({ color: m.color ? m.color.clone() : 0x9fd8ff, transparent: op < 0.99, opacity: op });
      });
      if (Array.isArray(o.material)) for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
      const c = o.isMesh ? new THREE.Mesh(g, mats.length > 1 ? mats : mats[0]) : new THREE.LineSegments(g, mats[0]);
      c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); c.matrixWorld.copy(o.matrixWorld);
      c.name = model.name || '';
      scene.add(c);
    });
  }
  return scene;
}

export async function exportInteractiveHTML(project, viewer, { groupName = () => '', onProgress } = {}) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  onProgress && onProgress('Packing the model…');
  const scene = buildScene(viewer);
  const glb = scene.children.length ? await new GLTFExporter().parseAsync(scene, { binary: true }) : null;
  const marks = project.markups.map((m) => {
    const w = viewer.ifcToWorld(m.position);
    const t = typeMeta(m.type);
    return {
      n: m.number, tag: itemTag(m), type: t.label, color: t.color,
      status: (STATUSES[m.status] || STATUSES.open).label, priority: m.priority || 'normal',
      title: markupTitle(m), text: m.text || '', author: m.author || '', assigned: m.assignedTo || '',
      group: m.group ? groupName(m.group) : '', created: fmtDateTime(m.checkedAt || m.createdAt), modified: m.modifiedAt,
      ifc: [m.position.x, m.position.y, m.position.z], w: [w.x, w.y, w.z],
      element: m.element ? { name: m.element.name || '', guid: m.element.guid || '', type: m.element.ifcType || '' } : null,
      images: [m.snapshot, ...(m.photos || [])].filter((d) => typeof d === 'string' && d.startsWith('data:image')),
      replies: (m.replies || []).map((r) => ({ a: r.author || '', t: r.text || '', d: r.createdAt || '' })), locked: !!m.locked
    };
  });
  const cam = viewer.persp, tgt = viewer.orbit ? viewer.orbit.target : new THREE.Vector3();
  const start = viewer.mode === 'plan' ? null : { p: cam.position.toArray(), t: tgt.toArray() };
  const data = { name: project.name, exported: new Date().toISOString(), marks, start, models: project.models.filter((m) => m.visible !== false).map((m) => m.name) };
  onProgress && onProgress('Writing the HTML…');
  const html = TEMPLATE.replaceAll('%%TITLE%%', () => escH(project.name)).replace('%%DATA%%', () => J(data)).replace('%%GLB%%', () => (glb ? toB64(glb) : ''));
  return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), count: marks.length, sizeMB: html.length / 1048576 };
}

// ---------------------------------------------------------------- the viewer page
const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>%%TITLE%% · NEXAR</title>
<style>
:root{--bg:#0E0E10;--sf:#161618;--sf2:#1F1F22;--ln:#2A2A2E;--tx:#F4F4F5;--mu:#9E9EA3;--ac:#D8AF30;--ac2:#DFB73A}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Thai",sans-serif;overflow:hidden}
#app{display:grid;grid-template-columns:1fr 340px;grid-template-rows:52px 1fr;height:100%}
header{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--sf);border-bottom:1px solid var(--ln)}
header h1{font-size:15px;margin:0 8px 0 0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
header small{color:var(--mu);font-weight:400}
button{font:inherit;color:var(--tx);background:var(--sf2);border:1px solid var(--ln);border-radius:9px;padding:6px 11px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--ac)}button.on{background:rgba(223,183,58,.16);border-color:rgba(223,183,58,.48);color:var(--ac2);font-weight:600}
#view{position:relative;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none}
#pins{position:absolute;inset:0;pointer-events:none}
.pin{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center}
.pin b{min-width:26px;height:26px;padding:0 6px;border-radius:13px;display:grid;place-items:center;font-size:12px;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px #0008}
.pin i{width:2px;height:10px;background:#fff}.pin.sel b{transform:scale(1.25);box-shadow:0 0 0 4px #dfb73a88}.pin.far{opacity:.45}
aside{background:var(--sf);border-left:1px solid var(--ln);display:flex;flex-direction:column;min-height:0}
.tools{padding:10px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--ln)}
.tools input{flex:1;min-width:120px;background:var(--bg);border:1px solid var(--ln);border-radius:9px;color:var(--tx);padding:6px 10px;font:inherit}
#list{overflow:auto;flex:1}
.it{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--ln);cursor:pointer}.it:hover{background:var(--sf2)}.it.sel{background:#16284a}
.it .n{flex:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:600}
.it .t{font-weight:600}.it .s{color:var(--mu);font-size:12px}
#card{position:absolute;left:12px;bottom:12px;width:min(420px,calc(100% - 24px));max-height:60%;overflow:auto;background:#161618f2;border:1px solid var(--ln);border-radius:12px;padding:14px;display:none;backdrop-filter:blur(8px)}
#card h2{margin:0 0 4px;font-size:16px}#card .meta{color:var(--mu);font-size:12px;margin-bottom:8px}
#card p{white-space:pre-wrap;margin:6px 0 10px}#card table{width:100%;border-collapse:collapse;font-size:12px}
#card td{padding:3px 0;border-top:1px solid var(--ln);vertical-align:top}#card td:first-child{color:var(--mu);width:38%}
#card .imgs{display:flex;gap:6px;overflow:auto;margin:8px 0}#card .imgs img{height:96px;border-radius:8px;cursor:zoom-in;border:1px solid var(--ln)}
#card .x{position:absolute;right:8px;top:8px;padding:2px 9px}
.badge{display:inline-block;padding:1px 8px;border-radius:9px;font-size:11px;background:var(--sf2);border:1px solid var(--ln);margin-right:4px}
#zoom{position:fixed;inset:0;background:#000d;display:none;place-items:center;z-index:9}#zoom img{max-width:96vw;max-height:94vh;border-radius:8px}
#hint{position:absolute;right:10px;bottom:10px;color:var(--mu);font-size:11px;pointer-events:none}
#empty{padding:20px;color:var(--mu)}
@media (max-width:760px){#app{grid-template-columns:1fr;grid-template-rows:52px 1fr 38%}aside{border-left:0;border-top:1px solid var(--ln)}#card{max-height:55%}header .opt{display:none}}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
</head><body>
<div id="app">
<header><h1>%%TITLE%% <small id="sub"></small></h1>
<button id="b-pins" class="on" title="Show / hide the marks">Marks</button>
<button id="b-xray" class="opt" title="See-through model">X-Ray</button>
<button id="b-model" class="on opt" title="Show / hide the model">Model</button>
<button id="b-fit">Fit</button></header>
<div id="view"><canvas id="c"></canvas><div id="pins"></div>
<div id="card"><button class="x" id="card-x">✕</button><div id="card-b"></div></div>
<div id="hint">Drag: orbit · Right-drag / two fingers: pan · Wheel / pinch: zoom · Tap a mark</div></div>
<aside><div class="tools"><input id="q" placeholder="Search marks…"><select id="ft" style="background:var(--bg);color:var(--tx);border:1px solid var(--ln);border-radius:9px;padding:6px"></select></div><div id="list"></div></aside>
</div>
<div id="zoom"><img alt=""></div>
<script id="glb" type="application/octet-stream">%%GLB%%</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const D = %%DATA%%;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '';
$('#sub').textContent = '· ' + D.marks.length + ' marks · exported ' + new Date(D.exported).toLocaleDateString();
const canvas = $('#c'), view = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x070b14);
scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x1a2333, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(30, 60, 20); scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 20000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.screenSpacePanning = true;
const model = new THREE.Group(); scene.add(model);
const box = new THREE.Box3();
// marks: a small 3D bead at the exact point + a numbered HTML pin above it
const beadGeo = new THREE.SphereGeometry(1, 16, 12);
const marks = D.marks.map((m, i) => {
  const p = new THREE.Vector3(...m.w);
  const bead = new THREE.Mesh(beadGeo, new THREE.MeshBasicMaterial({ color: m.color, depthTest: false, transparent: true, opacity: 0.95 }));
  bead.position.copy(p); bead.renderOrder = 5; scene.add(bead);
  const el = document.createElement('div'); el.className = 'pin';
  el.innerHTML = '<b style="background:' + m.color + '">' + m.n + '</b><i></i>';
  el.onclick = (e) => { e.stopPropagation(); select(i, true); };
  $('#pins').appendChild(el);
  return { m, p, bead, el };
});
const b64 = $('#glb').textContent.trim();
if (b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  new GLTFLoader().parse(bin.buffer, '', (g) => { model.add(g.scene); fit(); }, (e) => console.error(e));
} else fit();
function fit() {
  box.makeEmpty(); box.expandByObject(model);
  for (const k of marks) box.expandByPoint(k.p);
  if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 5;
  if (D.start && !fit.done) { camera.position.fromArray(D.start.p); controls.target.fromArray(D.start.t); }
  else { controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(r * 0.9, r * 0.7, r * 0.9)); }
  fit.done = true; camera.near = Math.max(0.02, r / 2000); camera.far = r * 50; camera.updateProjectionMatrix(); controls.update();
}
// list + filters
const types = [...new Set(D.marks.map((m) => m.type))];
$('#ft').innerHTML = '<option value="">All types</option>' + types.map((t) => '<option>' + esc(t) + '</option>').join('');
let sel = -1;
function visible(k) {
  const q = $('#q').value.trim().toLowerCase(), ft = $('#ft').value;
  if (ft && k.m.type !== ft) return false;
  return !q || (k.m.tag + ' ' + k.m.title + ' ' + k.m.text + ' ' + k.m.author + ' ' + k.m.group + ' ' + k.m.status).toLowerCase().includes(q);
}
function renderList() {
  const rows = marks.map((k, i) => visible(k) ? '<div class="it' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><div class="n" style="background:' + k.m.color + '">' + k.m.n + '</div><div><div class="t">' + esc(k.m.title) + '</div><div class="s">' + esc(k.m.type) + ' · ' + esc(k.m.status) + (k.m.group ? ' · ' + esc(k.m.group) : '') + (k.m.author ? ' · ' + esc(k.m.author) : '') + '</div></div></div>' : '').join('');
  $('#list').innerHTML = rows || '<div id="empty">No marks</div>';
}
$('#list').onclick = (e) => { const it = e.target.closest('.it'); if (it) select(+it.dataset.i, true); };
$('#q').oninput = $('#ft').onchange = renderList;
function select(i, fly) {
  sel = i; renderList();
  const k = marks[i]; if (!k) { $('#card').style.display = 'none'; return; }
  const m = k.m, f = (v) => (+v).toFixed(3);
  const rows = [['Tag', m.tag], ['Type', m.type], ['Status', m.status], ['Priority', m.priority], ['Group', m.group], ['Author', m.author], ['Assigned to', m.assigned],
    ['Created', fmt(m.created)], ['Model X, Y, Z (m)', f(m.ifc[0]) + ', ' + f(m.ifc[1]) + ', ' + f(m.ifc[2])],
    ...(m.element ? [['Element', m.element.name + ' (' + m.element.type + ')'], ['IFC GUID', m.element.guid]] : [])].filter((r) => r[1]);
  $('#card-b').innerHTML = '<h2>#' + m.n + ' ' + esc(m.title) + '</h2><div class="meta"><span class="badge" style="border-color:' + m.color + '">' + esc(m.type) + '</span><span class="badge">' + esc(m.status) + '</span>' + (m.locked ? '<span class="badge">Locked</span>' : '') + '</div>' +
    (m.text && m.text !== m.title ? '<p>' + esc(m.text) + '</p>' : '') +
    (m.images.length ? '<div class="imgs">' + m.images.map((s) => '<img src="' + s + '">').join('') + '</div>' : '') +
    '<table>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>' +
    (m.replies.length ? '<h4 style="margin:10px 0 4px">Replies</h4>' + m.replies.map((r) => '<p><b>' + esc(r.a) + '</b> ' + esc(r.t) + '</p>').join('') : '');
  $('#card').style.display = 'block';
  if (fly) flyTo(k.p);
}
$('#card-x').onclick = () => select(-1);
$('#card-b').onclick = (e) => { if (e.target.tagName === 'IMG') { $('#zoom img').src = e.target.src; $('#zoom').style.display = 'grid'; } };
$('#zoom').onclick = () => { $('#zoom').style.display = 'none'; };
let anim = null;
function flyTo(p) {
  const dir = camera.position.clone().sub(controls.target); const d = Math.min(Math.max(dir.length(), 3), 9);
  dir.setLength(d);
  anim = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toT: p.clone(), toP: p.clone().add(dir) };
}
// toggles
let pinsOn = true;
$('#b-pins').onclick = (e) => { pinsOn = !pinsOn; e.target.classList.toggle('on', pinsOn); $('#pins').style.display = pinsOn ? '' : 'none'; for (const k of marks) k.bead.visible = pinsOn; };
$('#b-model').onclick = (e) => { model.visible = !model.visible; e.target.classList.toggle('on', model.visible); };
let xray = false;
$('#b-xray').onclick = (e) => {
  xray = !xray; e.target.classList.toggle('on', xray);
  model.traverse((o) => { if (!o.material) return; for (const mt of [].concat(o.material)) { mt.userData.o ??= { t: mt.transparent, o: mt.opacity, d: mt.depthWrite }; mt.transparent = xray || mt.userData.o.t; mt.opacity = xray ? Math.min(mt.userData.o.o, 0.18) : mt.userData.o.o; mt.depthWrite = xray ? false : mt.userData.o.d; mt.needsUpdate = true; } });
};
$('#b-fit').onclick = () => fit();
// click on the model background closes the card
canvas.addEventListener('click', () => { if (sel >= 0 && !anim) select(-1); });
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const v = new THREE.Vector3();
renderer.setAnimationLoop((now) => {
  if (anim) {
    const k = Math.min(1, (now - anim.t0) / 600), e = k * k * (3 - 2 * k);
    controls.target.lerpVectors(anim.fromT, anim.toT, e); camera.position.lerpVectors(anim.fromP, anim.toP, e);
    if (k >= 1) anim = null;
  }
  controls.update();
  const w = view.clientWidth, h = view.clientHeight;
  for (let i = 0; i < marks.length; i++) {
    const k = marks[i];
    const dist = camera.position.distanceTo(k.p);
    k.bead.scale.setScalar(Math.max(0.03, dist * 0.006));
    v.copy(k.p).project(camera);
    const show = pinsOn && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 && visible(k);
    k.el.style.display = show ? '' : 'none';
    if (show) { k.el.style.left = ((v.x + 1) / 2 * w) + 'px'; k.el.style.top = ((1 - v.y) / 2 * h - 4) + 'px'; k.el.classList.toggle('sel', i === sel); }
  }
  renderer.render(scene, camera);
});
renderList();
</script></body></html>`;
