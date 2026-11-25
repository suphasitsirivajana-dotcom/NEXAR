// Small UI toolkit: ribbon, modals, toasts, hints.
import { icon } from './icons.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// ---------------------------------------------------------------- toasts
export function toast(msg, kind = 'info', ms = 2800) {
  const root = $('#toasts');
  const el = h(`<div class="toast ${kind}">${icon(kind === 'ok' ? 'check' : kind === 'error' ? 'x' : kind === 'warn' ? 'info' : 'info')}<span>${esc(msg)}</span></div>`);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------------------------------------------------------- tool hint banner
export function hint(text, onCancel) {
  const el = $('#hint');
  el.innerHTML = `<span class="hint-dot"></span><span>${esc(text)}</span>${onCancel ? `<button class="hint-x">${icon('x')}<span>Esc</span></button>` : ''}`;
  el.hidden = false;
  const b = el.querySelector('.hint-x'); if (b) b.onclick = onCancel;
}
export function hideHint() { $('#hint').hidden = true; }

// ---------------------------------------------------------------- modal
export function modal({ title, body, actions = [], wide = false, onClose, dismissible = true, cls = '' }) {
  const root = $('#modal-root');
  const el = h(`<div class="modal-wrap"><div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
      <header><h2>${esc(title)}</h2>${dismissible ? `<button class="icon-btn m-close" aria-label="Close">${icon('x')}</button>` : ''}</header>
      <div class="modal-body"></div>
      <footer></footer></div></div>`);
  const bodyEl = el.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = el.querySelector('footer');
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    el.classList.remove('in'); setTimeout(() => el.remove(), 180);
    document.removeEventListener('keydown', onKey);
    onClose && onClose(v);
  };
  for (const a of actions) {
    const b = h(`<button class="btn ${a.kind || ''}" ${a.id ? `id="${a.id}"` : ''}>${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`);
    if (a.left) b.classList.add('left');
    b.onclick = () => a.onClick ? a.onClick(close, el) : close();
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissible) {
    el.querySelector('.m-close').onclick = () => close();
    // Palm-safe & Apple Pencil-safe backdrop dismiss: never close while writing with Pencil or resting palm on edge
    let wrapDown = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target !== el) { wrapDown = null; return; }
      const ae = document.activeElement;
      const typing = ae && el.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName);
      if (e.pointerType === 'pen' || typing) { wrapDown = null; return; }
      wrapDown = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!wrapDown || wrapDown.id !== e.pointerId || e.target !== el) { wrapDown = null; return; }
      const moved = Math.hypot(e.clientX - wrapDown.x, e.clientY - wrapDown.y);
      wrapDown = null;
      if (moved < 10) close();
    });
  }
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return { el, body: bodyEl, close };
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    modal({ title, body: `<p class="muted">${esc(text)}</p>`, onClose: (v) => res(!!v),
      actions: [{ label: 'Cancel', onClick: (c) => c(false) }, { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => c(true) }] });
  });
}
export function promptBox(title, label, value = '') {
  return new Promise((res) => {
    const m = modal({ title, body: `<label class="field"><span>${esc(label)}</span><input type="text" autocorrect="on" spellcheck="true" enterkeyhint="done" value="${esc(value)}"></label>`,
      onClose: (v) => res(v ?? null),
      actions: [{ label: 'Cancel', onClick: (c) => c(null) }, { label: 'OK', kind: 'primary', onClick: (c) => c(m.body.querySelector('input').value.trim()) }] });
    const inp = m.body.querySelector('input');
    if (!document.body.classList.contains('has-pencil')) setTimeout(() => { inp.focus(); inp.select(); }, 60);
    inp.onkeydown = (e) => { if (e.key === 'Enter') m.close(inp.value.trim()); };
  });
}

