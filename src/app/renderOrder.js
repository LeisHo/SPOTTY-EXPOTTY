// Render order + visibility of everything on screen (dev panel > UI Layout > Visibility / Render Order).
// The dev panel's item selector saves its state as JSON in the control `listPickerRenderOrder`:
//   { items: [{ key, name, on, group? }], groupOrder: [top-level group names] }
// The list reads top to bottom as FRONT to BACK, exactly as the selector draws it: the items that are not in a group first, then each group (items first, then its
// subgroups). flatten() below repeats that reading, so what the panel shows is what renders. Each item gets a z-index (10 per step); `isOn(key)` is the item's checkbox.
// Items that have their own "Enabled" checkbox in the panel are linked to it by the panel (both ways); the others (`OWN_VISIBILITY`) are hidden here.
import { setting } from './settings.js';

// Same keys, same default order as RO_ITEMS in src/devpanel/devPanel.js (front to back).
export const DEFAULT_KEYS = ['volume', 'shuffle', 'songdatabtn', 'filter', 'search', 'device', 'nav', 'songbar', 'scrub', 'songdata', 'date', 'scale', 'graph', 'meta', 'artist', 'title', 'play', 'cover', 'ticks', 'bgfx', 'bg'];
// Items whose visibility the panel does NOT link to another checkbox: renderOrder hides them (the timeline's own layers are handled in timeline.js).
const HIDDEN_BY_CLASS = { volume: ['spxVolume'], nav: ['spxPrev', 'spxNext'], cover: ['spxCover'], bg: ['spxBg', 'spxBgPrev'], bgfx: ['spxBgFx'] };
const Z_OF = { volume: ['spxVolume'], shuffle: ['spxShuffle'], songdatabtn: ['spxSongData'], filter: ['spxFilter'], search: ['spxSearch'], device: ['spxDevice'], nav: ['spxPrev', 'spxNext'], songbar: ['spxSongBar'], graph: ['spxTimeline'], bg: ['spxBg'],
    meta: ['spxMeta'], artist: ['spxArtist'], title: ['spxTitle'], play: ['spxPlayGlyph'], cover: ['spxCover'], bgfx: ['spxBgFx'] };
// Deployed (non-dev) mode: the Deployed list has no linked Enabled checkboxes, so these items are hidden here too (on top of their own Enabled checkbox).
const DEPLOYED_HIDE = { shuffle: ['spxShuffle'], songdatabtn: ['spxSongData'], filter: ['spxFilter'], search: ['spxSearch'], device: ['spxDevice'], songbar: ['spxSongBar'], meta: ['spxMeta'], artist: ['spxArtist'], title: ['spxTitle'], play: ['spxPlayGlyph'] };
const isDev = () => document.documentElement.classList.contains('dev-mode');
const SEP = '/';

let state = new Map(); // key -> { z, on }

function flatten(items, groupOrder, topOrder) {
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
    const walk = (n, out) => { n.items.forEach(i => out.push(i)); n.children.forEach(c => walk(c, out)); };
    const out = [];
    if (Array.isArray(topOrder)) { // single items and groups interleaved, as the selector shows them
        const singles = new Map(ungrouped.map(i => [i.key, i])), seen = new Set();
        topOrder.forEach(t => {
            if (typeof t !== 'string') return;
            if (t.startsWith('g:') && root.children.has(t.slice(2)) && !seen.has(t)) { seen.add(t); walk(root.children.get(t.slice(2)), out); }
            else if (t.startsWith('i:') && singles.has(t.slice(2)) && !seen.has(t)) { seen.add(t); out.push(singles.get(t.slice(2))); }
        });
        ungrouped.forEach(i => { if (!seen.has('i:' + i.key)) out.push(i); });
        top.forEach(n => { if (!seen.has('g:' + n)) walk(root.children.get(n), out); });
        return out;
    }
    ungrouped.forEach(i => out.push(i));
    top.forEach(name => walk(root.children.get(name), out));
    return out;
}

// Reads the saved / live list again. Cheap: the list is ~20 items.
export function refresh() {
    const read = id => { let v = setting(id); if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } } return v && Array.isArray(v.items) ? v : null; };
    // Dev mode reads the "Visibility / Render Order" list, a normal visitor the "Deployed" list under it (until one has been saved, the visitor gets the dev list).
    let parsed = isDev() ? read('listPickerRenderOrder') : (read('listPickerRenderOrderDeployed') || read('listPickerRenderOrder'));
    const items = parsed && Array.isArray(parsed.items) ? parsed.items.filter(it => it && DEFAULT_KEYS.includes(it.key)) : [];
    const seen = new Set(items.map(it => it.key));
    // an item the saved list has never heard of goes right after the item before it in the default order (and into that item's group), not behind everything
    DEFAULT_KEYS.forEach((k, ki) => {
        if (seen.has(k)) return;
        const prev = ki > 0 ? items.findIndex(it => it.key === DEFAULT_KEYS[ki - 1]) : -1;
        items.splice(prev + 1, 0, { key: k, on: true, ...(prev >= 0 && items[prev].group ? { group: items[prev].group } : {}) });
        seen.add(k);
    });
    const ordered = flatten(items, parsed && parsed.groupOrder, parsed && parsed.topOrder);
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
    const dep = !isDev();
    Object.entries(DEPLOYED_HIDE).forEach(([key, ids]) => ids.forEach(id => { const e = $(id); if (e) e.classList.toggle('ro-off', dep && !isOn(key)); }));
}
