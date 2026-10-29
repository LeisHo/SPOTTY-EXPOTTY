// Audio-feature filter: tempo, valence, danceability and energy ranges (the Filter button under Shuffle).
//
// The slider bounds are the dataset's own min and max. A song "passes" when every feature that has been narrowed
// (its range is smaller than the dataset's) contains the song's value. Songs with no value for a narrowed feature
// follow the "Songs With No Audio Data" setting (hide = they fail). Nothing is removed from the timeline: failing
// songs are drawn gray and are not played (main.js / timeline.js use passes(i)).
import { setting } from './settings.js';
import { cleanTitle } from './title.mjs';
import { featureIconHtml, customIconHtml, ICON_BOX } from './iconStyles.js';

// Name Lengths / Song Date / Song Length: each is shown (and applied) only while its dev-panel checkbox is on. Icons are simple stand-ins
// (title letter, person, disc, calendar, clock) until the owner's own icon files exist. `get` returns the song's value, or null if it has none.
const pad2 = n => String(n).padStart(2, '0');
const DAY = 86400000;
const dateOf = s => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s.od || s.rd || ''); /* od = the song's own earlier date (merge_original_dates.py), else the album's */ return m && +m[1] >= 1000 ? Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1) / DAY : null; };
const fmtDate = v => { const d = new Date(Math.round(v) * DAY); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
const fmtYear = v => String(new Date(Math.round(v) * DAY).getUTCFullYear()); // Song Date shows only the year
const fmtLen = v => { const t = Math.round(v); return Math.floor(t / 60) + ':' + pad2(t % 60); };
let indiv = false; // Individual Artists: each artist of a song is its own length instead of the joined text
const artistLens = s => { const p = typeof s.a === 'string' ? s.a.split(';').map(x => x.trim()).filter(Boolean) : []; return indiv ? (p.length ? p.map(x => x.length) : null) : (typeof s.a === 'string' && s.a.length ? s.a.length : null); };
const lenOf = k => s => { const t = typeof s[k] === 'string' ? (k === 'n' ? cleanTitle(s[k]) : s[k]) : ''; return t.length ? t.length : null; }; // the title is measured as shown (decoration stripped)
const CIRCLE = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const EXTRA_ICONS = {
    ln: [['M7 7h28.5v6.5H24.6V36h-6.7V13.5H7z', 0]],
    la: [[CIRCLE(21.26, 13, 8), 0], ['M5 37c0-8.5 7-13 16.26-13S37.5 28.5 37.5 37z', 0]],
    lb: [[CIRCLE(21.26, 21.26, 17.26) + CIRCLE(21.26, 21.26, 4.5), 1]],
    rd: [['M11 4h4.5v5h11.5V4h4.5v5h4a2.5 2.5 0 0 1 2.5 2.5v22a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-22A2.5 2.5 0 0 1 7 9h4zM9 18v15.5h24.5V18z', 1]],
    du: [[CIRCLE(21.26, 21.26, 17.26) + CIRCLE(21.26, 21.26, 13.5), 1], ['M19.4 11.5h3.7v9.2l6.4 3.7-1.85 3.2-8.25-4.8z', 0]],
};
const FEATURES = [
    { key: 'tp', showVal: 'checkboxFilterShowValueOriginal', label: 'Tempo', unit: ' BPM', step: 'any', dp: 0 },
    { key: 'v', showVal: 'checkboxFilterShowValueOriginal', label: 'Valence', unit: '', step: 'any', dp: 1 },
    { key: 'dn', showVal: 'checkboxFilterShowValueOriginal', label: 'Danceability', unit: '', step: 'any', dp: 1 },
    { key: 'e', showVal: 'checkboxFilterShowValueOriginal', label: 'Energy', unit: '', step: 'any', dp: 1 },
    { key: 'ln', showVal: 'checkboxFilterShowValueNameLengths', label: 'Song Title Length', unit: '', dp: 0, gate: 'checkboxFilterNameLengths', get: lenOf('n') },
    { key: 'la', showVal: 'checkboxFilterShowValueNameLengths', label: 'Artist Name Length', unit: '', dp: 0, gate: 'checkboxFilterNameLengths', get: artistLens },
    { key: 'lb', showVal: 'checkboxFilterShowValueNameLengths', label: 'Album Title Length', unit: '', dp: 0, gate: 'checkboxFilterNameLengths', get: lenOf('al') },
    { key: 'rd', showVal: 'checkboxFilterShowValueSongDate', label: 'Song Date', unit: '', dp: 0, gate: 'checkboxFilterSongDate', get: dateOf, format: fmtYear },
    { key: 'du', showVal: 'checkboxFilterShowValueSongLength', label: 'Song Length', unit: '', dp: 0, gate: 'checkboxFilterSongLength', get: s => (typeof s.du === 'number' && s.du > 0 ? s.du / 1000 : null), format: fmtLen },
];
const STORE = 'spxFilter';
// the panel shows an icon instead of each feature's name (the name is its tooltip); the icon is the dev panel's choice for that feature
export const FEATURE_ICON_SETTING = { tp: 'selectTempoIconStyle', v: 'selectValenceIconStyle', dn: 'selectDanceIconStyle', e: 'selectEnergyIconStyle' };

// tempo 0 is Spotify's "no data" placeholder, so it counts as missing like a null does
// A row whose tempo, valence and danceability are all exactly 0 has no audio analysis (3 songs): those 3 values are missing, not real zeros.
const noAnalysis = s => s.tp === 0 && s.v === 0 && s.dn === 0;
const valueOf = (s, k) => { const x = FEATURES.find(f => f.key === k); if (x && x.get) return x.get(s);
     const v = s[k]; return typeof v === 'number' && !(k !== 'e' && noAnalysis(s)) && !(k === 'tp' && v <= 0) ? v : null; };

export function createFilter(songs, { host, onChange }) {
    // dataset extents
    indiv = !!setting('checkboxFilterIndividualArtists');
    const ext = {};
    const extOf = f => {
        let lo = Infinity, hi = -Infinity;
        songs.forEach(s => { const v = valueOf(s, f.key); (Array.isArray(v) ? v : v === null ? [] : [v]).forEach(x => { if (x < lo) lo = x; if (x > hi) hi = x; }); });
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        return [lo, hi]; // exactly the lowest and highest value present in the data
    };
    FEATURES.forEach(f => { ext[f.key] = extOf(f); });
    const range = {};
    FEATURES.forEach(f => { range[f.key] = ext[f.key].slice(); });
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (saved) FEATURES.forEach(f => {
            const r = saved[f.key];
            if (Array.isArray(r) && r.length === 2 && r.every(Number.isFinite)) range[f.key] = [Math.max(ext[f.key][0], Math.min(r[0], r[1])), Math.min(ext[f.key][1], Math.max(r[0], r[1]))];
        });
    } catch (e) { /* storage blocked or unreadable */ }

    const gateOn = {};
    let rows = null; // the panel rows, once built
    const readGates = () => {
        FEATURES.forEach(f => { gateOn[f.key] = !f.gate || !!setting(f.gate); });
        const now = !!setting('checkboxFilterIndividualArtists');
        if (now !== indiv) { // Individual Artists was toggled: the Artist Name Length slider's dataset extents change, so its range starts over
            indiv = now;
            const fa = FEATURES.find(x => x.key === 'la');
            ext.la = extOf(fa); range.la = ext.la.slice();
            if (rows) { rows.la.min.min = rows.la.max.min = ext.la[0]; rows.la.min.max = rows.la.max.max = ext.la[1]; }
        }
    };
    readGates();
    const narrowed = f => gateOn[f.key] && (range[f.key][0] > ext[f.key][0] || range[f.key][1] < ext[f.key][1]);
    const active = () => FEATURES.some(narrowed);
    function passes(i) {
        const s = songs[i];
        for (const f of FEATURES) {
            if (!narrowed(f)) continue;
            const v = valueOf(s, f.key);
            if (v === null) { if (setting('selectFilterMissing') === 'hide') return false; continue; }
            if (Array.isArray(v)) { if (!v.some(x => x >= range[f.key][0] - 1e-9 && x <= range[f.key][1] + 1e-9)) return false; continue; } // several values (Individual Artists): one artist in range is enough
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
    // Vertical resize: a strip on the bottom edge (the Panel group's Resizable checkbox switches all three strips on and off)
    const HEIGHT_KEY = 'spxFilterHeight', MIN_H = 60;
    { const hb = document.createElement('div');
      hb.className = 'spx-flt-resize spx-flt-resize-b'; hb.title = 'Drag to resize (double-click to reset)';
      panel.appendChild(hb);
      hb.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          e.preventDefault(); try { hb.setPointerCapture(e.pointerId); } catch (e2) { /* not an active pointer */ }
          const r0 = panel.getBoundingClientRect(), y0 = e.clientY;
          const move = ev => { panel.style.height = Math.max(MIN_H, Math.min(window.innerHeight - r0.top - 4, r0.height + ev.clientY - y0)) + 'px'; };
          const up = () => {
              hb.removeEventListener('pointermove', move); hb.removeEventListener('pointerup', up); hb.removeEventListener('pointercancel', up);
              try { localStorage.setItem(HEIGHT_KEY, String(Math.round(panel.getBoundingClientRect().height))); } catch (e2) { /* storage blocked */ }
          };
          hb.addEventListener('pointermove', move); hb.addEventListener('pointerup', up); hb.addEventListener('pointercancel', up);
      });
      hb.addEventListener('dblclick', () => { panel.style.height = ''; try { localStorage.removeItem(HEIGHT_KEY); } catch (e2) { /* storage blocked */ } onChange({ layout: true }); }); }
    // Draggable: a press on the panel's background (not on a slider, button or resize strip) moves the whole panel; its place is remembered
    const POS_KEY = 'spxFilterPos'; let userPos = null;
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) userPos = p; } catch (e) { /* storage blocked */ }
    panel.addEventListener('pointerdown', e => {
        if (!setting('checkboxFilterPanelDraggable') || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('input, button, .spx-flt-resize')) return;
        e.preventDefault(); try { panel.setPointerCapture(e.pointerId); } catch (e2) { /* not an active pointer */ }
        const r0 = panel.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
        const move = ev => {
            panel.style.left = Math.max(4, Math.min(window.innerWidth - r0.width - 4, r0.left + ev.clientX - x0)) + 'px';
            panel.style.top = Math.max(4, Math.min(window.innerHeight - Math.min(r0.height, window.innerHeight - 8) - 4, r0.top + ev.clientY - y0)) + 'px';
        };
        const up = () => {
            panel.removeEventListener('pointermove', move); panel.removeEventListener('pointerup', up); panel.removeEventListener('pointercancel', up);
            userPos = { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) };
            try { localStorage.setItem(POS_KEY, JSON.stringify(userPos)); } catch (e2) { /* storage blocked */ }
        };
        panel.addEventListener('pointermove', move); panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up);
    });
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
    rows = {};
    const fmt = (f, v) => f.format ? f.format(v) : v.toFixed(f.dp) + f.unit;

    FEATURES.forEach(f => {
        const [lo, hi] = ext[f.key];
        const row = document.createElement('div');
        row.className = 'spx-flt-row';
        row.innerHTML = `<div class="spx-flt-top"><span class="spx-flt-ico" title="${f.label}" aria-label="${f.label}"><svg viewBox="0 0 ${ICON_BOX} ${ICON_BOX}" aria-hidden="true"></svg></span></div>
            <div class="spx-flt-range"><div class="spx-flt-track"><div class="spx-flt-fill"></div></div>
            <input type="range" class="spx-flt-min" min="${lo}" max="${hi}" step="any" aria-label="${f.label} minimum">
            <input type="range" class="spx-flt-max" min="${lo}" max="${hi}" step="any" aria-label="${f.label} maximum"></div>
            <div class="spx-flt-nums"><span class="spx-flt-lo"></span><span class="spx-flt-val"></span><span class="spx-flt-hi"></span></div>
            <div class="spx-flt-cur"></div>`;
        rowsEl.appendChild(row);
        const r = rows[f.key] = { f, row, ico: row.querySelector('.spx-flt-ico svg'), lo: row.querySelector('.spx-flt-lo'), hi: row.querySelector('.spx-flt-hi'), val: row.querySelector('.spx-flt-val'), cur: row.querySelector('.spx-flt-cur'), fill: row.querySelector('.spx-flt-fill'), min: row.querySelector('.spx-flt-min'), max: row.querySelector('.spx-flt-max') };
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
        readGates();
        let firstShown = true;
        FEATURES.forEach(f => { const r = rows[f.key], shown = gateOn[f.key]; r.row.style.display = shown ? '' : 'none'; r.row.style.marginTop = shown && firstShown ? '0' : ''; if (shown) firstShown = false; });
        FEATURES.forEach(f => {
            const r = rows[f.key];
            if (EXTRA_ICONS[f.key]) { if (!r.ico.dataset.icon) { r.ico.dataset.icon = 'x'; r.ico.innerHTML = customIconHtml(EXTRA_ICONS[f.key]); } return; }
            const v = setting(FEATURE_ICON_SETTING[f.key]); if (r.ico.dataset.icon !== String(v)) { r.ico.dataset.icon = String(v); r.ico.innerHTML = featureIconHtml(f.key, v); }
        });
        FEATURES.forEach(f => {
            const r = rows[f.key], [lo, hi] = ext[f.key], [a, b] = range[f.key];
            r.min.value = a; r.max.value = b;
            r.val.textContent = fmt(f, a) + ' - ' + fmt(f, b);
            r.cur.textContent = r.val.textContent; r.row.classList.toggle('show-cur', !!setting(f.showVal)); // Show Value: the selected range, centred under the slider
            r.lo.textContent = f.format ? f.format(lo) : lo.toFixed(f.dp); r.hi.textContent = f.format ? f.format(hi) : hi.toFixed(f.dp); // the dataset's own lowest / highest value at the two ends
            const span = hi - lo || 1;
            r.fill.style.left = ((a - lo) / span * 100) + '%';
            r.fill.style.width = ((b - a) / span * 100) + '%';
            r.row.classList.toggle('on', narrowed(f));
        });
        panel.classList.toggle('no-nums', !setting('checkboxFilterShowNumbers'));
        panel.classList.toggle('no-range-text', !setting('checkboxFilterShowRangeText')); // the "36 BPM - 209 BPM" text between the two end numbers
        // Panel group: resizable / scrollable / draggable
        const rz = !!setting('checkboxFilterPanelResizable');
        panel.classList.toggle('no-resize', !rz);
        panel.classList.toggle('scroll', !!setting('checkboxFilterPanelScrollable'));
        panel.classList.toggle('draggable', !!setting('checkboxFilterPanelDraggable'));
        panel.classList.toggle('count-top', !!setting('checkboxFilterSongCountTop'));
        if (!rz) { panel.style.width = ''; panel.style.height = ''; }
        else { // back to the remembered size after a Resizable off / on
            try {
                if (!panel.style.width) { const w0 = parseFloat(localStorage.getItem(WIDTH_KEY)); if (w0 >= MIN_W) panel.style.width = w0 + 'px'; }
                if (!panel.style.height) { const h0 = parseFloat(localStorage.getItem(HEIGHT_KEY)); if (h0 >= MIN_H) panel.style.height = h0 + 'px'; }
            } catch (e) { /* storage blocked */ }
        }
        // Panel Song Count group: on/off, font size, X / Y offset, bold, italic, letter spacing, space around the "/"
        const cOn = !!setting('checkboxFilterSongCountEnabled');
        countEl.style.display = cOn ? '' : 'none';
        if (cOn) {
            countEl.innerHTML = '<span>' + countPassing() + '</span><span class="spx-cnt-sep" style="margin:0 ' + setting('sliderFilterSongCountNumberGap') + 'px">/</span><span>' + songs.length + '</span> songs';
            countEl.style.letterSpacing = setting('sliderFilterSongCountLetterSpacing') + 'px';
            countEl.style.fontSize = setting('sliderFilterSongCountFontSize') + 'px';
            countEl.style.fontWeight = setting('checkboxFilterSongCountBold') ? '700' : '400';
            countEl.style.fontStyle = setting('checkboxFilterSongCountItalic') ? 'italic' : 'normal';
            countEl.style.transform = 'translate(' + setting('sliderFilterSongCountOffsetX') + 'px, ' + setting('sliderFilterSongCountOffsetY') + 'px)';
        }
    }
    function commit() {
        try { localStorage.setItem(STORE, JSON.stringify(range)); } catch (e) { /* storage blocked */ }
        onChange();
    }
    panel.querySelector('.spx-flt-clear').addEventListener('click', () => { clear(); });
    function clear() { FEATURES.forEach(f => { range[f.key] = ext[f.key].slice(); }); refresh(); commit(); }
    refresh();

    return {
        get userPos() { return userPos; }, panel, passes, active, countPassing, clear, refresh, ext, range,
        get open() { return !panel.hidden; },
        setOpen(v) { panel.hidden = !v; if (v) refresh(); },
        describe() { return FEATURES.filter(narrowed).map(f => `${f.label} ${fmt(f, range[f.key][0])}-${fmt(f, range[f.key][1])}`).join(', ') || 'none'; },
    };
}
