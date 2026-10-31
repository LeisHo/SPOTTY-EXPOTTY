// Global debugging tools, ported from HANDY DANDIES' Debug group (the ones that are not tied to one specific log):
// PAUSE (freeze every animation), Pause / Resume Logs, Copy All Logs, Clear All Logs, Export Logs (JSON file of every active
// log), an optional on-screen "export logs" corner button, Show Frame Rate, and Take Snapshot (one log of THIS moment, with
// checkboxes for what goes in it). The buttons are dev-panel controls (devPanel.js, Debug group); this module holds the logic.
//
// "A log" = anything registered in window.spxDebugLogRegistry as { key, title, active(), lines(), clear() } (the Mouse Log
// registers itself from devPanel.js); the tools work on the whole registry, so a future log only has to register.
// Hand Behaviour / Pose Jump / Render Reordering / Frame Rate Drop logs, hand numbers, grid helper, wireframe etc. are specific
// to HANDY DANDIES and were left out on purpose.
import { setting, DEFAULTS, activeDevice } from './settings.js';
import { applyExportIcon } from './iconStyles.js';
import { embedStatus, isPlaying, embedMode, spotifyLoginStatus } from './handoff.js';
import { sdkRecentEvents } from './sdkPlayer.js';

const pageLoadMs = performance.now();
let paused = false, logsPaused = false, snapshotText = '';
const frozen = new Set();
let freezeRaf = 0, lastPointer = null;

// ---- PAUSE: every running animation / transition stops where it is; JS animation loops check window.__spxPaused ----
function freezeAnimations() {
    document.getAnimations().forEach(a => { if (a.playState === 'running') { a.pause(); frozen.add(a); } });
    if (paused) freezeRaf = requestAnimationFrame(freezeAnimations); // catches animations started while paused
}
function setPaused(v) {
    paused = v;
    window.__spxPaused = v;
    cancelAnimationFrame(freezeRaf);
    if (v) freezeAnimations();
    else { frozen.forEach(a => { try { a.play(); } catch (e) { /* finished or removed */ } }); frozen.clear(); }
}

