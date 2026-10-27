// Background animation (dev panel > UI Layout > Background > Animation). A WebGL layer (#spxBgFx) above the background canvas that
// shows a transformed copy of the background, driven by one fragment shader with several modes:
//   rotation  - the background itself turns around the album cover's centre (plus an offset)
//   patches   - a rotated copy shows through drifting noise blobs, so only parts of the picture seem to turn
//   breathing - a rotated copy fades in and out
//   rings     - concentric rings around the centre each turn at their own speed
//   swirl     - the turn depends on the distance from the centre (a twirl)
//   warp      - octave (fbm) noise bends the picture, like a displacement map
//   overlay   - a rotated duplicate lies over the background with a blend mode
// All modes share one "eased time" tau: it advances at speed x factor, where factor ramps 0 -> 1 on start and 1 -> 0 on stop along
// the Start / Stop curve (x = progress through the Start / Stop duration), so the rotation, the noise drift and the breathing all
// speed up and slow down together. The animation runs only while the song is playing: pausing slows it down over the Start / Stop
// duration and it then stays at the angle it reached (no frames run); playing again speeds it up from there. Switching the mode off
// slows it down the same way, then hides the layer.
import { setting } from './settings.js';

const DRIFT_DIRS = { diagonal: 0, toward: 1, away: 2 }; // Drift Direction dropdown -> shader mode
const MODES = { rotation: 1, patches: 2, breathing: 3, rings: 4, swirl: 5, warp: 6, overlay: 7 };

