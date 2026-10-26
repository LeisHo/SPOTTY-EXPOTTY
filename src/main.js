// SPOTTY EXPOTTY -- host entry point.
// Desktop: the mouse wheel scrubs through every song added to the diary playlists (in the order
// they were added); a click on the timeline jumps there; click-and-drag zooms the timeline with the
// playhead as the zoom origin. Touch: one-finger drag scrubs, two-finger pinch zooms, tap jumps.
// While scrubbing, 30-second preview clips flash past from a preloaded pool; when scrubbing stops,
// the real song plays in Spotify's (invisible) embedded player. The album cover is the play/pause
// button. Every on-screen element's position and scale is owned by the UI Layout Engine (lib/ui-engine).
import {
    createUIElement, updateElement, setContextValue, getActiveContext, resolveAndApplyAll, captureAllLayoutConfigs, registerStorageBackend, loadLayoutConfig,
    resetLayoutConfig,
} from '../lib/ui-engine/registry.mjs';
import { setting, loadSavedSettings, rgbaOf, activeDevice } from './app/settings.js';
import { createTimeline } from './app/timeline.js';
import { preload, playClip, stopClip, unlock, isUnlocked, poolInfo, setMasterVolume, clipState, clipPosition, clipIsPlaying, previewClipsOn, seekClip, clipLength } from './app/clipPlayer.js';
import { initVolume } from './app/volume.js';
import { iconIndex, applyVolumeIcon, applyShuffleIcon, applyNavIcon, applyPlayIcon, applyCoverGlyph } from './app/iconStyles.js';
import { initDebugTools } from './app/debugTools.js';
import { logEvent } from './app/debugLog.js';
import { initEmbed, playTrack, pauseEmbed, toggleTrack, onPlayState, setOnEnded, playTrackCrossfade, noteSongChange, embedStatus, embedMode, initSdkPlayer, setRealVolume, activateRealPlayer, spotifyLoginStatus, sdkIsReady, sdkInfo, isPlaying, playingId, getProgress, seekTo } from './app/handoff.js';
import { hasClientId, isLoggedIn, handleRedirectIfAny, loginPopup, logout, onLoginChange } from './app/spotifyAuth.js';
import { cleanTitle } from './app/title.mjs';
import { initTitleAnim } from './app/titleAnim.js';
import { createBackground } from './app/background.js';
import { createFilter } from './app/filter.js';

