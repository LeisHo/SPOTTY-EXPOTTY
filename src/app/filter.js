// Audio-feature filter: tempo, valence, danceability and energy ranges (the Filter button under Shuffle).
//
// The slider bounds are the dataset's own min and max. A song "passes" when every feature that has been narrowed
// (its range is smaller than the dataset's) contains the song's value. Songs with no value for a narrowed feature
// follow the "Songs With No Audio Data" setting (hide = they fail). Nothing is removed from the timeline: failing
// songs are drawn gray and are not played (main.js / timeline.js use passes(i)).
import { setting } from './settings.js';

const FEATURES = [
    { key: 'tp', label: 'Tempo', unit: ' BPM', step: 'any', dp: 0 },
    { key: 'v', label: 'Valence', unit: '', step: 'any', dp: 1 },
    { key: 'dn', label: 'Danceability', unit: '', step: 'any', dp: 1 },
    { key: 'e', label: 'Energy', unit: '', step: 'any', dp: 1 },
];
const STORE = 'spxFilter';
// the panel shows an icon instead of each feature's name (the name is its tooltip)
export const FEATURE_ICON_PATHS = {} ; // filled below (the same icons are drawn on the timeline by the Song Data row)
const ICONS = {
    tp: '<path d="M8 21h8l-2.5-17h-3z"/><path d="M12 16l4.5-9"/><path d="M9.5 12h5"/>', // metronome
    v: '<circle cx="12" cy="12" r="9"/><path d="M8 14.2c1.2 2.2 6.8 2.2 8 0"/><path d="M9 9.8h.01M15 9.8h.01"/>', // smiley
    dn: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v6.5M6 4l6 5 6-5M12 14l-4 7M12 14l4 7"/>', // dancing figure
    e: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>', // lightning bolt
};

// tempo 0 is Spotify's "no data" placeholder, so it counts as missing like a null does
Object.assign(FEATURE_ICON_PATHS, ICONS);
// A row whose tempo, valence and danceability are all exactly 0 has no audio analysis (3 songs): those 3 values are missing, not real zeros.
const noAnalysis = s => s.tp === 0 && s.v === 0 && s.dn === 0;
const valueOf = (s, k) => { const v = s[k]; return typeof v === 'number' && !(k !== 'e' && noAnalysis(s)) && !(k === 'tp' && v <= 0) ? v : null; };

