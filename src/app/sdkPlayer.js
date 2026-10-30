// Spotify Web Playback SDK: the browser becomes a Spotify Connect device ("SPOTTY EXPOTTY") that plays FULL songs for a logged-in
// Premium account, with real volume control. handoff.js uses it instead of the embedded iframe whenever it is ready; if it cannot
// start (not logged in, no Client ID, not Premium, unsupported browser) the iframe embed keeps being used.
// Needs the login from spotifyAuth.js. Tracks are started with the Web API (PUT /v1/me/player/play) on this device.
import { getAccessToken, isLoggedIn, hasClientId } from './spotifyAuth.js';
import { logEvent } from './debugLog.js';

let player = null, deviceId = null, ready = false, failed = null, loading = false, volume = 1, lastPlayError = null;
// The last SDK events, kept even when "Log Playback Timing" is off, so the snapshot (Debug > Take Snapshot) can say what the SDK did.
const recent = [];
const note = msg => { recent.push(new Date().toISOString().slice(11, 23) + '  ' + msg); if (recent.length > 25) recent.shift(); logEvent('playback', 'SDK ' + msg); };
export const sdkRecentEvents = () => recent.slice();
let cb = { onState: () => {}, onEnded: () => {}, onStatus: () => {} };
let lastState = null, lastEndedAt = 0, lastStateAt = 0;

// Play On Device: while `target` is set, another Spotify Connect device (phone, speaker, TV, PC) plays instead of this browser. Every
// command below then goes to that device through the Web API, and its state is polled (the SDK only reports this browser's own state).
// handoff.js needs no change: sdkReady() stays true, and the state / ended callbacks fire from the poll exactly as the SDK's would.
let target = null; // { id, name, type, supportsVolume, volume }
let pollTimer = 0, pollMs = 1500, lastCmdAt = 0, lastVolSentAt = 0, volTimer = 0, remoteVolSent = -1;
let deviceCb = { onDevice: () => {}, onVolume: () => {} };
export const setDeviceCallbacks = c => { deviceCb = { ...deviceCb, ...c }; };
export const sdkDeviceTarget = () => target;
export const sdkBrowserDeviceId = () => deviceId;
export const sdkSetPollMs = ms => { pollMs = Math.min(10000, Math.max(500, ms || 1500)); };
const usable = () => ready || !!target;
const dev = () => (target ? target.id : deviceId);
export const sdkReady = () => ready || !!target;
// A login exists and the SDK has not failed: it is ready or about to be, so a song should wait for it instead of using the iframe preview.
export const sdkExpected = () => hasClientId() && isLoggedIn() && !failed;
export const sdkStatus = () => (!hasClientId() ? 'no Client ID' : !isLoggedIn() ? 'not logged in' : ready ? (lastPlayError ? 'ready, but the last play failed: ' + lastPlayError : 'ready') : failed ? 'failed: ' + failed : 'loading');
const setStatus = () => cb.onStatus(sdkStatus());

