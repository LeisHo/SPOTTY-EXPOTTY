// Spotify embed (iFrame API), used as an invisible audio player: the real song plays
// here when scrubbing stops or the album cover is clicked. Full songs need the
// viewer to be logged in to Spotify in this browser; otherwise the embed plays a
// 30-second preview. Whatever is playing (preview or full song) loops when it ends.
import { logEvent } from './debugLog.js';
import * as sdk from './sdkPlayer.js';
let controller = null;
let lastPausedSeen = null, lastBufSeen = null;
let queued = null;
let status = 'loading';
let loadedId = null;
let playing = false;
let wantPlaying = false; // we (or the user) asked for playback and haven't asked to pause
let lastRestart = 0; // performance.now() of the last loop restart (debounce)
const listeners = new Set();
// Last 200 playback_update payloads, for diagnosing end-of-track behaviour (window.__spxEvents).
const events = (window.__spxEvents = []);

export const onPlayState = fn => listeners.add(fn);
// ---- Web Playback SDK (full songs + real volume; sdkPlayer.js). Used whenever it is ready; otherwise the iframe embed below plays. ----
// The SDK needs a few seconds after page load to connect. A song asked for before that (the first one after startup) WAITS for it
// (up to 8 s) instead of starting in the iframe, which can only play the 30 s preview.
// Timing for the playback log: how long from the song change (and from our play request) until Spotify's player is really playing it.
let songChangeAt = 0, requestAt = 0, audibleLogged = true;
export const noteSongChange = () => { songChangeAt = performance.now(); };
let pendingSdkTrack = null, pendingTimer = 0;
// ---- handoff crossfade: the preview keeps playing until the full song is AUDIBLE, then it fades out while the song fades in ----
let audibleWait = null; // { id, fadeMs, onAudible, timer, before }
function finishAudible(why) {
    const w = audibleWait;
    if (!w) return;
    audibleWait = null;
    clearTimeout(w.timer);
    logEvent('playback', `HANDOFF full song audible (${why}) after ${Math.round(performance.now() - w.t0)}ms: crossfading ${w.fadeMs}ms`);
    if (sdk.sdkReady()) sdk.sdkFadeIn(w.fadeMs);
    w.onAudible(w.fadeMs);
}
function cancelAudible() {
    if (!audibleWait) return;
    clearTimeout(audibleWait.timer);
    audibleWait = null;
    if (sdk.sdkReady()) sdk.sdkRestoreVolume();
}
// Like playTrack, but onAudible(fadeMs) is called once the song is really playing (SDK state / iframe update), or after 3 s whatever
// happens (so the preview can never play on forever, nor the song stay silent).
export function playTrackCrossfade(trackId, fadeMs, onAudible, positionMs = 0) {
    cancelAudible();
    audibleWait = { id: trackId, fadeMs, onAudible, t0: performance.now(), before: sdk.sdkCurrentTrackId() };
    audibleWait.timer = setTimeout(() => finishAudible('3 s timeout'), 3000);
    if (sdk.sdkReady()) sdk.sdkPrepareFade();
    logEvent('playback', 'HANDOFF crossfade: starting the full song silently, the preview keeps playing until it is audible');
    return playTrack(trackId, positionMs);
}
const clearPending = () => { pendingSdkTrack = null; clearTimeout(pendingTimer); };
export function initSdkPlayer(onStatus) {
    sdk.initSdk({
        onState: (isPlayingNow, info) => {
            playing = isPlayingNow;
            if (info && info.duration > 0) lastDur = info.duration;
            if (!audibleLogged && isPlayingNow && info && (info.id === loadedId || info.linkedId === loadedId)) {
                audibleLogged = true;
                logEvent('playback', `FULL SONG PLAYING: ${Math.round(performance.now() - requestAt)}ms after the play request, ${Math.round(performance.now() - songChangeAt)}ms after the song change`);
            }
            if (audibleWait && isPlayingNow && info && (info.id === audibleWait.id || info.linkedId === audibleWait.id || (info.id !== audibleWait.before && info.position < 2500))) finishAudible('sdk');
            emit();
        },
        onEnded: () => sdkEnded(),
        onStatus: s => {
            if (pendingSdkTrack) {
                const t = pendingSdkTrack;
                if (sdk.sdkReady()) { // it connected: play the waiting song, in full
                    clearPending();
                    logEvent('playback', 'SDK became ready: playing the song that was waiting for it (' + t + ')');
                    if (audibleWait) sdk.sdkPrepareFade();
                    sdk.sdkPlay(t).then(ok => { if (!ok && wantPlaying && loadedId === t) playViaEmbed(t); });
                } else if (!sdk.sdkExpected()) { clearPending(); playViaEmbed(t); } // it failed: the iframe preview is all there is
            }
            if (onStatus) onStatus(s);
        },
    });
}
export const setRealVolume = v => sdk.sdkSetVolume(v);
export const activateRealPlayer = () => sdk.sdkActivate();
export const spotifyLoginStatus = () => sdk.sdkStatus();
export const sdkIsReady = () => sdk.sdkReady();
export const sdkInfo = () => sdk.sdkInfo();
function sdkEnded() {
    if (!wantPlaying) return;
    if (endedHandler && endedHandler()) return;              // shuffle moves on
    logEvent('playback', 'SDK song ended: loop (play it again)');
    if (loadedId) sdk.sdkPlay(loadedId);
}
// Called when the playing song reaches its end; return true to say it was handled (shuffle moves on) so the loop restart is skipped.
let endedHandler = null;
export const setOnEnded = fn => { endedHandler = fn; };
const emit = () => listeners.forEach(fn => fn(playing));

