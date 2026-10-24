// Page background, drawn on a full-viewport canvas behind the whole UI. Modes (dev panel > UI Layout > Background):
//   none, color, gradient, albumAverage, borderRadial, borderAverage, albumChroma, blurCover, palette, spotlight.
// The album cover modes read the cover's real pixels: the <img> is loaded with crossOrigin="anonymous"
// (Spotify's image CDN allows it) and drawn into a 96x96 sampler. Modes that depend on WHERE the cover is
// (borderRadial, spotlight following the cover) re-read the cover's on-screen rectangle every frame, so
// they follow it when it is resized or moved (dev panel sliders or the UI Layout Inspector).
// A change of song crossfades: the previous frame is copied to a second canvas that fades out.
import { setting } from './settings.js';

const SAMPLE = 96;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexToRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [13, 15, 18]; };
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    return { s: mx === 0 ? 0 : d / mx, v: mx };
};
const RECT_MODES = new Set(['borderRadial', 'spotlight']);

export function createBackground({ canvas, prevCanvas, coverEl, coverImg, getPalette }) {
    const ctx = canvas.getContext('2d');
    const pctx = prevCanvas.getContext('2d');
    const sampler = document.createElement('canvas');
    sampler.width = sampler.height = SAMPLE;
    const sctx = sampler.getContext('2d', { willReadFrequently: true });
    let pix = null; // Uint8ClampedArray RGBA, SAMPLE x SAMPLE
    let drawn = false, lastRect = '', lastSize = '';

    function analyseCover() {
        pix = null;
        if (!coverImg.complete || !coverImg.naturalWidth) return;
        try {
            sctx.clearRect(0, 0, SAMPLE, SAMPLE);
            sctx.drawImage(coverImg, 0, 0, SAMPLE, SAMPLE);
            pix = sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
        } catch (e) { pix = null; } // tainted canvas (image not CORS-readable): modes fall back to the palette data
    }

    // ---- colour statistics over the sampled cover pixels ------------------------------------
    function meanOf(pred) {
        if (!pix) return null;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < SAMPLE; y++) for (let x = 0; x < SAMPLE; x++) {
            const i = (y * SAMPLE + x) * 4;
            if (pred && !pred(x, y, pix[i], pix[i + 1], pix[i + 2])) continue;
            r += pix[i]; g += pix[i + 1]; b += pix[i + 2]; n++;
        }
        return n ? [r / n, g / n, b / n] : null;
    }
    function edgePred(depthPct, edges) {
        const d = Math.max(1, Math.round((SAMPLE * depthPct) / 100));
        const top = edges === 'all' || edges === 'top' || edges === 'topBottom';
        const bottom = edges === 'all' || edges === 'bottom' || edges === 'topBottom';
        const left = edges === 'all' || edges === 'left' || edges === 'leftRight';
        const right = edges === 'all' || edges === 'right' || edges === 'leftRight';
        return (x, y) => (top && y < d) || (bottom && y >= SAMPLE - d) || (left && x < d) || (right && x >= SAMPLE - d);
    }
    // Average of the colourful pixels; the plain average when the cover is largely grayscale.
    function chromaMean() {
        const minS = setting('sliderChromaMinSaturation'), minV = setting('sliderChromaMinBrightness');
        const grayLimit = setting('sliderChromaGrayscaleThreshold') / 100;
        if (!pix) return null;
        let gray = 0, total = 0;
        for (let i = 0; i < pix.length; i += 4) { const { s } = rgbToHsv(pix[i], pix[i + 1], pix[i + 2]); total++; if (s < minS) gray++; }
        const plain = meanOf(null);
        if (total && gray / total >= grayLimit) return plain;
        return meanOf((x, y, r, g, b) => { const { s, v } = rgbToHsv(r, g, b); return s >= minS && v >= minV; }) || plain;
    }
    // Colour of the border ring in N angular bins around the cover's centre (bin 0 starts at angle -PI,
    // measured in screen coordinates), gaps filled by interpolation and the whole ring smoothed.
    function ringColors(N, depthPct, smoothDeg) {
        if (!pix) return null;
        const d = Math.max(1, Math.round((SAMPLE * depthPct) / 100)), c = SAMPLE / 2;
        const sum = new Float64Array(N * 3), cnt = new Uint32Array(N);
        for (let y = 0; y < SAMPLE; y++) for (let x = 0; x < SAMPLE; x++) {
            if (!(x < d || x >= SAMPLE - d || y < d || y >= SAMPLE - d)) continue;
            const a = Math.atan2(y + 0.5 - c, x + 0.5 - c);
            const bin = Math.min(N - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * N));
            const i = (y * SAMPLE + x) * 4;
            sum[bin * 3] += pix[i]; sum[bin * 3 + 1] += pix[i + 1]; sum[bin * 3 + 2] += pix[i + 2]; cnt[bin]++;
        }
        const col = Array.from({ length: N }, (_, k) => (cnt[k] ? [sum[k * 3] / cnt[k], sum[k * 3 + 1] / cnt[k], sum[k * 3 + 2] / cnt[k]] : null));
        const filled = col.map((v, k) => {
            if (v) return v;
            let a = 1, b = 1;
            while (!col[(k - a + N) % N] && a < N) a++;
            while (!col[(k + b) % N] && b < N) b++;
            const A = col[(k - a + N) % N], B = col[(k + b) % N];
            if (!A && !B) return [0, 0, 0];
            if (!A) return B; if (!B) return A;
            const t = a / (a + b);
            return A.map((x, j) => x + (B[j] - x) * t);
        });
        const k = Math.round((smoothDeg / 360) * N);
        if (k < 1) return filled;
        return filled.map((_, i) => {
            let r = 0, g = 0, b = 0;
            for (let j = -k; j <= k; j++) { const v = filled[(i + j + N * 4) % N]; r += v[0]; g += v[1]; b += v[2]; }
            const m = 2 * k + 1; return [r / m, g / m, b / m];
        });
    }

    // ---- painting helpers -------------------------------------------------------------------
    function paintGradient(g2, w, h, type, rotDeg, scale, cx, cy, stops) {
        const th = (rotDeg * Math.PI) / 180;
        let g;
        if (type === 'radial') {
            const R = Math.max(1, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * scale);
            g = g2.createRadialGradient(cx, cy, 0, cx, cy, R);
        } else if (type === 'conic' && g2.createConicGradient) {
            g = g2.createConicGradient(th - Math.PI / 2, cx, cy);
        } else {
            const dx = Math.sin(th), dy = -Math.cos(th);
            const L = Math.max(1, (Math.abs(w * dx) + Math.abs(h * dy)) * scale); // CSS gradient-line length
            g = g2.createLinearGradient(cx - (dx * L) / 2, cy - (dy * L) / 2, cx + (dx * L) / 2, cy + (dy * L) / 2);
        }
        stops.forEach(s => g.addColorStop(clamp(s.p, 0, 1), s.c));
        g2.fillStyle = g; g2.fillRect(0, 0, w, h);
    }
    const paletteHex = () => { const p = getPalette && getPalette(); return p || null; };

    function coverGeometry() {
        const r = coverEl.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        return { cx: r.left - cr.left + r.width / 2, cy: r.top - cr.top + r.height / 2, half: Math.max(1, Math.min(r.width, r.height) / 2) };
    }

    function render() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
        const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        [canvas, prevCanvas].forEach(c => { if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; } });
        const mode = setting('selectBackgroundMode');
        const op = setting('sliderBackgroundOpacity'), bri = setting('sliderBackgroundBrightness'), sat = setting('sliderBackgroundSaturation');
        const f = `brightness(${bri}) saturate(${sat})`;
        canvas.style.filter = prevCanvas.style.filter = f;
        canvas.style.opacity = mode === 'none' ? '0' : String(op);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.filter = 'none';
        if (mode === 'none') { drawn = false; return; }
        const pal = paletteHex();
        const palRgb = pal ? pal.map(hexToRgb) : null;
        const fallback = (palRgb && palRgb[0]) || hexToRgb(setting('colorBackgroundColor'));
        const solid = c => { ctx.fillStyle = css(c || fallback); ctx.fillRect(0, 0, w, h); };
        if (mode === 'color') solid(hexToRgb(setting('colorBackgroundColor')));
        else if (mode === 'gradient') {
            const g = setting('curveEditorBackgroundGradient') || {};
            paintGradient(ctx, w, h, setting('selectBackgroundGradientType'), setting('sliderBackgroundGradientRotation'), setting('sliderBackgroundGradientScale'),
                (setting('sliderBackgroundGradientCenterX') / 100) * w, (setting('sliderBackgroundGradientCenterY') / 100) * h, g.stops || []);
        } else if (mode === 'albumAverage') solid(meanOf(null));
        else if (mode === 'borderAverage') solid(meanOf(edgePred(setting('sliderBorderDepth'), setting('selectBorderAverageEdges'))));
        else if (mode === 'albumChroma') solid(chromaMean());
        else if (mode === 'borderRadial') {
            const G = Math.round(setting('sliderBorderRadialGranularity'));       // distinct colour bands around the cover
            const N = Math.max(Math.round(setting('sliderBorderRadialRays')), G); // rays drawn (never fewer than bands)
            const ringG = ringColors(G, setting('sliderBorderDepth'), setting('sliderBorderRadialSmoothing'));
            const ring = ringG && Array.from({ length: N }, (_, i) => ringG[Math.min(G - 1, Math.floor((i * G) / N))]);
            if (!ring) { solid(null); }
            else {
                const { cx, cy, half } = coverGeometry();
                const start = setting('sliderBorderRadialStart') / 100, step = (2 * Math.PI) / N, far = Math.hypot(w, h) + half;
                const r0 = th => (half / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)), 1e-3)) * start; // cover edge along this ray
                ctx.fillStyle = css(meanOf(null) || fallback); ctx.fillRect(0, 0, w, h);
                if (setting('checkboxBorderRadialSmooth') && ctx.createConicGradient) {
                    // one conic gradient with a stop per band: colours blend continuously around the cover
                    const cg = ctx.createConicGradient(-Math.PI, cx, cy);
                    for (let i = 0; i < G; i++) cg.addColorStop((i + 0.5) / G, css(ringG[i]));
                    const wrap = [0, 1, 2].map(k => (ringG[0][k] + ringG[G - 1][k]) / 2);
                    cg.addColorStop(0, css(wrap)); cg.addColorStop(1, css(wrap));
                    ctx.save();
                    ctx.beginPath(); ctx.rect(0, 0, w, h);                      // everything except the cover-shaped hole
                    const hole = half * start; ctx.rect(cx - hole, cy - hole, hole * 2, hole * 2);
                    ctx.clip('evenodd');
                    ctx.fillStyle = cg; ctx.fillRect(0, 0, w, h);
                    ctx.restore();
                } else for (let i = 0; i < N; i++) {
                    const t0 = -Math.PI + i * step, t1 = t0 + step * 1.35; // slight overlap hides seams
                    const a = r0(t0), b = r0(t1);
                    ctx.beginPath();
                    ctx.moveTo(cx + a * Math.cos(t0), cy + a * Math.sin(t0));
                    ctx.lineTo(cx + far * Math.cos(t0), cy + far * Math.sin(t0));
                    ctx.lineTo(cx + far * Math.cos(t1), cy + far * Math.sin(t1));
                    ctx.lineTo(cx + b * Math.cos(t1), cy + b * Math.sin(t1));
                    ctx.closePath();
                    ctx.fillStyle = css(ring[i]); ctx.fill();
                }
                const fade = setting('sliderBorderRadialFade') / 100;
                if (fade > 0) { // dissolve the rays into the fade colour with distance from the cover
                    const g = ctx.createRadialGradient(cx, cy, half, cx, cy, far);
                    g.addColorStop(0, css(hexToRgb(setting('colorBorderRadialFadeColor')), 0));
                    g.addColorStop(1, css(hexToRgb(setting('colorBorderRadialFadeColor')), fade));
                    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
                }
            }
        } else if (mode === 'blurCover') {
            ctx.fillStyle = css(meanOf(null) || fallback); ctx.fillRect(0, 0, w, h);
            if (coverImg.complete && coverImg.naturalWidth) {
                const s = Math.max(w / coverImg.naturalWidth, h / coverImg.naturalHeight) * setting('sliderBlurScale');
                const iw = coverImg.naturalWidth * s, ih = coverImg.naturalHeight * s;
                ctx.filter = `blur(${setting('sliderBlurRadius')}px)`;
                ctx.drawImage(coverImg, (w - iw) / 2 + (setting('sliderBlurOffsetX') / 100) * w, (h - ih) / 2 + (setting('sliderBlurOffsetY') / 100) * h, iw, ih);
                ctx.filter = 'none';
            }
            ctx.fillStyle = `rgba(0,0,0,${setting('sliderBlurDarken')})`; ctx.fillRect(0, 0, w, h);
        } else if (mode === 'palette') {
            const cols = palRgb ? [palRgb[2], palRgb[3], palRgb[4]] : [fallback, fallback, fallback];
            paintGradient(ctx, w, h, setting('selectPaletteGradientType'), setting('sliderPaletteRotation'), setting('sliderPaletteScale'), w / 2, h / 2,
                cols.map((c, i) => ({ p: i / 2, c: css(c) })));
        } else if (mode === 'spotlight') {
            const src = setting('selectSpotlightColorSource');
            const col = Array.from((src === 'vivid' && palRgb && palRgb[1]) || (src === 'palette1' && palRgb && palRgb[2]) || meanOf(null) || chromaMean() || fallback); // a copy: the cap below must not edit the shared palette
            const edge = hexToRgb(setting('colorSpotlightEdgeColor'));
            const capB = (setting('sliderSpotlightMaxBrightness') / 100) * 255, peak = Math.max(col[0], col[1], col[2]);
            if (peak > capB && peak > 0) { const k = capB / peak; col[0] *= k; col[1] *= k; col[2] *= k; } // keep the colour, cap how bright it gets
            ctx.fillStyle = css(edge); ctx.fillRect(0, 0, w, h);
            let cx = (setting('sliderSpotlightCenterX') / 100) * w, cy = (setting('sliderSpotlightCenterY') / 100) * h;
            if (setting('checkboxSpotlightFollowCover')) ({ cx, cy } = coverGeometry());
            const R = Math.max(1, (setting('sliderSpotlightRadius') / 100) * Math.max(w, h));
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
            g.addColorStop(0, css(col, setting('sliderSpotlightIntensity')));
            g.addColorStop(1, css(col, 0));
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        }
        drawn = true;
    }

    // A new cover arrived: crossfade from what was on screen to the new frame.
    // What is on screen right now = the fading old frame (prevCanvas, at its current opacity) over the new frame
    // (canvas). When a new fade starts in the middle of an earlier one, the old frame handed to it must be that blend,
    // or the picture would jump.
    let snapTmp = null;
    function crossfadeThenRender() {
        const ms = setting('sliderBackgroundTransition');
        if (drawn && ms > 0 && setting('selectBackgroundMode') !== 'none') {
            const w = prevCanvas.width, h = prevCanvas.height;
            const op = parseFloat(canvas.style.opacity) || 1;
            const a = Math.min(1, (parseFloat(getComputedStyle(prevCanvas).opacity) || 0) / op); // fade left, relative to the layer opacity
            snapTmp = snapTmp || document.createElement('canvas');
            snapTmp.width = w; snapTmp.height = h;
            const t = snapTmp.getContext('2d');
            if (canvas.width === w && canvas.height === h) t.drawImage(canvas, 0, 0);
            t.globalAlpha = a; t.drawImage(prevCanvas, 0, 0);
            pctx.setTransform(1, 0, 0, 1, 0, 0);
            pctx.clearRect(0, 0, w, h);
            pctx.drawImage(snapTmp, 0, 0);
            prevCanvas.style.transition = 'none';
            prevCanvas.style.opacity = canvas.style.opacity || '1';
            void prevCanvas.offsetWidth; // commit the starting opacity before animating it away
            prevCanvas.style.transition = `opacity ${ms}ms linear`;
            prevCanvas.style.opacity = '0';
        }
        render();
    }

    coverImg.addEventListener('load', () => { analyseCover(); crossfadeThenRender(); });
    coverImg.addEventListener('error', () => { pix = null; crossfadeThenRender(); });
    window.addEventListener('resize', render);
    document.addEventListener('input', render);
    document.addEventListener('change', render);

    // Follow the cover if it moves / resizes (only the modes that depend on its position pay for this).
    (function watch() {
        if (RECT_MODES.has(setting('selectBackgroundMode'))) {
            const r = coverEl.getBoundingClientRect();
            const key = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10)).join(',') + '|' + innerWidth + 'x' + innerHeight;
            if (key !== lastRect) { lastRect = key; render(); }
        }
        requestAnimationFrame(watch);
    })();

    analyseCover();
    render();
    // A different song became current (scrub, click, next/back button): fade to its background. Modes that look the
    // same for every song (None / Color / Gradient) have nothing to fade.
    const SONG_INDEPENDENT = new Set(['none', 'color', 'gradient']);
    return {
        refresh: render,
        onCoverChanged: () => { analyseCover(); crossfadeThenRender(); },
        onSongChanged: () => { if (SONG_INDEPENDENT.has(setting('selectBackgroundMode'))) render(); else crossfadeThenRender(); },
    };
}
