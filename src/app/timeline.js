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
import { setting } from './settings.js';

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
    const FULL_SPAN = total * 1.02;
    const ranges = data.playlists.map(() => ({ lo: Infinity, hi: -Infinity }));
    songs.forEach((s, i) => {
        const r = ranges[s.p];
        r.lo = Math.min(r.lo, vt[i]);
        r.hi = Math.max(r.hi, vt[i]);
    });

    // Playlist rows are stacked in order of when each playlist STARTED (its first add), earliest at the
    // top, so they form a staircase. (They used to follow the files' alphabetical order, which meant the
    // vertical position said nothing.)
    const rowOf = data.playlists.map((_, i) => i).sort((a, b) => ranges[a].lo - ranges[b].lo || a - b)
        .reduce((m, pl, rank) => { m[pl] = rank; return m; }, []);
    let bandGeom = { ganttTop: 0, rowH: 1 };

    // ---- zoom limits: a 0-100 % log scale from "2 minutes visible" to "whole timeline" ----
    function zoomLimits() {
        const lim = setting('rangeBarTimelineZoomLimits') || { min: 0, max: 100 };
        const f = p => MIN_SPAN_MS * Math.pow(FULL_SPAN / MIN_SPAN_MS, clamp(p, 0, 100) / 100);
        return { lo: f(Math.min(lim.min, lim.max)), hi: f(Math.max(lim.min, lim.max)) };
    }
    const clampSpan = s => { const { lo, hi } = zoomLimits(); return clamp(s, lo, hi); };

    let span = clampSpan(Math.min(FULL_SPAN, Math.max(MIN_SPAN_MS, setting('sliderDefaultTimelineSpanDays') * DAY)));
    let viewStart = vMin;
    let pos = 0;

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
        const pad = span * 0.05;
        viewStart = Math.min(vMax + pad - span, Math.max(vMin - pad, viewStart));
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
    // Move the playhead dx px along the current scale (positive = later); returns the new position.
    function scrubByPixels(dx) { return vtToPos(posToVt(pos) + (dx / W()) * span); }
    // The position under a canvas x (clicking the timeline jumps here).
    function posAtX(x) { return vtToPos(viewStart + (clamp(x, 0, W()) / W()) * span); }

    // ---- ticks -------------------------------------------------------------
    const vtOfReal = t => t + lowerBound(real, t + 1) * SPACING_MS;
    function ticks() {
        const realOf = v => v - clamp(Math.round(vtToPos(v)), 0, n - 1) * SPACING_MS;
        const startReal = new Date(realOf(viewStart));
        const endReal = new Date(realOf(viewStart + span));
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
        while (d <= endReal && guard++ < 5000) { out.push({ x: xOf(vtOfReal(d.getTime())), text: label(d) }); step(); }
        const thinned = [];
        let lastX = -1e9;
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
    const coverOf = i => (songs[i].c !== undefined ? covers[songs[i].c] : null);
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

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        span = clampSpan(span);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
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
        // Only the bar band stretches with the canvas height. The playlist rows and the axis keep a
        // fixed pixel height pinned to the bottom (a short canvas shrinks the rows a little), so
        // making the timeline taller just makes the bars taller, upward.
        const axisH = 18, dateH = 18, ganttH = Math.min(76, Math.max(20, h * 0.4)), ganttTop = h - axisH - dateH - ganttH, topH = Math.max(12, ganttTop - 4);
        const viewEnd = viewStart + span;
        const i0 = lowerBound(vt, viewStart), i1 = lowerBound(vt, viewEnd);
        const accentCss = rgbCss(hexToRgb(accent), baseAlpha);

        // bins: bar width is a setting ("granularity"); each bin knows its contiguous song range
        const barPx = clamp(setting('sliderBarWidth'), 1, 60);
        const nb = Math.max(1, Math.floor(w / barPx));
        const bw = w / nb;
        const bins = new Array(nb).fill(null);
        for (let i = i0; i < i1; i++) {
            const b = clamp(Math.floor(((vt[i] - viewStart) / span) * nb), 0, nb - 1);
            if (!bins[b]) bins[b] = { a: i, b: i + 1 }; else bins[b].b = i + 1;
        }
        let maxBin = 1;
        bins.forEach(bn => { if (bn) maxBin = Math.max(maxBin, bn.b - bn.a); });
        const binH = bn => ((bn.b - bn.a) / maxBin) * (topH - 6);
        const binColorOf = bn => binPaint(bn.a, bn.b, colorOpts);

        if (style === 'none') {
            bins.forEach((bn, b) => { if (bn) paintFill(ctx, binColorOf(bn), b * bw, topH - binH(bn), Math.max(1, bw - 0.5), binH(bn), accentCss, baseAlpha); });
        } else if (style === 'glow') {
            const stemW = setting('sliderGlowStemWidth'), radius = setting('sliderGlowRadius');
            const dot = setting('sliderGlowDotSize'), intensity = setting('sliderGlowIntensity');
            bins.forEach((bn, b) => {
                if (!bn) return;
                const paint = binColorOf(bn);
                const rgb = paint ? (paint.solid || (paint.gradient && paint.gradient[paint.gradient.length >> 1]) || paint.stack[paint.stack.length - 1]) : hexToRgb(accent);
                const x = b * bw + bw / 2, top = topH - binH(bn);
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
            const mx = Math.max(1e-6, ...dens);
            const fillA = setting('sliderDensityFillOpacity'), lineW = setting('sliderDensityOutlineWidth');
            const ys = Array.from(dens, d => topH - (d / mx) * (topH - 6));
            // horizontal colour: accent, or the album colours of the songs under each stretch
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            const stops = Math.min(nb, 120);
            for (let s = 0; s <= stops; s++) {
                const f = s / stops, bi = clamp(Math.floor(f * (nb - 1)), 0, nb - 1);
                let rgb = hexToRgb(accent);
                if (colorOpts.on) {
                    for (let d = 0; d < nb; d++) { // nearest non-empty bin
                        const bn = bins[clamp(bi + (d % 2 ? -(d >> 1) - 1 : d >> 1), 0, nb - 1)];
                        if (bn) { const p = binColorOf(bn); if (p) rgb = p.solid || (p.gradient && p.gradient[p.gradient.length >> 1]) || p.stack[p.stack.length >> 1]; break; }
                    }
                }
                grad.addColorStop(f, rgbCss(rgb, 1));
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
                for (let b = 0; b < nb; b++) {
                    let p = paints[b];
                    for (let d = 1; !p && d < nb; d++) p = paints[b - d] || paints[b + d] || null; // nearest bar that has colours
                    const x0 = b * bw, x1 = Math.min(ys.length, Math.ceil((b + 1) * bw) + 1);
                    let top = topH;
                    for (let x = Math.floor(x0); x < x1; x++) top = Math.min(top, ys[x] === undefined ? topH : ys[x]);
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
                const pointRgb = p => { const c = colorOpts.on ? coverOf(p.i) : null; return c ? adjust(c[colorOpts.mode === 'vivid' ? 1 : 0], colorOpts.sat, colorOpts.bri) : accRgb; };
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
            const mx = Math.max(1e-6, ...cnt);
            // faint bars underneath keep the individual add dates readable
            ctx.globalAlpha = barsA;
            bins.forEach((bn, b) => { if (bn) { ctx.fillStyle = accentCss; ctx.fillRect(b * bw, topH - binH(bn), Math.max(1, bw - 0.5), binH(bn)); } });
            ctx.globalAlpha = 1;
            const mid = topH / 2;
            for (let x = 0; x < cols; x++) {
                if (cnt[x] < 1e-3) continue;
                const f = fcnt[x] > 1e-6 ? fsum[x] / fcnt[x] : 0.5;
                let rgb = hslToRgb([220 - f * 180, 0.75, 0.45 + f * 0.15]); // low = cool blue, high = warm yellow
                if (colorOpts.on) { // album colours under this pixel column instead of the feature hue
                    const bi = clamp(Math.floor((x / cols) * nb), 0, nb - 1);
                    const bn = bins[bi];
                    const p = bn && binColorOf(bn);
                    if (p) rgb = p.solid || (p.gradient && p.gradient[p.gradient.length >> 1]) || p.stack[p.stack.length >> 1];
                }
                const th = thick * (0.35 + 0.65 * Math.min(1, cnt[x] / mx));
                ctx.fillStyle = rgbCss(rgb, Math.min(1, baseAlpha + 0.1));
                ctx.fillRect(x, mid - th / 2, 1.5, th);
            }
        }

        // playlist rows
        const rowH = ganttH / ranges.length;
        bandGeom = { ganttTop, rowH };
        const curP = songs[currentIndex()].p;
        ranges.forEach((r, i) => {
            if (r.hi < viewStart || r.lo > viewEnd) return;
            const x0 = Math.max(0, xOf(r.lo)), x1 = Math.min(w, xOf(r.hi));
            ctx.globalAlpha = i === curP ? 1 : 0.35;
            ctx.fillStyle = i === curP ? playheadColor : accent;
            ctx.fillRect(x0, ganttTop + rowOf[i] * rowH, Math.max(2, x1 - x0), Math.max(1, rowH - 1));
        });

        // exact add date/time of the current song: under the playlist rows, above the scale text
        if (dateLine) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = playheadColor;
            ctx.font = `bold 13px ${getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'}`;
            ctx.textAlign = 'center';
            ctx.fillText(dateLine, w / 2, h - axisH - 4);
            ctx.textAlign = 'start';
        }

        // axis
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = playheadColor;
        ctx.font = '11px system-ui, sans-serif';
        ticks().forEach(t => { ctx.fillRect(t.x, h - axisH, 1, 5); ctx.fillText(t.text, t.x + 3, h - 4); });

        // individual song ticks when zoomed in far enough to tell songs apart
        if (i1 - i0 > 0 && (i1 - i0) * 4 < w) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = playheadColor;
            for (let i = i0; i < i1; i++) ctx.fillRect(Math.round(xOf(vt[i])), topH + 1, 1, 3);
        }

        // playhead
        ctx.globalAlpha = 1;
        ctx.fillStyle = playheadColor;
        const phW = Math.max(1, setting('sliderPlayheadWidth')), phH = Math.max(1, ((h - axisH) * setting('sliderPlayheadHeight')) / 100);
        ctx.fillRect(Math.round(xOf(posToVt(pos)) - phW / 2), (h - axisH) - phH, phW, phH);
    }

    // Hovering a playlist row shows that playlist's name and date range as the canvas tooltip.
    const rowToPlaylist = [];
    rowOf.forEach((rank, pl) => { rowToPlaylist[rank] = pl; });
    canvas.addEventListener('pointermove', e => {
        if (e.buttons) return; // not while dragging
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const rank = Math.floor((y - bandGeom.ganttTop) / bandGeom.rowH);
        let tip = '';
        if (y >= bandGeom.ganttTop && rank >= 0 && rank < rowToPlaylist.length) {
            const pl = rowToPlaylist[rank], r = ranges[pl];
            if (x >= xOf(r.lo) - 2 && x <= xOf(r.hi) + 2) {
                const fmt = t => new Date(real[Math.min(n - 1, Math.max(0, Math.round(vtToPos(t))))]).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                tip = `${data.playlists[pl].name}  ·  ${fmt(r.lo)} to ${fmt(r.hi)}`;
            }
        }
        if (canvas.title !== tip) canvas.title = tip;
    });

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

    let dateLine = '';
    function setDateLine(t) { if (t !== dateLine) { dateLine = t; draw(); } }
    function centerOnPlayhead() { keepPlayheadVisible(true); }
    window.addEventListener('resize', draw);
    centerOnPlayhead();
    return { draw, setDateLine, get fullSpanMs() { return FULL_SPAN; }, setPos, zoomBy, scrubByPixels, posAtX, centerOnPlayhead, currentIndex, zoomFraction, timeFraction, setSpanMs, width: W, get span() { return span; } };
}