export function createFilter(songs, { host, onChange }) {
    // dataset extents
    const ext = {};
    FEATURES.forEach(f => {
        let lo = Infinity, hi = -Infinity;
        songs.forEach(s => { const v = valueOf(s, f.key); if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        ext[f.key] = [lo, hi]; // exactly the lowest and highest value present in the data
    });
    const range = {};
    FEATURES.forEach(f => { range[f.key] = ext[f.key].slice(); });
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (saved) FEATURES.forEach(f => {
            const r = saved[f.key];
            if (Array.isArray(r) && r.length === 2 && r.every(Number.isFinite)) range[f.key] = [Math.max(ext[f.key][0], Math.min(r[0], r[1])), Math.min(ext[f.key][1], Math.max(r[0], r[1]))];
        });
    } catch (e) { /* storage blocked or unreadable */ }

    const narrowed = f => range[f.key][0] > ext[f.key][0] || range[f.key][1] < ext[f.key][1];
    const active = () => FEATURES.some(narrowed);
    function passes(i) {
        const s = songs[i];
        for (const f of FEATURES) {
            if (!narrowed(f)) continue;
            const v = valueOf(s, f.key);
            if (v === null) { if (setting('selectFilterMissing') === 'hide') return false; continue; }
            if (v < range[f.key][0] - 1e-9 || v > range[f.key][1] + 1e-9) return false;
        }
        return true;
    }
    const countPassing = () => { let n = 0; for (let i = 0; i < songs.length; i++) if (passes(i)) n++; return n; };

    // ---- panel ----
    const panel = document.createElement('div');
    panel.className = 'spx-filter-panel';
    panel.id = 'spxFilterPanel';
    panel.hidden = true;
    panel.innerHTML = '<div class="spx-flt-head"><button type="button" class="spx-flt-clear" title="Clear filters" aria-label="Clear filters"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg></button></div><div class="spx-flt-rows"></div><div class="spx-flt-count"></div>';
    // Horizontal resize: two thin strips on the panel's left and right edges. They sit inside the panel's own padding, below the
    // sliders (z-index), and the slider rows start inside that padding, so a press that could be either is always the slider's.
    const WIDTH_KEY = 'spxFilterWidth', MIN_W = 160;
    ['l', 'r'].forEach(side => {
        const h = document.createElement('div');
        h.className = 'spx-flt-resize spx-flt-resize-' + side;
        h.title = 'Drag to resize (double-click to reset)';
        panel.appendChild(h);
        h.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            h.setPointerCapture(e.pointerId);
            const r0 = panel.getBoundingClientRect(), x0 = e.clientX;
            const move = ev => {
                const dx = ev.clientX - x0;
                let left = r0.left, w = side === 'r' ? r0.width + dx : r0.width - dx;
                w = Math.max(MIN_W, Math.min(window.innerWidth - 8, w));
                if (side === 'l') left = r0.right - w;
                if (left < 4) { left = 4; if (side === 'l') w = r0.right - 4; }
                if (left + w > window.innerWidth - 4) w = window.innerWidth - 4 - left;
                panel.style.width = w + 'px'; panel.style.left = left + 'px';
            };
            const up = () => {
                h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
                try { localStorage.setItem(WIDTH_KEY, String(Math.round(panel.getBoundingClientRect().width))); } catch (e2) { /* storage blocked */ }
            };
            h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
        });
        h.addEventListener('dblclick', () => { // back to the dev panel's Panel Width
            panel.style.width = '';
            try { localStorage.removeItem(WIDTH_KEY); } catch (e2) { /* storage blocked */ }
            onChange({ layout: true });
        });
    });
    try { const w = parseFloat(localStorage.getItem(WIDTH_KEY)); if (w >= MIN_W) panel.style.width = w + 'px'; } catch (e) { /* storage blocked */ }
    host.appendChild(panel);
    const rowsEl = panel.querySelector('.spx-flt-rows'), countEl = panel.querySelector('.spx-flt-count');
    const rows = {};
    const fmt = (f, v) => v.toFixed(f.dp) + f.unit;

    FEATURES.forEach(f => {
        const [lo, hi] = ext[f.key];
        const row = document.createElement('div');
        row.className = 'spx-flt-row';
        row.innerHTML = `<div class="spx-flt-top"><span class="spx-flt-ico" title="${f.label}" aria-label="${f.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[f.key]}</svg></span></div>
            <div class="spx-flt-range"><div class="spx-flt-track"><div class="spx-flt-fill"></div></div>
            <input type="range" class="spx-flt-min" min="${lo}" max="${hi}" step="any" aria-label="${f.label} minimum">
            <input type="range" class="spx-flt-max" min="${lo}" max="${hi}" step="any" aria-label="${f.label} maximum"></div>
            <div class="spx-flt-nums"><span class="spx-flt-lo"></span><span class="spx-flt-val"></span><span class="spx-flt-hi"></span></div>`;
        rowsEl.appendChild(row);
        const r = rows[f.key] = { f, row, lo: row.querySelector('.spx-flt-lo'), hi: row.querySelector('.spx-flt-hi'), val: row.querySelector('.spx-flt-val'), fill: row.querySelector('.spx-flt-fill'), min: row.querySelector('.spx-flt-min'), max: row.querySelector('.spx-flt-max') };
        const fromInputs = which => {
            let a = parseFloat(r.min.value), b = parseFloat(r.max.value);
            if (a > b) { if (which === 'min') a = b; else b = a; }
            range[f.key] = [a, b];
            refresh(); commit();
        };
        // A press on the track (not on a handle) moves the nearer handle there and keeps dragging it.
        const rangeEl = row.querySelector('.spx-flt-range');
        const valAt = x => { const b = rangeEl.getBoundingClientRect(), t = Math.min(1, Math.max(0, (x - b.left) / (b.width || 1))), v = lo + t * (hi - lo); return v; };
        rangeEl.addEventListener('pointerdown', e => {
            if (e.target.tagName === 'INPUT') return; // a handle: the browser drags it
            e.preventDefault();
            const v0 = valAt(e.clientX), which = Math.abs(v0 - range[f.key][0]) <= Math.abs(v0 - range[f.key][1]) ? 'min' : 'max';
            const el = which === 'min' ? r.min : r.max;
            const move = ev => { el.value = valAt(ev.clientX); fromInputs(which); };
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
            move(e);
        });
        r.min.addEventListener('input', () => fromInputs('min'));
        r.max.addEventListener('input', () => fromInputs('max'));
    });
    function refresh() {
        FEATURES.forEach(f => {
            const r = rows[f.key], [lo, hi] = ext[f.key], [a, b] = range[f.key];
            r.min.value = a; r.max.value = b;
            r.val.textContent = fmt(f, a) + ' - ' + fmt(f, b);
            r.lo.textContent = lo.toFixed(f.dp); r.hi.textContent = hi.toFixed(f.dp); // the dataset's own lowest / highest value at the two ends
            const span = hi - lo || 1;
            r.fill.style.left = ((a - lo) / span * 100) + '%';
            r.fill.style.width = ((b - a) / span * 100) + '%';
            r.row.classList.toggle('on', narrowed(f));
        });
        panel.classList.toggle('no-nums', !setting('checkboxFilterShowNumbers'));
        countEl.style.display = setting('checkboxFilterShowCount') ? '' : 'none';
        if (setting('checkboxFilterShowCount')) countEl.textContent = countPassing() + '/' + songs.length + ' songs';
    }
    function commit() {
        try { localStorage.setItem(STORE, JSON.stringify(range)); } catch (e) { /* storage blocked */ }
        onChange();
    }
    panel.querySelector('.spx-flt-clear').addEventListener('click', () => { clear(); });
    function clear() { FEATURES.forEach(f => { range[f.key] = ext[f.key].slice(); }); refresh(); commit(); }
    refresh();

    return {
        panel, passes, active, countPassing, clear, refresh, ext, range,
        get open() { return !panel.hidden; },
        setOpen(v) { panel.hidden = !v; if (v) refresh(); },
        describe() { return FEATURES.filter(narrowed).map(f => `${f.label} ${fmt(f, range[f.key][0])}-${fmt(f, range[f.key][1])}`).join(', ') || 'none'; },
    };
}
