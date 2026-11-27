// Standalone HTML Coordinate & Crop-View Report exporter (works 100% offline, print-ready A4 PDF).
// Shows:
//   1. Overview 2D Plan Coordinate Map (SVG) plotting every Mark (🟡 Circle), Note (🔵 Square), Issue (🔴 Triangle)
//   2. Per-spot Crop View (zoomed 3D crop with Crop/Full toggle + ±5 m Local Plan Crop mini-map + site photos)
//   3. Full BIM coordinates (X, Y, Z), Checked Date & Time, UniFormat/Family, Host GUID/Revit Id & Camera Eye
import { MARKUP_TYPES, STATUSES, typeMeta, recordKind, itemTag, pinLabel, fmtDateTime, markupTitle } from '../Core/Nexar.Document/project.js';
import { itemNaming } from './photopack.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shapeSvg(kind, cx, cy, r, fill, stroke = '#fff', sw = 1.6) {
  if (kind === 'issue') {
    const h = r * 1.15;
    const w = r * 1.18;
    return `<polygon points="${cx.toFixed(1)},${(cy - h).toFixed(1)} ${(cx + w).toFixed(1)},${(cy + h * 0.78).toFixed(1)} ${(cx - w).toFixed(1)},${(cy + h * 0.78).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (kind === 'note') {
    return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="2.5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function colorForKind(k) {
  return k === 'mark' ? MARKUP_TYPES.family.color : k === 'issue' ? MARKUP_TYPES.issue.color : MARKUP_TYPES.note.color;
}
function shapeName(k) {
  return k === 'mark' ? 'Sphere' : k === 'issue' ? 'Equilateral Triangle' : 'Cube';
}

// Overview SVG Plan Map across all spots + model bounds
function buildOverviewMapSvg(items, modelBounds) {
  const W = 920, H = 360, PAD = 42;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const expand = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  if (modelBounds) { expand(modelBounds.minX, modelBounds.minY); expand(modelBounds.maxX, modelBounds.maxY); }
  for (const it of items) expand(it.position.x, it.position.y);
  if (!Number.isFinite(minX)) { minX = 0; maxX = 10; minY = 0; maxY = 10; }
  const spanX = Math.max(2, maxX - minX), spanY = Math.max(2, maxY - minY);
  const padX = spanX * 0.14, padY = spanY * 0.14;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const scale = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const sx = (x) => W / 2 + (x - midX) * scale;
  const sy = (y) => H / 2 - (y - midY) * scale; // IFC +Y = North (up)

  // Grid step
  const rawStep = Math.max(maxX - minX, maxY - minY) / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, rawStep))));
  const step = rawStep / pow < 2 ? pow : rawStep / pow < 5 ? pow * 2 : pow * 5;
  const grid = [];
  for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) {
    const px = sx(gx);
    grid.push(`<line x1="${px.toFixed(1)}" y1="14" x2="${px.toFixed(1)}" y2="${H - 22}" stroke="#252830" stroke-width="1"/>`);
    grid.push(`<text x="${px.toFixed(1)}" y="${H - 7}" fill="#7c8396" font-size="10" text-anchor="middle" font-family="ui-monospace,monospace">${gx.toFixed(step < 1 ? 1 : 0)}m</text>`);
  }
  for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step) {
    const py = sy(gy);
    grid.push(`<line x1="36" y1="${py.toFixed(1)}" x2="${W - 14}" y2="${py.toFixed(1)}" stroke="#252830" stroke-width="1"/>`);
    grid.push(`<text x="32" y="${(py + 3).toFixed(1)}" fill="#7c8396" font-size="10" text-anchor="end" font-family="ui-monospace,monospace">${gy.toFixed(step < 1 ? 1 : 0)}</text>`);
  }
  const bRect = modelBounds ? `<rect x="${sx(modelBounds.minX).toFixed(1)}" y="${sy(modelBounds.maxY).toFixed(1)}" width="${Math.max(4, (modelBounds.maxX - modelBounds.minX) * scale).toFixed(1)}" height="${Math.max(4, (modelBounds.maxY - modelBounds.minY) * scale).toFixed(1)}" fill="rgba(91,140,255,0.08)" stroke="rgba(148,163,184,0.45)" stroke-dasharray="4 3" stroke-width="1.2"/>` : '';
  const originPt = (minX <= 0 && maxX >= 0 && minY <= 0 && maxY >= 0)
    ? `<g opacity=".75"><line x1="${(sx(0) - 8).toFixed(1)}" y1="${sy(0).toFixed(1)}" x2="${(sx(0) + 8).toFixed(1)}" y2="${sy(0).toFixed(1)}" stroke="#4CB884" stroke-width="1.4"/><line x1="${sx(0).toFixed(1)}" y1="${(sy(0) - 8).toFixed(1)}" x2="${sx(0).toFixed(1)}" y2="${(sy(0) + 8).toFixed(1)}" stroke="#4CB884" stroke-width="1.4"/><text x="${(sx(0) + 9).toFixed(1)}" y="${(sy(0) - 5).toFixed(1)}" fill="#4CB884" font-size="9.5" font-family="ui-monospace,monospace">0,0 Base</text></g>` : '';

  const dots = items.map((it) => {
    const px = sx(it.position.x), py = sy(it.position.y);
    return `<g class="map-dot" data-id="${esc(it.id)}" data-kind="${esc(it.kind)}" style="cursor:pointer" onclick="jumpTo('${esc(it.id)}')">
      <title>${esc(it.tag)} · ${esc(it.title)} (X ${it.position.x.toFixed(2)}, Y ${it.position.y.toFixed(2)}, Z ${it.position.z.toFixed(2)})</title>
      ${shapeSvg(it.kind, px, py, 9, it.color, '#0e0e12', 1.8)}
      <text x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" fill="#f4f4f5" font-size="10" font-weight="700" text-anchor="middle" font-family="ui-monospace,monospace">${esc(it.pin)}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="ov-svg" role="img" aria-label="2D Coordinate Plan Map">
    <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#111216"/>
    ${grid.join('')}${bRect}${originPt}${dots}
    <g transform="translate(${W - 34}, 30)"><circle r="14" fill="#1a1c22" stroke="#343844"/><text y="-3" fill="#DFB73A" font-size="9" font-weight="700" text-anchor="middle">N</text><path d="M0,-9 L3,4 L0,1 L-3,4 Z" fill="#DFB73A"/></g>
  </svg>`;
}

// Local ±5 m Plan Crop SVG centered on one specific spot
function buildLocalCropSvg(item, allItems, modelBounds) {
  const W = 240, H = 180, HALF = 5.0; // ±5 m crop window around spot
  const cx = item.position.x, cy = item.position.y;
  const scale = Math.min((W - 24) / (HALF * 2), (H - 24) / (HALF * 2));
  const sx = (x) => W / 2 + (x - cx) * scale;
  const sy = (y) => H / 2 - (y - cy) * scale;
  const grid = [];
  for (let gx = Math.ceil(cx - HALF); gx <= Math.floor(cx + HALF); gx++) {
    const px = sx(gx);
    grid.push(`<line x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="${H}" stroke="#22252e" stroke-width="1"/>`);
  }
  for (let gy = Math.ceil(cy - HALF); gy <= Math.floor(cy + HALF); gy++) {
    const py = sy(gy);
    grid.push(`<line x1="0" y1="${py.toFixed(1)}" x2="${W}" y2="${py.toFixed(1)}" stroke="#22252e" stroke-width="1"/>`);
  }
  const bRect = modelBounds ? `<rect x="${sx(modelBounds.minX).toFixed(1)}" y="${sy(modelBounds.maxY).toFixed(1)}" width="${Math.max(2, (modelBounds.maxX - modelBounds.minX) * scale).toFixed(1)}" height="${Math.max(2, (modelBounds.maxY - modelBounds.minY) * scale).toFixed(1)}" fill="rgba(91,140,255,0.09)" stroke="rgba(148,163,184,0.45)" stroke-dasharray="3 2" stroke-width="1"/>` : '';
  const neighbors = allItems.filter((o) => o.id !== item.id && Math.abs(o.position.x - cx) <= HALF && Math.abs(o.position.y - cy) <= HALF)
    .map((o) => `<g opacity=".48">${shapeSvg(o.kind, sx(o.position.x), sy(o.position.y), 5.5, o.color, '#0e0e12', 1.1)}<text x="${sx(o.position.x).toFixed(1)}" y="${(sy(o.position.y) - 8).toFixed(1)}" fill="#a1a1aa" font-size="8.5" text-anchor="middle" font-family="ui-monospace,monospace">${esc(o.pin)}</text></g>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="crop-plan-svg">
    <rect width="${W}" height="${H}" fill="#0f1015"/>
    ${grid.join('')}${bRect}${neighbors}
    <line x1="${W / 2}" y1="8" x2="${W / 2}" y2="${H - 8}" stroke="${item.color}" stroke-opacity=".35" stroke-dasharray="3 3"/>
    <line x1="8" y1="${H / 2}" x2="${W - 8}" y2="${H / 2}" stroke="${item.color}" stroke-opacity=".35" stroke-dasharray="3 3"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="19" fill="none" stroke="${item.color}" stroke-opacity=".45" stroke-width="1.2"/>
    ${shapeSvg(item.kind, W / 2, H / 2, 8.5, item.color, '#ffffff', 1.8)}
    <rect x="6" y="6" width="96" height="18" rx="4" fill="rgba(12,13,18,.86)" stroke="#2c303b"/>
    <text x="12" y="18" fill="#cbd5e1" font-size="9.5" font-family="ui-monospace,monospace">Plan Crop ±5m</text>
    <rect x="6" y="${H - 22}" width="${W - 12}" height="17" rx="4" fill="rgba(12,13,18,.88)"/>
    <text x="${W / 2}" y="${H - 10}" fill="#DFB73A" font-size="9.5" font-weight="600" text-anchor="middle" font-family="ui-monospace,monospace">X ${cx.toFixed(2)} · Y ${cy.toFixed(2)} · Z ${item.position.z.toFixed(2)} m</text>
  </svg>`;
}

export function exportCropViewHTML(project, { groupName = () => '', modelBounds = null } = {}) {
  const kindOrder = { mark: 0, issue: 1, note: 2 };
  const raw = (project.markups || []).slice().sort((a, b) => ((kindOrder[recordKind(a)] ?? 9) - (kindOrder[recordKind(b)] ?? 9)) || ((a.number || 0) - (b.number || 0)));

  const items = raw.map((m) => {
    const k = recordKind(m);
    const gn = groupName(m.group);
    const nm = itemNaming(m, gn);
    const p = m.position || { x: 0, y: 0, z: 0 };
    return {
      id: m.id,
      kind: k,
      tag: itemTag(m),
      pin: pinLabel(m),
      color: colorForKind(k),
      shape: shapeName(k),
      typeLabel: typeMeta(m.type).label,
      status: m.status || 'open',
      statusLabel: (STATUSES[m.status] || STATUSES.open).label,
      priority: m.priority || 'normal',
      title: markupTitle(m),
      text: m.text || '',
      group: gn,
      author: m.author || '',
      assignedTo: m.assignedTo || '',
      checkedAt: fmtDateTime(m.checkedAt || m.createdAt),
      modelName: m.modelName || '',
      position: { x: +(p.x || 0), y: +(p.y || 0), z: +(p.z || 0) },
      camEye: m.viewpoint && m.viewpoint.position ? m.viewpoint.position : null,
      family: k === 'mark' ? (m.family || null) : null,
      element: m.element || null,
      snapshot: m.snapshot || null,
      photos: m.photos || [],
      photoFolder: nm.folderPath,
      photoFiles: nm.sitePhotos.map((f) => f.fileName)
    };
  });

  const cMark = items.filter((x) => x.kind === 'mark').length;
  const cNote = items.filter((x) => x.kind === 'note').length;
  const cIssue = items.filter((x) => x.kind === 'issue').length;
  const overviewSvg = buildOverviewMapSvg(items, modelBounds);

  const cardsHtml = items.map((it) => {
    const F = it.family || {};
    const snapBlock = it.snapshot
      ? `<div class="crop-3d is-cropped" id="c3-${esc(it.id)}">
          <img src="${it.snapshot}" alt="${esc(it.tag)} 3D crop view">
          <div class="crop-reticle" style="--c:${it.color}"></div>
          <span class="crop-badge" style="--c:${it.color}">${esc(it.tag)} · 3D Crop</span>
          <button type="button" class="crop-tog" onclick="toggleCrop('c3-${esc(it.id)}', this)">Full View</button>
        </div>`
      : `<div class="crop-3d empty"><span>No 3D snapshot captured</span></div>`;

    const sitePhotosHtml = it.photos.length
      ? `<div class="site-photos">${it.photos.map((src, i) => `<button type="button" class="sph" onclick="openImg(this.querySelector('img').src,'${esc(it.tag)} · ${esc(it.photoFiles[i] || `Photo ${i + 1}`)}')"><img src="${src}" alt=""><span>${esc(it.photoFiles[i] || `P${String(i + 1).padStart(2, '0')}`)}</span></button>`).join('')}</div>`
      : '';

    const famRows = it.family
      ? `<div class="kv"><span>UniFormat / Family</span><b>${esc(F.uniformat || '—')}${F.familyName ? ` · ${esc(F.familyName)}` : ''}${F.typeName ? ` : ${esc(F.typeName)}` : ''}</b></div>
         <div class="kv"><span>Placement / Normal</span><b class="mono">${esc(F.hostSurface || 'Floor')} ${Math.round(F.rotationDeg || 0)}°${F.normal ? ` · N(${F.normal.x.toFixed(2)}, ${F.normal.y.toFixed(2)}, ${F.normal.z.toFixed(2)})` : ''}</b></div>`
      : '';

    const hostRow = it.element
      ? `<div class="kv"><span>Host Element</span><b>${esc(it.element.ifcType || '')}${it.element.name ? ` · ${esc(it.element.name)}` : ''}${it.element.tag ? ` (Revit Id ${esc(it.element.tag)})` : ''}${it.element.guid ? `<br><code>${esc(it.element.guid)}</code>` : ''}</b></div>`
      : '';

    const camRow = it.camEye
      ? `<div class="kv"><span>Camera Eye (Plugin)</span><b class="mono">(${it.camEye.x.toFixed(2)}, ${it.camEye.y.toFixed(2)}, ${it.camEye.z.toFixed(2)}) m</b></div>`
      : '';

    const shapeIcon = it.kind === 'issue' ? '▲' : it.kind === 'note' ? '■' : '●';

    return `<article class="card" id="item-${esc(it.id)}" data-kind="${esc(it.kind)}" data-status="${esc(it.status)}" data-q="${esc(`${it.tag} ${it.title} ${it.text} ${it.group} ${F.uniformat || ''} ${F.familyName || ''} ${it.element ? it.element.name : ''}`).toLowerCase()}">
      <div class="card-head">
        <span class="tag-pill" style="--c:${it.color}"><i>${shapeIcon}</i> ${esc(it.tag)}</span>
        <h3>${esc(it.title)}</h3>
        <span class="st-pill st-${esc(it.status)}">${esc(it.statusLabel)}</span>
        <span class="meta-r mono">${esc(it.checkedAt)}</span>
      </div>
      <div class="card-grid">
        <div class="card-views">
          ${snapBlock}
          <div class="crop-plan">${buildLocalCropSvg(it, items, modelBounds)}</div>
        </div>
        <div class="card-data">
          <div class="coord-box" style="--c:${it.color}">
            <div><small>X (IFC m)</small><b class="mono">${it.position.x.toFixed(3)}</b></div>
            <div><small>Y (IFC m)</small><b class="mono">${it.position.y.toFixed(3)}</b></div>
            <div><small>Z (IFC m)</small><b class="mono">${it.position.z.toFixed(3)}</b></div>
            <div><small>3D Shape</small><b>${shapeIcon} ${esc(it.shape)}</b></div>
          </div>
          ${it.text ? `<p class="desc">${esc(it.text)}</p>` : ''}
          <div class="kv-list">
            <div class="kv"><span>Stream · Type</span><b>${esc(it.typeLabel)} · Priority: ${esc(it.priority)}${it.assignedTo ? ` · Assigned: ${esc(it.assignedTo)}` : ''}</b></div>
            ${it.modelName ? `<div class="kv"><span>Model File</span><b class="mono">${esc(it.modelName)}</b></div>` : ''}
            ${it.group ? `<div class="kv"><span>Group</span><b>${esc(it.group)}</b></div>` : ''}
            ${famRows}${hostRow}${camRow}
            <div class="kv"><span>Photo Folder</span><b class="mono">${esc(it.photoFolder)}/</b></div>
            ${it.author ? `<div class="kv"><span>Author</span><b>${esc(it.author)}</b></div>` : ''}
          </div>
          ${sitePhotosHtml}
        </div>
      </div>
    </article>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(project.name)} — NEXAR Coordinate &amp; Crop View Report</title>
