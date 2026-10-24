// Zoomable timeline canvas. x = date inside a movable view window. Top band = songs
// added per bar (bar width ~3 px, so bars re-bin as you zoom); bottom band = one thin
// row per playlist spanning its first..last add date; a playhead marks the current
// position. Dragging scrubs RELATIVELY (see scrubFromDrag): moving the pointer dx px
// moves the playhead dx px along the current scale, wherever the pointer started.
//
// "vt" is a virtual time: real add time + index * 1 s. Songs added in the same
// instant (bulk adds share a timestamp) would otherwise sit at one x and be
// impossible to scrub between; the 1 s spacing separates them while moving every
// date by at most ~1.8 h across all 6,345 songs.
import { setting } from './settings.js';

const SPACING_MS = 1000;
const MIN_SPAN_MS = 120000;
const DAY = 864e5;

export function createTimeline(canvas, data) {
    const songs = data.songs;
    const n = songs.length;
    const real = songs.map(s => Date.parse(s.t));
    const vt = real.map((t, i) => t + i * SPACING_MS);
    const vMin = vt[0], vMax = vt[n - 1];
    const total = Math.max(1, vMax - vMin);
    const ranges = data.playlists.map(() => ({ lo: Infinity, hi: -Infinity }));
    songs.forEach((s, i) => {
        const r = ranges[s.p];
        r.lo = Math.min(r.lo, vt[i]);
        r.hi = Math.max(r.hi, vt[i]);
    });

    let span = Math.min(total * 1.02, Math.max(MIN_SPAN_MS, setting('sliderDefaultTimelineSpanDays') * DAY));
    let viewStart = vMin;
    let pos = 0;

    const W = () => canvas.clientWidth || 1;
    const xOf = v => ((v - viewStart) / span) * W();

    // index of the first element with arr[i] >= x
    function lowerBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
        return lo;
    }
    const posToVt = p => {
        const i = Math.min(n - 1, Math.max(0, Math.floor(p)));
        const j = Math.min(n - 1, i + 1);
        return vt[i] + (p - i) * (vt[j] - vt[i]);
    };
    const vtToPos = v => {
        if (v <= vMin) return 0;
        if (v >= vMax) return n - 1;
        const i = lowerBound(vt, v + 1e-6) - 1; // last index with vt <= v
        return i + (v - vt[i]) / (vt[i + 1] - vt[i]);
    };

    function clampView() {
        const pad = span * 0.05;
        viewStart = Math.min(vMax + pad - span, Math.max(vMin - pad, viewStart));
    }
    function keepPlayheadVisible(forceCenter) {
        const x = xOf(posToVt(pos)), w = W();
        if (forceCenter) viewStart = posToVt(pos) - 0.5 * span;
        else if (x < w * 0.1 || x > w * 0.9) {
            const far = x < -w || x > 2 * w; // a big jump (Home/End): recenter instead of edge-pinning
            const target = far ? 0.5 : x < w * 0.1 ? 0.1 : 0.9;
            viewStart = posToVt(pos) - target * span;
        }
        clampView();
    }

    function setPos(p) {
        pos = Math.min(n - 1, Math.max(0, p));
        keepPlayheadVisible(false);
    }

    // Zoom keeping the vt under anchorX fixed (default: the playhead).
    function zoomBy(factor, anchorX) {
        const w = W();
        const ax = anchorX === undefined ? xOf(posToVt(pos)) : anchorX;
        const vAnchor = viewStart + (ax / w) * span;
        span = Math.min(total * 1.02, Math.max(MIN_SPAN_MS, span * factor));
        viewStart = vAnchor - (ax / w) * span;
        clampView();
    }

    // New (fractional) position after the pointer moved dx px.
    function scrubFromDrag(dx) {
        return vtToPos(posToVt(pos) + (dx / W()) * span);
    }

    // ---- ticks -------------------------------------------------------------
    // vt of a real timestamp (consistent with how songs are placed)
    const vtOfReal = t => t + lowerBound(real, t + 1) * SPACING_MS;
    function ticks() {
        const realOf = v => v - Math.min(n - 1, Math.max(0, Math.round(vtToPos(v)))) * SPACING_MS;
        const startReal = new Date(realOf(viewStart));
        const endReal = new Date(realOf(viewStart + span));
        const out = [];
        const w = W();
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
            out.push({ x: xOf(vtOfReal(d.getTime())), text: label(d) });
            step();
        }
        // thin to >= 64 px apart
        const thinned = [];
        let lastX = -1e9;
        out.forEach(t => { if (t.x - lastX >= 64 && t.x > -10 && t.x < w) { thinned.push(t); lastX = t.x; } });
        return thinned;
    }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const accent = setting('colorTimelineAccent');
        const playheadColor = setting('colorTimelinePlayhead');
        const topH = h * 0.5, axisH = 18, ganttTop = topH + 4, ganttH = h - ganttTop - axisH;
        const viewEnd = viewStart + span;

        // histogram of the visible slice
        const barW = 3, nb = Math.max(1, Math.floor(w / barW));
        const bins = new Array(nb).fill(0);
        const i0 = lowerBound(vt, viewStart), i1 = lowerBound(vt, viewEnd);
        for (let i = i0; i < i1; i++) bins[Math.min(nb - 1, Math.floor(((vt[i] - viewStart) / span) * nb))]++;
        const maxBin = Math.max(1, ...bins);
        ctx.globalAlpha = setting('sliderTimelineBarOpacity');
        ctx.fillStyle = accent;
        bins.forEach((c, b) => {
            if (!c) return;
            const bh = (c / maxBin) * (topH - 4);
            ctx.fillRect(b * (w / nb), topH - bh, Math.max(1, w / nb - 0.5), bh);
        });

        // playlist rows
        const rowH = ganttH / ranges.length;
        const curP = songs[Math.round(pos)].p;
        ranges.forEach((r, i) => {
            if (r.hi < viewStart || r.lo > viewEnd) return;
            const x0 = Math.max(0, xOf(r.lo)), x1 = Math.min(w, xOf(r.hi));
            ctx.globalAlpha = i === curP ? 1 : 0.35;
            ctx.fillStyle = i === curP ? playheadColor : accent;
            ctx.fillRect(x0, ganttTop + i * rowH, Math.max(2, x1 - x0), Math.max(1, rowH - 1));
        });

        // axis
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = playheadColor;
        ctx.font = '11px system-ui, sans-serif';
        ticks().forEach(t => {
            ctx.fillRect(t.x, h - axisH, 1, 5);
            ctx.fillText(t.text, t.x + 3, h - 4);
        });

        // individual song ticks when zoomed in far enough to tell songs apart
        if (i1 - i0 > 0 && (i1 - i0) * 4 < w) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = playheadColor;
            for (let i = i0; i < i1; i++) ctx.fillRect(Math.round(xOf(vt[i])), topH + 1, 1, 3);
        }

        // playhead
        ctx.globalAlpha = 1;
        ctx.fillStyle = playheadColor;
        ctx.fillRect(Math.round(xOf(posToVt(pos))) - 1, 0, 2, h - axisH);
    }

    function centerOnPlayhead() { keepPlayheadVisible(true); }
    window.addEventListener('resize', draw);
    centerOnPlayhead();
    return { draw, setPos, zoomBy, scrubFromDrag, centerOnPlayhead, width: W, get span() { return span; } };
}
