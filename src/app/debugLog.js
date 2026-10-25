// Timing logs for debugging the gap heard while scrubbing: a Playback Timing Log (which song, when its clip was ready,
// when a clip starts / stops / stalls, when the handoff timer is set / cancelled / fires, what the Spotify embed does) and a
// Preload Log (each preload batch, when each clip's URL and first 2 s of audio arrive, when the whole batch is ready).
// Each line: seconds since the page started, ms since the previous line of the SAME log, then the event. Off by default
// (dev panel > Debug > Log Playback Timing / Log Preloading); when off, logEvent() is a single settings read.
// Registered in window.spxDebugLogRegistry so Copy All / Clear All / Export Logs / Pause Logs cover them too.
import { setting } from './settings.js';

const MAX_LINES = 2000;
const logs = {
    playback: { title: 'Playback Timing Log', flag: 'checkboxLogPlayback', lines: [], last: 0 },
    preload: { title: 'Preload Log', flag: 'checkboxLogPreload', lines: [], last: 0 },
};
const view = key => (window.spxDebugLogViews || {})[key];

export function logEvent(key, msg) {
    const L = logs[key];
    if (!L || window.spxLogsPaused || !setting(L.flag)) return;
    const now = performance.now();
    const line = `${(now / 1000).toFixed(3)}s  +${String(Math.round(now - L.last)).padStart(5)}ms  ${msg}`;
    L.last = now;
    L.lines.push(line);
    if (L.lines.length > MAX_LINES) L.lines.shift();
    const v = view(key);
    if (v) v.append(line);
}

(window.spxDebugLogRegistry = window.spxDebugLogRegistry || []);
Object.entries(logs).forEach(([key, L]) => {
    window.spxDebugLogRegistry.push({
        key, title: L.title,
        active: () => !!setting(L.flag),
        lines: () => L.lines,
        clear: () => { L.lines.length = 0; L.last = 0; const v = view(key); if (v) v.clear(); },
    });
});
