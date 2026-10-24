// Scrub-time audio: a rolling pool of preloaded 30-second Deezer preview clips.
// Preloaded clips start in ~1 ms (measured in the built-in browser); a cold
// clip takes ~450-950 ms, so the pool preloads the songs around the playhead.
// Deezer preview links expire after ~15 min and the Deezer API has no CORS
// header, so URLs come from /api/preview (api/preview.js, or serve.py locally).
import { setting } from './settings.js';

const URL_TTL_MS = 10 * 60 * 1000;
const NULL_TTL_MS = 20 * 1000;
const urlCache = new Map(); // deezerId -> { url, at }
const pool = new Map(); // deezerId -> { did, audio, dead, urlAt, fade }
let current = null;
let token = 0;
let unlocked = false;

export function unlock() { unlocked = true; }
export function isUnlocked() { return unlocked; }

async function fetchUrls(ids) {
    const need = [...new Set(ids)].filter(id => {
        const c = urlCache.get(id);
        // a null (lookup failed or rate-limited) is retried after 20 s, a real URL after 10 min
        return !c || Date.now() - c.at > (c.url ? URL_TTL_MS : NULL_TTL_MS);
    });
    for (let i = 0; i < need.length; i += 20) {
        const chunk = need.slice(i, i + 20);
        try {
            const res = await fetch('/api/preview?ids=' + chunk.join(','));
            const body = await res.json();
            chunk.forEach(id => urlCache.set(id, { url: body[id] || null, at: Date.now() }));
        } catch (e) {
            chunk.forEach(id => urlCache.set(id, { url: null, at: Date.now() }));
        }
    }
}

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
    }
    return p;
}

async function attach(p) {
    if (p.audio.getAttribute('src') || p.dead) return;
    await fetchUrls([p.did]);
    const c = urlCache.get(p.did);
    if (c && c.url) { p.audio.src = c.url; p.urlAt = c.at; } else { p.dead = true; p.deadAt = Date.now(); }
}

// Preload the clips for these deezer ids and evict everything else (except the
// clip currently playing).
export async function preload(dids) {
    const want = [...new Set(dids.filter(Boolean))];
    const keep = new Set(want);
    if (current) keep.add(current.did);
    [...pool.values()].forEach(p => { if (!keep.has(p.did)) drop(p); });
    await fetchUrls(want);
    want.forEach(did => { attach(entry(did)); });
}

export function stopClip() {
    token++;
    if (!current) return;
    const p = current;
    current = null;
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
    if (!unlocked || !did || !setting('checkboxScrubAudioEnabled')) return 'skipped';
    const known = pool.get(did);
    if (!known && !setting('checkboxColdStartClips')) return 'skipped';
    const p = entry(did);
    if (p.dead) return 'skipped';
    const my = token;
    const go = () => {
        if (my !== token) return; // user already scrubbed past this song
        const a = p.audio;
        clearInterval(p.fade);
        a.volume = Math.min(1, Math.max(0, setting('sliderScrubVolume')));
        const dur = a.duration && isFinite(a.duration) ? a.duration : 30;
        let lo = setting('sliderClipStartMin'), hi = setting('sliderClipStartMax');
        if (hi < lo) [lo, hi] = [hi, lo];
        const start = Math.min(lo + Math.random() * (hi - lo), Math.max(0, dur - 1.5));
        try { a.currentTime = start; } catch (e) { /* metadata not ready */ }
        current = p;
        a.play().catch(() => {});
    };
    if (p.audio.readyState >= 3) { go(); return 'playing'; }
    if (!setting('checkboxColdStartClips')) return 'skipped';
    p.audio.addEventListener('canplay', go, { once: true });
    attach(p);
    return 'pending';
}

export function poolInfo() {
    const ps = [...pool.values()];
    return {
        size: ps.length,
        ready: ps.filter(p => p.audio.readyState >= 3).length,
        dead: ps.filter(p => p.dead).length,
        playing: current ? current.did : null,
    };
}
