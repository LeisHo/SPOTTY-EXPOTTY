// SPOTTY EXPOTTY -- host entry point.
// Desktop: the mouse wheel scrubs through every song added to the diary playlists (in the order
// they were added); a click on the timeline jumps there; click-and-drag zooms the timeline with the
// playhead as the zoom origin. Touch: one-finger drag scrubs, two-finger pinch zooms, tap jumps.
// While scrubbing, 30-second preview clips flash past from a preloaded pool; when scrubbing stops,
// the real song plays in Spotify's (invisible) embedded player. The album cover is the play/pause
// button. Every on-screen element's position and scale is owned by the UI Layout Engine (lib/ui-engine).
import {
    createUIElement, updateElement, resolveAndApplyAll, captureAllLayoutConfigs, registerStorageBackend, loadLayoutConfig,
    resetLayoutConfig,
} from '../lib/ui-engine/registry.mjs';
import { setting } from './app/settings.js';
import { createTimeline } from './app/timeline.js';
import { preload, playClip, stopClip, unlock, isUnlocked, poolInfo } from './app/clipPlayer.js';
import { initEmbed, playTrack, pauseEmbed, toggleTrack, onPlayState, embedStatus } from './app/handoff.js';
import { cleanTitle } from './app/title.mjs';
import { initTitleAnim } from './app/titleAnim.js';
import { createBackground } from './app/background.js';

