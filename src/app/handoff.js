// Spotify embed (iFrame API), used as an invisible audio player: the real song plays
// here when scrubbing stops or the album cover is clicked. Full songs need the
// viewer to be logged in to Spotify in this browser; otherwise the embed plays a
// 30-second preview. Whatever is playing (preview or full song) loops when it ends.
import { logEvent } from './debugLog.js';
import * as sdk from './sdkPlayer.js';
let controller = null;
let lastPausedSeen = null, lastBufSeen = null;
let queued = null;
let lastEmbed = null; // the embed's last update (position / length, ms)
let actualId = null; // the track the SDK really has loaded (from its state): Play resumes only that one
let actualLinkedId = null; // the id the track was requested under, when Spotify relinked it to another id (same song, different id)
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
            if (info && info.id) { actualId = info.id; actualLinkedId = info.linkedId || null; }
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
    lastEmbed = { position: d.position, duration: d.duration, paused: d.isPaused };
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
            if (queued && !sdk.sdkReady()) { const q = queued; queued = null; playTrack(q); }
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
        loadedId = trackId; queued = null;
        if (controller) { try { controller.pause(); } catch (e) { /* embed not ready */ } } // only one player plays
        clearPending();
        requestAt = performance.now(); audibleLogged = false;
        // A play request that fails right after the SDK's own pause command (or before its device is known) is retried once after 700 ms; only if that fails
        // too does the iframe play the song (and the SDK's old song is paused so it does not play on).
        sdk.sdkPlay(trackId, positionMs).then(ok => {
            if (ok || !wantPlaying || loadedId !== trackId) return;
            logEvent('playback', 'SDK play request failed: retrying once in 700 ms');
            setTimeout(() => {
                if (!wantPlaying || loadedId !== trackId) return;
                sdk.sdkPlay(trackId, positionMs).then(ok2 => { if (!ok2 && wantPlaying && loadedId === trackId) { sdk.sdkPause(); playViaEmbed(trackId); } });
            }, 700);
        });
        // A play request can be accepted and still not switch the song. If the SDK still reports another track 3 s later, ask once more; if it still
        // has not switched 3 s after that, let the iframe play it and stop the SDK.
        const stillOld = () => wantPlaying && loadedId === trackId && actualId !== trackId && actualLinkedId !== trackId;
        setTimeout(() => {
            if (!stillOld()) return;
            logEvent('playback', 'SDK did not switch to ' + trackId + ' within 3 s (it still reports ' + actualId + '): asking again');
            sdk.sdkPlay(trackId, positionMs).then(ok => { if (!ok && stillOld()) { sdk.sdkPause(); playViaEmbed(trackId); } });
            setTimeout(() => { if (stillOld()) { logEvent('playback', 'SDK still on the old song: the iframe plays ' + trackId); sdk.sdkPause(); playViaEmbed(trackId); } }, 3000);
        }, 3000);
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
    // play() is sent at once, still inside the click that started playback (a browser only lets the embed start while that click is fresh; a play() sent
    // only after a delay was ignored on the first start, so a second press was needed), then again after the track has loaded if it is not playing yet.
    try { logEvent('playback', 'EMBED play() sent at once (inside the click)'); controller.play(); } catch (e) { /* embed not ready yet */ }
    const again = ms => setTimeout(() => { if (!wantPlaying || loadedId !== trackId || playing) return; try { logEvent('playback', 'EMBED play() sent again (' + ms + 'ms after loadUri)'); controller.play(); } catch (e) { /* embed not ready yet */ } }, ms);
    again(350); again(1000);
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
export function toggleTrack(trackId, startOnly = false) { // startOnly: a start (never a pause): used by the start screen, which must not pause what already plays
    // Pause only the track that is really playing; resume only the track the SDK really has; anything else starts this song.
    // A press while anything is playing PAUSES it. (It used to pause only when the playing track's id equalled the shown song's id, so a relinked
    // track - Spotify reports another id for the same song - or a song change that had not switched yet made the press load the shown song instead.)
    if (playing) {
        if (!startOnly) { pauseEmbed(); return; }
        if (loadedId === trackId || actualId === trackId || actualLinkedId === trackId) return; // already playing this song
    }
    if (startOnly) { playTrack(trackId); return; } // the page-load start may have loaded the track but been blocked from playing (no gesture yet): resume() would do nothing
    if (sdk.sdkReady() && (actualId === trackId || actualLinkedId === trackId)) { wantPlaying = true; sdk.sdkResume(); return; }
    if (controller && loadedId === trackId && !sdk.sdkReady()) {
        wantPlaying = true;
        // play(), not resume(): resume() is a no-op on an embed that was loaded but never started
        // (or whose track ended), which left the cover button doing nothing.
        try { controller.play(); } catch (e) { /* ignore */ }
        return;
    }
    playTrack(trackId);
}

// The song's position and length (ms) from the active player: the SDK, then the embed. null when neither has one.
export function getProgress() {
    const i = sdk.sdkReady() ? sdk.sdkInfo() : null;
    if (i && i.duration > 0) return { pos: i.position, dur: i.duration };
    if (lastEmbed && lastEmbed.duration > 0) return { pos: lastEmbed.position, dur: lastEmbed.duration };
    return null;
}
// Seeks the SDK or the embed (ms). false when neither is available, so the caller can seek the preview clip instead.
export function seekTo(ms) {
    if (sdk.sdkReady()) { sdk.sdkSeek(ms); return true; }
    if (controller) { try { controller.seek(ms / 1000); return true; } catch (e) { /* embed not ready */ } }
    return false;
}
export const isPlaying = () => playing;
export const playingId = () => actualId;
export const embedStatus = () => status;
// 'preview' when the embed reports a ~30 s duration (not logged in, or the iframe can't see the login),
// 'full' when it reports a longer one, 'unknown' before the first playing update.
export const embedMode = () => (sdk.sdkReady() ? 'FULL (Web Playback SDK)' : lastDur <= 0 ? 'unknown' : lastDur <= 31000 ? 'preview(30s)' : 'FULL');
