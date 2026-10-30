// Zoomable timeline canvas. x = date inside a movable view window; the top band shows
// when songs were added (several selectable visual styles, optionally coloured by the
// albums' cover colours); the bottom band has one thin row per playlist.
//
// "vt" is a virtual time: real add time + index * 1 s. Songs added in the same instant
// (bulk adds share a timestamp) would otherwise sit at one x and be impossible to scrub
// between; the 1 s spacing separates them while moving every date by at most ~1.8 h.
//
// The current song is always floor(pos): the last song added AT OR BEFORE the playhead's
// time, so landing in an empty stretch plays the most recent earlier song.
import { setting, activeDevice } from './settings.js';
import { FEATURE_ICON_SETTING } from './filter.js';
import { featureIcon, ICON_BOX } from './iconStyles.js';
import { zFor, isOn } from './renderOrder.js';

const SPACING_MS = 1000;
const MIN_SPAN_MS = 120000;
const DAY = 864e5;
const FEATURE_KEY = { valence: 'v', energy: 'e', danceability: 'dn' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbCss = ([r, g, b], a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export function createTimeline(canvas, data) {
    const songs = data.songs;
    const covers = (data.covers || []).map(c => c.map(hexToRgb));
    const n = songs.length;
    const real = songs.map(s => Date.parse(s.t));
    const vt = real.map((t, i) => t + i * SPACING_MS);
    const vMin = vt[0], vMax = vt[n - 1];
    const total = Math.max(1, vMax - vMin);
    // The first year starts before the first song: its 1 January must be on the timeline, so the view may reach it.
    const yearStartMs = new Date(new Date(real[0]).getFullYear(), 0, 1).getTime();
    const vMinView = Math.min(vMin, yearStartMs);
    const FULL_SPAN = Math.max(1, vMax - vMinView) * 1.02;

    // ---- zoom limits: a 0-100 % log scale from "2 minutes visible" to "whole timeline" ----
    function zoomLimits() {
        const lim = setting('rangeBarTimelineZoomLimits') || { min: 0, max: 100 };
        const f = p => MIN_SPAN_MS * Math.pow(FULL_SPAN / MIN_SPAN_MS, clamp(p, 0, 100) / 100);
        return { lo: f(Math.min(lim.min, lim.max)), hi: f(Math.max(lim.min, lim.max)) };
    }
    const clampSpan = s => { const { lo, hi } = zoomLimits(); return clamp(s, lo, hi); };

    let span = clampSpan(Math.min(FULL_SPAN, Math.max(MIN_SPAN_MS, setting('sliderDefaultTimelineSpanDays') * DAY)));
    let viewStart = vMinView;
    let pos = 0;

    // Scrub Line Click and Drag: the line's width and opacity ease between its idle / hover / press / release values over the
    // Animation Time, like a button's animation. Idle with the drag off = the plain Scrub Line Width.
    const ph = { w: null, op: 1, state: 'idle', raf: 0, last: 0 };
    const phTarget = () => {
        const base = Math.max(1, setting('sliderPlayheadWidth'));
        const baseOp = setting('sliderPlayheadOpacity') / 100; // the Scrub Line Opacity slider
        if (!setting('checkboxScrubLineDrag')) return { w: base, op: baseOp };
        if (ph.state === 'press') return { w: setting('sliderScrubLineClickWidth'), op: setting('sliderScrubLineClickOpacity') / 100 };
        if (ph.state === 'hover') return { w: setting('sliderScrubLineHoverWidth'), op: setting('sliderScrubLineHoverOpacity') / 100 };
        if (ph.state === 'release') return { w: setting('sliderScrubLineReleaseWidth'), op: 1 };
        return { w: base, op: baseOp };
    };
    function phStep(now) {
        ph.raf = 0;
        const t = phTarget();
        if (ph.w === null) { ph.w = t.w; ph.op = t.op; }
        const dt = Math.max(1, now - (ph.last || now)); ph.last = now;
        const k = Math.min(1, dt / Math.max(1, setting('sliderScrubLineAnimTime')));
        ph.w += (t.w - ph.w) * k; ph.op += (t.op - ph.op) * k;
        draw();
        if (Math.abs(t.w - ph.w) > 0.02 || Math.abs(t.op - ph.op) > 0.005) ph.raf = requestAnimationFrame(phStep);
        else ph.last = 0;
    }
    function setPlayheadState(st) {
        ph.state = st;
        if (!ph.raf) { ph.last = 0; ph.raf = requestAnimationFrame(phStep); }
    }
    // While a state is animating or set, the line uses its width / opacity; otherwise the plain Scrub Line Width.
    const playheadW = () => (ph.raf || ph.state !== 'idle' ? ph.w : Math.max(1, setting('sliderPlayheadWidth')));
    const phOpacity = () => (ph.raf || ph.state !== 'idle' ? ph.op : setting('sliderPlayheadOpacity') / 100);
    const W = () => canvas.clientWidth || 1;
    const xOf = v => ((v - viewStart) / span) * W();

    function lowerBound(arr, x) { // first index with arr[i] >= x
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
        return lo;
    }
    const posToVt = p => {
        const i = clamp(Math.floor(p), 0, n - 1), j = Math.min(n - 1, i + 1);
        return vt[i] + (p - i) * (vt[j] - vt[i]);
    };
    const vtToPos = v => {
        if (v <= vMin) return 0;
        if (v >= vMax) return n - 1;
        const i = lowerBound(vt, v + 1e-6) - 1; // last index with vt <= v
        return i + (v - vt[i]) / (vt[i + 1] - vt[i]);
    };
    const currentIndex = () => clamp(Math.floor(pos + 1e-9), 0, n - 1);

    function clampView() {
        // Whole timeline on screen: nothing to pan, so the view stays at its start.
        if (span >= (vMax - vMinView) * 0.999) { viewStart = vMinView; return; }
        const pad = span * 0.05;
        viewStart = Math.min(vMax + pad - span, Math.max(vMinView - pad, viewStart));
    }
    function keepPlayheadVisible(forceCenter) {
        const x = xOf(posToVt(pos)), w = W();
        if (forceCenter) viewStart = posToVt(pos) - 0.5 * span;
        else if (x < w * 0.1 || x > w * 0.9) {
            const far = x < -w || x > 2 * w; // a big jump: recenter instead of edge-pinning
            const target = far ? 0.5 : x < w * 0.1 ? 0.1 : 0.9;
            viewStart = posToVt(pos) - target * span;
        }
        clampView();
    }
    function setPos(p) { pos = clamp(p, 0, n - 1); keepPlayheadVisible(false); }

    // Zoom keeping the vt under anchorX fixed (default and normal use: the playhead).
    function zoomBy(factor, anchorX) {
        const w = W();
        const ax = anchorX === undefined ? xOf(posToVt(pos)) : anchorX;
        const vAnchor = viewStart + (ax / w) * span;
        span = clampSpan(span * factor);
        viewStart = vAnchor - (ax / w) * span;
        clampView();
    }
    // Pan the view by dx px (a right-button drag): the scale and the playhead stay as they are
    function panPx(dx) { viewStart -= (dx / W()) * span; clampView(); }
    // Move the playhead dx px along the current scale (positive = later); returns the new position.
    function scrubByPixels(dx) { return vtToPos(posToVt(pos) + (dx / W()) * span); }
    // The position under a canvas x (clicking the timeline jumps here).
    function posAtX(x) { return vtToPos(viewStart + (clamp(x, 0, W()) / W()) * span); }

    // ---- ticks -------------------------------------------------------------
    const vtOfReal = t => t + lowerBound(real, t + 1) * SPACING_MS;
    function ticks() {
        const realOf = v => v - clamp(Math.round(vtToPos(v)), 0, n - 1) * SPACING_MS;
        const smooth = !!setting('checkboxScaleSmoothPan'); // Smooth Panning: ticks are chosen by calendar position (not from the left edge) and run past both edges
        const ext = smooth ? span * 0.15 : 0;
        const startReal = new Date(realOf(viewStart - ext));
        const endReal = new Date(realOf(viewStart + span + ext));
        const out = [];
        let unit = 'year';
        if (span < 6 * 3600e3) unit = 'minute';
        else if (span < 5 * DAY) unit = 'hour';
        else if (span < 150 * DAY) unit = 'day';
        else if (span < 4 * 365 * DAY) unit = 'month';
        const d = new Date(startReal);
        if (unit === 'minute') d.setSeconds(0, 0);
        else if (unit === 'hour') d.setMinutes(0, 0, 0);
        else if (unit === 'day') d.setHours(0, 0, 0, 0);
        else if (unit === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); }
        else { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); }
        const step = () => {
            if (unit === 'minute') d.setMinutes(d.getMinutes() + 1);
            else if (unit === 'hour') d.setHours(d.getHours() + 1);
            else if (unit === 'day') d.setDate(d.getDate() + 1);
            else if (unit === 'month') d.setMonth(d.getMonth() + 1);
            else d.setFullYear(d.getFullYear() + 1);
        };
        const label = x => {
            if (unit === 'year') return String(x.getFullYear());
            if (unit === 'month') return x.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
            if (unit === 'day') return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        };
        let guard = 0;
        while (d <= endReal && guard++ < 5000) {
            const v0 = vtOfReal(d.getTime());
            const tick = { x: xOf(v0), text: label(d), v0, v1: v0, idx: unit === 'year' ? d.getFullYear() : unit === 'month' ? d.getFullYear() * 12 + d.getMonth() : Math.round(d.getTime() / ({ day: DAY, hour: 3600e3, minute: 60e3 })[unit]) };
            out.push(tick);
            step();
            tick.v1 = vtOfReal(d.getTime()); // the tick's unit (the year / month / day / hour it names) runs from v0 to v1
        }
        const thinned = [];
        let lastX = -1e9;
        if (smooth) { // every k-th unit by its calendar index: the same ticks stay for the whole pan, only a zoom changes k
            const unitMs = { year: 365.25 * DAY, month: 30.44 * DAY, day: DAY, hour: 3600e3, minute: 60e3 }[unit];
            const k = Math.max(1, Math.ceil(64 / (W() * unitMs / span)));
            out.forEach(t => { if (t.idx % k === 0) thinned.push(t); });
            return thinned;
        }
        out.forEach(t => { if (t.x - lastX >= 64 && t.x > -10 && t.x < W()) { thinned.push(t); lastX = t.x; } });
        return thinned;
    }

    // ---- colour helpers ------------------------------------------------------
    // covers[c] = [avg, vivid, palette1, palette2, palette3] as [r,g,b]; songs[i].c indexes it.
    const colorCache = new Map();
    function adjust(rgb, sat, bri) {
        const key = rgb.join(',') + '|' + sat + '|' + bri;
        let v = colorCache.get(key);
        if (!v) {
            const [h, s, l] = rgbToHsl(rgb);
            v = hslToRgb([h, clamp(s * sat, 0, 1), clamp(l * bri, 0, 1)]);
            colorCache.set(key, v);
        }
        return v;
    }
    // Audio-feature filter (Filter button): filterFn(i) = song i passes; null = no filter. A song that does not pass has its album colors
    // desaturated by grayAmt (0-1) wherever the graph uses them; cumValid[i] = how many of songs [0, i) pass (for the scale ticks).
    let filterFn = null, grayAmt = 0, cumValid = null;
    const grayCache = new Map();
    const grayRgb = (rgb, amt) => { const g = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; return rgb.map(c => Math.round(c + (g - c) * amt)); };
    const coverOf = i => {
        const c = songs[i].c !== undefined ? covers[songs[i].c] : null;
        if (!c || !filterFn || grayAmt <= 0 || filterFn(i)) return c;
        const key = songs[i].c + '|' + grayAmt;
        let v = grayCache.get(key);
        if (!v) { v = c.map(r => grayRgb(r, grayAmt)); grayCache.set(key, v); }
        return v;
    };
    const meanRgb = list => list.length ? [0, 1, 2].map(k => list.reduce((a, c) => a + c[k], 0) / list.length) : null;

    // The colour(s) a bar covering songs [a, b) should take, per the album-colour mode.
    // Returns { solid } | { gradient:[c,c,c] } | { stack:[c,...] } (rgb arrays), or null.
    function binPaint(a, b, o) {
        if (!o.on || b <= a) return null;
        const cs = [];
        for (let i = a; i < b; i++) { const c = coverOf(i); if (c) cs.push(c); }
        if (!cs.length) return null;
        const A = c => adjust(c, o.sat, o.bri);
        if (o.mode === 'stacked') return { stack: cs.map(c => A(c[0])) };
        if (o.mode === 'vividStacked') return { stack: cs.map(c => A(c[1])) }; // the same stack, one segment per song, in each album's vivid dominant colour
        if (o.mode === 'average') return { solid: A(meanRgb(cs.map(c => c[0]))) };
        if (o.mode === 'vivid') {
            // dominant hue bucket (12 buckets) among the vivid colours, averaged
            const buckets = new Map();
            cs.forEach(c => { const k = Math.floor(rgbToHsl(c[1])[0] / 30); (buckets.get(k) || buckets.set(k, []).get(k)).push(c[1]); });
            const best = [...buckets.values()].sort((x, y) => y.length - x.length)[0];
            return { solid: A(meanRgb(best)) };
        }
        // Vivid-dominant variants, per bar: the mean of every album's vivid dominant colour / a bottom-to-top gradient through
        // every album's vivid dominant colour (in song order) / just the first album's vivid dominant colour.
        if (o.mode === 'vividAverage') return { solid: A(meanRgb(cs.map(c => c[1]))) };
        if (o.mode === 'vividGradient') return cs.length === 1 ? { solid: A(cs[0][1]) } : { gradient: cs.map(c => A(c[1])) };
        if (o.mode === 'vividFirst') return { solid: A(cs[0][1]) };
        // Chroma Only (the Background's "Average Color Only, Ignore Grays", from the per-cover colours we have): every colour of every cover (average, vivid, the
        // 3 palette colours) counts in proportion to its saturation, so grays barely move the result; a cover with only grays falls back to its average.
        if (o.mode === 'chroma') {
            let wr = 0, wg = 0, wb = 0, ws = 0;
            cs.forEach(c => c.forEach(col => { const sat = rgbToHsl(col)[1]; wr += col[0] * sat; wg += col[1] * sat; wb += col[2] * sat; ws += sat; }));
            return { solid: A(ws > 0.05 ? [wr / ws, wg / ws, wb / ws] : meanRgb(cs.map(c => c[0]))) };
        }
        // Spotlight (the Background's "Cover Spotlight Glow"): a bright vivid core in the middle of the bar fading toward a darker average at both ends
        if (o.mode === 'spotlight') {
            const dim = adjust(meanRgb(cs.map(c => c[0])), o.sat, o.bri * 0.55);
            return { gradient: [dim, A(meanRgb(cs.map(c => c[1]))), dim] };
        }
        // palette: bottom -> top gradient of the bars' averaged palette colours
        return { gradient: [2, 3, 4].map(k => A(meanRgb(cs.map(c => c[k])))) };
    }

    function paintFill(ctx, paint, x, y, w, h, accent, alpha) {
        if (!paint) { ctx.fillStyle = accent; ctx.fillRect(x, y, w, h); return; }
        if (paint.solid) { ctx.fillStyle = rgbCss(paint.solid, alpha); ctx.fillRect(x, y, w, h); return; }
        if (paint.gradient) {
            const g = ctx.createLinearGradient(0, y + h, 0, y);
            const n = paint.gradient.length; // any number of stops, evenly spaced bottom -> top
            paint.gradient.forEach((c, i) => g.addColorStop(n === 1 ? 0 : i / (n - 1), rgbCss(c, alpha)));
            ctx.fillStyle = g; ctx.fillRect(x, y, w, h); return;
        }
        const k = paint.stack.length, seg = h / k, gap = Math.min(1, seg * 0.2);
        paint.stack.forEach((c, j) => { ctx.fillStyle = rgbCss(c, alpha); ctx.fillRect(x, y + h - (j + 1) * seg, w, Math.max(0.5, seg - (k > 1 ? gap : 0))); });
    }

    // ---- drawing -------------------------------------------------------------
    function box(arr, r) { // one box-blur pass over a Float32Array, in place
        const w = arr.length, out = new Float32Array(w);
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += arr[clamp(i, 0, w - 1)];
        for (let i = 0; i < w; i++) {
            out[i] = sum / (2 * r + 1);
            sum += arr[clamp(i + r + 1, 0, w - 1)] - arr[clamp(i - r, 0, w - 1)];
        }
        arr.set(out);
    }
    const smooth = (arr, px) => { const r = Math.max(1, Math.round(px / 2)); box(arr, r); box(arr, r); box(arr, r); };

    // Height Transition: bars and curves are scaled to the largest value in the visible window, so zooming changes that
    // largest value and everything jumps at once. With the transition on, the scale eases to its new value over the
    // duration (smoothstep), redrawing each frame until it arrives. Off: the scale is used as it is, as before.
    const eased = {};
    let easeRaf = 0;
    // Album Colour Transition: the frame from before a colour-affecting change, faded out over the duration (see draw())
    let lastColorKey = null, colorFade = null, colorRaf = 0;
    const fadeCanvas = document.createElement('canvas');
    function easedScale(key, target) {
        const dur = setting('checkboxTimelineHeightTransition') ? Math.max(0, setting('sliderTimelineHeightTransitionMs')) : 0;
        const st = eased[key];
        if (!st || !dur) { eased[key] = { from: target, to: target, cur: target, t0: 0 }; return target; }
        if (st.to !== target) { st.from = st.cur; st.to = target; st.t0 = performance.now(); }
        const k = Math.min(1, (performance.now() - st.t0) / dur), e = k * k * (3 - 2 * k);
        st.cur = st.from + (st.to - st.from) * e;
        if (k < 1 && !easeRaf) easeRaf = requestAnimationFrame(() => { easeRaf = 0; draw(); });
        return st.cur;
    }

    // Right Click Height on desktop: the drawn graph band is the Timeline Height setting, NOT the canvas (which is as tall as the window), so a right-drag has to
    // change the band. null = use the setting. bandHeight() is what the band is right now (the drag starts from it).
    let bandOverride = null;
    // The song ticks can live on their own canvas (#spx-ticks) BEHIND everything except the background: above the background layers, below the album cover, the text and the
    // graph canvas. It is as big as the stage and is drawn in the timeline canvas's own coordinates (offset by where that canvas is on screen).
    let tickCanvas = null;
    const layers = {}; // the scale / date / song data / scrub line canvases (see layerCtx in draw())
    const getTickCanvas = () => {
        if (!tickCanvas) {
            tickCanvas = document.getElementById('spxTicks'); // main.js creates it with the page (so the UI Layout Inspector can list it)
            if (!tickCanvas) {
                tickCanvas = document.createElement('canvas'); tickCanvas.className = 'spx-ticks';
                const fx = document.getElementById('spxBgFx');
                if (fx && fx.parentNode) fx.parentNode.insertBefore(tickCanvas, fx.nextSibling); else canvas.parentNode.insertBefore(tickCanvas, canvas);
            }
        }
        return tickCanvas;
    };
    function setBandHeight(v) { bandOverride = v > 0 ? v : null; draw(); }
    // Phone only: the canvas can be TALLER than the graph (extra room above it for tall upward song ticks); phoneBand is the graph's own height then (null = the whole canvas is the graph)
    let phoneBand = null;
    function setPhoneBand(v) { const n = v > 0 ? v : null; if (n !== phoneBand) { phoneBand = n; draw(); } }
    function bandHeight() { return activeDevice() === '' ? Math.min(canvas.clientHeight, bandOverride !== null ? bandOverride : setting('sliderTimelineHeight')) : (phoneBand !== null ? Math.min(canvas.clientHeight, phoneBand) : canvas.clientHeight); }
    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, cssH = canvas.clientHeight;
        // The bars use the visible band: the Timeline Height setting on desktop, and the whole canvas on a phone (whose height is
        // already the device's own setting). The canvas itself is taller on desktop, so bars that run above the band are drawn,
        // not cut off. oy moves the band down to the bottom of the canvas.
        const h = activeDevice() === '' ? Math.min(cssH, bandOverride !== null ? bandOverride : setting('sliderTimelineHeight')) : (phoneBand !== null ? Math.min(cssH, phoneBand) : cssH); // bandOverride: set by a right-drag (Right Click Height)
        const oy = cssH - h;
        if (!w || !h) return;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(cssH * dpr);
        }
        span = clampSpan(span);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, oy * dpr);
        // Render order (dev panel > UI Layout > Visibility / Render Order): this canvas draws only the GRAPH. The scale, the add date, the song data row and the scrub line each
        // get a transparent canvas of their own on top of it (same box, no pointer events), so each can sit anywhere in the front-to-back list, between the cover, the text
        // and the buttons. layerCtx() returns that canvas's cleared 2D context in this canvas's own coordinates, or null while the item is switched off.
        let layerBox = null;
        const layerCtx = name => {
            let L = layers[name];
            if (!L) {
                let cv = document.querySelector('canvas.spx-layer[data-layer="' + name + '"]'); // main.js creates these with the page (UI Layout Inspector)
                if (!cv) { cv = document.createElement('canvas'); cv.className = 'spx-layer'; cv.dataset.layer = name; canvas.parentNode.insertBefore(cv, canvas.nextSibling); }
                L = layers[name] = { cv, c: cv.getContext('2d') };
            }
            const cv = L.cv;
            if (!isOn(name)) { cv.style.display = 'none'; return null; }
            cv.style.display = ''; cv.style.zIndex = String(zFor(name));
            if (cv.width !== canvas.width || cv.height !== canvas.height) { cv.width = canvas.width; cv.height = canvas.height; }
            if (!layerBox) { const ar = canvas.parentNode.getBoundingClientRect(), r0 = canvas.getBoundingClientRect(); layerBox = { l: r0.left - ar.left, t: r0.top - ar.top }; }
            // an engine-managed layer (a position mode chosen in the UI Layout Inspector) is placed by the engine instead
            if (cv.classList.contains('ui-mode-flow') || !cv.classList.contains('ui-element')) { cv.style.left = layerBox.l + 'px'; cv.style.top = layerBox.t + 'px'; } else { cv.style.left = ''; cv.style.top = ''; }
            cv.style.width = canvas.clientWidth + 'px'; cv.style.height = canvas.clientHeight + 'px';
            const c = L.c;
            c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.globalAlpha = 1;
            c.setTransform(dpr, 0, 0, dpr, 0, oy * dpr);
            return c;
        };
        // Album Colour Transition: when a colour-affecting input changes (zoom, pan, colour settings), keep what is on screen
        // now so it can fade out over the duration. The colours then change gradually instead of snapping.
        const colorKey = [viewStart, span, setting('checkboxAlbumColorsEnabled'), setting('selectAlbumColorMode'), setting('sliderAlbumColorSaturation'), setting('sliderAlbumColorBrightness')].join('|');
        if (colorKey !== lastColorKey) {
            if (lastColorKey !== null && setting('checkboxAlbumColorTransition') && canvas.width) {
                if (fadeCanvas.width !== canvas.width || fadeCanvas.height !== canvas.height) { fadeCanvas.width = canvas.width; fadeCanvas.height = canvas.height; }
                fadeCanvas.getContext('2d').drawImage(canvas, 0, 0);
                colorFade = { t0: performance.now(), dur: Math.max(1, setting('sliderAlbumColorTransitionMs')) };
            }
            lastColorKey = colorKey;
        }
        ctx.clearRect(0, -oy, w, cssH);
        grayAmt = filterFn ? setting('sliderFilterGraphGrayscale') / 100 : 0;
        const accent = setting('colorTimelineAccent');
        const playheadColor = setting('colorTimelinePlayhead');
        const baseAlpha = setting('sliderTimelineBarOpacity');
        const style = setting('selectTimelineStyle');
        const colorOpts = {
            on: !!setting('checkboxAlbumColorsEnabled') && covers.length > 0,
            mode: setting('selectAlbumColorMode'),
            sat: setting('sliderAlbumColorSaturation'),
            bri: setting('sliderAlbumColorBrightness'),
        };
        // Only the bar band stretches with the canvas height. The scale text keeps a fixed pixel height pinned to the bottom,
        // so making the timeline taller just makes the bars taller, upward.
        // Negative gaps (down to -18) shrink the strip between the bars and the scale text; 0 keeps the original 18 px.
        const axisH = 18, dateH = Math.max(0, 18 + setting('sliderTimelineScaleGap')), ganttTop = h - axisH - dateH, topH = Math.max(12, ganttTop - 4);
        const viewEnd = viewStart + span;
        const i0 = lowerBound(vt, viewStart), i1 = lowerBound(vt, viewEnd);
        const accentCss = rgbCss(hexToRgb(accent), baseAlpha);

        // Song ticks: drawn FIRST by default ("Render Ticks Behind Bars" on) so everything else (the bars, rows, scale, date, playhead) sits on top of them; off = after the bars
        const drawSongTicks = ctx => {
        ctx.save();
        // individual song ticks when zoomed in far enough to tell songs apart: from Song Ticks Start Showing (the pixels between songs) upward
        if (i1 - i0 > 0 && w / (i1 - i0) >= setting('sliderSongTickMinSpacing')) {
            const wr = setting('rangeBarSongTickWidth') || { min: 1, max: 1 };
            const wMinT = Math.max(1, Math.round(Math.min(wr.min, wr.max))), wMaxT = Math.max(wMinT, Math.round(Math.max(wr.min, wr.max))), tickH = Math.max(0, setting('sliderSongTickHeight'));
            // The THINNEST tick (a tick of one song): its width is picked from the Thinnest Song Tick Width Min / Max by the zoom curve (X: 0 = fully zoomed in, 1 = fully
            // zoomed out, the same scale as Zoom Limits). Without Scale Song Ticks every tick is that thin; with it, ticks grow from that width up to the Max along the
            // Song Tick Scale Curve. Every width stays between the Song Tick Width Min (floor) and Max (widest).
            const tr = setting('rangeBarSongTickThinWidth') || { min: 1, max: 1 };
            // Scale Per Zoom curve (the old "Thinnest Per Zoom" one): one overall scale for EVERY tick width as the zoom changes (X: zoom, Y: scale, 1 = the widths as set).
            // Thickest Tick Per Zoom curve: how much further the THICKEST tick's scale is multiplied, so the thinnest and thickest scale at different rates (1 = the same rate);
            // ticks in between blend from one to the other.
            const zf = zoomFraction('limits'), scaleAll = curveValue(setting('curveEditorSongTickThinZoom'), zf), scaleThick = curveValue(setting('curveEditorSongTickThickZoom'), zf);
            const thinT = Math.max(Math.min(tr.min, tr.max), Math.max(tr.min, tr.max) * scaleAll); // the thinnest tick: its Max scaled, never below its Min
            const wMaxEff = Math.max(thinT, wMaxT * scaleAll * scaleThick); // the thickest tick: the Max scaled by both curves
            // Opacity Per Zoom: a SCALE of the tick's own opacity (min / max in % from the range bar, the curve picks between them by zoom; may be negative = invisible).
            // Opacity Per Width: the REAL opacity (min / max in %), the curve picks between them by the tick's width inside the Song Tick Width Min..Max.
            // Both on: the width opacity is the tick's own opacity and the zoom scale multiplies it. The result stays between 0 and 1.
            const opzOn = !!setting('checkboxTickOpacityZoomEnabled'), opwOn = !!setting('checkboxTickOpacityWidthEnabled');
            const opzR = setting('rangeBarTickOpacityZoom') || { min: 0, max: 100 }, opwR = setting('rangeBarTickOpacityWidth') || { min: 0, max: 100 };
            const opzScale = opzOn ? (opzR.min + (opzR.max - opzR.min) * curveValue(setting('curveEditorTickOpacityZoom'), zf)) / 100 : 1;
            // Opacity On Zoom: the REAL opacity (min / max in %) by zoom. With Opacity Per Width also on, the two real opacities multiply.
            const oozOn = !!setting('checkboxTickOpacityOnZoomEnabled'), oozR = setting('rangeBarTickOpacityOnZoom') || { min: 0, max: 100 };
            const oozOpacity = oozOn ? (oozR.min + (oozR.max - oozR.min) * curveValue(setting('curveEditorTickOpacityOnZoom'), zf)) / 100 : 1;
            const tickOp = tw => {
                let o = oozOn ? oozOpacity : setting('sliderSongTickOpacity') / 100;
                if (opwOn) o = (oozOn ? oozOpacity : 1) * (opwR.min + (opwR.max - opwR.min) * curveValue(setting('curveEditorTickOpacityWidth'), wMaxT > wMinT ? Math.min(1, Math.max(0, (tw - wMinT) / (wMaxT - wMinT))) : 0)) / 100;
                return Math.min(1, Math.max(0, o * opzScale));
            };
            let tickOpFlat = tickOp(wMinT);
            const tickO = !setting('checkboxTickMatchGraphColors') || !covers.length ? null : setting('selectTickColorMode') === 'graph' ? colorOpts : { on: true, mode: setting('selectTickColorMode'), sat: setting('sliderTickColorSaturation'), bri: setting('sliderTickColorBrightness') }; // Match Graph Colors
            const paintTick = (px, py, pw, ph, off, a, b) => { const p = !off && tickO && tickO.on ? binPaint(a, b, tickO) : null; if (p) paintFill(ctx, p, px, py, pw, ph, playheadColor, 1); else ctx.fillRect(px, py, pw, ph); };
            const both = !!setting('checkboxSongTickBoth'), tickY = both || setting('checkboxSongTickInvert') ? topH - tickH : topH + 1, tickHH0 = both ? tickH * 2 : tickH; // Both Sides: centred on the graph's bottom line
            // Clamp To Browser: the tick is cut at the window's top / bottom edge (in the graph's own coordinates: the graph's top is cr.top + oy below the window top). Only the edge the
            // tick grows toward can be reached, so this is the bottom edge for a normal tick, the top edge for an inverted one, and both for Both Sides.
            let tickYc = tickY, tickHHc = tickHH0;
            if (setting('checkboxSongTickClamp')) {
                const origin = canvas.getBoundingClientRect().top + oy, y0 = Math.max(tickYc, -origin), y1 = Math.min(tickYc + tickHH0, window.innerHeight - origin);
                tickYc = y0; tickHHc = Math.max(0, y1 - y0);
            }
            // Tick Width Transition Time: the numbers the widths come from (thinnest width, floor, widest, busiest tick's song count) ease toward their new values
            // instead of snapping; 0 = snap, and the widths are then whole pixels.
            const smoothMs = Math.max(0, setting('sliderSongTickWidthTransitionMs'));
            const clampWith = (v, a, b) => Math.max(a, Math.min(b, Math.max(1, smoothMs > 0 ? v : Math.round(v))));
            const grayOp = setting('sliderFilterGrayOpacity') / 100, grayCol = setting('colorFilterGray');
            if (setting('checkboxSongTickScale')) {
                // Scale With Datapoints: the songs that land in the same pixel column are ONE tick, as tall as the Height slider (every tick the same height); the curve sets its width, at
                // (songs in this tick - 1) / (songs in the busiest tick in view - 1); a tick is gray only when none of its songs passes the filter
                const cols = new Map();
                for (let i = i0; i < i1; i++) {
                    const x = Math.round(xOf(vt[i]));
                    let c = cols.get(x);
                    if (!c) { c = { n: 0, on: false, a: i, b: i + 1 }; cols.set(x, c); }
                    c.n++; c.b = i + 1;
                    if (!(filterFn && !filterFn(i))) c.on = true;
                }
                let maxN = 1;
                cols.forEach(c => { if (c.n > maxN) maxN = c.n; });
                const ts = tickWidthsNow({ wMin: wMinT, wMax: wMaxEff, thin: thinT, maxN });
                const curve = setting('curveEditorSongTickScale');
                cols.forEach((c, x) => {
                    const t = ts.maxN > 1 ? Math.min(1, (c.n - 1) / (ts.maxN - 1)) : 0; // only one song in the busiest tick (e.g. a single tick on screen): every tick is "one song" = the thinnest, not the widest
                    const off = !!filterFn && !c.on;
                    ctx.globalAlpha = off ? grayOp : tickOpFlat;
                    ctx.fillStyle = off ? grayCol : playheadColor;
                    const cv = curveValue(curve, t), tw = clampWith(ts.thin + (ts.wMax - ts.thin) * cv, ts.wMin, ts.wMax); // width: from the thinnest tick's width up to the Max along the curve; height: Height x the curve
                    if (!off) ctx.globalAlpha = tickOp(tw);
                    paintTick(x - (smoothMs > 0 ? tw / 2 : Math.floor(tw / 2)), tickYc, tw, tickHHc, off, c.a, c.b);
                });
            } else {
                const ts = tickWidthsNow({ wMin: wMinT, wMax: wMaxEff, thin: thinT, maxN: 1 });
                const tickW = clampWith(ts.thin, ts.wMin, ts.wMax);
                tickOpFlat = tickOp(tickW);
                for (let i = i0; i < i1; i++) {
                    const off = !!filterFn && !filterFn(i);
                    ctx.globalAlpha = off ? grayOp : tickOpFlat;
                    ctx.fillStyle = off ? grayCol : playheadColor;
                    paintTick(Math.round(xOf(vt[i])) - (smoothMs > 0 ? tickW / 2 : Math.floor(tickW / 2)), tickYc, tickW, tickHHc, off, i, i + 1); // one mark per song; it hangs down from the graph's bottom edge
                }
            }
        }
        ctx.restore();
        };
        const tc = getTickCanvas();
        if (isOn('ticks')) {
            tc.style.zIndex = String(zFor('ticks'));
            const sw = tc.clientWidth, sh = tc.clientHeight;
            if (tc.width !== Math.round(sw * dpr) || tc.height !== Math.round(sh * dpr)) { tc.width = Math.round(sw * dpr); tc.height = Math.round(sh * dpr); }
            const tctx = tc.getContext('2d');
            tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tc.width, tc.height);
            const cr = canvas.getBoundingClientRect(), sr = tc.getBoundingClientRect();
            tctx.setTransform(dpr, 0, 0, dpr, (cr.left - sr.left) * dpr, (cr.top - sr.top + oy) * dpr);
            tc.style.display = '';
            drawSongTicks(tctx);
        } else tc.style.display = 'none';


        // bins: bar width is a setting ("granularity"); each bin knows its contiguous song range
        const barPx = clamp(setting('sliderBarWidth'), 1, 60);
        const nb = Math.max(1, Math.floor(w / barPx));
        const bw = w / nb;
        // Every bar covers the same fixed slice of time (binVt) on a grid that starts at time 0, so which songs share a bar - and with
        // them the bar's colors - do not change while the view is panned; only zooming changes the grouping. offX = where the first
        // (partly visible) bar starts, left of the screen edge.
        const binVt = span / nb, k0 = Math.floor(viewStart / binVt);
        const offX = ((k0 * binVt) - viewStart) / span * w;
        const bins = new Array(nb + 2).fill(null);
        const j0 = lowerBound(vt, k0 * binVt), j1 = lowerBound(vt, (k0 + nb + 2) * binVt);
        for (let i = j0; i < j1; i++) {
            const b = clamp(Math.floor(vt[i] / binVt) - k0, 0, nb + 1);
            if (!bins[b]) bins[b] = { a: i, b: i + 1 }; else bins[b].b = i + 1;
        }
        let maxBin = 1;
        bins.forEach(bn => { if (bn) maxBin = Math.max(maxBin, bn.b - bn.a); });
        const shownBin = easedScale('bins', maxBin);
        const binH = bn => ((bn.b - bn.a) / shownBin) * (topH - 6);
        const binColorOf = bn => binPaint(bn.a, bn.b, colorOpts);
        // Audio-feature filter (the Filter button): songs that do not pass are drawn gray. validOf(bn) = how many of the bar's songs pass.
        const filt = filterFn;
        const validOf = bn => { if (!filt) return bn.b - bn.a; let c = 0; for (let i = bn.a; i < bn.b; i++) if (filt(i)) c++; return c; };
        const grayCss = filt ? rgbCss(hexToRgb(setting('colorFilterGray')), setting('sliderFilterGrayOpacity') / 100) : '';
        const flatGray = !!filt && !colorOpts.on; // album colors off: filtered-out parts of a bar are a flat gray

        if (style === 'none') {
            bins.forEach((bn, b) => {
                if (!bn) return;
                const n = bn.b - bn.a, ok = validOf(bn), full = binH(bn), x = b * bw + offX, ww = Math.max(1, bw - 0.5);
                if (ok === n || !flatGray) { paintFill(ctx, binColorOf(bn), x, topH - full, ww, full, accentCss, baseAlpha); return; }
                const okH = full * ok / n; // the passing songs keep their colour at the bottom, the rest of the bar is gray
                if (okH > 0) paintFill(ctx, binColorOf(bn), x, topH - okH, ww, okH, accentCss, baseAlpha);
                ctx.fillStyle = grayCss; ctx.fillRect(x, topH - full, ww, full - okH);
            });
        } else if (style === 'glow') {
            const stemW = setting('sliderGlowStemWidth'), radius = setting('sliderGlowRadius');
            const dot = setting('sliderGlowDotSize'), intensity = setting('sliderGlowIntensity');
            bins.forEach((bn, b) => {
                if (!bn) return;
                const paint = binColorOf(bn);
                let rgb = paint ? (paint.solid || (paint.gradient && paint.gradient[paint.gradient.length >> 1]) || paint.stack[paint.stack.length - 1]) : hexToRgb(accent);
                if (flatGray && validOf(bn) === 0) rgb = hexToRgb(setting('colorFilterGray')); // nothing in this bar passes the filter
                const x = b * bw + offX + bw / 2, top = topH - binH(bn);
                ctx.save();
                ctx.shadowColor = rgbCss(rgb, intensity);
                ctx.shadowBlur = radius;
                ctx.fillStyle = rgbCss(rgb, baseAlpha);
                ctx.fillRect(x - stemW / 2, top, stemW, topH - top);
                ctx.beginPath();
                ctx.arc(x, top, dot, 0, Math.PI * 2);
                ctx.fillStyle = rgbCss(rgb, Math.min(1, baseAlpha + 0.2));
                ctx.fill();
                ctx.restore();
            });
        } else if (style === 'density') {
            // per-pixel-column counts, blurred into a smooth curve
            const dens = new Float32Array(Math.max(2, Math.ceil(w)));
            for (let i = i0; i < i1; i++) dens[clamp(Math.floor(xOf(vt[i])), 0, dens.length - 1)] += 1;
            smooth(dens, setting('sliderDensitySmoothing'));
            const mx = easedScale('dens', Math.max(1e-6, ...dens));
            const fillA = setting('sliderDensityFillOpacity'), lineW = setting('sliderDensityOutlineWidth');
            const ys = Array.from(dens, d => topH - (d / mx) * (topH - 6));
            // horizontal colour: accent, or the album colours of the songs under each stretch. A datapoint's colour BEGINS at its add
            // time; before that the line shows the previous datapoint's colour, blended into the new one over "Color Blend Before Add Time"
            // (a % of the distance back to the previous datapoint): 0 = a hard step exactly at the add time, 100 = blended all the way
            // from the previous datapoint (the smoothest, and how it always looked before this slider).
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            const accRgb = hexToRgb(accent), blendPct = clamp(setting('sliderDensityColorBlend'), 0, 100) / 100;
            const colPts = [];
            if (colorOpts.on) bins.forEach((bn, b) => {
                if (!bn) return;
                const p = binColorOf(bn);
                if (p) colPts.push({ x: (b + 0.5) * bw + offX, rgb: p.solid || (p.gradient && p.gradient[p.gradient.length >> 1]) || p.stack[p.stack.length >> 1] });
            });
            let lastF = 0;
            const stop = (x, rgb) => { const f = Math.max(lastF, clamp(x / w, 0, 1)); lastF = f; grad.addColorStop(f, rgbCss(rgb, 1)); };
            if (!colPts.length) { grad.addColorStop(0, rgbCss(accRgb, 1)); grad.addColorStop(1, rgbCss(accRgb, 1)); }
            else {
                stop(0, colPts[0].rgb);
                colPts.forEach((pt, i) => {
                    if (i) { const prev = colPts[i - 1]; stop(pt.x - blendPct * (pt.x - prev.x), prev.rgb); } // the previous colour holds until the blend starts
                    stop(pt.x, pt.rgb);
                });
                stop(w, colPts[colPts.length - 1].rgb);
            }
            ctx.beginPath();
            ctx.moveTo(0, topH);
            ys.forEach((y, x) => ctx.lineTo(x, y));
            ctx.lineTo(ys.length - 1, topH);
            ctx.closePath();
            ctx.save();
            ctx.globalAlpha = fillA;
            // Colour modes whose bars have vertical colour (Stacked Albums, Palette Gradient, Vivid Dominant Gradient): paint each
            // bar-wide strip of the area with that bar's own vertical colours, scaled to the area's height there, so the density
            // curve shows the same colours the bars would. Single-colour modes keep the smooth horizontal gradient.
            const paints = bins.map(bn => (colorOpts.on && bn ? binColorOf(bn) : null));
            if (paints.some(p => p && (p.stack || p.gradient))) {
                ctx.clip();
                const fallbackCss = rgbCss(hexToRgb(accent), 1);
                for (let b = 0; b < nb + 2; b++) {
                    let p = paints[b];
                    for (let d = 1; !p && d < nb + 2; d++) p = paints[b - d] || paints[b + d] || null; // nearest bar that has colours
                    const x0 = b * bw + offX, x1 = Math.min(ys.length, Math.ceil(x0 + bw) + 1);
                    let top = topH;
                    for (let x = Math.max(0, Math.floor(x0)); x < x1; x++) top = Math.min(top, ys[x] === undefined ? topH : ys[x]);
                    paintFill(ctx, p, x0, top, bw + 0.5, Math.max(1, topH - top), fallbackCss, 1);
                }
            } else {
                ctx.fillStyle = grad; // hue comes from the horizontal gradient
                ctx.fill();
            }
            if (setting('checkboxDensityGradientFill')) { // optional vertical fade toward the baseline
                ctx.globalCompositeOperation = 'destination-out';
                const fade = ctx.createLinearGradient(0, 0, 0, topH);
                fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.85)');
                ctx.globalAlpha = 1; ctx.fillStyle = fade; ctx.fillRect(0, 0, w, topH);
            }
            ctx.restore();
            if (lineW > 0) {
                ctx.beginPath();
                ys.forEach((y, x) => (x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.strokeStyle = grad; ctx.lineWidth = lineW; ctx.globalAlpha = Math.min(1, baseAlpha + 0.2); ctx.stroke(); ctx.globalAlpha = 1;
            }
        } else if (style === 'line') {
            const key = FEATURE_KEY[setting('selectLineFeature')] || 'v';
            const lineW = setting('sliderLineWidth'), dot = setting('sliderLineDotSize'), fillA = setting('sliderLineFillOpacity');
            const pts = [];
            const lo = Math.max(0, i0 - 1), hi = Math.min(n, i1 + 1);
            for (let i = lo; i < hi; i++) { const v = songs[i][key]; if (v != null) pts.push({ x: xOf(vt[i]), y: topH - 4 - v * (topH - 12), i }); }
            if (pts.length) {
                const accRgb = hexToRgb(accent);
                const pointRgb = p => { const c = colorOpts.on ? coverOf(p.i) : null; return c ? adjust(c[colorOpts.mode === 'vivid' || colorOpts.mode === 'vividStacked' ? 1 : 0], colorOpts.sat, colorOpts.bri) : accRgb; };
                if (fillA > 0) { // area under the line
                    ctx.beginPath(); ctx.moveTo(pts[0].x, topH);
                    pts.forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.lineTo(pts[pts.length - 1].x, topH); ctx.closePath();
                    const g = ctx.createLinearGradient(0, 0, 0, topH);
                    g.addColorStop(0, rgbCss(accRgb, fillA)); g.addColorStop(1, rgbCss(accRgb, 0));
                    ctx.fillStyle = g; ctx.fill();
                }
                ctx.lineWidth = lineW; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
                const curve = setting('checkboxLineSmooth');
                for (let k = 1; k < pts.length; k++) { // per-segment so colours can differ along the line
                    const a = pts[k - 1], b = pts[k];
                    ctx.beginPath(); ctx.moveTo(a.x, a.y);
                    if (curve) ctx.quadraticCurveTo((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2), ctx.quadraticCurveTo((a.x + b.x) / 2, b.y, b.x, b.y);
                    else ctx.lineTo(b.x, b.y);
                    ctx.strokeStyle = rgbCss(pointRgb(b), Math.min(1, baseAlpha + 0.15)); ctx.stroke();
                }
                if (dot > 0) pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, dot, 0, Math.PI * 2); ctx.fillStyle = rgbCss(pointRgb(p), 1); ctx.fill(); });
            }
        } else if (style === 'ribbon') {
            const key = FEATURE_KEY[setting('selectRibbonFeature')] || 'v';
            const thick = setting('sliderRibbonThickness'), sm = setting('sliderRibbonSmoothing'), barsA = setting('sliderRibbonBarsOpacity');
            const cols = Math.max(2, Math.ceil(w));
            const cnt = new Float32Array(cols), fsum = new Float32Array(cols), fcnt = new Float32Array(cols);
            for (let i = i0; i < i1; i++) {
                const x = clamp(Math.floor(xOf(vt[i])), 0, cols - 1);
                cnt[x] += 1;
                const v = songs[i][key];
                if (v != null) { fsum[x] += v; fcnt[x] += 1; }
            }
            smooth(cnt, sm); smooth(fsum, sm); smooth(fcnt, sm);
            const mx = easedScale('ribbon', Math.max(1e-6, ...cnt));
            // faint bars underneath keep the individual add dates readable
            ctx.globalAlpha = barsA;
            bins.forEach((bn, b) => { if (bn) { ctx.fillStyle = accentCss; ctx.fillRect(b * bw + offX, topH - binH(bn), Math.max(1, bw - 0.5), binH(bn)); } });
            ctx.globalAlpha = 1;
            const mid = topH / 2;
            for (let x = 0; x < cols; x++) {
                if (cnt[x] < 1e-3) continue;
                const f = fcnt[x] > 1e-6 ? fsum[x] / fcnt[x] : 0.5;
                let rgb = hslToRgb([220 - f * 180, 0.75, 0.45 + f * 0.15]); // low = cool blue, high = warm yellow
                if (colorOpts.on) { // album colours under this pixel column instead of the feature hue
                    const bi = clamp(Math.floor(((x / cols) * w - offX) / bw), 0, nb + 1);
                    const bn = bins[bi];
                    const p = bn && binColorOf(bn);
                    if (p) rgb = p.solid || (p.gradient && p.gradient[p.gradient.length >> 1]) || p.stack[p.stack.length >> 1];
                }
                const th = thick * (0.35 + 0.65 * Math.min(1, cnt[x] / mx));
                ctx.fillStyle = rgbCss(rgb, Math.min(1, baseAlpha + 0.1));
                ctx.fillRect(x, mid - th / 2, 1.5, th);
            }
        }

        // exact add date/time of the current song: under the graph, above the scale text
        { const ctx = layerCtx('date');
        if (ctx && dateLine && setting('checkboxSongAddDateEnabled')) {
            ctx.globalAlpha = setting('sliderSongAddDateOpacity');
            ctx.fillStyle = setting('colorSongAddDate');
            ctx.font = `${setting('checkboxSongAddDateBold') ? 'bold ' : ''}${setting('sliderSongAddDateFontSize')}px ${getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'}`;
            ctx.letterSpacing = `${setting('sliderSongAddDateLetterSpacing')}px`;
            ctx.textAlign = 'center';
            ctx.fillText(dateLine, w / 2, h - axisH - dateH / 2 + 4.5 + setting('sliderSongAddDateOffsetY')); // centred in the strip between the graph and the scale text, moved by the Y Offset
            ctx.textAlign = 'start';
            ctx.letterSpacing = '0px';
        }
        }

        // Song Data (the button under Shuffle): tempo / valence / danceability / energy of the shown song, each as an icon and a number,
        // right-aligned on the same row as the add date.
        { const ctx = layerCtx('songdata');
        const sdItems = songData && songData.length ? songData : (sdAlpha > 0 ? sdLast : null); // while fading out, the last row is still drawn
        if (ctx && sdItems && sdAlpha > 0) {
            const fsz = setting('sliderSongDataFontSize'), ic = setting('sliderSongDataIconSize'), gIc = setting('sliderSongDataIconGap'), gIt = setting('sliderSongDataItemGap');
            ctx.globalAlpha = setting('sliderSongDataOpacity') * sdAlpha; // sdAlpha: the fade when the Song Data button is switched on / off
            ctx.fillStyle = ctx.strokeStyle = setting('colorSongData');
            const fam = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif';
            // The row is centred vertically on the add date's text: the middle of the date's digits (measured with the date's own font) is the row's centre
            // line; the icons are centred on it and each number's digits are centred on it too, whatever the two font sizes are.
            const digitMid = font => { ctx.font = font; const m = ctx.measureText('0'); return (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2; };
            const dateBase = h - axisH - dateH / 2 + 4.5 + setting('sliderSongAddDateOffsetY'); // the add date's text baseline (the Song Data row follows the date's Y Offset)
            const yc = dateBase - digitMid(`${setting('checkboxSongAddDateBold') ? 'bold ' : ''}${setting('sliderSongAddDateFontSize')}px ${fam}`) + setting('sliderSongDataOffsetY');
            const dataFont = `${setting('checkboxSongDataBold') ? 'bold ' : ''}${fsz}px ${fam}`;
            const base = yc + digitMid(dataFont); // baseline that puts the number's digits on the centre line
            ctx.font = dataFont;
            ctx.letterSpacing = '0px';
            ctx.textAlign = 'start';
            const items = sdItems.map(it => ({ ...it, tw: ctx.measureText(it.text).width }));
            const total = items.reduce((sum, it) => sum + ic + gIc + it.tw, 0) + gIt * (items.length - 1);
            let x = w - setting('sliderSongDataEdgeOffset') - total;
            items.forEach(it => {
                ctx.save();
                ctx.translate(x, yc - ic / 2); // icon centred on the row's centre line
                ctx.scale(ic / ICON_BOX, ic / ICON_BOX);
                (it.shapes || []).forEach(([p2, eo]) => ctx.fill(p2, eo ? 'evenodd' : 'nonzero'));
                ctx.restore();
                ctx.fillText(it.text, x + ic + gIc, base);
                x += ic + gIc + it.tw + gIt;
            });
        }
        }

        // axis
        // Timeline Scale: the scale numbers and the tick marks each have their own settings
        { const ctx = layerCtx('scale');
        if (ctx) {
        const numFont = `${setting('checkboxScaleNumbersBold') ? 'bold ' : ''}${setting('sliderScaleNumbersFontSize')}px system-ui, sans-serif`;
        // a tick stands on its bottom edge, which sits Start Height above the scale line, and rises Height upward from there
        const tickBottom = h - axisH - setting('sliderTickStartHeight'); // negative values put the tick below the scale line
        ctx.letterSpacing = `${setting('sliderScaleNumbersLetterSpacing')}px`;
        const grayTicks = !!filterFn && !!cumValid && setting('checkboxFilterGrayTicks');
        ticks().forEach(t => {
            // no song in this tick's time span passes the filter: the tick and its number are grayed
            const dead = grayTicks && cumValid[lowerBound(vt, t.v1)] - cumValid[lowerBound(vt, t.v0)] === 0;
            ctx.globalAlpha = dead ? setting('sliderFilterTickGrayOpacity') / 100 : setting('sliderTickOpacity');
            ctx.fillStyle = dead ? setting('colorFilterTickGray') : setting('colorTickMark');
            ctx.fillRect(t.x, tickBottom - setting('sliderTickHeight'), setting('sliderTickWidth'), setting('sliderTickHeight'));
            ctx.globalAlpha = dead ? setting('sliderFilterNumberGrayOpacity') / 100 : setting('sliderScaleNumbersOpacity');
            ctx.fillStyle = dead ? setting('colorFilterTickGray') : setting('colorScaleNumbers');
            ctx.font = numFont;
            ctx.fillText(t.text, t.x + setting('sliderScaleNumbersOffsetX'), h - 4);
        });
        ctx.letterSpacing = '0px';
        }
        }

        // playhead (the scrub line)
        { const ctx = layerCtx('scrub');
        if (ctx) {
        ctx.globalAlpha = phOpacity();
        ctx.fillStyle = playheadColor;
        const phW = playheadW(), phH = Math.max(1, ((h - axisH) * setting('sliderPlayheadHeight')) / 100);
        const phBottom = (h - axisH) - Math.max(0, setting('sliderPlayheadStartHeight'));
        ctx.fillRect(Math.round(xOf(posToVt(pos)) - phW / 2), phBottom - phH, phW, phH);
        }
        }

        // Graph switched off in the render-order list: the canvas stays (it is what takes the clicks) but draws nothing
        if (!isOn('graph')) ctx.clearRect(0, -oy, w, cssH);

        // Album Colour Transition: the frame from before the change, fading out over the duration on top of the new frame
        if (colorFade && isOn('graph')) {
            const k = Math.min(1, (performance.now() - colorFade.t0) / colorFade.dur);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1 - k;
            ctx.drawImage(fadeCanvas, 0, 0);
            ctx.restore();
            if (k < 1) { if (!colorRaf) colorRaf = requestAnimationFrame(() => { colorRaf = 0; draw(); }); }
            else colorFade = null;
        }
    }

    // The numbers the song ticks' widths are worked out from, eased toward their targets over Tick Width Transition Time (called while drawing; it asks for
    // another frame until they have arrived). target = { wMin, wMax, thin, maxN }.
    let tickShown = null, tickAnimT = 0, tickRaf = 0;
    function tickWidthsNow(target) {
        const dur = Math.max(0, setting('sliderSongTickWidthTransitionMs')), now = performance.now();
        if (!tickShown || dur === 0) { tickShown = { ...target }; tickAnimT = now; return tickShown; }
        let dt = now - tickAnimT; if (dt > 100) dt = 16; if (dt < 0) dt = 0; // the first frame after a pause starts from where the widths were
        tickAnimT = now;
        const k = 1 - Math.exp(-dt / (dur / 3));
        let moving = false;
        for (const key of ['wMin', 'wMax', 'thin', 'maxN']) {
            tickShown[key] += (target[key] - tickShown[key]) * k;
            if (Math.abs(target[key] - tickShown[key]) > 0.02) moving = true; else tickShown[key] = target[key];
        }
        if (moving && !tickRaf) tickRaf = requestAnimationFrame(() => { tickRaf = 0; draw(); });
        return tickShown;
    }
    // A curve editor's value (0..1) at x (0..1): the dev panel's own evaluator when it is there, else straight lines between the points.
    function curveValue(curve, x) {
        const pts = curve && curve.points && curve.points.length ? curve.points : [{ x: 0, y: 1 }, { x: 1, y: 1 }];
        let y;
        if (typeof window.evaluateCurveEditorPoints === 'function') y = window.evaluateCurveEditorPoints(pts, x, (curve && curve.method) || 'monotone');
        else { const q = [...pts].sort((a, b) => a.x - b.x); y = x <= q[0].x ? q[0].y : q[q.length - 1].y; for (let k = 0; k < q.length - 1; k++) if (x <= q[k + 1].x) { y = q[k].y + ((x - q[k].x) / ((q[k + 1].x - q[k].x) || 1)) * (q[k + 1].y - q[k].y); break; } }
        return Math.min(1, Math.max(0, y));
    }
    // Where the current zoom sits between the smallest and largest span, 0 = fully zoomed in, 1 = fully zoomed
    // out, on the same log scale as the Zoom Limits slider. range 'limits' (default) spans the slider's
    // min..max; 'full' spans everything (2 minutes .. the whole timeline).
    function zoomFraction(range) {
        let lo = MIN_SPAN_MS, hi = FULL_SPAN;
        if (range !== 'full') ({ lo, hi } = zoomLimits());
        if (hi <= lo * 1.0001) return 0;
        return clamp((Math.log(span) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0, 1);
    }
    // How far along the whole timeline the playhead is (0 = first add, 1 = last add), by time.
    const timeFraction = () => clamp((posToVt(pos) - vMin) / total, 0, 1);
    // Set the visible span directly (clamped to the zoom limits), keeping the playhead where it is on screen.
    function setSpanMs(ms) { zoomBy(clampSpan(ms) / span); }

    function setFilter(fn) {
        filterFn = fn;
        cumValid = null;
        if (fn) { cumValid = new Uint32Array(n + 1); for (let i = 0; i < n; i++) cumValid[i + 1] = cumValid[i] + (fn(i) ? 1 : 0); }
        draw();
    }
    // Song Data row: [{ key, text }] or null. The icon paths come from the filter panel's icons.
    let songData = null, sdLast = null, sdAlpha = 0, sdFadeRaf = 0, sdFadeT = 0; // the row, the last row (drawn while it fades out), its fade 0..1
    function setSongData(items) {
        songData = items ? items.map(it => ({ ...it, shapes: featureIcon(it.key, setting(FEATURE_ICON_SETTING[it.key])).p.map(([d, eo]) => [new Path2D(d), eo]) })) : null;
        if (songData) sdLast = songData;
        // Switching the row on fades it in, switching it off fades it out (Song Data > Fade Duration); a change of song while it is on does not fade.
        const target = songData ? 1 : 0, dur = Math.max(0, setting('sliderSongDataFadeMs'));
        if (sdAlpha === target) { draw(); return; }
        if (dur === 0) { sdAlpha = target; draw(); return; }
        cancelAnimationFrame(sdFadeRaf); sdFadeT = performance.now();
        const step = now => {
            const d = Math.max(0, Math.min(100, now - sdFadeT)); sdFadeT = now;
            sdAlpha = target ? Math.min(1, sdAlpha + d / dur) : Math.max(0, sdAlpha - d / dur);
            draw();
            if (sdAlpha !== target) sdFadeRaf = requestAnimationFrame(step); else sdFadeRaf = 0;
        };
        sdFadeRaf = requestAnimationFrame(step);
    }
    let dateLine = '';
    function setDateLine(t) { if (t !== dateLine) { dateLine = t; draw(); } }
    function centerOnPlayhead() { keepPlayheadVisible(true); }
    window.addEventListener('resize', draw);
    centerOnPlayhead();
    return { draw, setBandHeight, setPhoneBand, bandHeight, setFilter, setSongData, setDateLine, panPx, setPlayheadState, playheadX: () => xOf(posToVt(pos)), get fullSpanMs() { return FULL_SPAN; }, setPos, zoomBy, scrubByPixels, posAtX, centerOnPlayhead, currentIndex, zoomFraction, timeFraction, setSpanMs, width: W, get span() { return span; } };
}
