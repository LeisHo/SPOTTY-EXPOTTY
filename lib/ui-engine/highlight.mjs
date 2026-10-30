// ui-layout-engine — Inspector geometry highlight (added in SPOTTY EXPOTTY first, 2026-10-30; port to the canonical engine once the owner has tried it).
//
// While an element is selected in the Inspector, this draws, on top of the page, the geometry its position mode and size modes actually use — measured from the real DOM
// boxes, so it shows what the browser did, not what the config says:
//   cyan     the selected element: its box, the edge(s) it is anchored by
//   magenta  what it is anchored to: the containing block / viewport / target element / parent: its box, the matching edge(s)
//   yellow   a crosshair on every anchor POINT (a corner, an edge midpoint or a centre is a point, not a line), on both sides
//   orange   the offset between the two points (dashed), with the numbers
//   red      keepInside constraints
// Position modes: anchor (containing block edges), fixed (viewport edges), relative (the target element's edge / corner / centre against this element's), absolute (the
// containing block's origin and the x / y it is moved by), flow (the parent). Size modes, per axis: fixed / clamp / content / fill / aspect / match (the element it follows).
//
// Pure DOM + SVG, no dependencies. The overlay never takes pointer events. It redraws every animation frame while an element is selected and the Inspector is visible,
// but only rebuilds the SVG when a measured number changed.
import { getElement, getEffectiveValue, getActiveContext } from './registry.mjs';

const NS = 'http://www.w3.org/2000/svg';
const COL = { me: '#00e5ff', target: '#ff2bd6', point: '#ffe600', offset: '#ff9f1a', warn: '#ff5555' };
const STORE_KEY = 'uiEngineHighlight';

let svg = null, raf = 0, currentId = null, lastKey = '', visibleCheck = () => true;
let enabled = true;
try { enabled = localStorage.getItem(STORE_KEY) !== '0'; } catch (e) { /* storage blocked: stay on */ }

export const isHighlightEnabled = () => enabled;
export function setHighlightEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
  lastKey = '';
  if (!enabled) clear(); else if (currentId) start();
}
// The Inspector tells this module how to know it is on screen (a hidden panel must not leave highlights behind).
export function setHighlightVisibleCheck(fn) { visibleCheck = fn || (() => true); }
export function setHighlightTarget(id) {
  currentId = id || null;
  lastKey = '';
  if (!currentId) { stop(); return; }
  if (enabled) start();
}
export function stopHighlight() { currentId = null; stop(); }

function start() { if (!raf) raf = requestAnimationFrame(tick); }
function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; clear(); }
function clear() { if (svg) { svg.replaceChildren(); lastKey = ''; } }
function tick() {
  raf = 0;
  if (!enabled || !currentId) return;
  try { if (visibleCheck()) draw(); else clear(); } catch (e) { clear(); }
  raf = requestAnimationFrame(tick);
}

function ensureSvg() {
  if (svg && svg.isConnected) return svg;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ui-highlight-overlay');
  svg.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;overflow:visible;z-index:2147481900';
  document.body.appendChild(svg);
  return svg;
}

// ---- geometry helpers ------------------------------------------------------------------------------------------------------
const rectOf = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
const viewportRect = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight });
// 'top-center', 'center-right', 'center', 'bottom-left' ... -> which edge on each axis (center = the middle line)
function parseAnchor(s) {
  const t = String(s || 'top-left').split('-');
  return { v: t.includes('top') ? 'top' : t.includes('bottom') ? 'bottom' : 'center', h: t.includes('left') ? 'left' : t.includes('right') ? 'right' : 'center' };
}
const px = (r, h) => (h === 'left' ? r.left : h === 'right' ? r.right : (r.left + r.right) / 2);
const py = (r, v) => (v === 'top' ? r.top : v === 'bottom' ? r.bottom : (r.top + r.bottom) / 2);
const r1 = n => Math.round(n * 10) / 10;