const VERT = `
attribute vec2 aPos;
uniform vec2 uRes;
varying vec2 vP;
void main() {
    vP = vec2((aPos.x * 0.5 + 0.5) * uRes.x, (1.0 - (aPos.y * 0.5 + 0.5)) * uRes.y); // pixels, origin top-left
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uCenter, uTexel;
uniform float uMode, uAngle, uTau, uZoom;
uniform float uOpacity;
uniform float uPatchScale, uPatchCover, uPatchSoft, uPatchDrift, uPatchOct, uPatchDir;
uniform float uBreathPeriod, uBreathMin, uBreathMax;
uniform float uRingStep, uRingAlt, uRingBlur, uRingLast, uRingCount, uRingRev;
uniform vec4 uEdge[16];      // outer edge (px from the centre) of rings 0..63, 4 per vector; later rings are uRingLast thick
uniform vec2 uSwirlRange;    // turn amount at the curve's Y = 0 and Y = 1 (fraction of the full turn)
uniform vec4 uSwirlLut[9];   // the swirl curve sampled at 32 points (the last value repeated)
uniform float uSwirlR, uSwirlInv, uSwirlTwist;
uniform float uWarpStr, uWarpScale, uWarpOct, uWarpLac, uWarpGain, uWarpDrift, uWarpDir;
varying vec2 vP;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// fractal noise, 0..1 (normalised by the sum of the octave amplitudes)
float fbm(vec2 p, float oct, float lac, float gain) {
    float v = 0.0, a = 0.5, s = 0.0;
    for (int i = 0; i < 6; i++) {
        if (float(i) >= oct) break;
        v += a * vnoise(p);
        s += a;
        p = p * lac + vec2(17.3, 9.1);
        a *= gain;
    }
    return v / max(s, 0.0001);
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// Where a drifting noise pattern is sampled after it has moved s px: mode 0 = the pattern slides down and to the right (the original drift),
// 1 = it flows toward the rotation center, 2 = away from it. The pattern is read s px "behind" its movement, along the direction from the center.
vec2 driftSample(vec2 p, float mode, float s) {
    if (mode < 0.5) return p + vec2(0.6, 0.8) * s;
    vec2 dd = p - uCenter;
    vec2 r = dd / max(length(dd), 1.0);
    return mode < 1.5 ? p + r * s : p - r * s;
}
// mirrored lookup: the picture is reflected past its edges, so a turned copy never shows empty corners
vec4 samp(vec2 src) {
    vec2 uv = src / uRes;
    uv = 1.0 - abs(1.0 - mod(uv, 2.0));
    // never read the picture's outermost 2 texels: the edge row / column can be a partly transparent or differently filtered line, and a
    // mirrored or turned copy would put that line in the middle of the screen
    uv = clamp(uv, uTexel * 2.0, 1.0 - uTexel * 2.0);
    return texture2D(uTex, uv);
}

// the swirl curve at f = 0..31 (linear between the samples; loop-indexed because a fragment shader cannot index a uniform array freely)
float lutAt(float f) {
    f = clamp(f, 0.0, 31.0);
    float v = 0.0;
    for (int j = 0; j < 8; j++) {
        float b = float(j * 4);
        if (f >= b && f < b + 4.0) {
            vec4 e = uSwirlLut[j], n = vec4(e.y, e.z, e.w, uSwirlLut[j + 1].x);
            float u = f - b;
            float a = u < 1.0 ? e.x : (u < 2.0 ? e.y : (u < 3.0 ? e.z : e.w));
            float c2 = u < 1.0 ? n.x : (u < 2.0 ? n.y : (u < 3.0 ? n.z : n.w));
            v = mix(a, c2, fract(u));
        }
    }
    return v;
}
// the picture as ring k shows it (every ring turns by its own angle)
vec4 ringColor(vec2 d, float k) {
    float sgn = uRingAlt > 0.5 ? (mod(abs(k), 2.0) < 1.0 ? 1.0 : -1.0) : 1.0;
    // Speed Change Per Ring counts rings from the center out; reversed it counts from the outermost ring in, so the INNER rings turn the most
    float kk = uRingRev > 0.5 ? max(uRingCount - 1.0 - k, 0.0) : k;
    return samp(uCenter + rot(d, uAngle * (1.0 + uRingStep * kk) * sgn) / max(uZoom, 0.01));
}

void main() {
    int m = int(uMode + 0.5);
    vec2 p = vP, d = p - uCenter;
    vec2 q;
    float alpha = 1.0;
    vec4 c = vec4(0.0);
    bool direct = false; // the mode already worked out the colour
    if (m == 1) {            // rotation
        q = rot(d, uAngle);
    } else if (m == 2) {     // patches
        q = rot(d, uAngle);
        float n = fbm(driftSample(p, uPatchDir, uTau * uPatchDrift) / uPatchScale, uPatchOct, 2.0, 0.5);
        float thr = mix(0.78, 0.22, uPatchCover);
        float soft = max(0.005, uPatchSoft * 0.35);
        alpha = smoothstep(thr - soft, thr + soft, n);
    } else if (m == 3) {     // breathing
        q = rot(d, uAngle);
        alpha = mix(uBreathMin, uBreathMax, 0.5 + 0.5 * sin(6.2831853 * uTau / max(uBreathPeriod, 0.05)));
    } else if (m == 4) {     // rings
        float len = length(d);
        float prevE = 0.0, r0 = 0.0, r1 = 1.0, k = 0.0;
        bool done = false;
        for (int j = 0; j < 16; j++) {
            vec4 e = uEdge[j];
            float b = float(j * 4);
            if (!done) {
                if (len < e.x) { k = b; r0 = prevE; r1 = e.x; done = true; }
                else if (len < e.y) { k = b + 1.0; r0 = e.x; r1 = e.y; done = true; }
                else if (len < e.z) { k = b + 2.0; r0 = e.y; r1 = e.z; done = true; }
                else if (len < e.w) { k = b + 3.0; r0 = e.z; r1 = e.w; done = true; }
                prevE = e.w;
            }
        }
        if (!done) { float lt = max(uRingLast, 1.0); float n = floor((len - prevE) / lt); k = 64.0 + n; r0 = prevE + n * lt; r1 = r0 + lt; }
        float t = (len - r0) / max(r1 - r0, 1.0);
        float b = clamp(uRingBlur, 0.0, 1.0) * 0.5; // half the width of the blended band, as a fraction of a ring
        c = ringColor(d, k);
        // blur the edges: near a ring's inner / outer edge it is mixed with its neighbour's picture (half and half exactly on the edge)
        if (b > 0.001) {
            if (t < b && k > 0.5) c = mix(c, ringColor(d, k - 1.0), 0.5 * (1.0 - t / b));
            else if (t > 1.0 - b) c = mix(c, ringColor(d, k + 1.0), 0.5 * (1.0 - (1.0 - t) / b));
        }
        direct = true;
    } else if (m == 5) {     // swirl
        float xs = clamp(length(d) / max(uSwirlR, 1.0), 0.0, 1.0); // 0 = the centre, 1 = the swirl radius
        float w = mix(uSwirlRange.x, uSwirlRange.y, lutAt(xs * 31.0));
        if (uSwirlInv > 0.5) w = 1.0 - w;
        q = rot(d, (uAngle + uSwirlTwist) * w);
    } else if (m == 6) {     // domain warp
        vec2 pp = driftSample(p, uWarpDir, uTau * uWarpDrift) / uWarpScale;
        vec2 disp = (vec2(fbm(pp, uWarpOct, uWarpLac, uWarpGain), fbm(pp + vec2(5.2, 1.3), uWarpOct, uWarpLac, uWarpGain)) - 0.5) * 2.0 * uWarpStr;
        q = rot(d + disp, uAngle);
    } else {                 // overlay (a rotated duplicate on top)
        q = rot(d, uAngle);
        alpha = 1.0;
    }
    if (!direct) c = samp(uCenter + q / max(uZoom, 0.01));
    float a = c.a * alpha * uOpacity; // uOpacity: the Animation Opacity slider, for every mode
    gl_FragColor = vec4(c.rgb * a, a); // premultiplied (the texture is straight alpha, so c.rgb is multiplied by its own alpha too)
}`;

