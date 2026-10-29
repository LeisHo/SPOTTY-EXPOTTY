// Import button-icon SVG files from the dev panel (the button next to every icon dropdown).
// An imported file becomes an entry in that dropdown's icon list (named after the file, without ".svg"); a file whose name already exists in the list
// overwrites that entry in place. The imported / overwritten icons are kept in `custom` and travel with the dev panel's Sync (extra.customIcons) and in
// localStorage, so a reload keeps them and a normal visitor sees them too (main.js applies the saved ones before the first draw).
// Same reading rules as scripts/active/build_button_icons.js: filled shapes, a white shape is a cut-out (merged with the even-odd rule), "none" is skipped.
// Added: shape / group transforms are kept, and the file's viewBox is scaled onto the 42.52 box the icons are drawn on.
import { BUTTON_ICONS, ICON_BOX } from './buttonIcons.js';
import { bumpIconRevision } from './iconStyles.js';

const LS_KEY = 'spxCustomIcons';
let custom = {}; // key -> { name: shapes }

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const isWhite = f => /^(#fff|#ffffff|white|rgb\(255,\s*255,\s*255\))$/i.test(f || '');

function fillOf(el, cls) {
    const st = (el.getAttribute('style') || '');
    const m = st.match(/fill:\s*([^;]+)/);
    if (m) return m[1].trim();
    if (el.hasAttribute('fill')) return el.getAttribute('fill').trim();
    const c = (el.getAttribute('class') || '').split(/\s+/).map(x => cls[x]).filter(Boolean).pop();
    return c && c.fill ? c.fill : '#000';
}
function evenOddOf(el, cls) {
    if (/fill-rule:\s*evenodd/.test(el.getAttribute('style') || '') || el.getAttribute('fill-rule') === 'evenodd') return true;
    return (el.getAttribute('class') || '').split(/\s+/).some(x => cls[x] && cls[x].eo);
}
const transformChain = (el, root) => { const t = []; for (let n = el; n && n !== root.parentNode; n = n.parentNode) { const a = n.getAttribute && n.getAttribute('transform'); if (a) t.unshift(a); } return t.join(' '); };

function shapeD(el) {
    const tag = el.tagName.toLowerCase(), a = k => num(el.getAttribute(k));
    if (tag === 'path') return el.getAttribute('d');
    if (tag === 'polygon') { const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); if (p.length < 4) return null; let d = 'M' + p[0] + ' ' + p[1]; for (let i = 2; i + 1 < p.length; i += 2) d += 'L' + p[i] + ' ' + p[i + 1]; return d + 'Z'; }
    if (tag === 'rect') { const x = a('x'), y = a('y'), w = a('width'), h = a('height'); return w > 0 && h > 0 ? `M${x} ${y}h${w}v${h}h${-w}z` : null; }
    if (tag === 'circle') { const cx = a('cx'), cy = a('cy'), r = a('r'); return r > 0 ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z` : null; }
    if (tag === 'ellipse') { const cx = a('cx'), cy = a('cy'), rx = a('rx'), ry = a('ry'); return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z` : null; }
    return null;
}

