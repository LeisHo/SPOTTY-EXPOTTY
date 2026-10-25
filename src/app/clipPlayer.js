// Scrub-time audio: a rolling pool of preloaded 30-second Deezer preview clips.
// Preloaded clips start in ~1 ms (measured in the built-in browser); a cold
// clip takes ~450-950 ms, so the pool preloads the songs around the playhead.
// Deezer preview links expire after ~15 min and the Deezer API has no CORS
// header, so URLs come from /api/preview (api/preview.js, or serve.py locally).
import { setting } from './settings.js';
import { logEvent } from './debugLog.js';

const URL_TTL_MS = 10 * 60 * 1000;
const NULL_TTL_MS = 20 * 1000;
const urlCache = new Map(); // deezerId -> { url, at }
const pool = new Map(); // deezerId -> { did, audio, dead, urlAt, fade }
let current = null;
let token = 0;
let unlocked = false;
let masterVolume = 1; // the top-right volume control, 0..1, multiplies the dev panel's Clip Volume

export function unlock() { unlocked = true; }
// For the debug logs: what state a song's clip is in right now.
export function clipState(did) {
    const p = pool.get(did);
    if (!did) return 'no clip for this song';
    if (!p) return 'not requested';
    if (p.dead) return 'no clip (lookup failed)';
    const b = bufferedEnd(p.audio);
    return b >= MIN_BUFFERED_S ? `ready (${b.toFixed(1)}s buffered)` : (p.audio.getAttribute('src') ? `loading (${b.toFixed(1)}s buffered)` : 'waiting for its URL');
}
// ---- preload batches, for the Preload Log: a batch = one preload() call (the clips wanted around the playhead) ----
let batch = null, batchNo = 0;
const isReady = did => { const p = pool.get(did); return !!p && !p.dead && bufferedEnd(p.audio) >= MIN_BUFFERED_S; };
const isSettled = did => { const p = pool.get(did); return !!p && (p.dead || isReady(did)); };
function checkBatch() {
    if (!batch || batch.done || !batch.want.every(isSettled)) return;
    batch.done = true;
    const ready = batch.want.filter(isReady).length;
    logEvent('preload', `BATCH #${batch.n} COMPLETE: ${ready} ready, ${batch.want.length - ready} without a clip, ${Math.round(performance.now() - batch.t0)}ms after it was requested`);
}
function noteReady(p) {
    if (p.readyAt || p.dead || bufferedEnd(p.audio) < MIN_BUFFERED_S) return;
    p.readyAt = performance.now();
    const ready = [...pool.values()].filter(q => !q.dead && bufferedEnd(q.audio) >= MIN_BUFFERED_S).length;
    logEvent('preload', `READY ${p.did}: ${Math.round(p.readyAt - (p.reqAt || p.readyAt))}ms after its URL request (${bufferedEnd(p.audio).toFixed(1)}s buffered); ${ready}/${pool.size} in the pool are ready`);
    checkBatch();
}
export function setMasterVolume(v) {
    masterVolume = Math.min(1, Math.max(0, v));
    if (current) current.audio.volume = Math.min(1, Math.max(0, setting('sliderScrubVolume'))) * masterVolume; // live, on the clip playing now
}
export function isUnlocked() { return unlocked; }

async function fetchUrls(ids) {
    const need = [...new Set(ids)].filter(id => {
        const c = urlCache.get(id);
        // a null (lookup failed or rate-limited) is retried after 20 s, a real URL after 10 min
        return !c || Date.now() - c.at > (c.url ? URL_TTL_MS : NULL_TTL_MS);
    });
    // Small chunks, all requested at once in priority order: the nearest songs come
    // back first instead of waiting for one big batch (the server rate-limits Deezer).
    const chunks = [];
    for (let i = 0; i < need.length; i += 4) chunks.push(need.slice(i, i + 4));
    await Promise.all(chunks.map(async chunk => {
        try {
            const res = await fetch('/api/preview?ids=' + chunk.join(','));
            const body = await res.json();
            chunk.forEach(id => urlCache.set(id, { url: body[id] || null, at: Date.now() }));
        } catch (e) {
            chunk.forEach(id => urlCache.set(id, { url: null, at: Date.now() }));
        }
    }));
}