let lastDur = 0; // last non-zero duration (ms) the embed reported
function handleUpdate(d) {
    const wasPlaying = playing;
    playing = !d.isPaused;
    if (d.duration > 0 && d.duration !== lastDur) {
        lastDur = d.duration;
        logEvent('playback', `EMBED track length ${Math.round(d.duration)}ms = ${d.duration <= 31000 ? 'a 30 s PREVIEW (Spotify is not treating this iframe as logged in)' : 'a FULL song (logged in)'}`);
    }
    if (d.isPaused !== lastPausedSeen || d.isBuffering !== lastBufSeen) {
        lastPausedSeen = d.isPaused; lastBufSeen = d.isBuffering;
        logEvent('playback', `EMBED ${d.isPaused ? 'paused' : 'PLAYING'}${d.isBuffering ? ' (buffering)' : ''} at ${Math.round(d.position)}ms of ${Math.round(d.duration)}ms`);
    }
    if (audibleWait && loadedId === audibleWait.id && !d.isPaused && d.position > 200) finishAudible('iframe');
    events.push({ t: Math.round(performance.now()), paused: d.isPaused, buffering: d.isBuffering, pos: d.position, dur: d.duration });
    if (events.length > 200) events.shift();
    // Looping. MEASURED (the __spxEvents log): at the end of a 29.7 s preview the embed sends one
    // last update with position == duration and isPaused still FALSE, then goes silent: it never
    // reports a pause. So the end is detected by the position reaching the duration. A plain
    // unrequested pause while playback is wanted is treated as an end too (belt and braces).
    const atEnd = !d.isPaused && d.duration > 0 && d.position >= d.duration - 300;
    const unrequestedStop = !playing && wasPlaying;
    if (wantPlaying && (atEnd || unrequestedStop) && performance.now() - lastRestart > 3000) {
        lastRestart = performance.now();
        if (endedHandler && endedHandler()) { logEvent('playback', 'EMBED reached the end: handled (shuffle moved to the next song)'); emit(); return; }
        logEvent('playback', 'EMBED reached the end: loop restart scheduled');
        // MEASURED: a seek(0)+resume() sent in the same instant as the end-of-track update is ignored
        // (the player is still finishing); the same calls work once it has settled. So wait, restart,
        // and if no update shows the position back near the start, load the track again and play.
        const sawRestart = () => events.length && events[events.length - 1].pos < 5000 && !events[events.length - 1].paused;
        setTimeout(() => {
            if (!wantPlaying) return;
            try { controller.seek(0); controller.play(); } catch (e) { /* embed not ready */ }
            setTimeout(() => {
                if (!wantPlaying || sawRestart() || !loadedId) return;
                try { controller.loadUri('spotify:track:' + loadedId); setTimeout(() => controller.play(), 350); } catch (e) { /* ignore */ }
            }, 2000);
        }, 500);
    }
    emit();
}

