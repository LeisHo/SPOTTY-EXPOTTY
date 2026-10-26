// Audio-feature filter: tempo, valence, danceability and energy ranges (the Filter button under Shuffle).
//
// The slider bounds are the dataset's own min and max. A song "passes" when every feature that has been narrowed
// (its range is smaller than the dataset's) contains the song's value. Songs with no value for a narrowed feature
// follow the "Songs With No Audio Data" setting (hide = they fail). Nothing is removed from the timeline: failing
// songs are drawn gray and are not played (main.js / timeline.js use passes(i)).
import { setting } from './settings.js';

const FEATURES = [
    { key: 'tp', label: 'Tempo', unit: ' BPM', step: 1, dp: 0 },
    { key: 'v', label: 'Valence', unit: '', step: 0.01, dp: 2 },
    { key: 'dn', label: 'Danceability', unit: '', step: 0.01, dp: 2 },
    { key: 'e', label: 'Energy', unit: '', step: 0.01, dp: 2 },
];
const STORE = 'spxFilter';

// tempo 0 is Spotify's "no data" placeholder, so it counts as missing like a null does
const valueOf = (s, k) => { const v = s[k]; return typeof v === 'number' && !(k === 'tp' && v <= 0) ? v : null; };

export function createFilter(songs, { host, onChange }) {
    // dataset extents
    const ext = {};
    FEATURES.forEach(f => {
        let lo = Infinity, hi = -Infinity;
        songs.forEach(s => { const v = valueOf(s, f.key); if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        ext[f.key] = f.key === 'tp' ? [Math.floor(lo), Math.ceil(hi)] : [lo, hi];
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
    panel.innerHTML = '<div class="spx-flt-head"><span>FILTER</span><button type="button" class="spx-flt-clear">Clear</button></div><div class="spx-flt-rows"></div><div class="spx-flt-count"></div>';
    host.appendChild(panel);
    const rowsEl = panel.querySelector('.spx-flt-rows'), countEl = panel.querySelector('.spx-flt-count');
    const rows = {};
    const fmt = (f, v) => v.toFixed(f.dp) + f.unit;

    FEATURES.forEach(f => {
        const [lo, hi] = ext[f.key];
        const row = document.createElement('div');
        row.className = 'spx-flt-row';
        row.innerHTML = `<div class="spx-flt-top"><span>${f.label}</span><span class="spx-flt-val"></span></div>
            <div class="spx-flt-range"><div class="spx-flt-track"><div class="spx-flt-fill"></div></div>
            <input type="range" class="spx-flt-min" min="${lo}" max="${hi}" step="${f.key === 'tp' ? 1 : 'any'}" aria-label="${f.label} minimum">
            <input type="range" class="spx-flt-max" min="${lo}" max="${hi}" step="${f.key === 'tp' ? 1 : 'any'}" aria-label="${f.label} maximum"></div>`;
        rowsEl.appendChild(row);
        const r = rows[f.key] = { f, row, val: row.querySelector('.spx-flt-val'), fill: row.querySelector('.spx-flt-fill'), min: row.querySelector('.spx-flt-min'), max: row.querySelector('.spx-flt-max') };
        const fromInputs = which => {
            let a = parseFloat(r.min.value), b = parseFloat(r.max.value);
            if (a > b) { if (which === 'min') a = b; else b = a; }
            range[f.key] = [a, b];
            refresh(); commit();
        };
        r.min.addEventListener('input', () => fromInputs('min'));
        r.max.addEventListener('input', () => fromInputs('max'));
    });
    function refresh() {
        FEATURES.forEach(f => {
            const r = rows[f.key], [lo, hi] = ext[f.key], [a, b] = range[f.key];
            r.min.value = a; r.max.value = b;
            r.val.textContent = fmt(f, a) + ' - ' + fmt(f, b);
            const span = hi - lo || 1;
            r.fill.style.left = ((a - lo) / span * 100) + '%';
            r.fill.style.width = ((b - a) / span * 100) + '%';
            r.row.classList.toggle('on', narrowed(f));
        });
        const n = countPassing();
        countEl.textContent = setting('checkboxFilterShowCount') ? (active() ? `${n} of ${songs.length} songs match` : `${songs.length} songs (no filter)`) : '';
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