// Seconds of audio buffered from the start of the clip. A clip is only startable
// once it has a couple of seconds: seeking to a random offset past the buffered
// part makes the browser re-fetch from there, which is the "loading" silence.
const bufferedEnd = a => (a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0);
const MIN_BUFFERED_S = 2;

function drop(p) {
    clearInterval(p.fade);
    p.audio.pause();
    p.audio.removeAttribute('src');
    p.audio.load();
    pool.delete(p.did);
}

function entry(did) {
    let p = pool.get(did);
    if (p && p.urlAt && Date.now() - p.urlAt > URL_TTL_MS + 90000 && p.audio.paused) { drop(p); p = null; }
    if (p && p.dead && Date.now() - p.deadAt > NULL_TTL_MS) { drop(p); p = null; } // retry a failed lookup
    if (!p) {
        const audio = new Audio();
        audio.preload = 'auto';
        p = { did, audio, dead: false, urlAt: 0, fade: 0 };
        pool.set(did, p);
        ['progress', 'canplay', 'loadeddata'].forEach(ev => audio.addEventListener(ev, () => noteReady(p)));
        audio.addEventListener('waiting', () => { if (current === p) logEvent('playback', `CLIP STALL ${did}: waiting for data (${bufferedEnd(audio).toFixed(1)}s buffered)`); });
        audio.addEventListener('error', () => {
            logEvent('preload', `ERROR ${did}: the audio element reported an error`);
            // an iTunes link (no URL lookup to fail earlier) that won't load counts as "no clip", like a failed Deezer lookup
            if (typeof did === 'string' && !p.dead) { p.dead = true; p.deadAt = Date.now(); checkBatch(); }
        });
    }
    return p;
}

async function attach(p) {
    // An iTunes preview (a song with no Deezer clip; the key is the link itself, see main.js clipKey()): a static CDN link,
    // so nothing to fetch. urlAt = Infinity keeps entry() from dropping it as an expired Deezer URL.
    if (typeof p.did === 'string') {
        if (!p.audio.getAttribute('src')) { p.audio.src = p.did; p.urlAt = Infinity; }
        return;
    }
    if (p.audio.getAttribute('src') || p.dead || p.fetching) return;
    p.fetching = true;
    p.reqAt = performance.now();
    await fetchUrls([p.did]);
    p.fetching = false;
    const c = urlCache.get(p.did);
    if (c && c.url) { p.audio.src = c.url; p.urlAt = c.at; logEvent('preload', `URL ${p.did}: ok after ${Math.round(performance.now() - p.reqAt)}ms, loading audio`); }
    else { p.dead = true; p.deadAt = Date.now(); logEvent('preload', `URL ${p.did}: NO clip (lookup failed or none) after ${Math.round(performance.now() - p.reqAt)}ms`); checkBatch(); }
}

// Preload the clips for these deezer ids and evict everything else (except the
// clip currently playing).
export async function preload(dids) {
    const want = [...new Set(dids.filter(Boolean))];
    const keep = new Set(want);
    if (current) keep.add(current.did);
    let evicted = 0;
    [...pool.values()].forEach(p => { if (!keep.has(p.did)) { drop(p); evicted++; } });
    if (batch && !batch.done) logEvent('preload', `BATCH #${batch.n} superseded: ${batch.want.filter(isReady).length}/${batch.want.length} were ready ${Math.round(performance.now() - batch.t0)}ms after it was requested`);
    batch = { n: ++batchNo, t0: performance.now(), want, done: false };
    logEvent('preload', `BATCH #${batch.n}: want ${want.length} clips (${want.filter(isReady).length} already ready, ${evicted} dropped from the pool)`);
    // One request per song, in priority order (nearest the playhead first), so the
    // closest clips resolve first rather than waiting on the whole window.
    want.forEach(did => { attach(entry(did)); });
    checkBatch();
}