// ---- logs ----------------------------------------------------------------------------------------------------------------
const registry = () => (window.spxDebugLogRegistry = window.spxDebugLogRegistry || []);
const allLogs = () => [...registry(), {
    key: 'snapshot', title: 'Snapshot', active: () => !!snapshotText,
    lines: () => (snapshotText ? snapshotText.split('\n') : []), clear: () => { snapshotText = ''; showSnapshot(''); },
}];
const flash = (btn, msg) => { if (!btn) return; const orig = btn.dataset.origText || btn.textContent; btn.dataset.origText = orig; btn.textContent = msg; setTimeout(() => { btn.textContent = orig; }, 1000); };
const showSnapshot = t => { if (typeof window.spxDebugShowSnapshot === 'function') window.spxDebugShowSnapshot(t); };
function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function copyAll(btn) {
    const text = allLogs().map(l => { const ls = l.lines(); return `=== ${l.title} ===\n${ls.length ? ls.join('\n') : '(empty)'}`; }).join('\n\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => flash(btn, 'Copied!')).catch(() => flash(btn, 'Copy failed'));
    else flash(btn, 'Copy failed');
}
function clearAll() { allLogs().forEach(l => { try { l.clear(); } catch (e) { /* ignore */ } }); }
function appState() {
    const sp = window.spotty;
    if (!sp) return {};
    const s = sp.songs[sp.idx] || {};
    return { songIndex: sp.idx, songCount: sp.songs.length, position: +sp.pos.toFixed(3), song: s.n, artist: s.a, album: s.al, addedAt: s.t, spanDays: +(sp.timeline.span / 864e5).toFixed(2) };
}
function exportLogs(btn) {
    const logs = {}, inactive = [];
    allLogs().forEach(l => { if (l.active()) { const e = l.lines(); logs[l.key] = { title: l.title, entryCount: e.length, entries: e }; } else inactive.push(l.title); });
    const payload = {
        app: 'SPOTTY EXPOTTY', exportedAt: new Date().toISOString(),
        page: { url: location.href, device: activeDevice() || 'Desktop', viewport: [innerWidth, innerHeight], pixelRatio: devicePixelRatio },
        state: { ...appState(), animationsPaused: paused, logsPaused, volume: window.spotty && window.spotty.volume ? window.spotty.volume.get() : null },
        activeLogs: Object.keys(logs), inactive, logs,
    };
    download(`spotty-expotty-logs-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    flash(btn, `Exported ${Object.keys(logs).length} logs`);
}

// ---- on-screen export button (corner), shown while "ADD UI BUTTON" is on --------------------------------------------------
function ensureExportButton() {
    let b = document.getElementById('spxExportLogsBtn');
    if (!b) {
        b = document.createElement('button');
        b.id = 'spxExportLogsBtn'; b.type = 'button'; b.title = 'Export logs (JSON)'; b.setAttribute('aria-label', 'Export logs'); b.className = 'spx-export-logs'; b.innerHTML = '<svg aria-hidden="true"></svg>'; applyExportIcon(b.querySelector('svg'), 0);
        b.style.cssText = 'position:fixed;left:12px;top:12px;z-index:100001;display:none'; // the look (an icon like the other buttons) is .spx-export-logs in app.css
        b.addEventListener('click', e => { e.stopPropagation(); exportLogs(b); });
        document.body.appendChild(b);
    }
    b.style.display = setting('checkboxExportLogsUiButton') ? 'flex' : 'none';
}

// ---- frame rate readout --------------------------------------------------------------------------------------------------
let fpsEl = null, fpsRaf = 0, fpsFrames = 0, fpsStart = 0;
function fpsTick(now) {
    fpsFrames++;
    const win = Math.max(50, setting('sliderFrameRateRefreshMs'));
    if (now - fpsStart >= win) { fpsEl.textContent = (fpsFrames * 1000 / (now - fpsStart)).toFixed(1) + ' fps'; fpsFrames = 0; fpsStart = now; }
    fpsRaf = requestAnimationFrame(fpsTick);
}
function applyFrameRate() {
    const on = !!setting('checkboxShowFrameRate');
    if (!fpsEl) {
        fpsEl = document.createElement('div');
        fpsEl.id = 'spxFrameRate'; fpsEl.textContent = '-- fps';
        fpsEl.style.cssText = 'position:fixed;top:8px;left:56px;z-index:100002;display:none;pointer-events:none;user-select:none;font:600 14px/1.2 ui-monospace,Menlo,Consolas,monospace;text-shadow:0 0 3px rgba(0,0,0,.85)';
        document.body.appendChild(fpsEl);
    }
    fpsEl.style.display = on ? 'block' : 'none';
    fpsEl.style.color = setting('colorFrameRateText') || '#ffffff';
    if (on && !fpsRaf) { fpsFrames = 0; fpsStart = performance.now(); fpsRaf = requestAnimationFrame(fpsTick); }
    if (!on && fpsRaf) { cancelAnimationFrame(fpsRaf); fpsRaf = 0; }
    // the colour / refresh rows only show while it is on (Desktop + twins)
    ['colorFrameRateText', 'sliderFrameRateRefreshMs'].forEach(id => ['', 'Mobile', 'Landscape'].forEach(dev => {
        const el = document.getElementById(id.replace(/^(color|slider)/, '$1' + dev));
        const row = el && el.closest('.dev-row');
        if (row) row.style.display = on ? '' : 'none';
    }));
}

// ---- snapshot ------------------------------------------------------------------------------------------------------------
function buildSnapshot() {
    const L = [], f1 = v => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : String(v));
    const last = (lines, n) => (lines.length ? lines.slice(-n).join('\n') : '(none buffered)');
    const sp = window.spotty;
    L.push(`=== SNAPSHOT ${new Date().toISOString()} (+${Math.round(performance.now() - pageLoadMs)}ms) ===`);
    let any = false;
    if (setting('checkboxSnapshotViewport')) {
        any = true;
        L.push('', '--- Viewport And Cursor ---');
        L.push(`viewport ${innerWidth}x${innerHeight} @${devicePixelRatio || 1}x, device class ${activeDevice() || 'Desktop'}`);
        L.push(lastPointer ? `last pointer (${lastPointer.x}, ${lastPointer.y}) ${lastPointer.type}, over ${lastPointer.target}` : 'no pointer movement seen yet');
        L.push(`animations paused ${paused}, logs paused ${logsPaused}`);
    }
    if (setting('checkboxSnapshotMouse')) {
        any = true;
        const m = registry().find(l => l.key === 'mouseLog');
        L.push('', '--- Mouse Tracking ---', 'last Mouse Log lines:', last(m ? m.lines() : [], 15));
    }
    if (setting('checkboxSnapshotPlayback') && sp) {
        any = true;
        const s = sp.songs[sp.idx] || {};
        L.push('', '--- Playback ---');
        L.push(`song ${sp.idx + 1} of ${sp.songs.length} (position ${f1(sp.pos)}): ${s.n} - ${s.a} [${s.al}]`);
        L.push(`added ${s.t}, track id ${s.id}, preview clip id ${s.d || 'none'}`);
        L.push(`spotify player: ${isPlaying() ? 'playing' : 'not playing'}, status ${JSON.stringify(embedStatus())}`);
        L.push(`player mode ${embedMode()}; Spotify login / SDK: ${spotifyLoginStatus()}`);
        const sdkLines = sdkRecentEvents();
        L.push('last Spotify SDK events:', sdkLines.length ? sdkLines.slice(-15).join('\n') : '(none: the SDK never started; check Client ID / login)');
        L.push(`volume ${sp.volume ? Math.round(sp.volume.get() * 100) + '%' : 'n/a'}`);
    }
    if (setting('checkboxSnapshotAudio') && sp) {
        any = true;
        L.push('', '--- Audio Clips ---', JSON.stringify(sp.poolInfo()));
    }
    if (setting('checkboxSnapshotTimeline') && sp) {
        any = true;
        const t = sp.timeline;
        L.push('', '--- Timeline ---', `visible span ${f1(t.span / 864e5)} days of ${f1(t.fullSpanMs / 864e5)} (whole data set)`);
    }
    if (setting('checkboxSnapshotSettings')) {
        any = true;
        const diff = [];
        Object.keys(DEFAULTS).forEach(k => { const v = setting(k); if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) diff.push(`  ${k}: ${JSON.stringify(v)}  (default ${JSON.stringify(DEFAULTS[k])})`); });
        L.push('', '--- Settings Changed From Default ---', diff.length ? diff.slice(0, 120).join('\n') + (diff.length > 120 ? `\n  ... and ${diff.length - 120} more` : '') : 'none');
    }
    if (!any) L.push('', '(nothing selected: tick at least one Snapshot checkbox)');
    return L.join('\n');
}
function takeSnapshot() { snapshotText = buildSnapshot(); showSnapshot(snapshotText); }

// ---- wiring --------------------------------------------------------------------------------------------------------------
export function initDebugTools() {
    window.spxLogsPaused = false;
    window.spxDebug = { getSnapshot: () => snapshotText, clearSnapshot: () => { snapshotText = ''; showSnapshot(''); }, setPaused, isPaused: () => paused };
    window.addEventListener('pointermove', e => {
        const t = e.target;
        lastPointer = { x: Math.round(e.clientX), y: Math.round(e.clientY), type: e.pointerType, target: t && t.tagName ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') : '?' };
    }, { passive: true });
    document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('button');
        if (!b || !b.id) return;
        if (b.id === 'buttonDebugPause') { setPaused(!paused); b.textContent = paused ? 'RESUME' : 'PAUSE'; }
        else if (b.id === 'buttonDebugPauseLogs') { logsPaused = !logsPaused; window.spxLogsPaused = logsPaused; b.textContent = logsPaused ? 'RESUME LOGS' : 'PAUSE LOGS'; }
        else if (b.id === 'buttonDebugCopyAll') copyAll(b);
        else if (b.id === 'buttonDebugClearAll') clearAll();
        else if (b.id === 'buttonDebugExport') exportLogs(b);
        else if (b.id === 'buttonDebugSnapshot') takeSnapshot();
    });
    // settings (checkboxes / colour / slider) take effect on any dev-panel change; the panel may build after load, so also poll
    const refresh = () => { ensureExportButton(); applyFrameRate(); };
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    setInterval(refresh, 1000);
    refresh();
}