export function createBgAnimation({ bgCanvas, prevCanvas, fxCanvas, coverEl, curveY, bgVersion, bgFading, isPlaying }) {
    let gl = null, prog = null, tex = null, U = {}, failed = false;
    const comp = document.createElement('canvas'); // the background as it is on screen mid-crossfade (new frame + fading old frame)
    let texel = [0, 0], on = false, shown = false, lastMode = 0, running = false, raf = 0, last = 0, lastDraw = 0, rampT = 0, tau = 0, seenVersion = -1;

    function init() {
        if (gl || failed) return !!gl;
        try { gl = fxCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }); } catch (e) { gl = null; }
        if (!gl) { failed = true; return false; }
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
            gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (e) { console.error('Background animation shader failed:', e); failed = true; gl = null; return false; }
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); U[info.name] = gl.getUniformLocation(prog, info.name); }
        gl.uniform1i(U.uTex, 0);
        return true;
    }

    const modeOf = () => MODES[setting('selectBgAnimMode')] || 0;

    function uploadSource() {
        const fading = bgFading();
        if (!fading && bgVersion() === seenVersion) return;
        seenVersion = bgVersion();
        let src = bgCanvas;
        if (fading && prevCanvas.width && bgCanvas.width) {
            if (comp.width !== bgCanvas.width || comp.height !== bgCanvas.height) { comp.width = bgCanvas.width; comp.height = bgCanvas.height; }
            const cx = comp.getContext('2d');
            const op = parseFloat(bgCanvas.style.opacity) || 1;
            const a = Math.min(1, (parseFloat(getComputedStyle(prevCanvas).opacity) || 0) / op); // fade left, relative to the layer opacity
            cx.globalAlpha = 1; cx.clearRect(0, 0, comp.width, comp.height); cx.drawImage(bgCanvas, 0, 0);
            cx.globalAlpha = a; cx.drawImage(prevCanvas, 0, 0);
            src = comp;
        }
        if (!src.width || !src.height) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        texel = [1 / src.width, 1 / src.height];
    }

    function draw() {
        const m = lastMode; // the mode being drawn (also while it slows down after being switched off)
        if (!m) return;
        const rect = fxCanvas.getBoundingClientRect();
        const cssW = rect.width || innerWidth, cssH = rect.height || innerHeight;
        const scale = Math.max(0.1, Math.min(1, setting('sliderBgAnimResolution') / 100));
        const pw = Math.max(2, Math.round(cssW * scale)), ph = Math.max(2, Math.round(cssH * scale));
        if (fxCanvas.width !== pw || fxCanvas.height !== ph) { fxCanvas.width = pw; fxCanvas.height = ph; }
        gl.viewport(0, 0, pw, ph);
        uploadSource();
        const px = pw / cssW; // css px -> shader px
        const cr = coverEl.getBoundingClientRect();
        const cx = (cr.left - rect.left + cr.width / 2 + setting('sliderBgAnimCenterX')) * px;
        const cy = (cr.top - rect.top + cr.height / 2 + setting('sliderBgAnimCenterY')) * px;
        const f = (name, v) => { if (U[name] !== undefined && U[name] !== null) gl.uniform1f(U[name], v); };
        gl.uniform2f(U.uRes, pw, ph);
        gl.uniform2f(U.uCenter, cx, cy);
        gl.uniform2f(U.uTexel, texel[0], texel[1]);
        f('uMode', m);
        f('uAngle', (setting('sliderBgAnimSpeed') * tau * Math.PI) / 180);
        f('uTau', tau);
        f('uZoom', setting('sliderBgAnimZoom') / 100);
        f('uOpacity', setting('sliderBgAnimOpacity') / 100);
        f('uPatchScale', setting('sliderBgAnimPatchScale') * px); f('uPatchCover', setting('sliderBgAnimPatchCoverage') / 100);
        f('uPatchSoft', setting('sliderBgAnimPatchSoftness') / 100); f('uPatchDrift', setting('sliderBgAnimPatchDrift') * px); f('uPatchDir', DRIFT_DIRS[setting('selectBgAnimPatchDriftDir')] || 0); f('uPatchOct', setting('sliderBgAnimPatchOctaves'));
        f('uBreathPeriod', setting('sliderBgAnimBreathPeriod')); f('uBreathMin', setting('sliderBgAnimBreathMin') / 100); f('uBreathMax', setting('sliderBgAnimBreathMax') / 100);
        f('uRingStep', setting('sliderBgAnimRingSpeedStep')); f('uRingAlt', setting('checkboxBgAnimRingAlternate') ? 1 : 0); f('uRingBlur', setting('sliderBgAnimRingEdgeBlur') / 100);
        f('uSwirlR', setting('sliderBgAnimSwirlRadius') * px); f('uSwirlInv', setting('checkboxBgAnimSwirlInvert') ? 1 : 0);
        f('uSwirlTwist', (setting('sliderBgAnimSwirlTwist') * Math.PI) / 180);
        f('uWarpStr', setting('sliderBgAnimWarpStrength') * px); f('uWarpScale', setting('sliderBgAnimWarpScale') * px);
        f('uWarpOct', setting('sliderBgAnimWarpOctaves')); f('uWarpLac', setting('sliderBgAnimWarpLacunarity')); f('uWarpGain', setting('sliderBgAnimWarpGain'));
        f('uWarpDrift', setting('sliderBgAnimWarpDrift') * px); f('uWarpDir', DRIFT_DIRS[setting('selectBgAnimWarpDriftDir')] || 0);
        if (m === 4) { // ring edges: thickness = Min + (Max - Min) x the curve at (ring number / number of rings)
            const rg = setting('rangeBarBgAnimRingThickness') || { min: 120, max: 120 }, cv = setting('curveEditorBgAnimRingThickness');
            const tmin = Math.max(2, Math.min(rg.min, rg.max) * px), tmax = Math.max(tmin, Math.max(rg.min, rg.max) * px);
            const far = Math.hypot(Math.max(cx, pw - cx), Math.max(cy, ph - cy)); // the farthest corner: rings are needed out to here
            const edges = new Float32Array(64);
            let N = Math.min(64, Math.max(1, Math.round(far / ((tmin + tmax) / 2))));
            let last = tmax, n = 0;
            for (let it = 0; it < 4; it++) { // the number of rings depends on their thicknesses, which depend on the number of rings: settle it
                let sum = 0; n = 0;
                for (let k = 0; k < 64; k++) {
                    last = tmin + (tmax - tmin) * curveY(cv, N > 1 ? Math.min(1, k / (N - 1)) : 0);
                    sum += last; edges[k] = sum; n = k + 1;
                    if (sum >= far) break;
                }
                N = Math.max(1, n);
            }
            for (let k = n; k < 64; k++) edges[k] = 1e9;
            if (U['uEdge[0]'] !== undefined) gl.uniform4fv(U['uEdge[0]'], edges);
            f('uRingLast', last);
            let total = n; // rings out to the farthest corner (past the 64 in the table the rings are `last` thick)
            if (n > 0 && edges[n - 1] < far) total = n + Math.ceil((far - edges[n - 1]) / Math.max(last, 1));
            f('uRingCount', total); f('uRingRev', setting('checkboxBgAnimRingReverse') ? 1 : 0);
        } else if (m === 5) { // swirl: turn amount = Min + (Max - Min) x the curve at (distance from the centre / swirl radius)
            const sr = setting('rangeBarBgAnimSwirlStrength') || { min: 0, max: 100 }, cv = setting('curveEditorBgAnimSwirlStrength');
            const lut = new Float32Array(36);
            for (let i = 0; i < 32; i++) lut[i] = curveY(cv, i / 31);
            for (let i = 32; i < 36; i++) lut[i] = lut[31];
            if (U['uSwirlLut[0]'] !== undefined) gl.uniform4fv(U['uSwirlLut[0]'], lut);
            if (U.uSwirlRange !== undefined && U.uSwirlRange !== null) gl.uniform2f(U.uSwirlRange, Math.min(sr.min, sr.max) / 100, Math.max(sr.min, sr.max) / 100);
        }
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function frame(now) {
        raf = 0;
        if (!running) return;
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        const dur = Math.max(0, setting('sliderBgAnimStartStopMs')) / 1000;
        if (on) rampT = dur > 0 ? Math.min(dur, rampT + dt) : 0; else rampT = Math.max(0, rampT - dt);
        const prog = dur > 0 ? rampT / dur : (on ? 1 : 0);
        const factor = dur > 0 ? curveY(setting('curveEditorBgAnimStartStop'), prog) : (on ? 1 : 0);
        tau += dt * factor;
        const capMs = 1000 / Math.max(1, setting('sliderBgAnimMaxFps'));
        if (now - lastDraw >= capMs - 1) { lastDraw = now; draw(); }
        if (!on && rampT <= 0) { // fully slowed down: stop the frames; keep the angle while the mode is still on, hide the layer if it was switched off
            stopLoop();
            if (modeOf()) draw(); else hide();
            return;
        }
        raf = requestAnimationFrame(frame);
    }
    function start() {
        if (running) return;
        if (!init()) return;
        running = true; last = performance.now(); seenVersion = -1;
        raf = requestAnimationFrame(frame);
    }
    function stopLoop() {
        running = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function hide() {
        stopLoop();
        shown = false; rampT = 0; tau = 0;
        fxCanvas.style.display = 'none';
    }

    // Called from applyLook() whenever settings change: mode on/off, the CSS blend mode, the layer's opacity / filter.
    function refresh() {
        const m = modeOf();
        on = m > 0 && !!isPlaying();
        if (!m && shown && !running) hide(); // switched off while idle: nothing to slow down
        if (m > 0) {
            lastMode = m;
            if (!shown) { if (!init()) return; shown = true; fxCanvas.style.display = 'block'; }
            fxCanvas.style.opacity = bgCanvas.style.opacity || '1';
            fxCanvas.style.filter = bgCanvas.style.filter || '';
            fxCanvas.style.mixBlendMode = (m === 2 || m === 3 || m === 7) ? (setting('selectBgAnimBlend') || 'normal') : 'normal';
            seenVersion = -1; // the background may have been redrawn
            if (on || rampT > 0) { if (!running) start(); } else draw(); // idle (paused): redraw once at the angle it stopped at
        }
    }
    return { refresh, get active() { return running; }, get shown() { return shown; }, get failed() { return failed; } };
}