export function initSdk(callbacks) {
    cb = { ...cb, ...callbacks };
    if (player || loading || !hasClientId() || !isLoggedIn()) { setStatus(); return; }
    loading = true; failed = null; note('starting (loading the SDK script)'); setStatus();
    window.onSpotifyWebPlaybackSDKReady = create;
    if (window.Spotify && window.Spotify.Player) { create(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => { failed = 'the SDK script did not load (blocked?)'; loading = false; note('script did not load'); setStatus(); };
    document.body.appendChild(s);
}
function create() {
    player = new window.Spotify.Player({ name: 'SPOTTY EXPOTTY', getOAuthToken: async done => { try { done(await getAccessToken()); } catch (e) { failed = 'login expired: ' + e.message; note('token FAILED: ' + e.message); setStatus(); } }, volume });
    player.addListener('ready', ({ device_id }) => { deviceId = device_id; ready = true; loading = false; failed = null; note('ready as device ' + device_id); setStatus(); player.setVolume(volume).catch(() => {}); /* the saved volume / mute applies from the start */ transfer(); });
    player.addListener('not_ready', () => { ready = false; note('device went offline'); setStatus(); });
    player.addListener('initialization_error', e => fail('initialization: ' + e.message));
    player.addListener('authentication_error', e => fail('authentication: ' + e.message));
    player.addListener('account_error', e => fail('account (Premium needed): ' + e.message));
    player.addListener('playback_error', e => { lastPlayError = 'playback error: ' + e.message; note('playback error: ' + e.message); setStatus(); });
    player.addListener('player_state_changed', onState);
    player.connect();
}
// Called when a song has waited for the SDK for too long: treat it as unavailable so later songs use the iframe at once instead of waiting again.
export function sdkGiveUp(reason) { if (ready) return; failed = reason; loading = false; note('GAVE UP: ' + reason); setStatus(); }
function fail(msg) { failed = msg; ready = false; loading = false; note('FAILED: ' + msg); setStatus(); }

function onState(state) {
    if (!state) return;
    const cur = state.track_window && state.track_window.current_track;
    // The SDK does not say "ended": a finished track shows up as paused at position 0 with the track moved into previous_tracks.
    const ended = lastState && !lastState.paused && state.paused && state.position === 0 && lastState.track_window.current_track
        && state.track_window.previous_tracks.some(t => t.id === lastState.track_window.current_track.id) && Date.now() - lastEndedAt > 2000;
    lastState = state; lastStateAt = performance.now();
    cb.onState(!state.paused, { id: cur && cur.id, linkedId: cur && cur.linked_from && cur.linked_from.id, position: state.position, duration: state.duration });
    if (ended) { lastEndedAt = Date.now(); note('song ended'); cb.onEnded(); }
}

async function api(path, method, body) {
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok && r.status !== 204) { const t = await r.text().catch(() => ''); throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + t.slice(0, 120)); }
}
// Make this browser the active Spotify device (without starting anything). A brand-new device is not always known to Spotify's
// servers yet, in which case starting a track on it answers 404 "device not found"; transferring first fixes that.
async function transfer(id = dev(), play = false) {
    try { await api('/me/player', 'PUT', { device_ids: [id], play }); note('playback transferred to ' + (target && id === target.id ? target.name : 'this device')); return true; }
    catch (e) { note('transfer failed: ' + e.message); return false; }
}
async function apiGet(path) {
    const r = await fetch('https://api.spotify.com/v1' + path, { headers: { Authorization: 'Bearer ' + (await getAccessToken()) } });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error('GET ' + path + ' -> ' + r.status);
    return r.json();
}
// Start a track on this device. On "device not found" (404) transfer playback and try once more.
export async function sdkPlay(trackId, positionMs = 0) {
    if (!usable()) return false;
    // position_ms starts the track part-way through, in the same request (no separate seek that could race the start)
    const body = { uris: ['spotify:track:' + trackId], ...(positionMs > 0 ? { position_ms: Math.round(positionMs) } : {}) };
    const go = () => api('/me/player/play?device_id=' + encodeURIComponent(dev()), 'PUT', body);
    try {
        try { await go(); }
        catch (e) { if (!/ 404 /.test(e.message)) throw e; note('play got 404 (device not found yet): transferring and retrying'); await transfer(); await new Promise(r => setTimeout(r, 400)); await go(); }
        lastPlayError = null; note('play ' + trackId + ' requested' + (target ? ' on ' + target.name : '')); setStatus();
        if (target) { lastCmdAt = performance.now(); patchState({ paused: false, position: positionMs, id: trackId }); schedulePoll(900); }
        return true;
    } catch (e) {
        lastPlayError = e.message.replace(/^PUT \S+ -> /, ''); note('play FAILED: ' + e.message); setStatus();
        if (target && / (404|403) /.test(e.message)) loseDevice(target.name + ' did not answer (asleep or off?): back on this browser');
        return false;
    }
}
// A command to the remote device: the shown state changes at once (the poll confirms it a moment later).
const remote = (path, method, then) => { lastCmdAt = performance.now(); api(path, method).catch(e => note('device command failed: ' + e.message)); if (then) then(); schedulePoll(900); };
export const sdkPause = () => {
    if (target) { remote('/me/player/pause?device_id=' + encodeURIComponent(target.id), 'PUT', () => patchState({ paused: true })); return; }
    if (ready) player.pause().catch(() => {});
};
export const sdkResume = () => {
    if (target) { remote('/me/player/play?device_id=' + encodeURIComponent(target.id), 'PUT', () => patchState({ paused: false })); return; }
    if (ready) player.resume().catch(() => {});
};
export const sdkSeek = ms => {
    if (target) { remote('/me/player/seek?position_ms=' + Math.round(ms) + '&device_id=' + encodeURIComponent(target.id), 'PUT', () => patchState({ position: ms })); return; }
    if (ready) player.seek(ms).catch(() => {});
};
let fadeTimer = 0, quiet = false;
export function sdkSetVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    if (target) { sendRemoteVolume(); return; } // the volume slider now controls that device, not this browser
    if (player && !quiet) player.setVolume(volume).catch(() => {});
}
// Throttled: a slider drag sends about 6 requests a second, and the last value always goes out.
function sendRemoteVolume() {
    if (!target || !target.supportsVolume) return;
    const send = () => {
        if (!target) return;
        lastVolSentAt = performance.now(); remoteVolSent = Math.round(volume * 100);
        api('/me/player/volume?volume_percent=' + remoteVolSent + '&device_id=' + encodeURIComponent(target.id), 'PUT').catch(e => note('device volume failed: ' + e.message));
    };
    clearTimeout(volTimer);
    const wait = 160 - (performance.now() - lastVolSentAt);
    if (wait <= 0) send(); else volTimer = setTimeout(send, wait);
} // while silent for a crossfade only the stored level changes
// Handoff crossfade: the next song starts with the SDK volume at 0 (the preview is still playing), then sdkFadeIn() brings it up to the volume slider's level.
export function sdkPrepareFade() { if (!ready || !player || target) return false; clearInterval(fadeTimer); quiet = true; player.setVolume(0).catch(() => {}); return true; }
export function sdkFadeIn(ms) {
    if (!player || target) return;
    clearInterval(fadeTimer);
    if (!quiet || ms <= 0) { quiet = false; player.setVolume(volume).catch(() => {}); return; }
    const t0 = performance.now();
    fadeTimer = setInterval(() => {
        const f = Math.min(1, (performance.now() - t0) / ms);
        player.setVolume(volume * f).catch(() => {});
        if (f >= 1) { clearInterval(fadeTimer); quiet = false; }
    }, 30);
}
export function sdkRestoreVolume() { clearInterval(fadeTimer); if (quiet && !target) { quiet = false; if (player) player.setVolume(volume).catch(() => {}); } }
// Browsers want this inside a click / key press before audio may start.
export function sdkActivate() { if (player && player.activateElement) { try { player.activateElement(); } catch (e) { /* ignore */ } } }
// What the SDK says is loaded right now (position extrapolated while playing): used by the on-screen status box.
export function sdkInfo() {
    if (!lastState) return null;
    const cur = lastState.track_window.current_track || {};
    const pos = lastState.paused ? lastState.position : Math.min(lastState.duration, lastState.position + (performance.now() - lastStateAt));
    return { paused: lastState.paused, position: pos, duration: lastState.duration, title: cur.name || '?', artist: (cur.artists || []).map(a => a.name).join(', ') };
}
export const sdkCurrentTrackId = () => (lastState && lastState.track_window.current_track ? lastState.track_window.current_track.id : null);

