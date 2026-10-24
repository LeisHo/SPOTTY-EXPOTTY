// Volume control, top right: a speaker icon that expands into a vertical slider. Custom slider (not
// <input type=range orient=vertical>, which is inconsistent across browsers): drag or tap the track, or use the
// keyboard when it is focused (arrows, Home, End). The value (0..1) is remembered in localStorage.
//
// What it controls: the short preview clips played while scrubbing (a master multiplier on top of the dev
// panel's "Clip Volume"). Spotify's embedded player exposes no volume method, so the real song / 30 s preview
// in that player is NOT scaled; at exactly 0 % the app treats everything as muted and stops/doesn't start that
// player instead (see main.js).
const KEY = 'spxVolume';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function initVolume({ root, onChange }) {
    const btn = root.querySelector('.spx-vol-btn');
    const panel = root.querySelector('.spx-vol-panel');
    const track = root.querySelector('.spx-vol-track');
    const fill = root.querySelector('.spx-vol-fill');
    const thumb = root.querySelector('.spx-vol-thumb');
    const label = root.querySelector('.spx-vol-label');
    let vol = 1;
    try { const s = localStorage.getItem(KEY); if (s !== null && Number.isFinite(+s)) vol = clamp(+s, 0, 1); } catch (e) { /* storage blocked */ }

    function render() {
        const pct = Math.round(vol * 100);
        fill.style.height = pct + '%';
        thumb.style.bottom = `calc(${pct}% - 7px)`;
        label.textContent = pct + '%';
        track.setAttribute('aria-valuenow', String(pct));
        btn.dataset.level = vol === 0 ? 'mute' : vol < 0.34 ? 'low' : vol < 0.67 ? 'mid' : 'high';
        btn.setAttribute('aria-label', vol === 0 ? 'Volume (muted)' : `Volume ${pct}%`);
    }
    function set(v, persist = true) {
        vol = clamp(v, 0, 1);
        render();
        if (persist) { try { localStorage.setItem(KEY, String(vol)); } catch (e) { /* storage blocked */ } }
        onChange(vol);
    }
    const fromEvent = e => { const r = track.getBoundingClientRect(); set(1 - (e.clientY - r.top) / (r.height || 1)); };

    let dragging = false;
    track.addEventListener('pointerdown', e => {
        e.preventDefault();
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (synthetic event): carry on */ }
        fromEvent(e);
    });
    track.addEventListener('pointermove', e => { if (dragging) fromEvent(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => track.addEventListener(type, () => { dragging = false; }));
    track.addEventListener('keydown', e => {
        const step = e.shiftKey ? 0.1 : 0.05;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(vol + step);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(vol - step);
        else if (e.key === 'Home') set(0);
        else if (e.key === 'End') set(1);
        else return;
        e.preventDefault(); e.stopPropagation();
    });

    const open = o => { panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); };
    btn.addEventListener('click', () => open(panel.hidden));
    // outside click / Escape closes it
    document.addEventListener('pointerdown', e => { if (!panel.hidden && !root.contains(e.target)) open(false); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });

    render();
    onChange(vol); // apply the remembered volume
    return { get: () => vol, set, open };
}