// ---------------------------------------------------------------- ribbon
// def: [{ id, label, groups: [{ label, items: [{ cmd, icon, label, tip, toggle }] }] }]
export class Ribbon {
  constructor(tabsEl, ribbonEl, def, onCmd) {
    this.tabsEl = tabsEl; this.ribbonEl = ribbonEl; this.def = def; this.onCmd = onCmd;
    this.active = new Set(); this.disabled = new Set();
    this.current = def[0].id;
    this.render();
  }
  render() {
    this.tabsEl.innerHTML = this.def.map((t) => `<button role="tab" class="rtab ${t.id === this.current ? 'on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('') + '<span class="rtab-ink"></span>';
    this.tabsEl.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) this.selectTab(b.dataset.tab); };
    this._renderPanel();
    requestAnimationFrame(() => this._ink());
  }
  _renderPanel() {
    const tab = this.def.find((t) => t.id === this.current);
    this.ribbonEl.innerHTML = tab.groups.map((g) => `
      <div class="rgroup"><div class="ritems">${g.items.map((it) => `
        <button class="rbtn ${this.active.has(it.cmd) ? 'on' : ''}" data-cmd="${it.cmd}" title="${esc(it.tip || it.label)}" ${this.disabled.has(it.cmd) ? 'disabled' : ''}>
          ${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</div>
        <div class="rlabel">${esc(g.label)}</div></div>`).join('<div class="rsep"></div>');
    this.ribbonEl.onclick = (e) => { const b = e.target.closest('[data-cmd]'); if (b && !b.disabled) this.onCmd(b.dataset.cmd, b); };
    this.ribbonEl.scrollLeft = 0;
  }
  _ink() {
    const on = this.tabsEl.querySelector('.rtab.on'), ink = this.tabsEl.querySelector('.rtab-ink');
    if (on && ink) { ink.style.width = `${on.offsetWidth - 20}px`; ink.style.transform = `translateX(${on.offsetLeft + 10}px)`; }
  }
  selectTab(id) {
    this.current = id;
    this.tabsEl.querySelectorAll('.rtab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    this._ink();
    this._renderPanel();
  }
  setActive(cmd, on) {
    on ? this.active.add(cmd) : this.active.delete(cmd);
    this.ribbonEl.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => b.classList.toggle('on', !!on));
  }
  setDisabled(cmd, off) {
    off ? this.disabled.add(cmd) : this.disabled.delete(cmd);
    this.ribbonEl.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => (b.disabled = !!off));
  }
}

// iPad / iPhone / Android: a plain download often goes nowhere (above all in the Home Screen app),
// so on touch devices we show a "file ready" box whose button opens the system Share sheet → Save to Files / AirDrop / LINE / Mail.
const TOUCH = matchMedia('(pointer: coarse)').matches || /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function saveByLink(url, filename) {
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
export function download(blobOrUrl, filename) {
  if (typeof blobOrUrl === 'string') { // data: URL (e.g. QR PNG) → blob, so it can go through the Share sheet too
    if (TOUCH && blobOrUrl.startsWith('data:')) { fetch(blobOrUrl).then((r) => r.blob()).then((b) => download(b, filename)).catch(() => saveByLink(blobOrUrl, filename)); return; }
    return saveByLink(blobOrUrl, filename);
  }
  const blob = blobOrUrl;
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  let file = null;
  try { file = new File([blob], filename, { type: blob.type || 'application/octet-stream' }); } catch (e) { /* old browser */ }
  const canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  if (!TOUCH) { // PC: straight to the browser's Downloads folder
    saveByLink(url, filename);
    toast(`Saved to your Downloads folder: ${filename}`, 'ok', 6000);
    return;
  }
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  // LINE / some chat apps refuse .ifc, .html, .bcfzip… but accept .zip → prepare a zip copy now,
  // so the tap can open the Share sheet straight away (iPad needs the share call right after the tap)
  const isImage = /^image\//.test(blob.type) || /\.zip$/i.test(filename);
  let zipFile = null;
  const zipName = filename.replace(/\.[^.]+$/, '') + '.zip';
  if (canShare && !isImage) {
    import('jszip').then(async ({ default: JSZip }) => {
      const z = new JSZip(); z.file(filename, blob);
      const zb = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      zipFile = new File([zb], zipName, { type: 'application/zip' });
      const b = document.getElementById('dl-zip'); if (b) { b.disabled = false; b.querySelector('span').textContent = `Send as ZIP (${fmtSize(zb.size)})`; }
    }).catch(() => { const b = document.getElementById('dl-zip'); if (b) b.remove(); });
  }
  const share = async (f, c) => {
    try { await navigator.share({ files: [f], title: f.name }); c(); }
    catch (e) { if (e && e.name !== 'AbortError') toast(`Share failed (${e.name}) — try Download or Send as ZIP`, 'warn', 5000); }
  };
  const m = modal({
    title: 'File ready',
    body: `<p><b>${esc(filename)}</b> <span class="muted">· ${fmtSize(blob.size)}</span></p>
      <p class="muted">${canShare ? `<b>Save to Files</b> → keep it on the iPad (Files app) or AirDrop / Mail.` +
        (isImage ? '' : `<br><b>Send as ZIP</b> → for <b>LINE</b> and chat apps (they refuse .${esc(filename.split('.').pop())} files). Unzip on the PC.`) :
        'Tap <b>Download</b>. iPad: it goes to the Files app → <b>Downloads</b>. If the file opens instead, tap Share → Save to Files.'}</p>`,
    actions: [
      { label: 'Download', icon: 'export', kind: canShare ? '' : 'primary', onClick: (c) => { saveByLink(url, filename); c(); } },
      ...(canShare && !isImage ? [{ id: 'dl-zip', label: 'Preparing ZIP…', icon: 'send', onClick: (c) => zipFile && share(zipFile, c) }] : []),
      ...(canShare ? [{ label: 'Save to Files', icon: 'send', kind: 'primary', onClick: (c) => share(file, c) }] : [])
    ]
  });
  const zb = m.el.querySelector('#dl-zip');
  if (zb) { if (zipFile) zb.querySelector('span').textContent = `Send as ZIP (${fmtSize(zipFile.size)})`; else zb.disabled = true; }
}

export function fileToDataURL(file, maxSize = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read image')); };
    img.src = url;
  });
}
