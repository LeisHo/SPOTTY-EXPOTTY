// Spotify embed handoff: when scrubbing stops, the real song plays in Spotify's
// embedded player (iFrame API). Full songs need the viewer to be logged in to
// Spotify in this browser; otherwise the embed plays a 30-second preview.
let controller = null;
let queued = null;
let status = 'loading';

export function initEmbed(el, firstTrackId) {
    window.onSpotifyIframeApiReady = IFrameAPI => {
        IFrameAPI.createController(el, { uri: 'spotify:track:' + firstTrackId, width: '100%', height: 80 }, c => {
            controller = c;
            status = 'ready';
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
    if (!controller) { queued = trackId; return false; }
    controller.loadUri('spotify:track:' + trackId);
    setTimeout(() => { try { controller.play(); } catch (e) { /* embed not ready yet */ } }, 350);
    return true;
}

export function pauseEmbed() {
    queued = null;
    if (controller) { try { controller.pause(); } catch (e) { /* ignore */ } }
}

export function embedStatus() { return status; }