const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function boot() {
    const appStage = document.getElementById('appStage');
    if (!appStage) return;
    appStage.innerHTML = `
        <div class="spx-app" id="spxApp">
            <canvas class="spx-bg spx-bg-prev" id="spxBgPrev"></canvas>
            <canvas class="spx-bg" id="spxBg"></canvas>
            <div class="ui-element spx-title" id="spxTitle"><a id="spxTitleLink" target="_blank" rel="noopener noreferrer">Loading…</a></div>
            <div class="ui-element spx-artist" id="spxArtist"></div>
            <div class="ui-element spx-meta" id="spxMeta"></div>
            <!-- the timeline precedes the cover in the DOM: CSS anchor positioning (the cover is placed relative to it)
                requires the anchor target to come earlier in tree order than the element anchored to it -->
            <canvas class="ui-element spx-timeline" id="spxTimeline"></canvas>
            <button class="ui-element spx-cover" id="spxCover" type="button" aria-label="Play">
                <img id="spxCoverImg" alt="" draggable="false" crossorigin="anonymous">
                <span class="spx-cover-glyph" id="spxGlyph">▶</span>
            </button>
            <div class="spx-embed"><div id="spxEmbed"></div></div>
            <div class="spx-pool" id="spxPool" hidden></div>
            <div class="spx-start" id="spxStart"><button type="button" id="spxStartBtn">Click to enable sound</button></div>
            <div class="spx-inspector" id="spxInspectorPanel" hidden>
                <div class="spx-inspector-head"><span>UI LAYOUT INSPECTOR</span><button type="button" id="spxInspectorClose">✕</button></div>
                <div id="spxInspectorMount"></div>
            </div>
        </div>`;
    const el = id => document.getElementById(id);

    // ---- UI Layout Engine: position + scale of every on-screen element ------------------
    // (docs: HTML UI ENGINE/docs/ENGINE_API.md, UI_LAYOUT.md.) The stage fills the viewport; each
    // element is registered with group/propertyLabel so the Inspector lists them as objects.
    // Title/timeline use `anchor` mode (absolute inside the full-screen stage), not `fixed`: CSS Anchor
    // Positioning, which `relative` mode uses, needs the target and the element to share a containing block.
    createUIElement({
        id: 'appStage', role: 'container', domNode: appStage,
        layout: {
            position: { mode: 'fixed', viewportAnchor: 'top-left', offset: { x: '0px', y: '0px' } },
            size: { width: { mode: 'fixed', value: '100vw' }, height: { mode: 'fixed', value: '100vh' } },
        },
    });
    const ctx = (o = {}) => ({
        mobilePortrait: { enabled: true, overrides: o.mobilePortrait || {} },
        mobileLandscape: { enabled: true, overrides: o.mobileLandscape || {} },
    });
    createUIElement({
        id: 'spxTitle', role: 'text', domNode: el('spxTitle'), group: 'Song Title', propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'anchor', horizontal: { anchor: 'center', offset: '0px' }, vertical: { anchor: 'top', offset: '12vh' } },
            size: { width: { mode: 'fixed', value: '90vw' }, height: { mode: 'content' } },
        },
        contexts: ctx({ mobileLandscape: { offsetY: '5vh' } }),
    });
    createUIElement({
        id: 'spxArtist', role: 'text', domNode: el('spxArtist'), group: 'Artist', propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'relative', relativeTo: 'spxTitle', myAnchor: 'top-center', targetAnchor: 'bottom-center', gap: '10px' },
            size: { width: { mode: 'fixed', value: '90vw' }, height: { mode: 'content' } },
        },
        contexts: ctx(),
    });
    createUIElement({
        id: 'spxMeta', role: 'text', domNode: el('spxMeta'), group: 'Album & Date Line', propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'relative', relativeTo: 'spxArtist', myAnchor: 'top-center', targetAnchor: 'bottom-center', gap: '12px' },
            size: { width: { mode: 'fixed', value: '90vw' }, height: { mode: 'content' } },
        },
        contexts: ctx(),
    });
    createUIElement({
        id: 'spxTimeline', role: 'container', domNode: el('spxTimeline'), group: 'Timeline', propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'anchor', horizontal: { anchor: 'center', offset: '0px' }, vertical: { anchor: 'bottom', offset: '14px' } },
            size: { width: { mode: 'fixed', value: '96vw' }, height: { mode: 'fixed', value: '200px' } },
        },
        contexts: ctx({ mobilePortrait: { heightValue: '150px' }, mobileLandscape: { heightValue: '110px' } }),
    });
    createUIElement({
        id: 'spxCover', role: 'button', domNode: el('spxCover'), group: 'Album Cover', propertyLabel: 'Position & Size',
        // Positioned from the stage's bottom edge by a fixed offset (timeline bottom 14 px + its default
        // height + a 14 px gap), NOT relative to the timeline: resizing the timeline must not move the
        // cover. No size ceiling (max is effectively unbounded): scaled up, it renders behind the rest of the UI.
        layout: {
            position: { mode: 'anchor', horizontal: { anchor: 'center', offset: '0px' }, vertical: { anchor: 'bottom', offset: '228px' } },
            size: {
                width: { mode: 'clamp', min: '80px', preferred: '22vmin', max: '9999px' },
                height: { mode: 'aspect', ratio: '1/1', basis: 'width' },
            },
        },
        contexts: ctx({
            mobilePortrait: { widthPreferred: '34vmin', offsetY: '178px' },
            mobileLandscape: { widthPreferred: '24vmin', offsetY: '138px' },
        }),
    });
    resolveAndApplyAll();
    const shippedLayout = captureAllLayoutConfigs();

    // Layout persistence rides on the dev panel's own Sync/Reset (devSaveCaptureExtra/ApplyExtra in
    // devPanel.js): the engine's saved state is stored under `extra.uiLayout` in the same GitHub file.
    let pendingLayout = null;
    registerStorageBackend({
        save() { if (typeof saveDevPanelSettings === 'function') saveDevPanelSettings(); },
        load() { return pendingLayout; },
    });
    window.spxCaptureLayout = () => captureAllLayoutConfigs();
    window.spxApplyLayout = state => { pendingLayout = state; loadLayoutConfig(); timeline.draw(); };
    window.spxResetLayout = () => { resetLayoutConfig(shippedLayout); resolveAndApplyAll(); timeline.draw(); };

    // ---- data ----------------------------------------------------------------------
    let data;
    try {
        data = await (await fetch('data/processed/timeline.json')).json();
    } catch (e) {
        el('spxTitleLink').textContent = 'Could not load data/processed/timeline.json';
        return;
    }
    const songs = data.songs;
    let pos = 0, idx = 0, dir = 1, handedOff = false, handoffTimer = 0, preloadQueued = false, moveLog = [];
    let lastTimelineHeight = null;

    const timeline = createTimeline(el('spxTimeline'), data);
    if (window.__spxPendingLayout) { window.spxApplyLayout(window.__spxPendingLayout); window.__spxPendingLayout = null; }
    new ResizeObserver(() => timeline.draw()).observe(el('spxTimeline'));

    // Page background (full-viewport canvas behind everything) and the track title's hover/press animation.
    const covers = data.covers || [];
    const background = createBackground({
        canvas: el('spxBg'), prevCanvas: el('spxBgPrev'), coverEl: el('spxCover'), coverImg: el('spxCoverImg'),
        getPalette: () => { const c = songs[idx] && songs[idx].c; return c !== undefined ? covers[c] : null; },
    });
    initTitleAnim(el('spxTitleLink'));

    // Evaluate a dev-panel curve ({points, method}) at x in 0..1 -> y in 0..1, with the dev panel's own
    // evaluator when available (same math as the editor draws), else a plain linear interpolation.
    const curveY = (curve, x) => {
        const pts = (curve && curve.points && curve.points.length ? curve.points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
        if (typeof window.evaluateCurveEditorPoints === 'function') return clamp(window.evaluateCurveEditorPoints(pts, x, (curve && curve.method) || 'monotone'), 0, 1);
        const s = [...pts].sort((a, b) => a.x - b.x);
        if (x <= s[0].x) return s[0].y;
        for (let i = 0; i < s.length - 1; i++) if (x <= s[i + 1].x) return s[i].y + ((x - s[i].x) / ((s[i + 1].x - s[i].x) || 1)) * (s[i + 1].y - s[i].y);
        return s[s.length - 1].y;
    };
    // Px the playhead moves per wheel notch: the plain slider, or (curve group enabled) the curve evaluated at
    // the current zoom scale, scaled between the curve's Y Bottom and Y Top.
    const wheelPixels = () => {
        if (!setting('checkboxWheelCurveEnabled')) return setting('sliderWheelScrubPixels');
        const y = curveY(setting('curveEditorWheelScrubCurve'), timeline.zoomFraction(setting('selectWheelCurveXRange')));
        const lo = setting('sliderWheelCurveMinPx'), hi = setting('sliderWheelCurveMaxPx');
        return lo + (hi - lo) * y;
    };
    // The span the timeline starts at: the curve (enabled) evaluated at the playhead's position along the
    // whole timeline, mapped on a log scale between its Y Bottom and Y Top days; else the plain slider.
    // Applied at load, on double-click on the timeline, and (optionally) on Home / End.
    const DAY_MS = 864e5;
    function applyStartSpan(force) {
        let days;
        if (setting('checkboxStartSpanCurveEnabled')) {
            const lo = Math.max(0.001, setting('sliderStartSpanCurveMinDays')), hi = Math.max(lo, setting('sliderStartSpanCurveMaxDays'));
            days = lo * Math.pow(hi / lo, curveY(setting('curveEditorStartSpanCurve'), timeline.timeFraction()));
        } else if (force) days = setting('sliderDefaultTimelineSpanDays');
        else return;
        timeline.setSpanMs(days * DAY_MS);
        timeline.centerOnPlayhead();
        timeline.draw();
    }
    // the saved dev-panel state arrives a moment after load, so apply the curve once it has had time to restore
    setTimeout(() => applyStartSpan(false), 1500);
    document.addEventListener('input', e => { if (/StartSpanCurve/.test((e.target && e.target.id) || '')) applyStartSpan(false); });
    window.addEventListener('dblclick', e => { if (e.target.id === 'spxTimeline') applyStartSpan(true); });
    const afterJump = () => { if (setting('checkboxStartSpanApplyOnJump')) applyStartSpan(false); };

    const applyLook = () => {
        const scale = (id, v) => el('spxApp').style.setProperty(id, String(v));
        scale('--spx-title-scale', setting('sliderTitleScale'));
        scale('--spx-artist-scale', setting('sliderArtistScale'));
        scale('--spx-meta-scale', setting('sliderMetaScale'));
        // Timeline height goes through the layout engine; the timeline is pinned by its bottom edge and
        // nothing else is positioned from it, so only the bars grow (upward).
        const wantH = setting('sliderTimelineHeight') + 'px';
        if (wantH !== lastTimelineHeight) {
            lastTimelineHeight = wantH;
            updateElement('spxTimeline', { size: { height: { value: wantH } } });
            resolveAndApplyAll();
        }
        timeline.draw();
        el('spxPool').hidden = !setting('checkboxShowPoolOverlay');
    };

    // ---- album cover (Spotify oEmbed; allows browser access) --------------------------------
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
        const link = el('spxTitleLink');
        link.textContent = cleanTitle(s.n);
        link.href = 'https://open.spotify.com/track/' + s.id; // the title opens the track on Spotify
        el('spxArtist').textContent = s.a;
        el('spxMeta').textContent = `${s.al}${s.ry ? ' (' + s.ry + ')' : ''}  ·  added ${fmtDate(s.t)}${s.d ? '' : '  ·  no preview clip'}`;
        scheduleCover();
        background.refresh(); // palette-driven modes change with the song even if the cover image did not
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

    // The current song is the LAST one added at or before the playhead's time (timeline.currentIndex()
    // = floor(pos)): landing in an empty stretch of the timeline plays the most recent earlier song.
    function moveTo(p) {
        pos = clamp(p, 0, songs.length - 1);
        timeline.setPos(pos);
        const n = timeline.currentIndex();
        if (n !== idx) onIndexChange(n);
        timeline.draw();
    }
    const seek = i => moveTo(i);

    // ---- input ---------------------------------------------------------------------------
    // Desktop: wheel = scrub (a notch moves the playhead N px along the current scale), click on the
    // timeline = jump, click-drag = zoom around the playhead. Touch: drag = scrub, pinch = zoom, tap = jump.
    const inUi = t => t.closest && t.closest('#devPanel, #spxInspectorPanel, #spxStart, #spxCover, a, button, input, select, textarea');
    // The title/artist/album lines are selectable text: a drag that starts on them selects it instead of zooming.
    const inText = t => t.closest && t.closest('.spx-title, .spx-artist, .spx-meta');
    window.addEventListener('wheel', e => {
        if (inUi(e.target)) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
        moveTo(timeline.scrubByPixels(unit * wheelPixels() * (setting('checkboxInvertScroll') ? -1 : 1)));
    }, { passive: false });

    const ptrs = new Map(); // pointerId -> { x, y, startX, startY, type, onTimeline, moved }
    let pinchDist = 0;
    const pinchSpan = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    window.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((inUi(e.target) || inText(e.target)) && e.target.id !== 'spxTimeline') return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType, onTimeline: e.target.id === 'spxTimeline', moved: false });
        if (ptrs.size === 2) pinchDist = pinchSpan();
    });
    window.addEventListener('pointermove', e => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4) p.moved = true;
        p.x = e.clientX; p.y = e.clientY;
        if (ptrs.size === 2) {
            const d = pinchSpan();
            timeline.zoomBy(pinchDist / d); // fingers apart = zoom in (smaller span), origin = playhead
            pinchDist = d;
            timeline.draw();
        } else if (p.moved) {
            if (p.type === 'mouse') { // click-drag zooms, drag right = zoom in
                timeline.zoomBy(Math.exp(-dx * 0.008 * setting('sliderTimelineZoomSpeed') * (setting('checkboxInvertZoomDrag') ? -1 : 1)));
                timeline.draw();
            } else { // one finger: scrub
                moveTo(timeline.scrubByPixels(dx * (setting('checkboxInvertScroll') ? -1 : 1)));
            }
        }
    });
    const endPointer = e => {
        const p = ptrs.get(e.pointerId);
        if (p && !p.moved && p.onTimeline && e.type === 'pointerup') { // a click/tap on the timeline jumps there
            moveTo(timeline.posAtX(e.clientX - el('spxTimeline').getBoundingClientRect().left));
        }
        ptrs.delete(e.pointerId);
        if (ptrs.size === 2) pinchDist = pinchSpan();
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    window.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('input, select, textarea, #devPanel')) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') moveTo(timeline.currentIndex() + step);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') moveTo(timeline.currentIndex() - step);
        else if (e.key === 'Home') { moveTo(0); afterJump(); }
        else if (e.key === 'End') { moveTo(songs.length - 1); afterJump(); }
        else return;
        e.preventDefault();
    });

    // ---- sound unlock + album-cover play button ---------------------------------------------
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

    // ---- UI Layout Inspector (dev only): the engine's own Inspector in a floating panel ------
    let inspectorMounted = false;
    document.addEventListener('click', async e => {
        if (e.target.id !== 'buttonOpenLayoutInspector') return;
        const panel = el('spxInspectorPanel');
        panel.hidden = !panel.hidden;
        if (!panel.hidden && !inspectorMounted) {
            const { mountInspector } = await import('../lib/ui-engine/inspector.mjs');
            mountInspector(el('spxInspectorMount'));
            inspectorMounted = true;
        }
    });
    el('spxInspectorClose').addEventListener('click', () => { el('spxInspectorPanel').hidden = true; });

    // settings changes (dev panel controls fire input/change)
    document.addEventListener('input', applyLook);
    document.addEventListener('change', applyLook);

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
