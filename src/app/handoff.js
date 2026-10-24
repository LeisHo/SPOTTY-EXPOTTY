// Spotify embed (iFrame API), used as an invisible audio player: the real song plays
// here when scrubbing stops or the album cover is clicked. Full songs need the
// viewer to be logged in to Spotify in this browser; otherwise the embed plays a
// 30-second preview. Whatever is playing (preview or full song) loops when it ends.
let controller = null;
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
const emit = () => listeners.forEach(fn => fn(playing));

function handleUpdate(d) {
    const wasPlaying = playing;
    playing = !d.isPaused;
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

export function playTrack(trackId) {
    wantPlaying = true;
    if (!controller) { queued = trackId; return false; }
    loadedId = trackId;
    controller.loadUri('spotify:track:' + trackId);
    setTimeout(() => { try { controller.play(); } catch (e) { /* embed not ready yet */ } }, 350);
    return true;
}

export function pauseEmbed() {
    queued = null;
    wantPlaying = false;
    if (controller) { try { controller.pause(); } catch (e) { /* ignore */ } }
}

// The album cover is the play button: pause if playing, resume if this song is already
// loaded, otherwise load and play it.
export function toggleTrack(trackId) {
    if (playing) { pauseEmbed(); return; }
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
