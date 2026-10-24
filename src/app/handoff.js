// Spotify embed (iFrame API), used as an invisible audio player: the real song plays
// here when scrubbing stops or the album cover is clicked. Full songs need the
// viewer to be logged in to Spotify in this browser; otherwise the embed plays a
// 30-second preview. Whatever is playing (preview or full song) loops when it ends.
let controller = null;
let queued = null;
let status = 'loading';
let loadedId = null;
let playing = false;
let userPaused = false; // paused by us/the user, so an end-of-track pause is not mistaken for "ended"
let lastPos = 0, lastDur = 0; // ms, from playback_update while playing
const listeners = new Set();

export const onPlayState = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(playing));

function handleUpdate(d) {
    const wasPlaying = playing;
    playing = !d.isPaused;
    if (!d.isPaused && d.duration > 0) { lastPos = d.position; lastDur = d.duration; }
    // Ended: the embed pauses at (or rewinds from) the end without us asking.
    // Restart it immediately so it loops.
    if (!playing && wasPlaying && !userPaused && lastDur > 0 && lastPos >= lastDur - 2000) {
        lastPos = 0;
        try { controller.seek(0); controller.resume(); } catch (e) { /* embed not ready */ }
    }
    emit();
}

export function initEmbed(el, firstTrackId) {
    window.onSpotifyIframeApiReady = IFrameAPI => {
        IFrameAPI.createController(el, { uri: 'spotify:track:' + firstTrackId, width: 300, height: 80 }, c => {
            controller = c;
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
    userPaused = false;
    if (!controller) { queued = trackId; return false; }
    loadedId = trackId;
    lastPos = 0;
    lastDur = 0;
    controller.loadUri('spotify:track:' + trackId);
    setTimeout(() => { try { controller.play(); } catch (e) { /* embed not ready yet */ } }, 350);
    return true;
}

export function pauseEmbed() {
    queued = null;
    userPaused = true;
    if (controller) { try { controller.pause(); } catch (e) { /* ignore */ } }
}

// The album cover is the play button: pause if playing, resume if this song is
// already loaded, otherwise load and play it.
export function toggleTrack(trackId) {
    if (playing) { pauseEmbed(); return; }
    if (controller && loadedId === trackId) {
        userPaused = false;
        try { controller.resume(); } catch (e) { /* ignore */ }
        return;
    }
    playTrack(trackId);
}

export const isPlaying = () => playing;
export const embedStatus = () => status;