export function stopClip() {
    token++;
    if (!current) return;
    const p = current;
    current = null;
    logEvent('playback', `CLIP STOP ${p.did}`);
    clearInterval(p.fade);
    const ms = setting('sliderClipFadeOut');
    if (!ms || p.audio.paused) { p.audio.pause(); return; }
    const v0 = p.audio.volume, steps = Math.max(1, Math.round(ms / 10));
    let n = 0;
    p.fade = setInterval(() => {
        n++;
        p.audio.volume = Math.max(0, v0 * (1 - n / steps));
        if (n >= steps) { clearInterval(p.fade); p.audio.pause(); p.audio.volume = v0; }
    }, 10);
}

// Start a clip from a random point inside it. Returns 'playing' | 'pending' |
// 'skipped' (no clip for this song, or cold start disabled and not preloaded).
export function playClip(did) {
    stopClip();
    const reqAt = performance.now();
    if (!unlocked || !did || !setting('checkboxScrubAudioEnabled')) { logEvent('playback', `CLIP skipped (${!unlocked ? 'sound not unlocked yet' : !did ? 'this song has no clip' : 'scrub audio is off'})`); return 'skipped'; }
    const known = pool.get(did);
    if (!known && !setting('checkboxColdStartClips')) { logEvent('playback', `CLIP skipped (${did} was not preloaded and cold starts are off)`); return 'skipped'; }
    const p = entry(did);
    if (p.dead) { logEvent('playback', `CLIP skipped (${did} has no clip)`); return 'skipped'; }
    const my = token;
    const go = () => {
        if (my !== token) return; // user already scrubbed past this song
        const a = p.audio;
        clearInterval(p.fade);
        a.volume = Math.min(1, Math.max(0, setting('sliderScrubVolume'))) * masterVolume;
        const dur = a.duration && isFinite(a.duration) ? a.duration : 30;
        let lo = setting('sliderClipStartMin'), hi = setting('sliderClipStartMax');
        if (hi < lo) [lo, hi] = [hi, lo];
        // Start inside what's already buffered so sound begins immediately; a fully
        // preloaded clip (buffered ~30 s) uses the whole configured range.
        const cap = Math.max(0, Math.min(dur, bufferedEnd(a)) - 1.5);
        hi = Math.min(hi, cap);
        lo = Math.min(lo, hi);
        const start = lo + Math.random() * (hi - lo);
        try { a.currentTime = start; } catch (e) { /* metadata not ready */ }
        current = p;
        logEvent('playback', `CLIP START ${did} at ${start.toFixed(1)}s (${bufferedEnd(a).toFixed(1)}s buffered, ${Math.round(performance.now() - reqAt)}ms after it was asked for, volume ${a.volume.toFixed(2)})`);
        a.play().catch(err => logEvent('playback', `CLIP play() REJECTED ${did}: ${err && err.name}`));
    };
    if (bufferedEnd(p.audio) >= MIN_BUFFERED_S) { go(); return 'playing'; }
    if (!setting('checkboxColdStartClips')) { logEvent('playback', `CLIP skipped (${did} not ready and cold starts are off)`); return 'skipped'; }
    logEvent('playback', `CLIP pending ${did}: ${clipState(did)}; will start once 2s are buffered`);
    const tryGo = () => {
        if (my !== token || bufferedEnd(p.audio) >= MIN_BUFFERED_S) {
            p.audio.removeEventListener('progress', tryGo);
            p.audio.removeEventListener('canplay', tryGo);
            if (my === token) go();
        }
    };
    p.audio.addEventListener('progress', tryGo);
    p.audio.addEventListener('canplay', tryGo);
    attach(p);
    return 'pending';
}

export function poolInfo() {
    const ps = [...pool.values()];
    return {
        size: ps.length,
        ready: ps.filter(p => bufferedEnd(p.audio) >= MIN_BUFFERED_S).length,
        dead: ps.filter(p => p.dead).length,
        playing: current ? current.did : null,
    };
}
