// Spotify Web Playback SDK: the browser becomes a Spotify Connect device ("SPOTTY EXPOTTY") that plays FULL songs for a logged-in
// Premium account, with real volume control. handoff.js uses it instead of the embedded iframe whenever it is ready; if it cannot
// start (not logged in, no Client ID, not Premium, unsupported browser) the iframe embed keeps being used.
// Needs the login from spotifyAuth.js. Tracks are started with the Web API (PUT /v1/me/player/play) on this device.
import { getAccessToken, isLoggedIn, hasClientId } from './spotifyAuth.js';
import { logEvent } from './debugLog.js';

let player = null, deviceId = null, ready = false, failed = null, loading = false, volume = 1;
let cb = { onState: () => {}, onEnded: () => {}, onStatus: () => {} };
let lastState = null, lastEndedAt = 0;

export const sdkReady = () => ready;
export const sdkStatus = () => (!hasClientId() ? 'no Client ID' : !isLoggedIn() ? 'not logged in' : ready ? 'ready' : failed ? 'failed: ' + failed : 'loading');
const setStatus = () => cb.onStatus(sdkStatus());

export function initSdk(callbacks) {
    cb = { ...cb, ...callbacks };
    if (player || loading || !hasClientId() || !isLoggedIn()) { setStatus(); return; }
    loading = true; failed = null; setStatus();
    window.onSpotifyWebPlaybackSDKReady = create;
    if (window.Spotify && window.Spotify.Player) { create(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => { failed = 'the SDK script did not load'; loading = false; setStatus(); };
    document.body.appendChild(s);
}
function create() {
    player = new window.Spotify.Player({ name: 'SPOTTY EXPOTTY', getOAuthToken: async done => { try { done(await getAccessToken()); } catch (e) { failed = 'login expired'; setStatus(); } }, volume });
    player.addListener('ready', ({ device_id }) => { deviceId = device_id; ready = true; loading = false; failed = null; logEvent('playback', 'SDK ready as device ' + device_id); setStatus(); });
    player.addListener('not_ready', () => { ready = false; logEvent('playback', 'SDK device went offline'); setStatus(); });
    player.addListener('initialization_error', e => fail('initialization: ' + e.message));
    player.addListener('authentication_error', e => fail('authentication: ' + e.message));
    player.addListener('account_error', e => fail('account (Premium needed): ' + e.message));
    player.addListener('playback_error', e => logEvent('playback', 'SDK playback error: ' + e.message));
    player.addListener('player_state_changed', onState);
    player.connect();
}
function fail(msg) { failed = msg; ready = false; loading = false; logEvent('playback', 'SDK FAILED: ' + msg); setStatus(); }

function onState(state) {
    if (!state) return;
    const cur = state.track_window && state.track_window.current_track;
    // The SDK does not say "ended": a finished track shows up as paused at position 0 with the track moved into previous_tracks.
    const ended = lastState && !lastState.paused && state.paused && state.position === 0 && lastState.track_window.current_track
        && state.track_window.previous_tracks.some(t => t.id === lastState.track_window.current_track.id) && Date.now() - lastEndedAt > 2000;
    lastState = state;
    cb.onState(!state.paused, { id: cur && cur.id, position: state.position, duration: state.duration });
    if (ended) { lastEndedAt = Date.now(); logEvent('playback', 'SDK song ended'); cb.onEnded(); }
}

async function api(path, method, body) {
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok && r.status !== 204) { const t = await r.text().catch(() => ''); throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + t.slice(0, 120)); }
}
// Start a track on this device (the first call also transfers playback to it).
export async function sdkPlay(trackId) {
    if (!ready) return false;
    try {
        await api('/me/player/play?device_id=' + encodeURIComponent(deviceId), 'PUT', { uris: ['spotify:track:' + trackId] });
        logEvent('playback', 'SDK play ' + trackId + ' requested');
        return true;
    } catch (e) { logEvent('playback', 'SDK play FAILED: ' + e.message); return false; }
}
export const sdkPause = () => { if (ready) player.pause().catch(() => {}); };
export const sdkResume = () => { if (ready) player.resume().catch(() => {}); };
export const sdkSeek = ms => { if (ready) player.seek(ms).catch(() => {}); };
export function sdkSetVolume(v) { volume = Math.min(1, Math.max(0, v)); if (player) player.setVolume(volume).catch(() => {}); }
// Browsers want this inside a click / key press before audio may start.
export function sdkActivate() { if (player && player.activateElement) { try { player.activateElement(); } catch (e) { /* ignore */ } } }
export const sdkCurrentTrackId = () => (lastState && lastState.track_window.current_track ? lastState.track_window.current_track.id : null);