// -> [[pathData, evenOdd, transform?], ...] or [] when the file has no usable shapes
export function parseSvgIcon(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return [];
    const cls = {};
    for (const st of doc.querySelectorAll('style')) for (const m of st.textContent.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
        const f = (m[2].match(/fill:\s*([^;\s]+)/) || [])[1];
        cls[m[1]] = { fill: f, eo: /fill-rule:\s*evenodd/.test(m[2]) };
    }
    // scale the file's own box onto the 42.52 box (centred); a file already on 42.52 x 42.52 from 0,0 needs nothing
    let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(v => !Number.isFinite(v))) vb = [0, 0, num(svg.getAttribute('width')) || ICON_BOX, num(svg.getAttribute('height')) || ICON_BOX];
    const [vx, vy, vw, vh] = vb;
    let root = '';
    if (vw > 0 && vh > 0 && !(Math.abs(vw - ICON_BOX) < 0.5 && Math.abs(vh - ICON_BOX) < 0.5 && !vx && !vy)) {
        const s = ICON_BOX / Math.max(vw, vh);
        root = `translate(${((ICON_BOX - vw * s) / 2 - vx * s).toFixed(4)} ${((ICON_BOX - vh * s) / 2 - vy * s).toFixed(4)}) scale(${s.toFixed(5)})`;
    }
    const shapes = [];
    for (const el of svg.querySelectorAll('path, polygon, rect, circle, ellipse')) {
        if (el.closest('defs, clipPath, mask, symbol')) continue;
        const d = shapeD(el); if (!d) continue;
        const fill = fillOf(el, cls).toLowerCase();
        if (fill === 'none') continue;
        shapes.push({ d, fill, eo: evenOddOf(el, cls), t: [root, transformChain(el, svg)].filter(Boolean).join(' ') });
    }
    const dark = shapes.filter(x => !isWhite(x.fill)), white = shapes.filter(x => isWhite(x.fill));
    if (white.length && white.every(x => x.t === dark[0]?.t) && dark.every(x => x.t === dark[0].t)) { // cut-outs: one even-odd path (shapes that all share one transform)
        const t = dark[0].t;
        return [[dark.concat(white).map(x => x.d).join(''), 1].concat(t ? [t] : [])];
    }
    return dark.map(x => [x.d, x.eo ? 1 : 0].concat(x.t ? [x.t] : []));
}

const listOf = key => BUTTON_ICONS[key];
export const iconKeys = () => Object.keys(BUTTON_ICONS);
export const iconNames = key => (listOf(key) || []).map(it => it.n);

function put(key, name, p) {
    const list = listOf(key); if (!list) return null;
    const at = list.findIndex(it => it.n === name);
    if (at >= 0) { list[at] = { n: name, p, custom: true }; return { index: at, overwritten: true }; }
    list.push({ n: name, p, custom: true });
    return { index: list.length - 1, overwritten: false };
}

// Reads the chosen files into the list for `key`. Returns { added, overwritten, failed, firstIndex }.
export async function importIconFiles(key, files) {
    const res = { added: [], overwritten: [], failed: [], firstIndex: -1 };
    for (const f of Array.from(files)) {
        const name = f.name.replace(/\.[^.]*$/, '');
        try {
            if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') throw new Error('not an SVG');
            const p = parseSvgIcon(await f.text());
            if (!p.length) throw new Error('no shapes');
            const r = put(key, name, p);
            (custom[key] = custom[key] || {})[name] = p;
            (r.overwritten ? res.overwritten : res.added).push(name);
            if (res.firstIndex < 0) res.firstIndex = r.index;
        } catch (e) { res.failed.push(f.name + ' (' + e.message + ')'); }
    }
    if (res.added.length || res.overwritten.length) { persistLocal(); bumpIconRevision(); }
    return res;
}

// What Sync saves: { key: [{ n, p }, ...] }
export function captureCustomIcons() {
    const out = {};
    for (const [key, byName] of Object.entries(custom)) out[key] = Object.entries(byName).map(([n, p]) => ({ n, p }));
    return out;
}
// Applies saved icons (from the settings file or localStorage) to the lists; later calls win over earlier ones for the same name.
export function applyCustomIcons(data) {
    if (!data || typeof data !== 'object') return;
    for (const [key, items] of Object.entries(data)) {
        if (!listOf(key) || !Array.isArray(items)) continue;
        for (const it of items) if (it && typeof it.n === 'string' && Array.isArray(it.p) && it.p.length) { put(key, it.n, it.p); (custom[key] = custom[key] || {})[it.n] = it.p; }
    }
    bumpIconRevision();
    if (typeof window.spxRefreshIconSelects === 'function') window.spxRefreshIconSelects();
}
function persistLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(captureCustomIcons())); } catch (e) { /* storage blocked or full */ } }
try { const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (d) { for (const [key, items] of Object.entries(d)) if (listOf(key) && Array.isArray(items)) for (const it of items) if (it && it.n && Array.isArray(it.p) && it.p.length) { put(key, it.n, it.p); (custom[key] = custom[key] || {})[it.n] = it.p; } } } catch (e) { /* unreadable */ }

// the dev panel (a classic script) reaches the importer through this global
window.SPX_ICON_IMPORT = { importFiles: importIconFiles, names: iconNames, keys: iconKeys, capture: captureCustomIcons, apply: applyCustomIcons };
