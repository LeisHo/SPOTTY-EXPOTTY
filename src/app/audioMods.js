// Dev-only audio modifiers for the 30 s preview clips (dev panel > Scrub Audio > Modifiers).
// They do nothing outside dev mode (html.dev-mode), so a normal visitor always hears the original clip.
// Spotify's full-song playback (iframe embed / Web Playback SDK) is DRM-protected and cannot be processed by the browser,
// so these only touch the preview clips.
//
// Tempo uses the media element's own time-stretch (playbackRate + preservesPitch). Everything else is one shared Web Audio
// chain: pitch shifter -> EQ -> filters -> distortion -> gain -> pan -> dry / echo / reverb mix. Each clip's element is routed
// into the chain only while some modifier is away from its neutral value; at neutral it goes straight to the speakers.
import { setting } from './settings.js';

export const MOD_IDS = [
    'checkboxModEnabled', 'sliderModTempo', 'sliderModKey', 'sliderModOctave', 'sliderModFineCents', 'selectModRelative',
    'sliderModBass', 'sliderModMid', 'sliderModTreble', 'sliderModLowPass', 'sliderModHighPass',
    'sliderModGain', 'sliderModPan', 'checkboxModMono', 'sliderModDistortion',
    'sliderModEchoMix', 'sliderModEchoTime', 'sliderModEchoFeedback', 'sliderModReverbMix', 'sliderModReverbDecay',
];

const isDev = () => document.documentElement.classList.contains('dev-mode');
const els = new Set();          // every registered clip element
const sources = new WeakMap();  // element -> MediaElementSource
let ctx = null, chain = null;

export function modsActive() { return isDev() && !!setting('checkboxModEnabled'); }

// the effective, clamped numbers
function values() {
    const rel = setting('selectModRelative');
    const semis = Math.max(-24, Math.min(24, setting('sliderModKey') + 12 * setting('sliderModOctave') + setting('sliderModFineCents') / 100 + (rel === 'minor' ? -3 : rel === 'major' ? 3 : 0)));
    return {
        tempo: setting('sliderModTempo'), semis,
        bass: setting('sliderModBass'), mid: setting('sliderModMid'), treble: setting('sliderModTreble'),
        lp: setting('sliderModLowPass'), hp: setting('sliderModHighPass'),
        gain: setting('sliderModGain'), pan: setting('sliderModPan'), mono: !!setting('checkboxModMono'),
        dist: setting('sliderModDistortion'),
        echoMix: setting('sliderModEchoMix'), echoTime: setting('sliderModEchoTime'), echoFb: setting('sliderModEchoFeedback'),
        revMix: setting('sliderModReverbMix'), revDecay: setting('sliderModReverbDecay'),
    };
}
// does anything need the Web Audio chain (everything except tempo)?
const needsChain = v => v.semis !== 0 || v.bass !== 0 || v.mid !== 0 || v.treble !== 0 || v.lp < 20000 || v.hp > 20 || v.gain !== 0
    || v.pan !== 0 || v.mono || v.dist > 0 || v.echoMix > 0 || v.revMix > 0;

