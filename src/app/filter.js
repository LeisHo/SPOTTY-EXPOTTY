// Audio-feature filter: tempo, valence, danceability and energy ranges (the Filter button under Shuffle).
//
// The slider bounds are the dataset's own min and max. A song "passes" when every feature that has been narrowed
// (its range is smaller than the dataset's) contains the song's value. Songs with no value for a narrowed feature
// follow the "Songs With No Audio Data" setting (hide = they fail). Nothing is removed from the timeline: failing
// songs are drawn gray and are not played (main.js / timeline.js use passes(i)).
import { setting } from './settings.js';
import { cleanTitle } from './title.mjs';
import { featureIconHtml, extraIconHtml, iconRev, ICON_BOX } from './iconStyles.js';

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
// the filter panel's other rows: their icon is the dev panel's choice too (built-in options in iconStyles.js EXTRA_ICON_SETS)
export const EXTRA_ICON_SETTING = { ln: 'selectTitleLenIconStyle', la: 'selectArtistLenIconStyle', lb: 'selectAlbumLenIconStyle', rd: 'selectSongDateIconStyle', du: 'selectSongLenIconStyle' };
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
    // Resize: four thin strips, one per edge. Dragging an edge moves THAT edge and keeps the opposite one where it is (left or right edge for X,
    // top or bottom edge for Y). Each axis is remembered as a real rectangle part - X: left + width, Y: top + height - so main.js's placeFilterPanel()
    // keeps the panel where it was dragged to; a double-click on an edge resets that axis. The strips sit in the panel's own padding, below the
    // sliders (z-index), so a press that could be either is always the slider's. The X Resize / Y Resize checkboxes switch the strips of an axis off.
    const MIN_W = 160, MIN_H = 60;
    const RECT_KEY = 'spxFilterRect'; let userRect = {};
    try { const r = JSON.parse(localStorage.getItem(RECT_KEY) || 'null'); if (r && typeof r === 'object') userRect = r; } catch (e) { /* storage blocked */ }
    const saveRect = () => { try { localStorage.setItem(RECT_KEY, JSON.stringify(userRect)); } catch (e) { /* storage blocked */ } };
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
    ['l', 'r', 't', 'b'].forEach(side => {
        const horizontal = side === 'l' || side === 'r';
        const h = document.createElement('div');
        h.className = 'spx-flt-resize spx-flt-resize-' + side;
        h.title = 'Drag to resize (double-click to reset)';
        panel.appendChild(h);
        h.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            try { h.setPointerCapture(e.pointerId); } catch (e2) { /* not an active pointer */ }
            panel.style.removeProperty('--fit-gl'); panel.style.removeProperty('--fit-gr'); fitG = { l: 0, r: 0 }; // drag the base box; fit() adds the growth back afterwards
            const r0 = panel.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
            const move = ev => {
                if (horizontal) {
                    const dx = ev.clientX - x0;
                    let left = r0.left, w = side === 'r' ? r0.width + dx : r0.width - dx;
                    w = Math.max(MIN_W, Math.min(window.innerWidth - 8, w));
                    if (side === 'l') left = r0.right - w;
                    if (left < 4) { left = 4; if (side === 'l') w = r0.right - 4; }
                    if (side !== 'l' && left + w > window.innerWidth - 4) w = window.innerWidth - 4 - left; // the far edge only follows the window when IT is the one dragged
                    panel.style.width = w + 'px'; panel.style.left = left + 'px';
                } else {
                    const dy = ev.clientY - y0;
                    let top = r0.top, hgt = side === 'b' ? r0.height + dy : r0.height - dy;
                    hgt = Math.max(MIN_H, Math.min(window.innerHeight - 8, hgt));
                    if (side === 't') top = r0.bottom - hgt;
                    if (top < 4) { top = 4; if (side === 't') hgt = r0.bottom - 4; }
                    if (side !== 't' && top + hgt > window.innerHeight - 4) hgt = window.innerHeight - 4 - top;
                    panel.style.height = hgt + 'px'; panel.style.top = top + 'px';
                }
            };
            const up = () => {
                h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
                const q = panel.getBoundingClientRect();
                if (horizontal) { userRect.x = { left: Math.round(q.left), width: Math.round(q.width) }; panel.style.width = ''; panel.style.setProperty('--spx-flt-userw', userRect.x.width + 'px'); }
                else userRect.y = { top: Math.round(q.top), height: Math.round(q.height) };
                saveRect();
                setTimeout(fit, 0);
            };
            h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
        });
        h.addEventListener('dblclick', () => { // this axis goes back to the dev panel's width / the content height and the default place
            if (horizontal) { delete userRect.x; panel.style.width = ''; panel.style.removeProperty('--spx-flt-userw'); } else { delete userRect.y; panel.style.height = ''; }
            saveRect();
            onChange({ layout: true });
        });
    });
    if (userRect.x && userRect.x.width >= MIN_W) panel.style.setProperty('--spx-flt-userw', userRect.x.width + 'px');
    if (userRect.y && userRect.y.height >= MIN_H) panel.style.height = userRect.y.height + 'px';
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
            if (EXTRA_ICON_SETTING[f.key]) { const xv = setting(EXTRA_ICON_SETTING[f.key]), xk = 'x' + xv + ':' + iconRev(); if (r.ico.dataset.icon !== xk) { r.ico.dataset.icon = xk; r.ico.innerHTML = extraIconHtml(f.key, xv); } return; }
            const v = setting(FEATURE_ICON_SETTING[f.key]), ik = v + ':' + iconRev(); if (r.ico.dataset.icon !== ik) { r.ico.dataset.icon = ik; r.ico.innerHTML = featureIconHtml(f.key, v); }
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
        // Panel group: resizable / scrollable / draggable
        const rzx = !!setting('checkboxFilterPanelResizeX'), rzy = !!setting('checkboxFilterPanelResizeY');
        panel.classList.toggle('no-resize-x', !rzx); panel.classList.toggle('no-resize-y', !rzy);
        panel.classList.toggle('scroll', !!setting('checkboxFilterPanelScrollable'));
        panel.classList.toggle('no-scrollbar', !setting('checkboxFilterPanelScrollBar'));
        panel.classList.toggle('draggable', !!setting('checkboxFilterPanelDraggable'));
        panel.classList.toggle('count-top', !!setting('checkboxFilterSongCountTop'));
        // an axis switched off goes back to the dev panel's own size on that axis; switched on again, the remembered rectangle returns
        if (!rzx) { panel.style.width = ''; panel.style.removeProperty('--spx-flt-userw'); }
        if (!rzy) panel.style.height = '';
        if (rzx && userRect.x && userRect.x.width >= MIN_W) panel.style.setProperty('--spx-flt-userw', userRect.x.width + 'px');
        if (rzy && userRect.y && !panel.style.height && userRect.y.height >= MIN_H) panel.style.height = userRect.y.height + 'px';
        // Panel Song Count group: on/off, font size, X / Y offset, bold, italic, letter spacing, space around the "/"
        const cOn = !!setting('checkboxFilterSongCountEnabled');
        countEl.style.display = cOn ? '' : 'none';
        if (cOn) {
            countEl.innerHTML = '<span>' + countPassing() + '</span><span class="spx-cnt-sep" style="margin:0 ' + setting('sliderFilterSongCountNumberGap') + 'px">/</span><span>' + songs.length + '</span> songs';
            countEl.style.letterSpacing = setting('sliderFilterSongCountLetterSpacing') + 'px';
            countEl.style.fontSize = setting('sliderFilterSongCountFontSize') + 'px';
            countEl.style.fontWeight = setting('checkboxFilterSongCountBold') ? '700' : '400';
            countEl.style.fontStyle = setting('checkboxFilterSongCountItalic') ? 'italic' : 'normal';
            countEl.style.transform = 'translate(' + setting('sliderFilterSongCountOffsetX') + 'px, ' + (-setting('sliderFilterSongCountOffsetY')) + 'px)'; // X: right = positive; Y: up = positive
        }
        fit();
    }
    // Keeps every item inside the panel, whatever Y / X offsets are set: all the offsets are transforms (they move an item without moving its
    // neighbours). Measured with the padding reset: (1) the slider block (`.spx-flt-rows`, which clips) grows by any overflow past its own box -
    // padding in, the same amount of margin out, so nothing moves; (2) the panel itself grows (padding) by what is still past ITS edge, which is
    // all the items plus the head button and the song count - so a shift inside the panel's own spare room (the margins and padding) shows as a
    // shift, and only what would leave the panel makes it bigger.
    // The song count's real extent = its TEXT (the element itself is a full-width block, so a sideways offset would push the whole box past the panel edge while
    // the number is still well inside). Used for the edge check and the cutoff gap.
    const countTextRect = () => {
        const rg = document.createRange(); rg.selectNodeContents(countEl);
        const q = rg.getBoundingClientRect();
        return q.width || q.height ? q : countEl.getBoundingClientRect();
    };
    let fitG = { l: 0, r: 0 }; // how much the panel is currently wider than its base width, per side (main.js places the base box)
    function fit() {
        const S = panel.style;
        ['rt', 'rb', 'pt', 'pb', 'ct', 'cb', 'gl', 'gr'].forEach(k => S.removeProperty('--fit-' + k));
        fitG = { l: 0, r: 0 };
        rowsEl.style.clipPath = '';
        if (panel.hidden) return;
        // Song Count cutoff distance (first, measured with everything reset): the scroll area keeps AT LEAST the dev panel's distance from the song count's real
        // edge (its X / Y offsets included). Nothing is clipped: when the two are closer than that, the scroll area's own edge moves away by the difference
        // (a margin on the edge facing the count) - count on top -> the area's top edge shifts down, count at the bottom -> its bottom edge shifts up. The area gets
        // shorter (fixed panel height) or the panel grows (auto height); everything stays reachable by scrolling.
        if (setting('checkboxFilterSongCountEnabled') && countEl.style.display !== 'none') {
            const rr = rowsEl.getBoundingClientRect(), cr = countTextRect(), gap = setting('sliderFilterSongCountCutoffDistance');
            const top = panel.classList.contains('count-top'), sep = top ? rr.top - cr.bottom : cr.top - rr.bottom, extra = Math.ceil(gap - sep);
            if (extra > 0) S.setProperty(top ? '--fit-ct' : '--fit-cb', extra + 'px');
        }
        // SIDES: the space between the panel's edge and the slider ends is fixed, so nothing that sticks out past a side shortens the sliders - the panel itself
        // gets wider on that side instead (the head button and the song count's text are what can be moved out there; the song count is centred, so it moves with
        // the growth and the loop adds the remainder until nothing is outside; capped so the panel stays inside the window).
        {
            const left0 = parseFloat(S.left) || 0, base = panel.getBoundingClientRect().width;
            const maxL = Math.max(0, left0 - 4), maxR = Math.max(0, window.innerWidth - 4 - (left0 + base));
            for (let pass = 0; pass < 12; pass++) {
                const bb = panel.getBoundingClientRect(), rects = Array.from(panel.querySelectorAll('.spx-flt-head > *')).map(el => el.getBoundingClientRect());
                if (countEl.style.display !== 'none') rects.push(countTextRect());
                let ol = 0, orr = 0;
                rects.forEach(q => { if (!q.width && !q.height) return; ol = Math.max(ol, bb.left - q.left); orr = Math.max(orr, q.right - bb.right); });
                const nl = Math.min(maxL, fitG.l + Math.max(0, Math.ceil(ol))), nr = Math.min(maxR, fitG.r + Math.max(0, Math.ceil(orr)));
                if (nl === fitG.l && nr === fitG.r) break;
                fitG = { l: nl, r: nr };
                S.setProperty('--fit-gl', nl + 'px'); S.setProperty('--fit-gr', nr + 'px');
            }
        }
        // TOP / BOTTOM: scroll mode: what is below (or scrolled above) the visible part is scroll content, not spill - only an item pushed above the unscrolled top counts
        const scrollMode = panel.classList.contains('scroll');
        const grow = (box, els, pre, scrolled, extraRects) => {
            const bb = box.getBoundingClientRect(), m = { t: 0, b: 0 }, st = scrolled ? rowsEl.scrollTop : 0;
            Array.from(els).map(el => el.getBoundingClientRect()).concat(extraRects || []).forEach(q => {
                if (!q.width && !q.height) return;
                m.t = Math.max(m.t, bb.top - (q.top + st)); m.b = Math.max(m.b, q.bottom - bb.bottom);
            });
            if (scrolled) m.b = 0;
            let grew = false; // adds to what is already padded (the song count is centred in its row, so one pass is not always enough)
            const cap = { t: bb.height * 0.35, b: bb.height * 0.35 }; // an extreme offset must not squeeze the sliders away: at most 35% of the box per side
            Object.keys(m).forEach(k => { if (m[k] > 0.5) { const cur = parseFloat(S.getPropertyValue('--fit-' + pre + k)) || 0, next = Math.min(cur + Math.ceil(m[k]), pre === 'p' ? cap[k] : Infinity); if (next > cur + 0.5) { S.setProperty('--fit-' + pre + k, next + 'px'); grew = true; } } });
            return grew;
        };
        grow(rowsEl, rowsEl.querySelectorAll('.spx-flt-top, .spx-flt-range, .spx-flt-nums, .spx-flt-cur'), 'r', scrollMode);
        for (let pass = 0; pass < 8; pass++) if (!grow(panel, panel.querySelectorAll(scrollMode ? '.spx-flt-head > *' : '.spx-flt-head > *, .spx-flt-top, .spx-flt-range, .spx-flt-nums, .spx-flt-cur'), 'p', false, countEl.style.display !== 'none' ? [countTextRect()] : [])) break;
    }
    window.addEventListener('resize', fit);
    panel.addEventListener('pointerup', () => setTimeout(fit, 0)); // after a resize drag
    function commit() {
        try { localStorage.setItem(STORE, JSON.stringify(range)); } catch (e) { /* storage blocked */ }
        onChange();
    }
    panel.querySelector('.spx-flt-clear').addEventListener('click', () => { clear(); });
    function clear() { FEATURES.forEach(f => { range[f.key] = ext[f.key].slice(); }); refresh(); commit(); }
    refresh();

    return {
        get userPos() { return userPos; }, get userRect() { return userRect; }, get fitGrowth() { return fitG.l + fitG.r; }, panel, passes, active, countPassing, clear, refresh, ext, range,
        get open() { return !panel.hidden; },
        setOpen(v) { panel.hidden = !v; if (v) refresh(); },
        describe() { return FEATURES.filter(narrowed).map(f => `${f.label} ${fmt(f, range[f.key][0])}-${fmt(f, range[f.key][1])}`).join(', ') || 'none'; },
    };
}