<style>
:root{--bg:#0d0e12;--sf:#15171d;--sf2:#1c1f27;--ln:#292d38;--tx:#f4f4f5;--tx2:#a1a7b5;--ac:#DFB73A;--mono:ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:13.5px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:22px 20px 64px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--ln);margin-bottom:18px}
.brand{display:flex;align-items:center;gap:10px}
.brand b{font-size:20px;letter-spacing:.12em}
.brand b span{color:var(--ac)}
.sub{color:var(--tx2);font-size:12px}
.stats{display:flex;gap:8px;flex-wrap:wrap}
.stat{padding:6px 12px;border-radius:8px;background:var(--sf);border:1px solid var(--ln);font-size:12px;display:flex;align-items:center;gap:6px}
.stat i{font-style:normal;font-size:13px}
.legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--tx2);margin:0 0 10px}
.overview{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:14px;margin-bottom:18px}
.ov-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.ov-head h2{margin:0;font-size:14px}
.ov-svg{width:100%;height:auto;display:block;border-radius:8px;border:1px solid var(--ln)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;position:sticky;top:0;z-index:10;background:rgba(13,14,18,.92);backdrop-filter:blur(10px);padding:10px 0;border-bottom:1px solid var(--ln)}
.fbtn{padding:6px 12px;border-radius:99px;border:1px solid var(--ln);background:var(--sf);color:var(--tx2);font-size:12px;font-weight:600;cursor:pointer}
.fbtn.on{background:rgba(223,183,58,.15);border-color:var(--ac);color:var(--ac)}
.search{flex:1;min-width:180px;padding:7px 12px;border-radius:8px;border:1px solid var(--ln);background:var(--sf);color:var(--tx);font:inherit}
.pbtn{padding:7px 14px;border-radius:8px;border:0;background:var(--ac);color:#111;font-weight:700;font-size:12px;cursor:pointer}
.cards{display:flex;flex-direction:column;gap:14px}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:14px 16px;break-inside:avoid}
.card.flash{border-color:var(--ac);box-shadow:0 0 0 2px rgba(223,183,58,.35)}
.card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--ln);margin-bottom:12px}
.card-head h3{margin:0;font-size:15px;flex:1;min-width:180px}
.tag-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font:700 12px var(--mono);background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
.tag-pill i{font-style:normal}
.st-pill{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:var(--sf2);border:1px solid var(--ln);color:var(--tx2)}
.st-resolved{color:#4CB884;border-color:rgba(76,184,132,.4)}
.meta-r{font-size:11.5px;color:var(--tx2)}
.mono{font-family:var(--mono)}
.card-grid{display:grid;grid-template-columns:minmax(260px,380px) 1fr;gap:14px}
.card-views{display:grid;grid-template-columns:1fr;gap:10px}
.crop-3d{position:relative;border-radius:9px;overflow:hidden;border:1px solid var(--ln);background:#0b0c10;aspect-ratio:16/10}
.crop-3d img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .22s ease}
.crop-3d.is-cropped img{transform:scale(1.65)}
.crop-3d.empty{display:grid;place-items:center;color:var(--tx2);font-size:12px}
.crop-reticle{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid var(--c);box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}
.crop-reticle::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:var(--c)}
.crop-badge{position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:5px;background:rgba(10,11,16,.84);border:1px solid color-mix(in srgb,var(--c) 55%,transparent);color:var(--c);font:700 10.5px var(--mono)}
.crop-tog{position:absolute;right:8px;bottom:8px;padding:3px 9px;border-radius:6px;background:rgba(10,11,16,.86);border:1px solid var(--ln);color:#fff;font-size:11px;cursor:pointer}
.crop-plan{border-radius:9px;overflow:hidden;border:1px solid var(--ln);background:#0f1015}
.crop-plan-svg{width:100%;height:auto;display:block}
.coord-box{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px;border-radius:8px;background:var(--sf2);border:1px solid color-mix(in srgb,var(--c) 35%,var(--ln));margin-bottom:10px}
.coord-box small{display:block;font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.06em}
.coord-box b{font-size:13px;color:var(--tx)}
.desc{margin:0 0 10px;padding:9px 11px;border-radius:8px;background:#101218;border:1px solid var(--ln);white-space:pre-wrap;font-size:13px}
.kv-list{display:flex;flex-direction:column;gap:5px}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.kv span{color:var(--tx2);flex:none}
.kv b{text-align:right;font-weight:500;overflow-wrap:anywhere}
.kv code{font:10.5px var(--mono);color:var(--ac)}
.site-photos{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.sph{padding:0;border:1px solid var(--ln);border-radius:7px;overflow:hidden;background:#0b0c10;width:104px;cursor:pointer;color:var(--tx2);text-align:left}
.sph img{width:100%;height:68px;object-fit:cover;display:block}
.sph span{display:block;padding:3px 5px;font:9.5px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lb{position:fixed;inset:0;z-index:99;background:rgba(5,6,9,.88);display:none;place-items:center;padding:24px}
#lb.on{display:grid}
#lb img{max-width:92vw;max-height:84vh;border-radius:10px;border:1px solid var(--ln)}
#lb p{color:#fff;font:12.5px var(--mono);margin:8px 0 0;text-align:center}
@media(max-width:780px){.card-grid{grid-template-columns:1fr}.coord-box{grid-template-columns:repeat(2,1fr)}}
@media print{body{background:#fff;color:#111}.toolbar,.crop-tog{display:none!important}.card,.overview,.stat{background:#fff;border-color:#ccc}.desc,.coord-box{background:#f6f7f9;border-color:#d4d7de;color:#111}.coord-box b,.kv b{color:#111}.kv span,.sub,.meta-r{color:#555}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand"><b>NEX<span>AR</span></b><span>Coordinate &amp; Crop View Report</span></div>
      <div class="sub">${esc(project.name)} · Exported ${esc(fmtDateTime(new Date().toISOString()))} · IFC Coordinates (metres, Z-up — synced with model Base Point)</div>
    </div>
    <div class="stats">
      <div class="stat"><i style="color:#DFB73A">●</i><b>${cMark}</b> Marks (Sphere)</div>
      <div class="stat"><i style="color:#5B8CFF">■</i><b>${cNote}</b> Notes (Cube)</div>
      <div class="stat"><i style="color:#E56565">▲</i><b>${cIssue}</b> Issues (Triangle)</div>
    </div>
  </header>

  <section class="overview">
    <div class="ov-head">
      <h2>2D Coordinate Plan Map (Click any spot to jump to Crop View)</h2>
      <div class="legend">
        <span><b style="color:#DFB73A">●</b> Mark (MK)</span>
        <span><b style="color:#5B8CFF">■</b> Note (NT)</span>
        <span><b style="color:#E56565">▲</b> Issue (IS)</span>
      </div>
    </div>
    ${overviewSvg}
  </section>

  <div class="toolbar">
    <button class="fbtn on" data-f="all" onclick="setFilter('all',this)">All (${items.length})</button>
    <button class="fbtn" data-f="mark" onclick="setFilter('mark',this)">● Marks (${cMark})</button>
    <button class="fbtn" data-f="note" onclick="setFilter('note',this)">■ Notes (${cNote})</button>
    <button class="fbtn" data-f="issue" onclick="setFilter('issue',this)">▲ Issues (${cIssue})</button>
    <button class="fbtn" data-f="open" onclick="setFilter('open',this)">Open</button>
    <input class="search" id="q" placeholder="Search tag (MK / NT / IS), UniFormat, title, host…" oninput="applyFilter()">
    <button class="pbtn" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="cards" id="cards">${cardsHtml || '<p class="sub">No spots recorded in this project.</p>'}</div>
</div>
<div id="lb" onclick="this.classList.remove('on')"><div><img id="lb-img" alt=""><p id="lb-cap"></p></div></div>
<script>
let curF = 'all';
function setFilter(f, btn) {
  curF = f;
  document.querySelectorAll('.fbtn').forEach(b => b.classList.toggle('on', b === btn));
  applyFilter();
}
function applyFilter() {
  const q = (document.getElementById('q').value || '').trim().toLowerCase();
  document.querySelectorAll('.card').forEach(c => {
    const k = c.dataset.kind, st = c.dataset.status, hay = c.dataset.q || '';
    const okF = curF === 'all' ? true : curF === 'open' ? (st === 'open' || st === 'in-progress') : k === curF;
    const okQ = !q || hay.includes(q);
    c.style.display = (okF && okQ) ? '' : 'none';
  });
  document.querySelectorAll('.map-dot').forEach(d => {
    const k = d.dataset.kind;
    d.style.opacity = (curF === 'all' || curF === 'open' || curF === k) ? '1' : '0.16';
  });
}
function toggleCrop(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const cropped = el.classList.toggle('is-cropped');
  btn.textContent = cropped ? 'Full View' : 'Crop 1.6×';
}
function jumpTo(id) {
  const el = document.getElementById('item-' + id);
  if (!el) return;
  if (el.style.display === 'none') {
    curF = 'all';
    document.querySelectorAll('.fbtn').forEach(b => b.classList.toggle('on', b.dataset.f === 'all'));
    applyFilter();
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1400);
}
function openImg(src, cap) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-cap').textContent = cap;
  document.getElementById('lb').classList.add('on');
}
</script>
</body>
</html>`;

  return {
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    count: items.length,
    counts: { mark: cMark, note: cNote, issue: cIssue }
  };
}