// ---- pitch shifter: two crossfaded, sawtooth-modulated delay lines (Chris Wilson's "Jungle" technique). Works on any
// (Offline)AudioContext so it can be measured. setSemitones(0) leaves a transparent pass-through.
export function createPitchShifter(c) {
    const sr = c.sampleRate, bufferTime = 0.1, fadeTime = 0.05, delayTime = 0.1;
    const len = Math.floor(bufferTime * sr), fadeLen = Math.floor(fadeTime * sr);
    const fadeBuf = c.createBuffer(1, len, sr), fp = fadeBuf.getChannelData(0);
    for (let i = 0; i < len; i++) fp[i] = i < fadeLen ? Math.sqrt(i / fadeLen) : i >= len - fadeLen ? Math.sqrt(1 - (i - (len - fadeLen)) / fadeLen) : 1;
    const downBuf = c.createBuffer(1, len, sr), upBuf = c.createBuffer(1, len, sr);
    const dp = downBuf.getChannelData(0), up = upBuf.getChannelData(0);
    for (let i = 0; i < len; i++) { dp[i] = i / len; up[i] = (len - i) / len; }
    const input = c.createGain(), output = c.createGain();
    const mk = (buf, g) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const gn = c.createGain(); gn.gain.value = g; s.connect(gn); return { s, gn }; };
    const m1 = mk(downBuf, 0), m2 = mk(downBuf, 0), m3 = mk(upBuf, 0), m4 = mk(upBuf, 0);
    const modGain1 = c.createGain(), modGain2 = c.createGain();
    m1.gn.connect(modGain1); m3.gn.connect(modGain1); m2.gn.connect(modGain2); m4.gn.connect(modGain2);
    const d1 = c.createDelay(), d2 = c.createDelay();
    modGain1.connect(d1.delayTime); modGain2.connect(d2.delayTime);
    const f1 = c.createBufferSource(), f2 = c.createBufferSource();
    f1.buffer = f2.buffer = fadeBuf; f1.loop = f2.loop = true;
    const mix1 = c.createGain(), mix2 = c.createGain(); mix1.gain.value = 0; mix2.gain.value = 0;
    f1.connect(mix1.gain); f2.connect(mix2.gain);
    const wet = c.createGain(); wet.gain.value = 0;
    input.connect(d1); input.connect(d2); d1.connect(mix1); d2.connect(mix2); mix1.connect(wet); mix2.connect(wet); wet.connect(output);
    const t = c.currentTime + 0.05, t2 = t + bufferTime - fadeTime;
    m1.s.start(t); m2.s.start(t2); m3.s.start(t); m4.s.start(t2); f1.start(t); f2.start(t2);
    const direct = c.createGain(); direct.gain.value = 1; input.connect(direct); direct.connect(output);
    let shifting = false;
    function setSemitones(semis) {
        const ratio = Math.pow(2, semis / 12), mult = ratio - 1;
        shifting = Math.abs(semis) > 0.001;
        const up = mult > 0;
        [m1.gn, m2.gn].forEach(g => { g.gain.value = up ? 0 : 1; });
        [m3.gn, m4.gn].forEach(g => { g.gain.value = up ? 1 : 0; });
        const d = delayTime * Math.abs(mult);
        modGain1.gain.setTargetAtTime(d, c.currentTime, 0.01); modGain2.gain.setTargetAtTime(d, c.currentTime, 0.01);
        // exact pass-through when not shifting, only the shifted copy while shifting
        direct.gain.value = shifting ? 0 : 1; wet.gain.value = shifting ? 1 : 0;
    }
    return { input, output, setSemitones };
}

function reverbImpulse(c, seconds) {
    const n = Math.max(1, Math.floor(c.sampleRate * seconds)), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return b;
}
function distCurve(amount) {
    const k = amount * 4, n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return curve;
}

function buildChain() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const c = ctx;
    const pitch = createPitchShifter(c);
    const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
    const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;
    const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    const shaper = c.createWaveShaper(); shaper.oversample = '2x';
    const gain = c.createGain();
    const mono = c.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; // downmix; channelInterpretation default speakers
    const pan = c.createStereoPanner();
    const dry = c.createGain(), master = c.createGain();
    const delay = c.createDelay(2), fb = c.createGain(), echoSend = c.createGain();
    const conv = c.createConvolver(), revSend = c.createGain();
    const input = pitch.input;
    pitch.output.connect(low); low.connect(mid); mid.connect(high); high.connect(hp); hp.connect(lp); lp.connect(shaper);
    shaper.connect(gain); gain.connect(mono); mono.connect(pan);
    pan.connect(dry); dry.connect(master);
    pan.connect(echoSend); echoSend.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(master);
    pan.connect(revSend); revSend.connect(conv); conv.connect(master);
    master.connect(c.destination);
    return { input, master, pitch, low, mid, high, hp, lp, shaper, gain, mono, pan, dry, delay, fb, echoSend, conv, revSend, revDecay: 0, monoOn: false };
}

