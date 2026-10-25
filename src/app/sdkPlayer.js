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

export const sdkReady = () => ready;
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
    player.addListener('ready', ({ device_id }) => { deviceId = device_id; ready = true; loading = false; failed = null; note('ready as device ' + device_id); setStatus(); transfer(); });
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
async function transfer() {
    try { await api('/me/player', 'PUT', { device_ids: [deviceId], play: false }); note('playback transferred to this device'); return true; }
    catch (e) { note('transfer failed: ' + e.message); return false; }
}
// Start a track on this device. On "device not found" (404) transfer playback and try once more.
export async function sdkPlay(trackId, positionMs = 0) {
    if (!ready) return false;
    // position_ms starts the track part-way through, in the same request (no separate seek that could race the start)
    const body = { uris: ['spotify:track:' + trackId], ...(positionMs > 0 ? { position_ms: Math.round(positionMs) } : {}) };
    const go = () => api('/me/player/play?device_id=' + encodeURIComponent(deviceId), 'PUT', body);
    try {
        try { await go(); }
        catch (e) { if (!/ 404 /.test(e.message)) throw e; note('play got 404 (device not found yet): transferring and retrying'); await transfer(); await new Promise(r => setTimeout(r, 400)); await go(); }
        lastPlayError = null; note('play ' + trackId + ' requested'); setStatus();
        return true;
    } catch (e) { lastPlayError = e.message.replace(/^PUT \S+ -> /, ''); note('play FAILED: ' + e.message); setStatus(); return false; }
}
export const sdkPause = () => { if (ready) player.pause().catch(() => {}); };
export const sdkResume = () => { if (ready) player.resume().catch(() => {}); };
export const sdkSeek = ms => { if (ready) player.seek(ms).catch(() => {}); };
let fadeTimer = 0, quiet = false;
export function sdkSetVolume(v) { volume = Math.min(1, Math.max(0, v)); if (player && !quiet) player.setVolume(volume).catch(() => {}); } // while silent for a crossfade only the stored level changes
// Handoff crossfade: the next song starts with the SDK volume at 0 (the preview is still playing), then sdkFadeIn() brings it up to the volume slider's level.
export function sdkPrepareFade() { if (!ready || !player) return false; clearInterval(fadeTimer); quiet = true; player.setVolume(0).catch(() => {}); return true; }
export function sdkFadeIn(ms) {
    if (!player) return;
    clearInterval(fadeTimer);
    if (!quiet || ms <= 0) { quiet = false; player.setVolume(volume).catch(() => {}); return; }
    const t0 = performance.now();
    fadeTimer = setInterval(() => {
        const f = Math.min(1, (performance.now() - t0) / ms);
        player.setVolume(volume * f).catch(() => {});
        if (f >= 1) { clearInterval(fadeTimer); quiet = false; }
    }, 30);
}
export function sdkRestoreVolume() { clearInterval(fadeTimer); if (quiet) { quiet = false; if (player) player.setVolume(volume).catch(() => {}); } }
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
