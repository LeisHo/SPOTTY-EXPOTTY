// SPOTTY EXPOTTY -- host entry point.
// Scroll (wheel / touch drag / arrow keys) or drag the timeline to scrub through
// every song added to the diary playlists, in the order they were added. While
// scrubbing, 30-second preview clips flash past from a preloaded pool; when
// scrubbing stops, the real song plays in Spotify's embedded player.
import { createUIElement, resolveAndApplyAll } from '../lib/ui-engine/registry.mjs';
import { setting } from './app/settings.js';
import { createTimeline } from './app/timeline.js';
import { preload, playClip, stopClip, unlock, isUnlocked, poolInfo } from './app/clipPlayer.js';
import { initEmbed, playTrack, pauseEmbed, embedStatus } from './app/handoff.js';

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
                <div class="spx-kicker" id="spxKicker"></div>
                <div class="spx-title" id="spxTitle">Loading…</div>
                <div class="spx-artist" id="spxArtist"></div>
                <div class="spx-meta" id="spxMeta"></div>
                <div class="spx-hint">Scroll, drag, or use ← → to scrub through the songs in the order you added them.</div>
            </div>
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

    const timeline = createTimeline(el('spxTimeline'), data, i => seek(i));
    const applyLook = () => {
        el('spxTimeline').style.height = setting('sliderTimelineHeight') + 'px';
        timeline.draw(idx);
        el('spxPool').hidden = !setting('checkboxShowPoolOverlay');
    };

    function render() {
        const s = songs[idx];
        el('spxKicker').textContent = `${data.playlists[s.p].name}  ·  ${idx + 1} / ${songs.length}`;
        el('spxTitle').textContent = s.n;
        el('spxArtist').textContent = s.a;
        el('spxMeta').textContent = `${s.al}${s.ry ? ' (' + s.ry + ')' : ''}  ·  added ${fmtDate(s.t)}${s.d ? '' : '  ·  no preview clip'}`;
        timeline.draw(idx);
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
            const ahead = Math.min(40, Math.max(setting('sliderPreloadAhead'), Math.ceil(speed))), behind = setting('sliderPreloadBehind');
            const fwd = dir >= 0 ? ahead : behind, back = dir >= 0 ? behind : ahead;
            const dids = [];
            for (let i = idx - back; i <= idx + fwd; i++) if (i >= 0 && i < songs.length && songs[i].d) dids.push(songs[i].d);
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
        const n = Math.round(pos);
        if (n !== idx) onIndexChange(n);
    }
    function seek(i) { moveTo(i); }

    // wheel
    window.addEventListener('wheel', e => {
        if (e.target.closest && e.target.closest('#devPanel')) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
        moveTo(pos + unit * setting('sliderSongsPerWheelNotch') * (setting('checkboxInvertScroll') ? -1 : 1));
    }, { passive: false });

    // touch drag (vertical)
    let touchY = null;
    el('spxZone').addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touchY = e.clientY; });
    window.addEventListener('pointermove', e => {
        if (touchY === null || e.pointerType !== 'touch') return;
        const dy = touchY - e.clientY;
        touchY = e.clientY;
        moveTo(pos + (dy / 100) * setting('sliderSongsPerDrag100') * (setting('checkboxInvertScroll') ? -1 : 1));
    });
    const endTouch = () => { touchY = null; };
    window.addEventListener('pointerup', endTouch);
    window.addEventListener('pointercancel', endTouch);

    // keyboard
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

    // sound unlock (browsers require one click before audio can start)
    el('spxStartBtn').addEventListener('click', () => {
        unlock();
        el('spxStart').hidden = true;
        playClip(songs[idx].d);
        schedulePreload();
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
    schedulePreload();
    window.spotty = { songs, seek, moveTo, get idx() { return idx; }, poolInfo, playClip, unlock };
}

boot();