function applyChain(v) {
    if (!chain) return;
    const c = ctx, t = c.currentTime, S = (p, x) => p.setTargetAtTime(x, t, 0.02);
    chain.pitch.setSemitones(v.semis);
    S(chain.low.gain, v.bass); S(chain.mid.gain, v.mid); S(chain.high.gain, v.treble);
    chain.hp.frequency.value = v.hp; chain.lp.frequency.value = v.lp;
    chain.shaper.curve = v.dist > 0 ? distCurve(v.dist / 100 * 20) : null;
    S(chain.gain.gain, Math.pow(10, v.gain / 20));
    chain.pan.pan.value = v.pan;
    if (v.mono !== chain.monoOn) { chain.monoOn = v.mono; chain.mono.channelCount = v.mono ? 1 : 2; }
    S(chain.dry.gain, 1 - v.revMix / 200 - v.echoMix / 200);
    chain.delay.delayTime.value = Math.max(0.01, v.echoTime / 1000);
    S(chain.fb.gain, Math.min(0.95, v.echoFb / 100)); S(chain.echoSend.gain, v.echoMix / 100);
    S(chain.revSend.gain, v.revMix / 100);
    if (Math.abs(v.revDecay - chain.revDecay) > 0.05) { chain.revDecay = v.revDecay; chain.conv.buffer = reverbImpulse(c, v.revDecay); }
}

function route(audio, wantChain) {
    let src = sources.get(audio);
    if (!src) {
        if (!wantChain) return; // never create the source (a permanent hook) until it is needed
        if (!chain) chain = buildChain();
        if (!chain) return;
        try { src = ctx.createMediaElementSource(audio); } catch (e) { return; }
        sources.set(audio, src);
        audio._spxMod = { chained: false };
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    const st = audio._spxMod;
    if (wantChain && !st.chained) { try { src.disconnect(); } catch (e) { /* not connected */ } src.connect(chain.input); st.chained = true; }
    else if (!wantChain && st.chained) { try { src.disconnect(); } catch (e) { /* not connected */ } src.connect(ctx.destination); st.chained = false; }
    else if (!wantChain && st.chained === undefined) { src.connect(ctx.destination); st.chained = false; }
}

function applyToElement(audio, v, wantChain) {
    const rate = v ? v.tempo : 1;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.preservesPitch = true; audio.webkitPreservesPitch = true; audio.mozPreservesPitch = true;
    // keep an already-routed element routed (a created source stays; go through the plain output when neutral)
    if (v && wantChain) route(audio, true);
    else if (sources.has(audio)) route(audio, false);
}

// Re-read the dev-panel values and push them onto every clip (and the shared chain).
export function applyMods() {
    const on = modsActive();
    const v = on ? values() : null;
    const wantChain = !!v && needsChain(v);
    if (wantChain) { if (!chain) chain = buildChain(); applyChain(v); }
    els.forEach(a => applyToElement(a, v, wantChain && (!a.paused || sources.has(a))));
}

// clipPlayer.js calls this for each new clip element, before its src is set.
export function registerClip(audio) {
    if (!isDev()) return;
    audio.crossOrigin = 'anonymous'; // both preview CDNs send CORS headers; needed so Web Audio can read the samples
    els.add(audio);
    audio.addEventListener('play', () => { if (modsActive()) { const v = values(); applyToElement(audio, v, needsChain(v)); } });
    audio.addEventListener('loadstart', () => { if (modsActive()) { const v = values(); audio.defaultPlaybackRate = v.tempo; audio.playbackRate = v.tempo; } });
}
export function unregisterClip(audio) { els.delete(audio); }

// Wire the dev panel: any modifier control changing re-applies (also covers Reset / Undo / Load, which dispatch input events).
export function initAudioMods() {
    if (!isDev()) return;
    const on = e => { const id = e.target && e.target.id; if (id && MOD_IDS.some(m => id === m || id.replace(/^(slider|checkbox|select)(Mobile|Landscape)/, '$1') === m)) applyMods(); };
    document.addEventListener('input', on, true);
    document.addEventListener('change', on, true);
    applyMods();
}
export function modsState() { return isDev() ? { enabled: modsActive(), ctx: ctx && ctx.state, chain: !!chain, values: values(), clips: [...els].map(a => ({ rate: a.playbackRate, paused: a.paused, cors: a.crossOrigin, chained: a._spxMod ? a._spxMod.chained : null, t: +a.currentTime.toFixed(1) })) } : null; }
// dev check: peak level (0-1) leaving the chain over ~0.3 s
export async function probeLevel() { if (!chain) return null; const an = ctx.createAnalyser(); chain.master.connect(an); const d = new Float32Array(an.fftSize); let pk = 0; for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(d); d.forEach(x => { pk = Math.max(pk, Math.abs(x)); }); } chain.master.disconnect(an); return pk; }
window.spxAudioMods = { probeLevel, createPitchShifter, applyMods, modsState };
