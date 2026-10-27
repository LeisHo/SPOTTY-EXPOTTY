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
uniform float uPatchScale, uPatchCover, uPatchSoft, uPatchDrift, uPatchOct;
uniform float uBreathPeriod, uBreathMin, uBreathMax;
uniform float uRingW, uRingStep, uRingAlt, uRingBlur;
uniform float uSwirlR, uSwirlPow, uSwirlInv, uSwirlTwist;
uniform float uWarpStr, uWarpScale, uWarpOct, uWarpLac, uWarpGain, uWarpDrift;
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
// mirrored lookup: the picture is reflected past its edges, so a turned copy never shows empty corners
vec4 samp(vec2 src) {
    vec2 uv = src / uRes;
    uv = 1.0 - abs(1.0 - mod(uv, 2.0));
    // never read the picture's outermost 2 texels: the edge row / column can be a partly transparent or differently filtered line, and a
    // mirrored or turned copy would put that line in the middle of the screen
    uv = clamp(uv, uTexel * 2.0, 1.0 - uTexel * 2.0);
    return texture2D(uTex, uv);
}

// the picture as ring k shows it (every ring turns by its own angle)
vec4 ringColor(vec2 d, float k) {
    float sgn = uRingAlt > 0.5 ? (mod(abs(k), 2.0) < 1.0 ? 1.0 : -1.0) : 1.0;
    return samp(uCenter + rot(d, uAngle * (1.0 + uRingStep * k) * sgn) / max(uZoom, 0.01));
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
        float n = fbm(p / uPatchScale + vec2(0.6, 0.8) * uTau * uPatchDrift / uPatchScale, uPatchOct, 2.0, 0.5);
        float thr = mix(0.78, 0.22, uPatchCover);
        float soft = max(0.005, uPatchSoft * 0.35);
        alpha = smoothstep(thr - soft, thr + soft, n) * uOpacity;
    } else if (m == 3) {     // breathing
        q = rot(d, uAngle);
        alpha = mix(uBreathMin, uBreathMax, 0.5 + 0.5 * sin(6.2831853 * uTau / max(uBreathPeriod, 0.05)));
    } else if (m == 4) {     // rings
        float x = length(d) / max(uRingW, 1.0);
        float k = floor(x), t = x - k;
        float b = clamp(uRingBlur, 0.0, 1.0) * 0.5; // half the width of the blended band, as a fraction of a ring
        c = ringColor(d, k);
        // blur the edges: near a ring's inner / outer edge it is mixed with its neighbour's picture (half and half exactly on the edge)
        if (b > 0.001) {
            if (t < b && k > 0.5) c = mix(c, ringColor(d, k - 1.0), 0.5 * (1.0 - t / b));
            else if (t > 1.0 - b) c = mix(c, ringColor(d, k + 1.0), 0.5 * (1.0 - (1.0 - t) / b));
        }
        direct = true;
    } else if (m == 5) {     // swirl
        float w = pow(clamp(1.0 - length(d) / max(uSwirlR, 1.0), 0.0, 1.0), uSwirlPow);
        if (uSwirlInv > 0.5) w = 1.0 - w;
        q = rot(d, (uAngle + uSwirlTwist) * w);
    } else if (m == 6) {     // domain warp
        vec2 pp = p / uWarpScale + vec2(0.6, 0.8) * uTau * uWarpDrift / uWarpScale;
        vec2 disp = (vec2(fbm(pp, uWarpOct, uWarpLac, uWarpGain), fbm(pp + vec2(5.2, 1.3), uWarpOct, uWarpLac, uWarpGain)) - 0.5) * 2.0 * uWarpStr;
        q = rot(d + disp, uAngle);
    } else {                 // overlay (a rotated duplicate on top)
        q = rot(d, uAngle);
        alpha = uOpacity;
    }
    if (!direct) c = samp(uCenter + q / max(uZoom, 0.01));
    float a = c.a * alpha;
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
        f('uPatchSoft', setting('sliderBgAnimPatchSoftness') / 100); f('uPatchDrift', setting('sliderBgAnimPatchDrift') * px); f('uPatchOct', setting('sliderBgAnimPatchOctaves'));
        f('uBreathPeriod', setting('sliderBgAnimBreathPeriod')); f('uBreathMin', setting('sliderBgAnimBreathMin') / 100); f('uBreathMax', setting('sliderBgAnimBreathMax') / 100);
        f('uRingW', setting('sliderBgAnimRingWidth') * px); f('uRingStep', setting('sliderBgAnimRingSpeedStep')); f('uRingAlt', setting('checkboxBgAnimRingAlternate') ? 1 : 0); f('uRingBlur', setting('sliderBgAnimRingEdgeBlur') / 100);
        f('uSwirlR', setting('sliderBgAnimSwirlRadius') * px); f('uSwirlPow', setting('sliderBgAnimSwirlFalloff')); f('uSwirlInv', setting('checkboxBgAnimSwirlInvert') ? 1 : 0);
        f('uSwirlTwist', (setting('sliderBgAnimSwirlTwist') * Math.PI) / 180);
        f('uWarpStr', setting('sliderBgAnimWarpStrength') * px); f('uWarpScale', setting('sliderBgAnimWarpScale') * px);
        f('uWarpOct', setting('sliderBgAnimWarpOctaves')); f('uWarpLac', setting('sliderBgAnimWarpLacunarity')); f('uWarpGain', setting('sliderBgAnimWarpGain'));
        f('uWarpDrift', setting('sliderBgAnimWarpDrift') * px);
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
