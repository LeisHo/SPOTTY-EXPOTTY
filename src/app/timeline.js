// Timeline canvas: x = date. Top band = songs added per week (histogram); bottom
// band = one thin row per playlist spanning its first..last add date. The
// playhead marks the current song's date. Dragging on it seeks to the first
// song added on/after that date.
import { setting } from './settings.js';

export function createTimeline(canvas, data, onSeek) {
    const songs = data.songs;
    const times = songs.map(s => Date.parse(s.t));
    const t0 = times[0], t1 = times[times.length - 1];
    const span = Math.max(1, t1 - t0);
    const WEEK = 7 * 864e5;
    const bins = new Array(Math.ceil(span / WEEK) + 1).fill(0);
    times.forEach(t => { bins[Math.floor((t - t0) / WEEK)]++; });
    const maxBin = Math.max(...bins);
    const ranges = data.playlists.map(() => ({ lo: Infinity, hi: -Infinity }));
    songs.forEach((s, i) => {
        const r = ranges[s.p];
        r.lo = Math.min(r.lo, times[i]);
        r.hi = Math.max(r.hi, times[i]);
    });
    let lastIndex = 0;

    const xOf = t => ((t - t0) / span) * canvas.clientWidth;
    function indexAtX(x) {
        const t = t0 + (x / canvas.clientWidth) * span;
        let lo = 0, hi = times.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
        return lo;
    }

    function draw(index = lastIndex) {
        lastIndex = index;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
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

        ctx.globalAlpha = setting('sliderTimelineBarOpacity');
        ctx.fillStyle = accent;
        const bw = Math.max(1, w / bins.length);
        bins.forEach((n, i) => {
            if (!n) return;
            const bh = (n / maxBin) * (topH - 4);
            ctx.fillRect((i / bins.length) * w, topH - bh, bw, bh);
        });

        const rowH = ganttH / ranges.length;
        const curP = songs[index].p;
        ranges.forEach((r, i) => {
            if (r.lo === Infinity) return;
            ctx.globalAlpha = i === curP ? 1 : 0.35;
            ctx.fillStyle = i === curP ? playheadColor : accent;
            ctx.fillRect(xOf(r.lo), ganttTop + i * rowH, Math.max(2, xOf(r.hi) - xOf(r.lo)), Math.max(1, rowH - 1));
        });

        ctx.globalAlpha = 0.6;
        ctx.fillStyle = playheadColor;
        ctx.font = '11px system-ui, sans-serif';
        const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
        for (let y = y0 + 1; y <= y1; y++) {
            const x = xOf(Date.UTC(y, 0, 1));
            ctx.fillRect(x, h - axisH, 1, 5);
            if (x < w - 26) ctx.fillText(String(y), x + 3, h - 4);
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = playheadColor;
        ctx.fillRect(Math.round(xOf(times[index])) - 1, 0, 2, h - axisH);
    }

    let dragging = false;
    const seekFromEvent = e => {
        const rect = canvas.getBoundingClientRect();
        onSeek(indexAtX(Math.min(Math.max(e.clientX - rect.left, 0), rect.width)));
    };
    canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); seekFromEvent(e); });
    canvas.addEventListener('pointermove', e => { if (dragging) seekFromEvent(e); });
    const end = () => { dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => draw());

    return { draw };
}