const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
// exact add moment, in the viewer's local time; date only when the export has no time of day
const fmtAdded = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    if (!/Tdd:dd/.test(iso) || /T00:00:00/.test(iso)) return fmtDate(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function boot() {
    const appStage = document.getElementById('appStage');
    if (!appStage) return;
    // This page load may be Spotify sending the login popup back with a code: finish the login and close the popup (no app in it).
    if (await handleRedirectIfAny() && window.opener && !window.opener.closed) {
        document.body.textContent = 'Logged in to Spotify. You can close this window.';
        window.close();
        return;
    }
    // A normal visitor has no dev panel (it only exists in dev mode), so setting() would see only the code defaults. Load what the dev
    // panel last saved (Sync) first: settings.js falls back to it, and the saved UI layout is applied below.
    if (!document.documentElement.classList.contains('dev-mode')) {
        const st = await loadSavedSettings();
        if (st && st.extra && st.extra.uiLayout) window.__spxPendingLayout = st.extra.uiLayout;
    }
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
            <button class="ui-element spx-cover bs-host" id="spxCover" type="button" aria-label="Play">
                <img id="spxCoverImg" alt="" draggable="false" crossorigin="anonymous">
                <span class="spx-play-glyph"><svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="ico-play" d="M7 4l13 8-13 8z"/><path class="ico-pause" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg></span>
            </button>
            <div class="spx-embed"><div id="spxEmbed"></div></div>
            <div class="spx-sdk-status" id="spxSdkStatus" hidden></div>
            <div class="spx-songbar" id="spxSongBar"><div class="spx-songbar-empty"></div><div class="spx-songbar-fill"></div><div class="spx-songbar-hit" id="spxSongBarHit"></div><div class="spx-songbar-marker"></div></div>
            <button class="ui-element spx-nav bs-host" id="spxPrev" type="button" aria-label="Previous song"><svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14L6 12z"/></svg></button>
            <button class="ui-element spx-nav bs-host" id="spxNext" type="button" aria-label="Next song"><svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l12-7z"/></svg></button>
            <div class="ui-element spx-volume" id="spxVolume">
                <button type="button" class="spx-vol-btn bs-host" aria-label="Volume" aria-expanded="false" data-level="high">
                    <svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9v6h4l5 4V5L8 9H4z"/><path class="w1" d="M16 9.5a4 4 0 0 1 0 5"/><path class="w2" d="M18.5 7a7.5 7.5 0 0 1 0 10"/><path class="w3" d="M21 4.5a11 11 0 0 1 0 15"/><path class="x" d="M17 9l5 6M22 9l-5 6"/></svg>
                </button>
                <div class="spx-vol-clip"><div class="spx-vol-panel">
                    <div class="spx-vol-track" role="slider" tabindex="0" aria-label="Volume" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="spx-vol-fill"></div><div class="spx-vol-thumb"></div></div>
                    <div class="spx-vol-label">100%</div>
                </div></div>
            </div>
            <button type="button" class="spx-shuffle bs-host" id="spxShuffle" aria-label="Shuffle" aria-pressed="false" title="Shuffle off"><svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></button>
            <button type="button" class="spx-filter bs-host" id="spxFilter" aria-label="Filter songs" aria-pressed="false" aria-expanded="false" title="Filter off"><svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg></button>
            <div class="spx-pool" id="spxPool" hidden></div>
            <div class="spx-start" id="spxStart"><button type="button" class="spx-start-play" id="spxStartBtn" aria-label="Start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg></button></div>
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
            // 100dvh, not 100vh: on a phone 100vh is the height WITH the browser's address bar / bottom toolbar
            // hidden, so a stage that tall (everything is anchored to its bottom edge) has its bottom under the toolbar.
            // dvh is the part actually visible, and follows the toolbars as they show and hide.
            size: { width: { mode: 'fixed', value: '100vw' }, height: { mode: 'fixed', value: '100dvh' } },
        },
    });
    // Browsers without dvh support (before ~2022): size the stage from the visual viewport instead.
    if (!(window.CSS && CSS.supports && CSS.supports('height', '100dvh'))) {
        const fitStage = () => { appStage.style.height = ((window.visualViewport && window.visualViewport.height) || innerHeight) + 'px'; };
        fitStage();
        window.addEventListener('resize', fitStage);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', fitStage);
    }
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
        // phone portrait: lifted 28 px (desktop 14 px) off the bottom edge, clear of the system gesture bar
        contexts: ctx({ mobilePortrait: { heightValue: '150px', offsetY: '28px' }, mobileLandscape: { heightValue: '110px' } }),
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
            mobilePortrait: { widthPreferred: '34vmin', offsetY: '192px' }, // timeline 28 + 150 high + 14 gap
            mobileLandscape: { widthPreferred: '24vmin', offsetY: '138px' },
        }),
    });
    // Placed relative to the cover (so they stay vertically centred on it), then pushed out sideways by placeNav() below
    // to 14 px from the browser edges. (A calc() gap cannot be used: the engine negates the left one into invalid CSS.)
    [['spxPrev', 'Previous Song Button', 'center-right', 'center-left', '0px'], ['spxNext', 'Next Song Button', 'center-left', 'center-right', '0px']].forEach(([id, group, my, target, gap]) => createUIElement({
        id, role: 'button', domNode: el(id), group, propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'relative', relativeTo: 'spxCover', myAnchor: my, targetAnchor: target, gap },
            size: { width: { mode: 'fixed', value: '48px' }, height: { mode: 'fixed', value: '48px' } },
        },
        contexts: ctx(),
    }));
    createUIElement({
        id: 'spxVolume', role: 'container', domNode: el('spxVolume'), group: 'Volume Control', propertyLabel: 'Position & Size',
        layout: {
            position: { mode: 'anchor', horizontal: { anchor: 'left', offset: '14px' }, vertical: { anchor: 'top', offset: '14px' } },
            size: { width: { mode: 'content' }, height: { mode: 'content' } },
        },
        contexts: ctx(),
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
    // The saved layout can arrive before the timeline data does (timeline is created later), so the redraw goes through a hook set then.
    window.spxApplyLayout = state => { pendingLayout = state; loadLayoutConfig(); if (window.spxRedrawTimeline) window.spxRedrawTimeline(); };
    window.spxResetLayout = () => { resetLayoutConfig(shippedLayout); resolveAndApplyAll(); if (window.spxRedrawTimeline) window.spxRedrawTimeline(); };

    // ---- data ----------------------------------------------------------------------
    let data;
    try {
        data = await (await fetch('data/processed/timeline.json')).json();
    } catch (e) {
        el('spxTitleLink').textContent = 'Could not load data/processed/timeline.json';
        return;
    }
    const songs = data.songs;
    // The clip a song plays: its Deezer id (proxied, expiring links), else its iTunes preview link (static), else 0 (no clip).
    const clipKey = s => s.d || s.u || 0;
    let pos = 0, idx = 0, dir = 1, handedOff = false, handoffPending = false, handoffTimer = 0, preloadQueued = false, moveLog = [];
    let lastTimelineHeight = null, heightTouched = false;
    // The song whose full version the hand-off has asked for. The preview keeps playing until that full song reports it is
    // playing; if it never does, the preview carries on instead of going silent.
    let previewHold = null;
    let stepImmediate = false; // set by stepSong() so that one song change skips the handoff delay
    // Audio-feature filter (Filter button, filter.js). Created further down; until then every song passes.
    let flt = null;
    const filterOn = () => !!flt && flt.active() && !!setting('checkboxFilterButtonEnabled');
    const songOk = i => !filterOn() || flt.passes(i);
    // (capture phase: runs before the generic settings listener below, so applyLook sees the flag)
    ['input', 'change'].forEach(t => document.addEventListener(t, e => { if (/TimelineHeight$/.test((e.target && e.target.id) || '')) heightTouched = true; }, true));

    const timeline = createTimeline(el('spxTimeline'), data);
    window.spxRedrawTimeline = () => timeline.draw();
    if (window.__spxPendingLayout) { window.spxApplyLayout(window.__spxPendingLayout); window.__spxPendingLayout = null; }
    new ResizeObserver(() => timeline.draw()).observe(el('spxTimeline'));

    // Page background (full-viewport canvas behind everything) and the track title's hover/press animation.
    const covers = data.covers || [];
    const background = createBackground({
        canvas: el('spxBg'), prevCanvas: el('spxBgPrev'), coverEl: el('spxCover'), coverImg: el('spxCoverImg'),
        getPalette: () => { const c = songs[idx] && songs[idx].c; return c !== undefined ? covers[c] : null; },
    });
    initTitleAnim(el('spxTitleLink'));
    initTitleAnim(el('spxStartBtn'), 'StartPlay');
    // Volume (top right): scales the scrub clips. Spotify's embedded player has no volume method, so at exactly
    // 0 % the song player is simply stopped and not started (a full mute); above 0 it plays at its own level.
    const volume = initVolume({
        root: el('spxVolume'),
        onChange: v => { setMasterVolume(v); setRealVolume(v); }, // muting does not pause the real song (the SDK is silenced; the iframe embed cannot be)
    });

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
    // The three starting-span sliders always max out at the span that shows the WHOLE data set (the timeline's full
    // span, in days; it follows the data, not a hard-coded number). Includes Mobile/Landscape twins, which appear later.
    const fitSpanSliders = () => {
        const days = Math.ceil((timeline.fullSpanMs / DAY_MS) * 10) / 10;
        ['sliderDefaultTimelineSpanDays', 'sliderStartSpanCurveMinDays', 'sliderStartSpanCurveMaxDays'].forEach(id =>
            ['', 'Mobile', 'Landscape'].forEach(dev => {
                const el = document.getElementById(id.replace(/^slider/, 'slider' + dev));
                if (el && parseFloat(el.max) !== days) el.max = String(days);
            }));
    };
    fitSpanSliders();
    setInterval(fitSpanSliders, 1500);
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
    // Startup scale. Full Scale on Startup (on): always the whole timeline, nothing remembered. Off: the scale the visitor
    // was on last time (saved in this browser), unless the Starting Span Curve is on, which still sets the start.
    // With neither, the Starting Timeline Span slider applies as before.
    const SPAN_KEY = 'spxTimelineSpan';
    function startupSpan() {
        if (setting('checkboxFullScaleOnStartup')) { timeline.setSpanMs(timeline.fullSpanMs); timeline.centerOnPlayhead(); timeline.draw(); return; }
        if (!setting('checkboxStartSpanCurveEnabled')) {
            let saved = 0;
            try { saved = parseFloat(localStorage.getItem(SPAN_KEY)) || 0; } catch (e) { /* storage blocked */ }
            if (saved > 0) { timeline.setSpanMs(saved); timeline.centerOnPlayhead(); timeline.draw(); return; }
        }
        applyStartSpan(true);
    }
    // Remember the scale, only while Full Scale on Startup is off (the span is written when it changes, at most once a second).
    let lastSpan = 0;
    const rememberSpan = () => {
        if (setting('checkboxFullScaleOnStartup')) return;
        const s = timeline.span;
        if (Math.abs(s - lastSpan) < 1) return;
        lastSpan = s;
        try { localStorage.setItem(SPAN_KEY, String(s)); } catch (e) { /* storage blocked */ }
    };
    // the saved dev-panel state arrives a moment after load, so the startup scale waits for it; remembering starts only after that,
    // so the placeholder scale from before startup is never saved
    setTimeout(() => { startupSpan(); setInterval(rememberSpan, 1000); }, 1500);
    // "Randomize Starting Song": once the saved settings have arrived, jump to a random song unless the visitor already moved.
    // Only the visitor's moves on the app count. Input on the dev panel (in dev mode, the panel is open while the page loads)
    // must not cancel the jump; before this, any click or scroll there silently skipped it.
    let interacted = false;
    const onVisitorInput = e => { if (!(e.target && e.target.closest && e.target.closest('#devPanel'))) interacted = true; };
    ['pointerdown', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, onVisitorInput, { capture: true }));
    // Full Scale on Startup: the timeline's real width is known only once it is laid out, so the startup scale is applied again
    // when it first gets a size, until the visitor interacts (and for a few seconds at most).
    const reFitStart = new ResizeObserver(() => { if (!interacted && setting('checkboxFullScaleOnStartup')) startupSpan(); });
    reFitStart.observe(el('spxTimeline'));
    setTimeout(() => reFitStart.disconnect(), 4000);
    // In dev mode the panel's own live checkbox is still the default until the GitHub copy arrives (it can take longer than
    // a fixed delay), so read the saved state itself. A visitor's saved state is already loaded at boot, so this costs nothing there.
    (async () => {
        await Promise.resolve(); // let boot() finish first: in normal mode (saved settings already loaded) the code below used to run at once, and moveTo() -> render() touched variables declared further down (a TDZ crash: the random start never happened)
        const saved = document.documentElement.classList.contains('dev-mode')
            ? await loadSavedSettings()
            : null;
        const randomOn = saved ? !!(saved.controls && saved.controls.checkboxRandomStartSong) : !!setting('checkboxRandomStartSong');
        if (interacted || !randomOn) return;
        moveTo(Math.floor(Math.random() * songs.length));
        startupSpan();
        timeline.centerOnPlayhead();
        timeline.draw();
    })();
    document.addEventListener('input', e => { if (/StartSpanCurve/.test((e.target && e.target.id) || '')) applyStartSpan(false); });
    // Only the keys Home and End (and the double-click) apply the Starting Span, and only when that option is on.
    // Next / Last and shuffle never change the zoom: the zoom changes only when you change it.
    const afterJump = () => { if (setting('checkboxStartSpanApplyOnJump')) applyStartSpan(false); };

    const BS_PROPS = ['--bs-color', '--bs-size', '--bs-op', '--bs-size-hover', '--bs-op-hover', '--bs-size-press', '--bs-op-press', '--bs-size-release', '--bs-time'];
    function applyButtonStyle(P, hosts) {
        const g = id => setting(id), on = g('checkbox' + P + 'ButtonEnabled'), anim = on && g('checkbox' + P + 'AnimEnabled');
        const size = g('slider' + P + 'ButtonSize'), op = g('slider' + P + 'ButtonOpacity') / 100, hop = g('slider' + P + 'ButtonHoverOpacity') / 100;
        const v = !on ? null : {
            '--bs-color': g('color' + P + 'Button'), '--bs-size': size + 'px', '--bs-op': String(op),
            '--bs-size-hover': (anim ? g('slider' + P + 'AnimHoverSize') : size) + 'px', '--bs-op-hover': String(anim ? g('slider' + P + 'AnimHoverOpacity') / 100 : hop),
            '--bs-size-press': (anim ? g('slider' + P + 'AnimClickSize') : size) + 'px', '--bs-op-press': String(anim ? g('slider' + P + 'AnimClickOpacity') / 100 : hop),
            '--bs-size-release': (anim ? g('slider' + P + 'AnimReleaseSize') : size) + 'px', '--bs-time': (anim ? g('slider' + P + 'AnimTime') : 0) + 'ms',
        };
        hosts.forEach(h => { if (h) BS_PROPS.forEach(k => (v ? h.style.setProperty(k, v[k]) : h.style.removeProperty(k))); });
    }
    // Shuffle Button Animation: the shuffle button's sizes and opacities, in the same custom properties the other buttons use.
    function applyShuffleStyle() {
        const g = id => setting(id), anim = g('checkboxShuffleAnimEnabled'), size = g('sliderShuffleIconSize') + 'px';
        const v = {
            '--bs-size': size, '--bs-size-hover': (anim ? g('sliderShuffleAnimHoverSize') : g('sliderShuffleIconSize')) + 'px',
            '--bs-size-press': (anim ? g('sliderShuffleAnimClickSize') : g('sliderShuffleIconSize')) + 'px', '--bs-size-release': (anim ? g('sliderShuffleAnimReleaseSize') : g('sliderShuffleIconSize')) + 'px',
            '--bs-op-hover': anim ? String(g('sliderShuffleAnimHoverOpacity') / 100) : undefined, '--bs-op-press': anim ? String(g('sliderShuffleAnimClickOpacity') / 100) : undefined,
            '--bs-time': (anim ? g('sliderShuffleAnimTime') : 0) + 'ms',
        };
        BS_PROPS.forEach(k => {
            if (v[k] !== undefined) el('spxShuffle').style.setProperty(k, v[k]);
            else if (k === '--bs-op-hover' || k === '--bs-op-press') el('spxShuffle').style.removeProperty(k); // off: the state opacity applies
        });
    }
    // Volume Button Animation: the volume button's sizes and opacities, the same custom properties as the other buttons. The slider's own
    // open/close animation (Animation Time in the slider group) is separate and is not changed by this.
    function applyVolumeButtonStyle() {
        const g = id => setting(id), anim = g('checkboxVolBtnAnimEnabled'), icon = g('sliderVolIconSize') + 'px';
        const v = {
            '--bs-size': icon, '--bs-size-hover': (anim ? g('sliderVolBtnAnimHoverSize') : g('sliderVolIconSize')) + 'px',
            '--bs-size-press': (anim ? g('sliderVolBtnAnimClickSize') : g('sliderVolIconSize')) + 'px', '--bs-size-release': (anim ? g('sliderVolBtnAnimReleaseSize') : g('sliderVolIconSize')) + 'px',
            '--bs-op-hover': String(anim ? g('sliderVolBtnAnimHoverOpacity') / 100 : 1), '--bs-op-press': String(anim ? g('sliderVolBtnAnimClickOpacity') / 100 : 1),
            '--bs-time': (anim ? g('sliderVolBtnAnimTime') : 0) + 'ms',
        };
        const btn = el('spxVolume').querySelector('.spx-vol-btn');
        BS_PROPS.forEach(k => { if (v[k] !== undefined) btn.style.setProperty(k, v[k]); });
    }
    // Hover Tolerance (Shuffle, Next/Last, Play): the hover state also shows while the pointer is within the tolerance of the button.
    const HOVER_TOL = [['spxShuffle', 'sliderShuffleHoverTolerance'], ['spxFilter', 'sliderFilterHoverTolerance'], ['spxPrev', 'sliderNavHoverTolerance'], ['spxNext', 'sliderNavHoverTolerance'], ['spxCover', 'sliderPlayHoverTolerance']];
    const distToRect = (r, x, y) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    document.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        HOVER_TOL.forEach(([id, key]) => {
            const h = el(id);
            if (distToRect(h.getBoundingClientRect(), e.clientX, e.clientY) <= setting(key)) h.classList.add('bs-hover');
            else if (!h.matches(':hover')) h.classList.remove('bs-hover');
        });
    });
    // hover / press / release state classes for the styled buttons (the CSS does the animating)
    [['Play', [el('spxCover')]], ['Nav', [el('spxPrev'), el('spxNext')]], ['Shuffle', [el('spxShuffle')]], ['Volume', [el('spxVolume').querySelector('.spx-vol-btn')]]].forEach(([P, hosts]) => hosts.forEach(h => {
        h.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') h.classList.add('bs-hover'); });
        h.addEventListener('pointerleave', () => h.classList.remove('bs-hover', 'bs-press'));
        h.addEventListener('pointerdown', () => h.classList.add('bs-press'));
        const up = () => {
            if (!h.classList.contains('bs-press')) return;
            h.classList.remove('bs-press'); h.classList.add('bs-release');
            setTimeout(() => h.classList.remove('bs-release'), Math.max(60, setting('slider' + P + 'AnimTime')));
        };
        h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    }));
    // UI Layout > Text: per-element Font Size/Color/Bold/Italic/Underline/Letter Spacing/Line
    // Spacing/Opacity/Wrap/Max Width/Overflow/Outline/Enabled, ported 2026-10-25 (see devPanel.js's
    // buildSpottyTextElementGroup() for the full account). Replaces the old scale/clamp vars above.
    // Font SIZE is a literal px value now, not the old clamp(min, growth-vw, max)*scale formula --
    // a disclosed tradeoff (continuous vw growth is gone; a phone still gets its own size through
    // the existing Mobile/Landscape independence checkbox, same as every other control here).
    // Box WIDTH/POSITION stay engine-owned (CLAUDE.md's own architecture note) -- Max Width is
    // applied as a plain CSS max-width (never shrinks the engine's own box, only caps it), with no
    // margin/position changes, so it can't fight the Layout Engine for ownership of these boxes.
    const TEXT_ELEMENTS = [['SongTitle', () => el('spxTitle')], ['Artist', () => el('spxArtist')], ['AlbumDate', () => el('spxMeta')]];
    function applyTextElementStyles() {
        const effective = {}; // the final font size of each element, for the Scale Down to Match options
        TEXT_ELEMENTS.forEach(([p, getNode]) => {
            const node = getNode();
            if (!node) return;
            const enabled = setting('checkboxTxt' + p + 'Enabled');
            node.style.display = enabled ? '' : 'none';
            if (!enabled) return;
            let size = setting('sliderTxt' + p + 'FontSize');
            // Scale Down to Match: Artist is capped at the Song Title's final size, Album & Date at the Artist's
            const matchOf = { Artist: 'SongTitle', AlbumDate: 'Artist' }[p];
            if (matchOf && setting('checkboxScale' + p + 'ToMatch') && effective[matchOf] !== undefined) size = Math.min(size, effective[matchOf]);
            const overflow = setting('selectTxt' + p + 'Overflow');
            const st = node.style;
            st.color = setting('colorTxt' + p + 'Color');
            st.fontWeight = setting('checkboxTxt' + p + 'Bold') ? '700' : '400';
            st.fontStyle = setting('checkboxTxt' + p + 'Italic') ? 'italic' : 'normal';
            st.textDecoration = setting('checkboxTxt' + p + 'Underline') ? 'underline' : 'none';
            st.letterSpacing = setting('sliderTxt' + p + 'LetterSpacing') + 'px';
            st.lineHeight = String(setting('sliderTxt' + p + 'LineSpacing'));
            st.opacity = String(setting('sliderTxt' + p + 'Opacity'));
            st.maxWidth = setting('sliderTxt' + p + 'MaxWidth') + 'px';
            const outlineOn = setting('checkboxTxt' + p + 'OutlineEnabled');
            st.webkitTextStrokeWidth = outlineOn ? setting('sliderTxt' + p + 'OutlineThickness') + 'px' : '0px';
            st.webkitTextStrokeColor = outlineOn ? setting('colorTxt' + p + 'OutlineColor') : 'transparent';
            if (overflow === 'truncate') { st.whiteSpace = 'nowrap'; st.overflow = 'hidden'; st.textOverflow = 'ellipsis'; }
            else if (overflow === 'clip') { st.whiteSpace = 'nowrap'; st.overflow = 'hidden'; st.textOverflow = 'clip'; }
            else if (overflow === 'scale') { st.whiteSpace = 'nowrap'; st.overflow = 'visible'; st.textOverflow = ''; }
            else { st.whiteSpace = setting('checkboxTxt' + p + 'WordWrap') ? 'pre-line' : 'nowrap'; st.overflow = ''; st.textOverflow = ''; }
            st.fontSize = size + 'px';
            // Scale Down If Multiline (Song Title, Artist): shrink the font until the text wraps to at most the line limit
            const multi = { SongTitle: 'Title', Artist: 'Artist', AlbumDate: 'AlbumDate' }[p];
            if (multi && overflow !== 'scale' && setting('checkboxScale' + multi + 'Multiline')) {
                const maxLines = setting('slider' + multi + 'MaxLines');
                const lineMul = parseFloat(st.lineHeight) || 1.2;
                // Line count = content height / line height (not fragment rectangles, which count a smaller bracketed span
                // or a differently-aligned fragment as an extra line). Keep the set size when it already fits; otherwise
                // find the largest size (0.5 px steps) that still fits within the line limit.
                const cs = getComputedStyle(node);
                const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
                const fits = f => {
                    st.fontSize = f + 'px';
                    return (node.getBoundingClientRect().height - pad) <= maxLines * f * lineMul + 1;
                };
                let fs = size;
                if (!fits(size)) {
                    let lo = 6, hi = size; // lo is the fallback if nothing fits
                    for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
                        const mid = (lo + hi) / 2;
                        if (fits(mid)) lo = mid; else hi = mid;
                    }
                    fs = lo;
                }
                st.fontSize = fs + 'px';
            }
            if (overflow === 'scale') { // Shrink to Fit: back off from the configured size until it fits
                let fs = size;
                while (fs > 6 && node.scrollWidth > node.clientWidth) { fs -= 1; st.fontSize = fs + 'px'; }
            }
            effective[p] = parseFloat(st.fontSize);
        });
    }
    // The graph's box: full browser height on desktop (so bars reach the top). On a phone the height comes from that device's
    // Timeline Height setting (the engine's per-device value), so the forced height is removed there.
    function applyTimelineBox() {
        const tl = el('spxTimeline').style;
        if (activeDevice() === '') tl.setProperty('height', 'calc(100dvh - 14px)', 'important');
        else tl.removeProperty('height');
        timeline.draw(); // the band height is a setting: redraw when it changes
    }
    window.addEventListener('resize', () => { applyTextElementStyles(); applyTimelineBox(); }); // the line count and the device depend on the width
    // Global Override (dev panel > Global Override): a colour, an opacity and an optional standard animation laid over the buttons that are
    // ticked there. It runs after each button's own styling, so while a button is ticked its values win; unticking gives its own look back.
    function applyGlobalOverride() {
        const g = id => setting(id), on = g('checkboxGlobalOverrideEnabled'), anim = g('checkboxGlobalOverrideAnim');
        const col = g('colorGlobalOverride'), op = String(g('sliderGlobalOverrideOpacity') / 100);
        const animVars = {
            // Scales are percentages of each button's own icon size (its --bs-size), so they work for every button
            '--bs-size-hover': `calc(var(--bs-size, 26px) * ${g('sliderGlobalAnimHoverSize') / 100})`, '--bs-size-press': `calc(var(--bs-size, 26px) * ${g('sliderGlobalAnimClickSize') / 100})`,
            '--bs-size-release': `calc(var(--bs-size, 26px) * ${g('sliderGlobalAnimReleaseSize') / 100})`, '--bs-op-hover': String(g('sliderGlobalAnimHoverOpacity') / 100),
            '--bs-op-press': String(g('sliderGlobalAnimClickOpacity') / 100), '--bs-time': g('sliderGlobalAnimTime') + 'ms',
        };
        // kind 'bs': a .bs-host whose --bs-color / --bs-op are rewritten by applyButtonStyle on every change (Play, Next, Last).
        // kind 'plain': a button with its own inline-free styling (Shuffle, Volume), undone by removing the inline properties.
        const targets = [
            { k: 'Play', host: el('spxCover'), kind: 'bs' },
            { k: 'Next', host: el('spxNext'), kind: 'bs' },
            { k: 'Last', host: el('spxPrev'), kind: 'bs' },
            { k: 'Shuffle', host: el('spxShuffle'), kind: 'plain', opVar: '--bs-op' },
            { k: 'Volume', host: el('spxVolume').querySelector('.spx-vol-btn'), kind: 'plain', opVar: '--spx-vol-op' },
        ];
        targets.forEach(t => {
            const ticked = on && !!g('checkboxOverride' + t.k), st = t.host.style;
            if (t.kind === 'bs') {
                if (ticked) {
                    st.setProperty('--bs-color', col); st.setProperty('--bs-op', op);
                    if (anim) Object.entries(animVars).forEach(([k, v]) => st.setProperty(k, v));
                }
                return;
            }
            if (ticked) {
                st.setProperty('color', col); st.setProperty(t.opVar, op);
                if (anim) Object.entries(animVars).forEach(([k, v]) => st.setProperty(k, v));
            } else {
                st.removeProperty('color'); st.removeProperty(t.opVar);
            }
        });
    }
    const applyLook = () => {
        const scale = (id, v) => el('spxApp').style.setProperty(id, String(v));
        applyTextElementStyles();
        // Shows Spotify's own player so you can see whether it says "Log in" / "Preview" and log in INSIDE it.
        document.querySelector('.spx-embed').classList.toggle('spx-embed-visible', !!setting('checkboxShowSpotifyPlayer') && !sdkIsReady()); // the iframe is idle (and shows a stale preview UI) while the SDK plays
        volume.configure({
            enabled: setting('checkboxVolumeButtonEnabled'),
            muted: setting('sliderVolMutedOpacity'), icon: setting('sliderVolIconSize'), radius: setting('sliderVolCircleRadius'), barW: setting('sliderVolBarWidth'), barL: setting('sliderVolBarLength'),
            fill: setting('colorVolBarFill'), track: setting('colorVolBarTrack'), thumb: setting('colorVolCircle'),
            tol: setting('sliderVolHoverTolerance'), clickTol: setting('sliderVolClickTolerance'), duration: setting('sliderVolAnimDuration'),
            speedAt: s => curveY(setting('curveEditorVolAnimSpeedCurve'), s),
        });
        // Album cover scale + offset are visual only (they never move other elements); the prev/next buttons follow its Y offset.
        // Play Button + Next And Last Song Buttons (UI Layout): CSS variables on each host; off = the defaults in app.css (Nav) / no glyph (Play)
        applyButtonStyle('Play', [el('spxCover')]);
        applyButtonStyle('Nav', [el('spxPrev'), el('spxNext')]);
        el('spxApp').classList.toggle('no-play-glyph', !setting('checkboxPlayButtonEnabled'));
        // Shadow sets: one CSS variable each, read by app.css. Angle 90 = straight down; x and y come from depth and angle.
        const shadowOf = k => {
            const a = setting(`sliderShadow${k}Angle`) * Math.PI / 180, d = setting(`sliderShadow${k}Depth`);
            return { x: (d * Math.cos(a)).toFixed(2) + 'px', y: (d * Math.sin(a)).toFixed(2) + 'px', blur: setting(`sliderShadow${k}Blur`) + 'px', c: rgbaOf(setting(`colorShadow${k}`), setting(`sliderShadow${k}Opacity`)) };
        };
        const shCover = shadowOf('Cover'), shVol = shadowOf('Volume'), shNav = shadowOf('Nav');
        const shStyle = el('spxApp').style;
        shStyle.setProperty('--shadow-cover', `${shCover.x} ${shCover.y} ${shCover.blur} ${setting('sliderShadowCoverSpread')}px ${shCover.c}`);
        shStyle.setProperty('--shadow-vol', `drop-shadow(${shVol.x} ${shVol.y} ${shVol.blur} ${shVol.c})`);
        shStyle.setProperty('--shadow-vol-box', `${shVol.x} ${shVol.y} ${shVol.blur} ${shVol.c}`);
        shStyle.setProperty('--shadow-nav', `drop-shadow(${shNav.x} ${shNav.y} ${shNav.blur} ${shNav.c})`);
        // Brackets Smaller Text (app.css: .spx-bracket inside the title)
        el('spxApp').classList.toggle('brackets-small', !!setting('checkboxBracketsSmaller'));
        shStyle.setProperty('--spx-bracket-pct', setting('sliderBracketsFontPct') + '%');
        // raise the smaller bracketed text so its vertical centre (about 0.35 em above the baseline) matches the main text's
        const bp = Math.max(1, setting('sliderBracketsFontPct')) / 100;
        shStyle.setProperty('--spx-bracket-raise', (0.35 * (1 - bp) / bp).toFixed(3) + 'em');
        // Startup: the darkening over the app until the first input, and the play icon (its size, and whether it shows)
        el('spxStart').style.setProperty('--spx-start-bg', rgbaOf(setting('colorStartOverlay'), setting('sliderStartOverlayOpacity')));
        el('spxStartBtn').hidden = !setting('checkboxStartButtonEnabled');
        el('spxStartBtn').style.setProperty('--spx-start-play-size', setting('sliderStartPlaySize') + 'px');
        centerStartOnCover(); // reads the cover's rect, which applies the scale/offset set above first
        setArtistLine(); // live: changing the separator re-joins the current song's artists
        el('spxApp').style.setProperty('--spx-sep-pct', setting('sliderArtistSeparatorPct') + '%');
        el('spxApp').style.setProperty('--spx-vol-icon-x', setting('sliderVolIconOffsetX') + 'px');
        // The graph reaches the top of the browser: its box is the full height (bottom edge unchanged). Buttons above it take their clicks (buttonUnder).
        applyTimelineBox();
        el('spxStart').style.transition = `opacity ${setting('sliderStartFadeMs')}ms linear`;
        el('spxShuffle').hidden = !setting('checkboxShuffleButtonEnabled');
        { // Filter button + panel
            const a = el('spxApp').style, c = (k, v) => a.setProperty(k, v);
            el('spxFilter').hidden = !setting('checkboxFilterButtonEnabled');
            c('--spx-filter-icon', setting('sliderFilterIconSize') + 'px'); c('--spx-filter-x', setting('sliderFilterIconOffsetX') + 'px');
            c('--spx-filter-gap', setting('sliderFilterGapBelowShuffle') + 'px'); c('--spx-filter-edge', setting('sliderFilterEdgeOffset') + 'px');
            c('--spx-filter-off-op', String(setting('sliderFilterOffOpacity') / 100)); c('--spx-filter-on-op', String(setting('sliderFilterOnOpacity') / 100));
            c('--spx-filter-color', setting('colorFilterIcon')); c('--spx-filter-on-color', setting('colorFilterOn'));
            const ps = flt && flt.panel.style;
            if (ps) {
                ps.setProperty('--spx-flt-width', setting('sliderFilterPanelWidth') + 'px'); ps.setProperty('--spx-flt-font', setting('sliderFilterPanelFontSize') + 'px');
                ps.setProperty('--spx-flt-bg', rgbaOf(setting('colorFilterPanelBg'), setting('sliderFilterPanelBgOpacity') / 100)); ps.setProperty('--spx-flt-accent', setting('colorFilterPanelAccent'));
                flt.refresh(); syncFilterUi(); timeline.setFilter(filterOn() ? flt.passes : null);
                if (flt.open) placeFilterPanel();
            }
        }
        placeNav(); // the edge offset is a setting
        el('spxApp').style.setProperty('--spx-shuffle-icon', setting('sliderShuffleIconSize') + 'px');
        el('spxApp').style.setProperty('--spx-shuffle-x', setting('sliderShuffleIconOffsetX') + 'px');
        el('spxApp').style.setProperty('--spx-shuffle-off-op', String(setting('sliderShuffleOffOpacity') / 100));
        el('spxApp').style.setProperty('--spx-shuffle-color', setting('colorShuffleIcon'));
        el('spxApp').style.setProperty('--spx-shuffle-on-color', setting('colorShuffleOn'));
        el('spxApp').style.setProperty('--spx-vol-op', String(setting('sliderVolIconOpacity') / 100));
        el('spxApp').style.setProperty('--spx-shuffle-on-op', String(setting('sliderShuffleOnOpacity') / 100));
        el('spxApp').style.setProperty('--spx-glyph-op-playing', String(setting('sliderPlayGlyphOpacityPlaying') / 100));
        el('spxApp').style.setProperty('--spx-glyph-op-paused', String(setting('sliderPlayGlyphOpacityPaused') / 100));
        el('spxApp').style.setProperty('--spx-vol-hover-op', String(setting('sliderVolHoverOpacity') / 100));
        // Icon styles (the dev panel's Icon Style dropdowns; see iconStyles.js)
        applyVolumeIcon(el('spxVolume').querySelector('.spx-vol-btn svg'), iconIndex(setting('selectVolIconStyle')));
        applyShuffleIcon(el('spxShuffle').querySelector('svg'), iconIndex(setting('selectShuffleIconStyle')));
        applyShuffleStyle();
        applyVolumeButtonStyle();
        // Song Timeline (dev panel > Song Timeline): the bar's size, colours, opacities and marker
        const sbOn = setting('checkboxSongBarEnabled'), sbAnim = setting('checkboxSongBarAnimEnabled'), sbBase = setting('sliderSongBarOpacity') / 100;
        const sbStyle = el('spxApp').style;
        sbStyle.setProperty('--sb-h', setting('sliderSongBarHeight') + 'px');
        sbStyle.setProperty('--sb-tol', setting('sliderSongBarClickTol') + 'px');
        sbStyle.setProperty('--sb-fill', setting('colorSongBarFill'));
        sbStyle.setProperty('--sb-empty', setting('colorSongBarEmpty'));
        sbStyle.setProperty('--sb-op', String(sbBase));
        sbStyle.setProperty('--sb-hover-op', String(setting('sliderSongBarHoverOpacity') / 100));
        sbStyle.setProperty('--sb-click-op', String(setting('sliderSongBarClickOpacity') / 100));
        sbStyle.setProperty('--sb-time', setting('sliderSongBarAnimTime') + 'ms');
        sbStyle.setProperty('--sb-mr', setting('sliderSongBarMarkerRadius') + 'px');
        sbStyle.setProperty('--sb-mop', String(setting('sliderSongBarMarkerOpacity') / 100));
        el('spxSongBar').classList.toggle('off', !sbOn);
        el('spxSongBar').classList.toggle('marker', !!setting('checkboxSongBarMarker'));
        applyGlobalOverride(); // last, so a ticked button's override wins over its own styling
        el('spxApp').style.setProperty('--spx-shuffle-edge', setting('sliderShuffleEdgeOffset') + 'px');
        el('spxVolume').style.translate = (setting('sliderVolEdgeOffset') - 14) + 'px 0px'; // the whole volume UI; 14 px is the layout's own left offset
        applyNavIcon(el('spxPrev').querySelector('svg'), iconIndex(setting('selectNavIconStyle')), true);
        applyNavIcon(el('spxNext').querySelector('svg'), iconIndex(setting('selectNavIconStyle')), false);
        applyCoverGlyph(el('spxCover').querySelector('.spx-play-glyph svg'), iconIndex(setting('selectPlayIconStyle')), iconIndex(setting('selectPauseIconStyle')));
        applyPlayIcon(el('spxStartBtn').querySelector('svg'), iconIndex(setting('selectPlayIconStyle')));
        // drop shadows (UI Layout > Shadows): each is a class that switches its shadow off in app.css
        [['checkboxShadowCover', 'no-shadow-cover'], ['checkboxShadowVolume', 'no-shadow-vol'], ['checkboxShadowNav', 'no-shadow-nav']].forEach(([id, cls]) => el('spxApp').classList.toggle(cls, !setting(id)));
        // Album Cover > Bounding Box: the cover's own box and its centre (see app.css)
        el('spxApp').classList.toggle('show-cover-bbox', !!setting('checkboxCoverBoundingBox'));
        const cvEl = el('spxCover');
        cvEl.style.scale = String(setting('sliderCoverScale'));
        cvEl.style.translate = `${setting('sliderCoverOffsetX')}px ${setting('sliderCoverOffsetY')}px`;
        keepCoverCentred();
        placeNav();
        const uiFont = setting('selectUiFont');
        scale('--spx-font', !uiFont || uiFont === 'system' ? 'inherit' : `'${uiFont}', system-ui, sans-serif`);
        // Timeline height goes through the layout engine; the timeline is pinned by its bottom edge and
        // nothing else is positioned from it, so only the bars grow (upward).
        // On a phone the engine's own per-device height (150 px portrait / 110 px landscape) overrides the base
        // height, so the setting must be written to the ACTIVE context or it does nothing there. The setting is the
        // phone's own value, including one mirrored from Desktop (Independent from Desktop off), so it is always applied.
        const wantH = setting('sliderTimelineHeight') + 'px';
        const ctxKey = getActiveContext();
        const sig = ctxKey + ':' + wantH;
        if (sig !== lastTimelineHeight) {
            lastTimelineHeight = sig;
            if (ctxKey === 'base') updateElement('spxTimeline', { size: { height: { value: wantH } } });
            else setContextValue('spxTimeline', ctxKey, 'heightValue', wantH);
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

    // The artist line: the raw names (the data joins them with ';') re-joined with the Artist Name Separator setting
    let artistRaw = '';
    // The artist line: each name is a text node; the separator between them is a span with its own font size, and
    // white-space: pre so several spaces stay several spaces (normal white-space collapses them into one).
    const setArtistLine = () => {
        const node = el('spxArtist');
        node.replaceChildren();
        artistRaw.split(';').forEach((name, i) => {
            if (i) { const sep = document.createElement('span'); sep.className = 'spx-sep'; sep.textContent = setting('textArtistSeparator'); node.appendChild(sep); }
            node.appendChild(document.createTextNode(name));
        });
    };
    function render() {
        const s = songs[idx];
        const link = el('spxTitleLink');
        // Bracketed text (round or square, with its brackets) is wrapped in .spx-bracket so Brackets Smaller Text can size it
        link.replaceChildren(...cleanTitle(s.n).split(/([(\[{][^()\[\]{}]*[)\]}])/).filter(Boolean).map(p => {
            if (!/^[(\[{]/.test(p)) return document.createTextNode(p);
            const sp = document.createElement('span');
            sp.className = 'spx-bracket';
            sp.textContent = p;
            return sp;
        }));
        link.href = 'https://open.spotify.com/track/' + s.id; // the title opens the track on Spotify
        artistRaw = s.a;
        setArtistLine();
        el('spxMeta').textContent = `${s.al}${s.ry ? ' (' + s.ry + ')' : ''}${songOk(idx) ? (clipKey(s) || !previewClipsOn() ? '' : '\nno preview clip') : '\nfiltered out'}`; // its own line (the line breaks via white-space: pre-line)
        applyTextElementStyles(); // re-run Shrink to Fit against the new text (a no-op for every other Overflow mode)
        timeline.setDateLine(fmtAdded(s.t));
        scheduleCover();
        background.onSongChanged(); // palette-driven modes change with the song even if the cover image did not; fades like a new cover
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
            const ahead = Math.min(16, Math.max(setting('sliderPreloadAhead'), Math.ceil(speed))), behind = Math.min(16, setting('sliderPreloadBehind')); // both capped at 16: a saved 30 + 30 meant ~47 clip downloads per song change
            // Nearest the playhead first, in the direction of travel first.
            const dids = [];
            const add = i => { if (i >= 0 && i < songs.length && clipKey(songs[i]) && !dids.includes(clipKey(songs[i]))) dids.push(clipKey(songs[i])); };
            add(idx);
            for (let k = 1; k <= Math.max(ahead, behind); k++) {
                if (k <= ahead) add(idx + dir * k);
                if (k <= behind) add(idx - dir * k);
            }
            logEvent('preload', `PLAN at song ${idx + 1}: ahead ${ahead}, behind ${behind}, scrub speed ${speed.toFixed(1)} songs/s -> ${dids.length} clips wanted`);
            preload(dids);
        });
    }

    let noPreviewTimer = 0; // Auto Next Song: the hold on a song with no preview clip
    function onIndexChange(newIdx) {
        dir = newIdx >= idx ? 1 : -1;
        idx = newIdx;
        moveLog.push({ t: performance.now(), i: idx });
        noteSongChange();
        logEvent('playback', `SONG ${idx + 1}/${songs.length} "${songs[idx].n}" - ${songs[idx].a}  [clip: ${clipState(clipKey(songs[idx]))}]`);
        render();
        schedulePreload();
        if (handedOff) { logEvent('playback', 'EMBED song stopped: moved to another song'); pauseEmbed(); handedOff = false; }
        if (!songOk(idx) && setting('checkboxFilterStopOnFiltered')) { // filtered out: nothing plays for this song
            logEvent('playback', 'FILTERED OUT: not playing');
            clearTimeout(handoffTimer); handoffPending = false; clearTimeout(noPreviewTimer);
            stopClip(); previewHold = null; stepImmediate = false;
            return;
        }
        playClip(clipKey(songs[idx]));
        if (handoffPending) logEvent('playback', 'HANDOFF timer cancelled: moved on before it fired');
        clearTimeout(handoffTimer);
        previewHold = null;
        // The handoff delay only exists so a fast wheel scrub does not send Spotify a play request per song. A single deliberate step
        // (Next / Last / shuffle step / a song ending) has nothing to wait for, so it starts at once.
        const handoffDelay = stepImmediate ? 0 : setting('sliderHandoffDelay');
        stepImmediate = false;
        handoffPending = true;
        // The handoff reads where the preview is, so it waits (up to 2 s after the song change) for a pending preview to start.
        const handoffWaitUntil = performance.now() + 2000;
        const doHandoff = () => {
            if (previewClipsOn() && clipKey(songs[idx]) && !clipIsPlaying() && performance.now() < handoffWaitUntil) { handoffTimer = setTimeout(doHandoff, 50); return; }
            handoffPending = false;
            const ok = interacted && isUnlocked() && setting('checkboxHandoffEnabled') && volume.get() > 0;
            logEvent('playback', `HANDOFF fired ${handoffDelay}ms after the last song change: ${ok ? 'starting the real song ' + songs[idx].id : 'skipped (' + (!isUnlocked() ? 'sound locked' : !setting('checkboxHandoffEnabled') ? 'handoff off' : 'muted') + ')'}`);
            if (ok) {
                // The full song starts where the preview is now (+ the Full Song Start Offset), not at 0:00
                const startMs = Math.max(0, clipPosition() + setting('sliderHandoffStartOffset')) * 1000;
                const fadeMs = setting('sliderHandoffCrossfade');
                if (fadeMs > 0) {
                    // Crossfade: the preview keeps playing; the full song starts silent and, once it is audible (SDK / iframe report it playing),
                    // it fades in while the preview fades out over fadeMs. No silence between the two.
                    previewHold = null;
                    playTrackCrossfade(songs[idx].id, fadeMs, ms => stopClip(ms), startMs);
                } else { previewHold = songs[idx].id; playTrack(songs[idx].id, startMs); } // 0 = hard cut: the preview still holds until the song plays
                handedOff = true;
            }
            else stopClip();
        };
        handoffTimer = setTimeout(doHandoff, handoffDelay);
        // Auto Next Song: a song with no preview clip is held for the set time, then the next song plays.
        // Any song change cancels the hold.
        clearTimeout(noPreviewTimer);
        if (previewClipsOn() && !clipKey(songs[idx]) && setting('checkboxAutoNextSong')) {
            const held = idx, holdS = setting('sliderNoPreviewHoldSeconds');
            logEvent('playback', `NO PREVIEW: holding ${holdS} s, then the next song`);
            noPreviewTimer = setTimeout(() => { if (idx === held) stepSong(1); }, holdS * 1000);
        }
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
    const inUi = t => t.closest && t.closest('#devPanel, #spxInspectorPanel, #spxFilterPanel, #spxCover, #spxVolume, #spxSongBar, a, button, input, select, textarea');
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
    let pinching = false; // a two-finger gesture happened: no finger lifting after it may count as a tap that jumps the playhead
    const pinchSpan = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    // A button can sit UNDER the timeline canvas or a text line (a tall timeline, a scaled-up cover). A press that lands
    // on such a cover-up but inside a button's rectangle is the button's click, not a scrub: remember it here and
    // re-dispatch it as a click on that button.
    let redirectBtn = null;
    // Click Tolerance (Shuffle, Next/Last, Play): each button's hit area grows by its own tolerance in px.
    const clickTolOf = b => (b.id === 'spxShuffle' ? setting('sliderShuffleClickTolerance') : b.id === 'spxFilter' ? setting('sliderFilterClickTolerance') : (b.id === 'spxPrev' || b.id === 'spxNext') ? setting('sliderNavClickTolerance') : b.id === 'spxCover' ? setting('sliderPlayClickTolerance') : 0);
    const buttonUnder = (x, y) => [el('spxVolume').querySelector('.spx-vol-btn'), el('spxPrev'), el('spxNext'), el('spxCover'), el('spxShuffle'), el('spxFilter'), el('spxTitleLink'), el('spxStartBtn')].find(b => {
        const r = b.getBoundingClientRect(), p = clickTolOf(b);
        return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
    });
    // The timeline canvas sits over the buttons, so the pointer shows as a hand over a button here too (the cursor follows the same test as the click).
    // Over the scrub line (with Click and Drag on) the pointer is a horizontal resize and the line takes its hover state.
    let phNear = false;
    const playheadScreenX = () => el('spxTimeline').getBoundingClientRect().left + timeline.playheadX();
    window.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const near = setting('checkboxScrubLineDrag') && e.target.id === 'spxTimeline' && Math.abs(e.clientX - playheadScreenX()) <= 10;
        if (near !== phNear && !e.buttons) { phNear = near; timeline.setPlayheadState(near ? 'hover' : 'idle'); }
        el('spxTimeline').style.cursor = buttonUnder(e.clientX, e.clientY) ? 'pointer' : near ? 'ew-resize' : '';
    });
    window.addEventListener('pointerdown', e => {
        redirectBtn = null;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest && e.target.closest('button, a, input, select, textarea, #devPanel, #spxInspectorPanel, #spxFilterPanel, #spxVolume, #spxSongBar')) return;
        redirectBtn = buttonUnder(e.clientX, e.clientY) || null;
    }, true);
    window.addEventListener('click', e => {
        if (!redirectBtn) return;
        const b = redirectBtn; redirectBtn = null;
        e.stopPropagation(); e.preventDefault();
        b.click();
    }, true);
    window.addEventListener('pointerdown', e => {
        if (redirectBtn) return;
        if (volume.owns(e)) return; // the volume slider's click tolerance: a volume change, never a scrub or a song change
        // Right-button drag on the timeline pans the view: no scrub, no zoom, no jump
        if (e.pointerType === 'mouse' && e.button === 2) {
            if (e.target.id === 'spxTimeline') ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: 'mouse', onTimeline: true, moved: false, pan: true, t: performance.now() });
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((inUi(e.target) || inText(e.target)) && e.target.id !== 'spxTimeline') return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType, onTimeline: e.target.id === 'spxTimeline', moved: false, t: performance.now() });
        if (setting('checkboxScrubLineDrag') && e.target.id === 'spxTimeline' && Math.abs(e.clientX - playheadScreenX()) <= 10) {
            // Grabbing the line does not move it: the drag keeps the grab point's offset from the line, so the song changes only when the line is dragged.
            const grab = ptrs.get(e.pointerId); grab.playhead = true; grab.grab = e.clientX - playheadScreenX(); timeline.setPlayheadState('press');
        }
        if (ptrs.size === 2) { pinchDist = pinchSpan(); pinching = true; }
    });
    window.addEventListener('pointermove', e => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        if (p.playhead) { moveTo(timeline.posAtX(e.clientX - p.grab - el('spxTimeline').getBoundingClientRect().left)); p.x = e.clientX; p.y = e.clientY; return; }
        const dx = e.clientX - p.x;
        // a finger must travel its own 'start threshold' before it counts as a drag (a tap is not a drag); a mouse 4 px
        const startPx = p.type === 'mouse' ? 4 : setting('sliderTouchStartThreshold');
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > startPx) p.moved = true;
        const now = performance.now(), dt = Math.max(1, now - p.t); // ms since this finger's previous move
        p.t = now;
        p.x = e.clientX; p.y = e.clientY;
        if (ptrs.size === 2) {
            const d = pinchSpan();
            // fingers apart = zoom in (smaller span), origin = playhead; Pinch Zoom Speed is the exponent (1 = follows the fingers 1:1)
            timeline.zoomBy(Math.pow(pinchDist / d, setting('sliderPinchZoomSpeed') * (setting('checkboxInvertPinch') ? -1 : 1)));
            pinchDist = d;
            timeline.draw();
        } else if (p.pan) { // right-button drag: pan the view
            timeline.panPx(dx);
            timeline.draw();
        } else if (p.moved) {
            if (p.type === 'mouse') { // click-drag zooms, drag right = zoom in
                timeline.zoomBy(Math.exp(-dx * 0.008 * setting('sliderTimelineZoomSpeed') * (setting('checkboxInvertZoomDrag') ? -1 : 1)));
                timeline.draw();
            } else { // one finger: scrub
                // One finger has its OWN settings (dev panel > Scrub Input > Touch Scrub And Pinch): the playhead moves
                // Touch Scrub Speed px per px of finger movement, plus Acceleration x the finger's speed (px/ms, capped
                // at 4) so a fast swipe travels farther than a slow one.
                const gain = setting('sliderTouchScrubSpeed') * (1 + setting('sliderTouchScrubAcceleration') * Math.min(4, Math.abs(dx) / dt));
                moveTo(timeline.scrubByPixels(dx * gain * (setting('checkboxInvertTouchScrub') ? -1 : 1)));
            }
        }
    });
    const endPointer = e => {
        const p = ptrs.get(e.pointerId);
        if (p && !p.moved && !p.pan && !pinching && !p.playhead && p.onTimeline && e.type === 'pointerup') { // a click/tap on the timeline jumps there
            moveTo(timeline.posAtX(e.clientX - el('spxTimeline').getBoundingClientRect().left));
        }
        ptrs.delete(e.pointerId);
        if (ptrs.size === 2) pinchDist = pinchSpan();
        if (ptrs.size === 0) pinching = false;
        if (p && p.playhead) { timeline.setPlayheadState('release'); setTimeout(() => timeline.setPlayheadState('idle'), setting('sliderScrubLineAnimTime')); }
    };
    window.addEventListener('pointerup', endPointer);
    el('spxTimeline').addEventListener('contextmenu', e => e.preventDefault()); // right-drag pans; no browser menu over the graph
    window.addEventListener('pointercancel', endPointer);

    // Shuffle (the icon under the volume icon): Next / Last song and the end of a song follow a shuffled order of every song instead of
    // the timeline order. The order is a permutation starting at the current song (so Last goes back through what was played); it is
    // rebuilt when you scrub elsewhere or run out. With shuffle off, Next / Last move one song along the timeline as before.
    let shuffleOn = false, shuffleQueue = [], shufflePtr = 0;
    try { shuffleOn = localStorage.getItem('spxShuffle') === '1'; } catch (e) { /* storage blocked */ }
    const shuffleBtn = el('spxShuffle');
    function rebuildShuffle() {
        const a = [];
        for (let i = 0; i < songs.length; i++) if (i !== idx && songOk(i)) a.push(i);
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        shuffleQueue = [idx, ...a]; shufflePtr = 0;
    }
    function shuffleStep(d) {
        if (shuffleQueue[shufflePtr] !== idx) rebuildShuffle(); // scrubbed somewhere else: shuffle on from here
        let p = shufflePtr + d;
        if (p >= shuffleQueue.length) { rebuildShuffle(); p = 1; }
        p = Math.max(0, p);
        shufflePtr = p;
        moveTo(shuffleQueue[p]);
        timeline.centerOnPlayhead();
        timeline.draw();
    }
    const syncShuffleUi = () => { shuffleBtn.setAttribute('aria-pressed', String(shuffleOn)); shuffleBtn.title = shuffleOn ? 'Shuffle on' : 'Shuffle off'; };
    shuffleBtn.addEventListener('click', () => {
        shuffleOn = !shuffleOn;
        try { localStorage.setItem('spxShuffle', shuffleOn ? '1' : '0'); } catch (e) { /* storage blocked */ }
        if (shuffleOn) rebuildShuffle();
        syncShuffleUi();
        logEvent('playback', 'SHUFFLE ' + (shuffleOn ? 'on' : 'off'));
    });
    if (shuffleOn) rebuildShuffle();
    syncShuffleUi();
    // The preview ended. Loop Preview on (default): the embed restarts the same song (return false). Off: move on to the next song,
    // and shuffle always picks the next one, as before.
    setOnEnded(() => {
        if (!shuffleOn && setting('checkboxLoopPreview')) return false;
        logEvent('playback', shuffleOn ? 'SONG ended: shuffle picks the next song' : 'SONG ended: Loop Preview is off, moves to the next song');
        stepSong(1);
        return true;
    });
    const stepSong = d => {
        stepImmediate = true;
        if (shuffleOn && Math.abs(d) === 1) shuffleStep(d);
        else {
            let t = timeline.currentIndex() + d;
            if (filterOn() && setting('checkboxFilterSkipOnStep')) { // Next / Last jump to the nearest song that passes the filter
                const sgn = d < 0 ? -1 : 1;
                while (t >= 0 && t < songs.length && !flt.passes(t)) t += sgn;
                if (t < 0 || t >= songs.length) { stepImmediate = false; return; } // none left in that direction
            }
            moveTo(t);
        }
        stepImmediate = false;
    };
    // ---- Filter button (under Shuffle) + panel ----
    const filterBtn = el('spxFilter');
    flt = createFilter(songs, { host: document.body, onChange: o => { if (o && o.layout) placeFilterPanel(); else onFilterChanged(); } });
    function placeFilterPanel() {
        const r = filterBtn.getBoundingClientRect(), pn = flt.panel;
        pn.style.top = Math.max(4, r.bottom + setting('sliderFilterPanelOffsetY')) + 'px';
        const w = pn.offsetWidth || setting('sliderFilterPanelWidth');
        pn.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.right - w + setting('sliderFilterPanelOffsetX'))) + 'px';
    }
    function syncFilterUi() {
        const on = filterOn();
        filterBtn.setAttribute('aria-pressed', String(on));
        filterBtn.setAttribute('aria-expanded', String(flt.open));
        filterBtn.title = on ? 'Filter on: ' + flt.describe() : 'Filter off';
    }
    function onFilterChanged() {
        timeline.setFilter(filterOn() ? flt.passes : null);
        if (shuffleOn) rebuildShuffle();
        if (!songOk(idx) && setting('checkboxFilterStopOnFiltered')) { // the current song no longer passes: stop it
            clearTimeout(handoffTimer); handoffPending = false; clearTimeout(noPreviewTimer);
            if (handedOff) { pauseEmbed(); handedOff = false; }
            stopClip(); previewHold = null;
        }
        render();
        syncFilterUi();
        logEvent('playback', 'FILTER ' + (filterOn() ? flt.describe() + ' -> ' + flt.countPassing() + ' of ' + songs.length + ' songs' : 'cleared'));
    }
    filterBtn.addEventListener('click', () => {
        flt.setOpen(!flt.open);
        if (flt.open) placeFilterPanel();
        syncFilterUi();
    });
    document.addEventListener('pointerdown', e => {
        if (flt.open && setting('checkboxFilterCloseOnOutside') && !flt.panel.contains(e.target) && !filterBtn.contains(e.target)) { flt.setOpen(false); syncFilterUi(); }
    }, true);
    window.addEventListener('resize', () => { if (flt.open) placeFilterPanel(); });
    timeline.setFilter(filterOn() ? flt.passes : null);
    syncFilterUi();
    window.__spxState = () => ({ idx, pass: songOk(idx), shuffleOn, filterOn: filterOn() }); // read by tests
    // dev-panel buttons (so a hotkey can be assigned to them there)
    document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('button');
        if (!b) return;
        if (b.id === 'buttonRunStartup') { showStartScreen(); return; }
        // A real mouse/touch click inside the dev panel never plays or skips. Hotkeys still do: they call click(), which is not trusted.
        if (e.isTrusted && e.target.closest('#devPanel')) return;
        if (b.id === 'buttonPlayPause') togglePlayback();
        else if (b.id === 'buttonNextSong') stepSong(1);
        else if (b.id === 'buttonPrevSong') stepSong(-1);
    });
    el('spxPrev').addEventListener('click', () => stepSong(-1));
    el('spxNext').addEventListener('click', () => stepSong(1));

    // Keys: Space = play / pause, Left / Right = previous / next song (Shift = 10), Up / Down = volume (Shift = bigger step).
    window.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('input, select, textarea, #devPanel')) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === ' ' || e.code === 'Space') {
            if (!e.repeat) { if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur(); togglePlayback(); }
        } else if (e.key === 'ArrowRight') { if (step === 1) stepSong(1); else moveTo(timeline.currentIndex() + step); }
        else if (e.key === 'ArrowLeft') { if (step === 1) stepSong(-1); else moveTo(timeline.currentIndex() - step); }
        else if (e.key === 'ArrowUp') volume.nudge(e.shiftKey ? 0.1 : 0.05);
        else if (e.key === 'ArrowDown') volume.nudge(e.shiftKey ? -0.1 : -0.05);
        else if (e.key === 'Home') { moveTo(0); afterJump(); }
        else if (e.key === 'End') { moveTo(songs.length - 1); afterJump(); }
        else return;
        e.preventDefault();
    });

    // ---- sound unlock + album-cover play button ---------------------------------------------
    // Browsers require a user gesture before audio can start. The first click or key press
    // ANYWHERE counts (not just the button), so the overlay can't get stuck behind the dev
    // panel or on a small screen.
    // Spotify's embedded player plays whole songs only when the browser is logged in to Spotify (Premium); otherwise it plays a
    // 30 s preview. A page cannot start a login without a click (popups need one), so the FIRST click / key press opens Spotify's own
    // login page in a small window (at most once per 24 h per browser; dev panel > Spotify Handoff to turn it off). Whether it helped
    // cannot be detected from here: the embed's iframe is cross-site, so it may still not receive the login cookie.
    const LOGIN_KEY = 'spxLoginOpenedAt';
    function openSpotifyLogin() {
        if (!setting('checkboxSpotifyLoginOnStart')) return;
        if (hasClientId()) { // the real login (OAuth + Web Playback SDK): needed whenever there is no stored login
            if (isLoggedIn()) activateRealPlayer(); else loginPopup();
            return;
        }
        try {
            const last = +localStorage.getItem(LOGIN_KEY) || 0;
            if (Date.now() - last < 24 * 3600 * 1000) return;
            localStorage.setItem(LOGIN_KEY, String(Date.now()));
        } catch (e) { /* storage blocked: open it anyway */ }
        try { window.open('https://accounts.spotify.com/login?continue=' + encodeURIComponent('https://open.spotify.com/'), 'spxSpotifyLogin', 'popup=yes,width=480,height=760,noopener'); } catch (e) { /* popup blocked */ }
    }
    // Sound starts by itself once the data is ready. A browser may refuse audio until the page has had a user gesture; then the
    // first click or key press starts it (playClip is tried again there). That first gesture also opens the Spotify login popup,
    // which browsers only allow after a gesture.
    // Starts the full song at once when the handoff is on, the same as the in-app play button does. Otherwise it waited for the
    // handoff timer, which only runs after a song change, so nothing played until a second input. Returns false when the preview
    // clip should play instead (handoff off, muted, or sound still locked).
    const startSpotifyNow = () => {
        if (isPlaying() && playingId() === songs[idx].id) return true; // already playing this song: leave it alone
        if (!isUnlocked() || !setting('checkboxHandoffEnabled') || volume.get() <= 0) return false;
        clearTimeout(handoffTimer); handoffPending = false; previewHold = null;
        stopClip(); handedOff = true; toggleTrack(songs[idx].id);
        return true;
    };
    const playFromStart = () => { unlock(); schedulePreload(); if (!startSpotifyNow()) playClip(clipKey(songs[idx])); };
    // The start screen. A press on the play icon starts playback: on press, or on release when Transition After Release is on.
    // A press or key press anywhere else starts it as well (sound unlocks on that first input).
    let startedOnce = false;
    const onIconPress = e => !!(e.target && e.target.closest && e.target.closest('#spxStartBtn'));
    // The start screen fades out over Fade Time (Ms), then hides. Showing it again fades it back in.
    // Centre Button on Album Cover (Startup group): the start button is placed over the cover's measured centre instead of the
    // middle of the screen. Off = the default flex centring, with no inline position left behind.
    const centerStartOnCover = () => {
        const sp = el('spxStart'), st = el('spxStartBtn');
        if (!setting('checkboxStartCenterOnCover')) { sp.classList.remove('center-cover'); st.style.left = st.style.top = ''; return; }
        const r = el('spxCover').getBoundingClientRect(); // includes the cover's own scale and offset
        sp.classList.add('center-cover');
        st.style.left = (r.left + r.width / 2 - st.offsetWidth / 2) + 'px';
        st.style.top = (r.top + r.height / 2 - st.offsetHeight / 2) + 'px';
    };
    const hideStartScreen = () => { const o = el('spxStart'); o.style.opacity = '0'; setTimeout(() => { if (o.style.opacity === '0') o.hidden = true; }, setting('sliderStartFadeMs')); };
    const startFromIcon = () => { hideStartScreen(); if (!startedOnce) { startedOnce = true; openSpotifyLogin(); } playFromStart(); };
    const onFirstGesture = e => {
        if (onIconPress(e)) { if (!setting('checkboxStartTransitionAfterRelease')) startFromIcon(); return; }
        // Only the start icon starts playback. A press or key anywhere else leaves the start screen alone.
    };
    el('spxStartBtn').addEventListener('pointerup', () => { if (setting('checkboxStartTransitionAfterRelease') && !el('spxStart').hidden) startFromIcon(); });
    // Run Startup (dev panel): show the start screen again. The next press outside the dev panel hides it (the icon starts it).
    const showStartScreen = () => {
        const o = el('spxStart'); o.hidden = false; o.style.opacity = '0';
        requestAnimationFrame(() => requestAnimationFrame(() => { o.style.opacity = '1'; }));
        const hideOnInput = e => {
            if (e.target && e.target.closest && e.target.closest('#devPanel')) return;
            if (onIconPress(e)) { if (!setting('checkboxStartTransitionAfterRelease')) startFromIcon(); return; }
            hideStartScreen();
            document.removeEventListener('pointerdown', hideOnInput, true);
            document.removeEventListener('keydown', hideOnInput, true);
        };
        document.addEventListener('pointerdown', hideOnInput, true);
        document.addEventListener('keydown', hideOnInput, true);
    };
    document.addEventListener('pointerdown', onFirstGesture, { capture: true });
    document.addEventListener('keydown', onFirstGesture, { capture: true, once: true });
    playFromStart();

    function togglePlayback() {
        logEvent('playback', 'USER play/pause (cover or Space)');
        if (!isUnlocked()) playFromStart();
        clearTimeout(handoffTimer);
        stopClip();
        toggleTrack(songs[idx].id);
    }
    // ---- Song Timeline: the playback bar along the album cover's bottom edge. Its hover opacity shows while the cover is hovered; a click or
    // a drag on it seeks; the marker circle (when on) is dragged the same way. Its own clicks never reach the cover (no play / pause).
    const progressNow = () => {
        const g = getProgress();
        if (g) return g;
        return clipIsPlaying() || clipPosition() > 0 ? { pos: clipPosition() * 1000, dur: clipLength() * 1000 } : null;
    };
    const seekNow = ms => { if (!seekTo(ms)) seekClip(ms / 1000); };
    const sbBar = el('spxSongBar'), sbHit = el('spxSongBarHit'), sbMarker = sbBar.querySelector('.spx-songbar-marker');
    let sbFrac = null, sbSeekAt = 0;
    const sbPos = e => { const r = el('spxCover').getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1), 0, 1); };
    function sbRender() {
        const g = progressNow();
        const f = sbFrac !== null ? sbFrac : g && g.dur > 0 ? clamp(g.pos / g.dur, 0, 1) : 0;
        sbBar.querySelector('.spx-songbar-fill').style.width = (f * 100) + '%';
        sbMarker.style.left = (f * 100) + '%';
    }
    setInterval(() => { if (sbFrac === null) sbRender(); }, 200);
    // The bar sits on the cover's bottom edge: placed from the cover's real on-screen box (scale and moves included)
    function sbPlace() {
        const c = el('spxCover').getBoundingClientRect(), host = sbBar.parentElement.getBoundingClientRect();
        const h = parseFloat(getComputedStyle(sbBar).height) || 4;
        sbBar.style.left = (c.left - host.left) + 'px';
        sbBar.style.width = c.width + 'px';
        sbBar.style.top = (c.bottom - host.top - h) + 'px';
        sbBar.style.bottom = 'auto';
    }
    sbPlace(); setInterval(sbPlace, 150);
    // Hover: the pointer is over the album cover (the timeline canvas sits above it, so the cover itself gets no hover)
    window.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const c = el('spxCover').getBoundingClientRect();
        sbBar.classList.toggle('hov', e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom);
    });
    function sbSeek(e, force) {
        const now = performance.now();
        if (!force && now - sbSeekAt < 120) return; // a drag seeks at most every 120 ms
        sbSeekAt = now;
        const g = progressNow(), dur = g && g.dur > 0 ? g.dur : 30000;
        seekNow(sbPos(e) * dur);
    }
    const sbDown = e => {
        e.stopPropagation(); e.preventDefault();
        sbFrac = sbPos(e); sbBar.classList.add('press');
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event: carry on */ }
        sbSeek(e, true); sbRender();
    };
    const sbMove = e => { if (sbFrac === null) return; sbFrac = sbPos(e); sbSeek(e, false); sbRender(); };
    const sbUp = e => { if (sbFrac === null) return; sbSeek(e, true); sbFrac = null; sbBar.classList.remove('press'); sbRender(); };
    [sbHit, sbMarker].forEach(h => {
        h.addEventListener('pointerdown', sbDown);
        h.addEventListener('pointermove', sbMove);
        h.addEventListener('pointerup', sbUp);
        h.addEventListener('pointercancel', sbUp);
        h.addEventListener('click', e => e.stopPropagation()); // never the cover's play / pause
    });
    let coverDown = null;
    el('spxCover').addEventListener('pointerdown', e => { coverDown = [e.clientX, e.clientY]; });
    el('spxCover').addEventListener('click', e => {
        if (coverDown && e.detail > 0 && Math.hypot(e.clientX - coverDown[0], e.clientY - coverDown[1]) > 4) return; // dragged to select: not a click
        togglePlayback();
    });
    // prev/next are placed by the engine relative to the cover (so they follow it, scale and offset included, and stay level with
    // its centre); this shifts each one sideways until it is 14 px from the browser edge (the button is 48 px wide). Read from
    // the cover's real on-screen box, so a scaled / moved cover is handled too. (The previous button's own left edge sits at
    // the cover's left edge - 48, the next one's at the cover's right edge.)
    function placeNav() {
        const r = el('spxCover').getBoundingClientRect();
        const prevEdge = setting('sliderLastButtonEdgeOffset'), nextEdge = setting('sliderNextButtonEdgeOffset');
        // The buttons are as wide as their own icon (the hit area = the icon), so the real widths place them, not a fixed 48 px
        const pw = el('spxPrev').offsetWidth, nw = el('spxNext').offsetWidth;
        el('spxPrev').style.translate = `${prevEdge - (r.left - pw)}px 0px`;
        el('spxNext').style.translate = `${(innerWidth - nextEdge - nw) - r.right}px 0px`;
    }
    // The cover's scale grows it around transform-origin. When the engine centres the cover (anchor center), it has already moved
    // the box by -50% of its own width / height, so scaling around the box's middle pushes it off centre (at scale 1.5 the centre
    // moved 92 px left on a 1920 px screen). Scaling around the anchor point instead keeps it centred. A bottom / top / left /
    // right anchor is unchanged: the origin stays at the middle.
    function keepCoverCentred() {
        const c = el('spxCover');
        const ox = c.dataset.anchorH === 'center' ? '0px' : '50%';
        const oy = c.dataset.anchorV === 'center' ? '0px' : '50%';
        const want = `${ox} ${oy}`;
        if (c.style.transformOrigin !== want) c.style.transformOrigin = want;
    }
    setInterval(keepCoverCentred, 500); // catches an anchor change made in the UI Layout Inspector
    new ResizeObserver(placeNav).observe(el('spxCover'));
    new ResizeObserver(() => centerStartOnCover()).observe(el('spxCover'));
    window.addEventListener('resize', placeNav);
    placeNav();
    onPlayState(playing => {
        el('spxCover').classList.toggle('playing', playing);
        el('spxCover').setAttribute('aria-label', playing ? 'Pause' : 'Play');
        // The preview stops only once the full song is actually playing (see previewHold above).
        if (playing && previewHold && songs[idx] && songs[idx].id === previewHold) {
            previewHold = null;
            stopClip();
            logEvent('playback', 'HANDOFF: the full song is playing, the preview stops');
        }
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
    document.addEventListener('spx-devrows-ready', applyLook); // see devPanel.js: twin rows exist only after the saved state is restored

    setInterval(() => {
        if (el('spxPool').hidden) return;
        const p = poolInfo();
        el('spxPool').textContent = `pool ${p.size} · ready ${p.ready} · no-clip ${p.dead} · embed ${embedStatus()}/${embedMode()} · playing ${p.playing ?? '-'}`;
    }, 250);

    initEmbed(el('spxEmbed'), songs[0].id);
    // Spotify Web Playback SDK: starts once there is a stored login (and a Client ID in spotifyConfig.js); until then the iframe plays.
    const refreshLoginButton = () => {
        const b = document.getElementById('buttonSpotifyLogin');
        if (!b) return;
        b.textContent = !hasClientId() ? 'Spotify Login: Client ID Not Set (spotifyConfig.js)'
            : !isLoggedIn() ? 'Log In With Spotify'
            : spotifyLoginStatus() === 'ready' ? 'Logged In: Full Songs (Click To Log Out)' : 'Logged In: SDK ' + spotifyLoginStatus() + ' (Click To Log Out)';
    };
    // "Show Spotify Player" with the SDK ready: instead of the (idle) iframe, a status box that shows what the SDK is really playing,
    // including the song's length (a full song is minutes long; a preview is 30 s).
    const fmtMs = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const updateSdkStatus = () => {
        const box = el('spxSdkStatus'), show = !!setting('checkboxShowSpotifyPlayer'), ready = sdkIsReady();
        document.querySelector('.spx-embed').classList.toggle('spx-embed-visible', show && !ready);
        box.hidden = !(show && ready);
        if (box.hidden) return;
        const i = sdkInfo();
        box.textContent = i ? `SPOTIFY SDK ${i.paused ? 'paused' : 'PLAYING'}  ${fmtMs(i.position)} / ${fmtMs(i.duration)}  ${i.duration > 31000 ? '(FULL SONG)' : '(only 30 s?)'}\n${i.title} - ${i.artist}` : 'SPOTIFY SDK ready: nothing has been played through it yet';
    };
    setInterval(updateSdkStatus, 500);
    initSdkPlayer(refreshLoginButton);
    onLoginChange(() => { initSdkPlayer(refreshLoginButton); refreshLoginButton(); });
    setInterval(refreshLoginButton, 1500);
    document.addEventListener('pointerdown', () => activateRealPlayer(), true); // the SDK wants an activation inside a user gesture
    document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('button');
        if (!b || b.id !== 'buttonSpotifyLogin' || !hasClientId()) return;
        if (isLoggedIn()) { logout(); setTimeout(() => location.reload(), 150); } else loginPopup();
    });
    applyLook();
    render();
    timeline.setPos(pos); // the app's position (a random start sets it): the scrub line must follow it, not reset to the start
    timeline.draw();
    schedulePreload();
    initDebugTools(); // Debug group: PAUSE, Pause/Copy/Clear/Export Logs, frame rate, snapshot (debugTools.js)
    window.spotty = { songs, volume, seek, moveTo, timeline, get idx() { return idx; }, get pos() { return pos; }, poolInfo, playClip, unlock };
}

boot();