// ---- Play On Device: the list, switching to a device, and following its state ----
function patchState({ paused, position, id }) {
    if (!lastState) lastState = { paused: true, position: 0, duration: 0, track_window: { current_track: null, previous_tracks: [] } };
    const now = performance.now();
    if (!lastState.paused) lastState.position = Math.min(lastState.duration || Infinity, lastState.position + (now - lastStateAt)); // freeze the extrapolation first
    if (paused !== undefined) lastState.paused = paused;
    if (position !== undefined) lastState.position = position;
    if (id) lastState.track_window = { current_track: { id, name: '', artists: [] }, previous_tracks: [] };
    lastStateAt = now;
    const cur = lastState.track_window.current_track; // handoff.js learns of it at once (the real state follows with the next poll), so Play / Pause act on the right song
    cb.onState(!lastState.paused, { id: cur && cur.id, linkedId: null, position: lastState.position, duration: lastState.duration });
}
export async function listDevices() {
    const r = await apiGet('/me/player/devices');
    return ((r && r.devices) || []).filter(d => d.id && !d.is_restricted).map(d => ({
        id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.volume_percent == null ? null : d.volume_percent / 100,
        supportsVolume: d.supports_volume !== false, isThis: d.id === deviceId,
    }));
}
// d = a device from listDevices(), or null for "back to this browser". Playing on it is up to the caller (sdkPlay / sdkResume).
export function sdkSetDevice(d) {
    clearTimeout(pollTimer); clearTimeout(volTimer); clearInterval(fadeTimer); quiet = false;
    if (!d || d.isThis) {
        const was = target; target = null; lastState = null; remoteVolSent = -1;
        if (was) note('back to this browser');
        if (player) player.setVolume(volume).catch(() => {});
        deviceCb.onDevice(null);
        return;
    }
    if (player) player.pause().catch(() => {}); // this browser stops; the device takes over
    target = { id: d.id, name: d.name, type: d.type, supportsVolume: d.supportsVolume, volume: d.volume };
    lastState = null; remoteVolSent = -1; lastCmdAt = performance.now();
    note('playing on device ' + d.name + ' (' + d.type + ')');
    deviceCb.onDevice(target);
    schedulePoll(400);
}
function loseDevice(reason) {
    if (!target) return;
    note('device lost: ' + reason);
    sdkSetDevice(null);
    deviceCb.onDevice(null, reason);
}
function schedulePoll(ms = pollMs) { clearTimeout(pollTimer); if (target) pollTimer = setTimeout(poll, ms); }
async function poll() {
    if (!target) return;
    if (performance.now() - lastCmdAt < 600) { schedulePoll(400); return; } // a command is still settling
    let st = null;
    try { st = await apiGet('/me/player'); } catch (e) { note('poll failed: ' + e.message); schedulePoll(Math.max(pollMs, 3000)); return; }
    if (!target) return;
    if (st && st.device && st.device.id !== target.id) { // somebody (the Spotify app) moved playback to another device: follow it, or come back here
        if (st.device.id === deviceId) { loseDevice('playback was moved back to this browser'); return; }
        const d = st.device;
        target = { id: d.id, name: d.name, type: d.type, supportsVolume: d.supports_volume !== false, volume: d.volume_percent == null ? null : d.volume_percent / 100 };
        note('playback moved to ' + d.name); deviceCb.onDevice(target, 'followed');
    }
    if (st && st.device && st.device.id === target.id) {
        const item = st.item;
        const state = { paused: !st.is_playing, position: st.progress_ms || 0, duration: item ? item.duration_ms : 0,
            track_window: { current_track: item ? { id: item.id, name: item.name, artists: item.artists || [], linked_from: item.linked_from } : null, previous_tracks: [] } };
        const prev = lastState, prevPos = prev && !prev.paused ? Math.min(prev.duration, prev.position + (performance.now() - lastStateAt)) : 0;
        // A device does not say "ended" either: it was playing near the end of the song and now is not (or has started over).
        const ended = !!prev && !prev.paused && prev.duration > 0 && state.paused && prev.duration - prevPos < pollMs + 2500
            && (state.position < 2000 || state.position >= state.duration - 1500) && Date.now() - lastEndedAt > 2000;
        lastState = state; lastStateAt = performance.now();
        const cur = state.track_window.current_track;
        cb.onState(!state.paused, { id: cur && cur.id, linkedId: cur && cur.linked_from && cur.linked_from.id, position: state.position, duration: state.duration });
        if (ended) { lastEndedAt = Date.now(); note('song ended (device)'); cb.onEnded(); }
        // the device's own volume changed (its buttons, the Spotify app): the slider follows, unless we just sent a value ourselves
        const vp = st.device.volume_percent;
        if (vp != null && st.device.supports_volume !== false && performance.now() - lastVolSentAt > 2500 && Math.abs(vp - (remoteVolSent < 0 ? vp : remoteVolSent)) >= 1) {
            remoteVolSent = vp; deviceCb.onVolume(vp / 100);
        } else if (vp != null && remoteVolSent < 0) remoteVolSent = vp;
    }
    schedulePoll();
}
