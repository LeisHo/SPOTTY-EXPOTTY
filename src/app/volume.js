// Volume control, top right: a speaker icon with a vertical slider that drops down from it. Custom slider (not
// <input type=range orient=vertical>, which is inconsistent across browsers): drag or tap the track, or use the
// keyboard when it is focused (arrows, Home, End). The value (0..1) is remembered in localStorage.
//
// Two modes (dev panel > UI Layout > Volume Button):
//   enabled  - the slider opens when the mouse hovers the icon (or the slider) and closes when it leaves, with a
//              pixel tolerance around the icon+slider, and drops down / rises up with a speed curve. On touch
//              screens (no hover) tapping the icon still toggles it.
//   disabled - the original behaviour: click the icon to open/close, no animation, default sizes and colours.
//
// What it controls: the short preview clips played while scrubbing (a master multiplier on top of the dev
// panel's "Clip Volume"). Spotify's embedded player exposes no volume method, so the real song / 30 s preview
// in that player is NOT scaled; at exactly 0 % the app treats everything as muted and stops/doesn't start that
// player instead (see main.js).
const KEY = 'spxVolume';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEFAULT_LOOK = { icon: 24, radius: 7, barW: 8, barL: 130, fill: '#1db954', track: '#ffffff', thumb: '#ffffff' };

export function initVolume({ root, onChange }) {
    const btn = root.querySelector('.spx-vol-btn');
    const clip = root.querySelector('.spx-vol-clip');
    const panel = root.querySelector('.spx-vol-panel');
    const track = root.querySelector('.spx-vol-track');
    const fill = root.querySelector('.spx-vol-fill');
    const thumb = root.querySelector('.spx-vol-thumb');
    const label = root.querySelector('.spx-vol-label');
    let vol = 1;
    try { const s = localStorage.getItem(KEY); if (s !== null && Number.isFinite(+s)) vol = clamp(+s, 0, 1); } catch (e) { /* storage blocked */ }

    const cfg = { enabled: true, tol: 30, duration: 350, speedAt: () => 1 };
    let target = false;   // should it be open
    let prog = 0;         // how far open it is, 0 = closed .. 1 = fully open
    let raf = 0, panelH = 0, lastPointer = 'mouse';

    function render() {
        const pct = Math.round(vol * 100);
        fill.style.height = pct + '%';
        thumb.style.bottom = `calc(${pct}% - var(--spx-vol-r))`;
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

    // ---- open / close, with the drop-down animation --------------------------------------------------------------
    function paint() {
        clip.style.height = (prog * panelH) + 'px';
        clip.style.visibility = prog > 0 ? 'visible' : 'hidden';
        panel.style.transform = `translateY(${-(1 - prog) * panelH}px)`; // slides out from under the icon
        btn.setAttribute('aria-expanded', String(target));
    }
    function setOpen(o) {
        if (o === target) return;
        target = o;
        cancelAnimationFrame(raf);
        if (!cfg.enabled || cfg.duration <= 0) { prog = o ? 1 : 0; paint(); return; }
        // s = progress of THIS sequence, 0..1 (closing runs the same sequence backwards on screen); the curve gives
        // the speed at that point, and the Animation Speed slider is the time one full run takes at speed 1.
        let s = o ? prog : 1 - prog, last = performance.now();
        const tick = now => {
            if (window.__spxPaused) { last = now; raf = requestAnimationFrame(tick); return; } // Debug > PAUSE freezes this animation
            const dt = now - last; last = now;
            s = Math.min(1, s + (dt / Math.max(1, cfg.duration)) * Math.max(0.03, cfg.speedAt(s)));
            prog = o ? s : 1 - s;
            paint();
            if (s < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
    }
    const open = o => setOpen(!!o);

    btn.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; });
    btn.addEventListener('click', e => {
        if (cfg.enabled && lastPointer === 'mouse' && e.detail > 0) return; // a mouse opens it by hovering, not clicking
        setOpen(!target);
    });
    // outside tap / Escape closes it
    document.addEventListener('pointerdown', e => { if (target && !root.contains(e.target)) setOpen(false); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && target) setOpen(false); });

    // Hover: inside the icon (when closed) or the icon + the fully-open slider (when open), grown by the tolerance.
    document.addEventListener('pointermove', e => {
        if (!cfg.enabled || e.pointerType === 'touch') return;
        const b = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
        let l = b.left, r = b.right, t = b.top, bt = b.bottom;
        if (target) { l = Math.min(l, rr.left); r = Math.max(r, rr.right); bt = b.bottom + panelH; }
        const tol = cfg.tol;
        const inside = e.clientX >= l - tol && e.clientX <= r + tol && e.clientY >= t - tol && e.clientY <= bt + tol;
        setOpen(inside);
    });

    // Sizes / colours / behaviour from the dev panel (called on every settings change).
    function configure(o) {
        cfg.enabled = !!o.enabled;
        cfg.tol = Math.max(0, o.tol || 0);
        cfg.duration = Math.max(0, o.duration || 0);
        cfg.speedAt = o.speedAt || (() => 1);
        const L = cfg.enabled ? o : DEFAULT_LOOK;
        const set1 = (k, v) => root.style.setProperty(k, v);
        set1('--spx-vol-icon', L.icon + 'px');
        set1('--spx-vol-r', L.radius + 'px');
        set1('--spx-vol-bw', L.barW + 'px');
        set1('--spx-vol-bl', L.barL + 'px');
        set1('--spx-vol-fill', L.fill);
        set1('--spx-vol-track', L.track);
        set1('--spx-vol-thumb', L.thumb);
        panelH = panel.offsetHeight + 8;
        if (!cfg.enabled) { target = target; prog = target ? 1 : 0; }
        paint();
    }

    render();
    onChange(vol); // apply the remembered volume
    configure({ enabled: true, ...DEFAULT_LOOK, tol: 30, duration: 350 });
    return { get: () => vol, set, open, configure, nudge: d => set(vol + d), isOpen: () => target };
}