export function initEmbed(el, firstTrackId) {
    window.onSpotifyIframeApiReady = IFrameAPI => {
        IFrameAPI.createController(el, { uri: 'spotify:track:' + firstTrackId, width: 300, height: 80 }, c => {
            controller = c;
            window.__spxController = c; // debugging handle
            status = 'ready';
            c.addListener('playback_update', e => handleUpdate(e.data));
            if (queued) { const q = queued; queued = null; playTrack(q); }
        });
    };
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => { status = 'unavailable'; };
    document.body.appendChild(s);
}

export function playTrack(trackId, positionMs = 0) {
    wantPlaying = true;
    if (sdk.sdkReady()) {
        loadedId = trackId;
        clearPending();
        requestAt = performance.now(); audibleLogged = false;
        sdk.sdkPlay(trackId, positionMs).then(ok => { if (!ok && wantPlaying && loadedId === trackId) playViaEmbed(trackId); }); // SDK refused: the iframe plays it instead
        return true;
    }
    if (sdk.sdkExpected()) { // logged in, SDK still connecting: wait for it
        loadedId = trackId; pendingSdkTrack = trackId;
        logEvent('playback', 'SDK not ready yet: song ' + trackId + ' waits for it (up to 8 s) instead of the iframe preview');
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { if (pendingSdkTrack === trackId) { pendingSdkTrack = null; sdk.sdkGiveUp('did not connect within 8 s (many phone browsers cannot run the Spotify player)'); logEvent('playback', 'SDK still not ready after 8 s: using the iframe preview from now on'); playViaEmbed(trackId); } }, 8000);
        return true;
    }
    return playViaEmbed(trackId);
}
function playViaEmbed(trackId) {
    wantPlaying = true;
    if (!controller) { queued = trackId; logEvent('playback', `EMBED playTrack ${trackId}: embed not ready yet, queued`); return false; }
    loadedId = trackId;
    logEvent('playback', `EMBED loadUri ${trackId} sent`);
    controller.loadUri('spotify:track:' + trackId);
    setTimeout(() => { try { logEvent('playback', 'EMBED play() sent (350ms after loadUri)'); controller.play(); } catch (e) { /* embed not ready yet */ } }, 350);
    return true;
}

export function pauseEmbed() {
    queued = null;
    wantPlaying = false;
    clearPending();
    cancelAudible();
    logEvent('playback', 'EMBED pause requested');
    if (sdk.sdkReady()) sdk.sdkPause();
    if (controller) { try { controller.pause(); } catch (e) { /* ignore */ } }
}

// The album cover is the play button: pause if playing, resume if this song is already
// loaded, otherwise load and play it.
export function toggleTrack(trackId) {
    if (playing) { pauseEmbed(); return; }
    if (sdk.sdkReady() && loadedId === trackId) { wantPlaying = true; sdk.sdkResume(); return; }
    if (controller && loadedId === trackId) {
        wantPlaying = true;
        // play(), not resume(): resume() is a no-op on an embed that was loaded but never started
        // (or whose track ended), which left the cover button doing nothing.
        try { controller.play(); } catch (e) { /* ignore */ }
        return;
    }
    playTrack(trackId);
}

export const isPlaying = () => playing;
export const embedStatus = () => status;
// 'preview' when the embed reports a ~30 s duration (not logged in, or the iframe can't see the login),
// 'full' when it reports a longer one, 'unknown' before the first playing update.
export const embedMode = () => (sdk.sdkReady() ? 'FULL (Web Playback SDK)' : lastDur <= 0 ? 'unknown' : lastDur <= 31000 ? 'preview(30s)' : 'FULL');