// ---- drawing: every primitive appends to `out` (an array of SVG strings), the whole SVG is set in one go ---------------------
function build(el, rect) {
  const out = [];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rectS = (r, color, o = {}) => out.push(`<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="${o.fill || 'none'}" stroke="${color}" stroke-width="${o.w || 2}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  const lineS = (x1, y1, x2, y2, color, o = {}) => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${o.w || 2}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  const label = (x, y, text, color) => {
    const w = text.length * 6.4 + 8;
    const lx = Math.max(2, Math.min(innerWidth - w - 2, x)), ly = Math.max(14, Math.min(innerHeight - 4, y));
    out.push(`<rect x="${lx - 2}" y="${ly - 11}" width="${w}" height="14" rx="3" fill="#000d"/><text x="${lx + 2}" y="${ly}" font-family="monospace" font-size="11" fill="${color}">${esc(text)}</text>`);
  };
  // a point: a crosshair with a ring (an origin / corner / centre is a POINT, not a line)
  const cross = (x, y, color = COL.point) => {
    out.push(`<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="1.6" fill="${color}"/>`);
    lineS(x - 13, y, x + 13, y, color, { w: 1.5 }); lineS(x, y - 13, x, y + 13, color, { w: 1.5 });
  };
  // the edge(s) an anchor uses: a side is a thick line along that whole edge, a centre is a dashed line through the middle; the point itself gets a crosshair
  const edges = (r, a, color) => {
    if (a.h !== 'center') lineS(px(r, a.h), r.top, px(r, a.h), r.bottom, color, { w: 4 }); else lineS(px(r, 'center'), r.top, px(r, 'center'), r.bottom, color, { w: 2, dash: '8 5' });
    if (a.v !== 'center') lineS(r.left, py(r, a.v), r.right, py(r, a.v), color, { w: 4 }); else lineS(r.left, py(r, 'center'), r.right, py(r, 'center'), color, { w: 2, dash: '8 5' });
    cross(px(r, a.h), py(r, a.v));
  };
  // a dimension line along one axis, with end ticks and a label
  const dim = (axis, r, color, text, offset) => {
    if (axis === 'width') { const y = r.top - offset; lineS(r.left, y, r.right, y, color, { w: 1.5 }); lineS(r.left, y - 5, r.left, y + 5, color, { w: 1.5 }); lineS(r.right, y - 5, r.right, y + 5, color, { w: 1.5 }); label((r.left + r.right) / 2 - text.length * 3, y - 4, text, color); }
    else { const x = r.left - offset; lineS(x, r.top, x, r.bottom, color, { w: 1.5 }); lineS(x - 5, r.top, x + 5, r.top, color, { w: 1.5 }); lineS(x - 5, r.bottom, x + 5, r.bottom, color, { w: 1.5 }); label(x - text.length * 6.4 - 12, (r.top + r.bottom) / 2 + 4, text, color); }
  };
  const ctx = getActiveContext();
  const eff = f => { const r = getEffectiveValue(el.id, f, ctx); return r && typeof r === 'object' && 'value' in r ? r.value : r; }; // getEffectiveValue returns { value, ... }
  const pos = el.layout.position || {}, mode = pos.mode;
  const refRect = id => { const t = id && getElement(id); return t && t.domNode ? rectOf(t.domNode) : null; };

  rectS(rect, COL.me, { w: 2.5 });
  label(rect.left, rect.top - 6, `${el.group ? el.group + ' · ' : ''}${el.id}  [${mode}${ctx !== 'base' ? ', ' + ctx : ''}]`, COL.me);

  if (mode === 'anchor' || mode === 'fixed') {
    const cb = mode === 'fixed' ? viewportRect() : (el.domNode.offsetParent ? rectOf(el.domNode.offsetParent) : viewportRect());
    let a;
    if (mode === 'fixed') a = parseAnchor(eff('viewportAnchor'));
    else a = { h: eff('anchorH') || 'left', v: eff('anchorV') || 'top' };
    rectS(cb, COL.target, { dash: '10 6', w: 2 });
    label(cb.left + 4, cb.top + 14, mode === 'fixed' ? 'viewport' : 'containing block', COL.target);
    edges(cb, a, COL.target);
    edges(rect, a, COL.me);
    const dx = px(rect, a.h) - px(cb, a.h), dy = py(rect, a.v) - py(cb, a.v);
    lineS(px(cb, a.h), py(cb, a.v), px(rect, a.h), py(cb, a.v), COL.offset, { w: 2, dash: '5 4' });
    lineS(px(rect, a.h), py(cb, a.v), px(rect, a.h), py(rect, a.v), COL.offset, { w: 2, dash: '5 4' });
    label(px(rect, a.h) + 8, py(rect, a.v) + 16, `anchor ${a.v}-${a.h}   x ${r1(dx)}px  y ${r1(dy)}px`, COL.offset);
  } else if (mode === 'relative') {
    const tgt = refRect(eff('relativeTo'));
    const my = parseAnchor(eff('myAnchor')), ta = parseAnchor(eff('targetAnchor'));
    if (tgt) {
      rectS(tgt, COL.target, { dash: '10 6', w: 2 });
      label(tgt.left + 4, tgt.bottom + 14, `target: ${eff('relativeTo')}`, COL.target);
      edges(tgt, ta, COL.target);
      edges(rect, my, COL.me);
      const tx = px(tgt, ta.h), ty = py(tgt, ta.v), mx = px(rect, my.h), my2 = py(rect, my.v);
      lineS(tx, ty, mx, my2, COL.offset, { w: 2, dash: '5 4' });
      label((tx + mx) / 2 + 8, (ty + my2) / 2 + 16, `mine ${my.v}-${my.h} -> target ${ta.v}-${ta.h}   x ${r1(mx - tx)}px  y ${r1(my2 - ty)}px`, COL.offset);
    } else label(rect.left, rect.bottom + 16, 'relative: the target element was not found', COL.warn);
  } else if (mode === 'absolute') {
    const cbEl = eff('containingBlock') && getElement(eff('containingBlock'));
    const cb = cbEl && cbEl.domNode ? rectOf(cbEl.domNode) : (el.domNode.offsetParent ? rectOf(el.domNode.offsetParent) : viewportRect());
    rectS(cb, COL.target, { dash: '10 6', w: 2 });
    label(cb.left + 4, cb.top + 14, `containing block${cbEl ? ': ' + cbEl.id : ''}`, COL.target);
    cross(cb.left, cb.top, COL.target); // the origin x / y count from
    lineS(cb.left, cb.top, rect.left, cb.top, COL.offset, { w: 2, dash: '5 4' });
    lineS(rect.left, cb.top, rect.left, rect.top, COL.offset, { w: 2, dash: '5 4' });
    cross(rect.left, rect.top, COL.me);
    label(rect.left + 8, rect.top + 16, `origin ${r1(rect.left - cb.left)}px, ${r1(rect.top - cb.top)}px`, COL.offset);
  } else if (mode === 'flow') {
    const par = refRect(eff('parent')) || (el.domNode.parentElement ? rectOf(el.domNode.parentElement) : null);
    if (par) { rectS(par, COL.target, { dash: '10 6', w: 2 }); label(par.left + 4, par.top + 14, `flow parent${eff('parent') ? ': ' + eff('parent') : ''}`, COL.target); }
  }

  // ---- size: each axis shows its mode, and the geometry that mode refers to ----
  const size = el.layout.size || {};
  ['width', 'height'].forEach((axis, i) => {
    const s = size[axis] || { mode: 'content' }, m = s.mode || 'content';
    const px0 = Math.round((axis === 'width' ? rect.width : rect.height) * 10) / 10;
    let text = `${axis[0].toUpperCase()}: ${m} = ${px0}px`;
    if (m === 'fixed') text += `  (${eff(axis + 'Value')})`;
    if (m === 'clamp') text += `  (${eff(axis + 'Min')} / ${eff(axis + 'Preferred')} / ${eff(axis + 'Max')})`;
    if (m === 'aspect') text += `  (${eff(axis + 'Ratio')}, from ${eff(axis + 'Basis') || (axis === 'height' ? 'width' : 'height')})`;
    const off = 14 + i * 0;
    dim(axis, rect, COL.me, text, off);
    if (m === 'match') {
      const t = refRect(eff(axis + 'RelativeTo'));
      if (t) { rectS(t, COL.target, { dash: '3 4', w: 1.5 }); dim(axis, t, COL.target, `${axis[0].toUpperCase()} follows ${eff(axis + 'RelativeTo')} = ${r1(axis === 'width' ? t.width : t.height)}px`, 14); }
    } else if (m === 'aspect') {
      lineS(rect.left, rect.top, rect.right, rect.bottom, COL.me, { w: 1, dash: '4 4' });
    } else if (m === 'fill') {
      const par = el.domNode.offsetParent ? rectOf(el.domNode.offsetParent) : null;
      if (par) rectS(par, COL.target, { dash: '3 4', w: 1.5 });
    }
  });

  // ---- constraints ----
  if (eff('keepInsideViewport')) { rectS(viewportRect(), COL.warn, { dash: '2 5', w: 2 }); label(8, innerHeight - 8, 'keepInsideViewport', COL.warn); }
  if (eff('keepInsideParent') && el.domNode.parentElement) { const p = rectOf(el.domNode.parentElement); rectS(p, COL.warn, { dash: '2 5', w: 2 }); label(p.left + 4, p.bottom - 6, 'keepInsideParent', COL.warn); }

  label(8, 18, 'cyan = this element   magenta = what it is anchored to   yellow ✛ = anchor point   orange = offset   red = constraint', '#ddd');
  return out.join('');
}

function draw() {
  const el = getElement(currentId);
  if (!el || !el.domNode || !el.domNode.isConnected) { clear(); return; }
  const rect = rectOf(el.domNode);
  const html = (() => { try { return build(el, rect); } catch (e) { return ''; } })();
  if (html === lastKey) return;
  lastKey = html;
  ensureSvg().innerHTML = html;
}
