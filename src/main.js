// SPOTTY EXPOTTY -- host entry point.
// Click-drag (or one-finger drag) along the timeline to scrub through every song added to
// the diary playlists, in the order they were added; the mouse wheel / two-finger pinch zooms
// the timeline, which sets how far a drag moves. While scrubbing, 30-second preview clips
// flash past from a preloaded pool; when scrubbing stops, the real song plays in Spotify's
// (invisible) embedded player. The album cover is the play/pause button.
import { createUIElement, resolveAndApplyAll } from '../lib/ui-engine/registry.mjs';
import { setting } from './app/settings.js';
import { createTimeline } from './app/timeline.js';
import { preload, playClip, stopClip, unlock, isUnlocked, poolInfo } from './app/clipPlayer.js';
import { initEmbed, playTrack, pauseEmbed, toggleTrack, onPlayState, embedStatus } from './app/handoff.js';
import { cleanTitle } from './app/title.mjs';

const appStage = document.getElementById('appStage');
if (appStage) {
    createUIElement({
        id: 'appStage',
        role: 'container',
        layout: {
            position: { mode: 'fixed', viewportAnchor: 'top-left', offset: { x: '0px', y: '0px' } },
            size: {
                width: { mode: 'fixed', value: '100vw' },
                height: { mode: 'fixed', value: '100vh' },
            },
        },
        domNode: appStage,
    });
    resolveAndApplyAll();
}

