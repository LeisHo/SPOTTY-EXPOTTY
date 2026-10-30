// Render order + visibility of everything on screen (dev panel > UI Layout > Visibility / Render Order).
// The dev panel's item selector saves its state as JSON in the control `listPickerRenderOrder`:
//   { items: [{ key, name, on, group? }], groupOrder: [top-level group names] }
// The list reads top to bottom as FRONT to BACK, exactly as the selector draws it: the items that are not in a group first, then each group (items first, then its
// subgroups). flatten() below repeats that reading, so what the panel shows is what renders. Each item gets a z-index (10 per step); `isOn(key)` is the item's checkbox.
// Items that have their own "Enabled" checkbox in the panel are linked to it by the panel (both ways); the others (`OWN_VISIBILITY`) are hidden here.
import { setting } from './settings.js';

// Same keys, same default order as RO_ITEMS in src/devpanel/devPanel.js (front to back).
export const DEFAULT_KEYS = ['volume', 'shuffle', 'songdatabtn', 'filter', 'nav', 'songbar', 'scrub', 'songdata', 'date', 'scale', 'graph', 'meta', 'artist', 'title', 'play', 'cover', 'ticks', 'bgfx', 'bg'];
// Items whose visibility the panel does NOT link to another checkbox: renderOrder hides them (the timeline's own layers are handled in timeline.js).
const HIDDEN_BY_CLASS = { volume: ['spxVolume'], nav: ['spxPrev', 'spxNext'], cover: ['spxCover'], bg: ['spxBg', 'spxBgPrev'], bgfx: ['spxBgFx'] };
const Z_OF = { volume: ['spxVolume'], shuffle: ['spxShuffle'], songdatabtn: ['spxSongData'], filter: ['spxFilter'], nav: ['spxPrev', 'spxNext'], songbar: ['spxSongBar'], graph: ['spxTimeline'], bg: ['spxBg'],
    meta: ['spxMeta'], artist: ['spxArtist'], title: ['spxTitle'], play: ['spxPlayGlyph'], cover: ['spxCover'], bgfx: ['spxBgFx'] };
const SEP = '/';

let state = new Map(); // key -> { z, on }

function flatten(items, groupOrder) {
    const root = { items: [], children: new Map() }, ungrouped = [], discovery = [];
    const nodeOf = segs => segs.reduce((n, s) => { if (!n.children.has(s)) n.children.set(s, { items: [], children: new Map() }); return n.children.get(s); }, root);
    items.forEach(it => {
        if (!it.group) { ungrouped.push(it); return; }
        const segs = it.group.split(SEP);
        if (!root.children.has(segs[0])) discovery.push(segs[0]);
        nodeOf(segs).items.push(it);
    });
    const known = new Set(groupOrder || []);
    const top = (groupOrder || []).filter(n => root.children.has(n));
    discovery.forEach(n => { if (!known.has(n)) top.push(n); });
    const out = ungrouped.slice();
    const walk = n => { n.items.forEach(i => out.push(i)); n.children.forEach(walk); };
    top.forEach(name => walk(root.children.get(name)));
    return out;
}

// Reads the saved / live list again. Cheap: the list is ~20 items.
export function refresh() {
    let parsed = setting('listPickerRenderOrder');
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; } }
    const items = parsed && Array.isArray(parsed.items) ? parsed.items.filter(it => it && DEFAULT_KEYS.includes(it.key)) : [];
    const seen = new Set(items.map(it => it.key));
    DEFAULT_KEYS.forEach(k => { if (!seen.has(k)) items.push({ key: k, on: true }); }); // an item the saved list has never heard of goes to the back
    const ordered = flatten(items, parsed && parsed.groupOrder);
    const next = new Map();
    ordered.forEach((it, i) => next.set(it.key, { z: (ordered.length - i) * 10, on: it.on !== false }));
    state = next;
}
export const zFor = key => (state.get(key) || { z: 10 }).z;
export const isOn = key => (state.get(key) || { on: true }).on;

// Writes the z-index of every element that is one DOM node per item, and hides the items nothing else hides.
export function applyRenderOrder() {
    refresh();
    const $ = id => document.getElementById(id);
    Object.entries(Z_OF).forEach(([key, ids]) => ids.forEach(id => { const e = $(id); if (e) e.style.zIndex = String(zFor(key)); }));
    const bgPrev = $('spxBgPrev');
    if (bgPrev) bgPrev.style.zIndex = String(zFor('bg') + 1); // the previous frame fades out ABOVE the new one
    Object.entries(HIDDEN_BY_CLASS).forEach(([key, ids]) => ids.forEach(id => { const e = $(id); if (e) e.classList.toggle('ro-off', !isOn(key)); }));
}