const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function boot() {
    if (!appStage) return;
    appStage.innerHTML = `
        <div class="spx-app">
            <div class="spx-zone" id="spxZone">
                <div class="spx-title" id="spxTitle">Loading…</div>
                <div class="spx-artist" id="spxArtist"></div>
                <div class="spx-meta" id="spxMeta"></div>
            </div>
            <button class="spx-cover" id="spxCover" type="button" aria-label="Play">
                <img id="spxCoverImg" alt="">
                <span class="spx-cover-glyph" id="spxGlyph">▶</span>
            </button>
            <canvas class="spx-timeline" id="spxTimeline"></canvas>
            <div class="spx-embed"><div id="spxEmbed"></div></div>
            <div class="spx-pool" id="spxPool" hidden></div>
            <div class="spx-start" id="spxStart"><button type="button" id="spxStartBtn">Click to enable sound</button></div>
        </div>`;
    const el = id => document.getElementById(id);
    let data;
    try {
        data = await (await fetch('data/processed/timeline.json')).json();
    } catch (e) {
        el('spxTitle').textContent = 'Could not load data/processed/timeline.json';
        return;
    }
    const songs = data.songs;
    let pos = 0, idx = 0, dir = 1, handedOff = false, handoffTimer = 0, preloadQueued = false, moveLog = [];

    const timeline = createTimeline(el('spxTimeline'), data);
    const applyLook = () => {
        el('spxTimeline').style.height = setting('sliderTimelineHeight') + 'px';
        const cover = el('spxCover');
        cover.style.width = setting('sliderCoverSize') + 'px';
        timeline.draw();
        el('spxPool').hidden = !setting('checkboxShowPoolOverlay');
    };

    // ---- album cover (Spotify oEmbed; allows browser access) ----------------
    const coverCache = new Map();
    let coverTimer = 0;
    async function coverUrl(id) {
        if (coverCache.has(id)) return coverCache.get(id);
        let url = '';
        try {
            const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/' + id));
            url = (await r.json()).thumbnail_url || '';
        } catch (e) { /* offline or blocked: no cover */ }
        coverCache.set(id, url);
        return url;
    }
    function scheduleCover() {
        clearTimeout(coverTimer); // don't fetch a cover for every song flashing past
        coverTimer = setTimeout(async () => {
            const id = songs[idx].id;
            const url = await coverUrl(id);
            if (songs[idx].id === id && url) el('spxCoverImg').src = url;
        }, 150);
    }

    function render() {
        const s = songs[idx];
        el('spxTitle').textContent = cleanTitle(s.n);
        el('spxArtist').textContent = s.a;
        el('spxMeta').textContent = `${s.al}${s.ry ? ' (' + s.ry + ')' : ''}  ·  added ${fmtDate(s.t)}${s.d ? '' : '  ·  no preview clip'}`;
        scheduleCover();
    }

    function schedulePreload() {
        if (preloadQueued) return;
        preloadQueued = true;
        requestAnimationFrame(() => {
            preloadQueued = false;
            // Preload farther ahead the faster the user scrubs: ~1 s of travel at the
            // current speed (songs/sec over the last 400 ms), never below the slider.
            const now = performance.now();
            moveLog = moveLog.filter(m => now - m.t < 400);
            const speed = moveLog.length ? Math.abs(moveLog[moveLog.length - 1].i - moveLog[0].i) / 0.4 : 0;
            // Capped at 16: the proxy serves Deezer lookups at ~8/s, so asking for more
            // than a couple of seconds of travel only queues requests that go stale.
            const ahead = Math.min(16, Math.max(setting('sliderPreloadAhead'), Math.ceil(speed))), behind = setting('sliderPreloadBehind');
            // Nearest the playhead first, in the direction of travel first.
            const dids = [];
            const add = i => { if (i >= 0 && i < songs.length && songs[i].d && !dids.includes(songs[i].d)) dids.push(songs[i].d); };
            add(idx);
            for (let k = 1; k <= Math.max(ahead, behind); k++) {
                if (k <= ahead) add(idx + dir * k);
                if (k <= behind) add(idx - dir * k);
            }
            preload(dids);
        });
    }

    function onIndexChange(newIdx) {
        dir = newIdx >= idx ? 1 : -1;
        idx = newIdx;
        moveLog.push({ t: performance.now(), i: idx });
        render();
        schedulePreload();
        if (handedOff) { pauseEmbed(); handedOff = false; }
        playClip(songs[idx].d);
        clearTimeout(handoffTimer);
        handoffTimer = setTimeout(() => {
            stopClip();
            if (isUnlocked() && setting('checkboxHandoffEnabled')) { playTrack(songs[idx].id); handedOff = true; }
        }, setting('sliderHandoffDelay'));
    }

    function moveTo(p) {
        pos = clamp(p, 0, songs.length - 1);
        timeline.setPos(pos);
        const n = Math.round(pos);
        if (n !== idx) onIndexChange(n);
        timeline.draw();
    }
    const seek = i => moveTo(i);

    // ---- input ---------------------------------------------------------------
    // Wheel = zoom (changes the scrub scale). Drag = relative scrub: moving the pointer dx px
    // moves the playhead dx px along the current scale, wherever the drag started, so it
    // advances song by song through the preloaded clips instead of jumping to the cursor.
    window.addEventListener('wheel', e => {
        if (e.target.closest && e.target.closest('#devPanel')) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
        timeline.zoomBy(Math.exp(unit * 0.25 * setting('sliderTimelineZoomSpeed')));
        timeline.draw();
    }, { passive: false });

    const ptrs = new Map();
    let pinchDist = 0;
    const pinchSpan = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    window.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!e.target.closest || !e.target.closest('#spxZone, #spxTimeline')) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) pinchDist = pinchSpan();
    });
    window.addEventListener('pointermove', e => {
        const prev = ptrs.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        if (ptrs.size === 1) {
            const sign = setting('checkboxInvertScroll') ? -1 : 1;
            moveTo(timeline.scrubFromDrag((cur.x - prev.x) * sign));
            ptrs.set(e.pointerId, cur);
        } else if (ptrs.size === 2) {
            ptrs.set(e.pointerId, cur);
            const d = pinchSpan();
            timeline.zoomBy(pinchDist / d); // fingers apart = zoom in (smaller span)
            pinchDist = d;
            timeline.draw();
        }
    });
    const endPointer = e => { ptrs.delete(e.pointerId); if (ptrs.size === 2) pinchDist = pinchSpan(); };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    window.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('input, select, textarea, #devPanel')) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') moveTo(Math.round(pos) + step);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') moveTo(Math.round(pos) - step);
        else if (e.key === 'Home') moveTo(0);
        else if (e.key === 'End') moveTo(songs.length - 1);
        else return;
        e.preventDefault();
    });

    // ---- sound unlock + album-cover play button ------------------------------
    // Browsers require a user gesture before audio can start. The first click or key press
    // ANYWHERE counts (not just the button), so the overlay can't get stuck behind the dev
    // panel or on a small screen.
    const unlockSound = () => {
        if (isUnlocked()) return;
        unlock();
        el('spxStart').hidden = true;
        playClip(songs[idx].d);
        schedulePreload();
    };
    document.addEventListener('pointerdown', unlockSound, { capture: true, once: true });
    document.addEventListener('keydown', unlockSound, { capture: true, once: true });
    el('spxStartBtn').addEventListener('click', unlockSound);

    el('spxCover').addEventListener('click', () => {
        unlockSound();
        clearTimeout(handoffTimer);
        stopClip();
        toggleTrack(songs[idx].id);
    });
    onPlayState(playing => {
        el('spxGlyph').textContent = playing ? '❚❚' : '▶';
        el('spxCover').classList.toggle('playing', playing);
        el('spxCover').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });

    // settings changes (dev panel controls fire input/change)
    document.addEventListener('input', applyLook);
    document.addEventListener('change', applyLook);

    // debug overlay
    setInterval(() => {
        if (el('spxPool').hidden) return;
        const p = poolInfo();
        el('spxPool').textContent = `pool ${p.size} · ready ${p.ready} · no-clip ${p.dead} · embed ${embedStatus()} · playing ${p.playing ?? '-'}`;
    }, 250);

    initEmbed(el('spxEmbed'), songs[0].id);
    applyLook();
    render();
    timeline.setPos(0);
    timeline.draw();
    schedulePreload();
    window.spotty = { songs, seek, moveTo, timeline, get idx() { return idx; }, get pos() { return pos; }, poolInfo, playClip, unlock };
}

boot();
