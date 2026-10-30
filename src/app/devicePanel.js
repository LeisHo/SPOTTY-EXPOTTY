// Play On Device: the Spotify Connect button. Lists the devices on the owner's Spotify account (phone, speaker, TV, another computer) and makes
// one of them the player; the song, pause / resume / seek, and the volume slider then act on that device (sdkPlayer.js does the Web API work and
// polls the device's state). The browser keeps scrubbing with its own preview clips; the real song plays on the device. Needs the Spotify login
// and Premium. Dev panel: UI Layout > Play On Device.
import { setting } from './settings.js';
import { hasClientId, isLoggedIn, loginPopup, onLoginChange } from './spotifyAuth.js';
import { logEvent } from './debugLog.js';

const REMEMBER = 'spxDevice';
const TYPES = { computer: 'Computer', smartphone: 'Phone', speaker: 'Speaker', tv: 'TV', castaudio: 'Cast Audio', castvideo: 'Cast Video', avr: 'Receiver', stb: 'Set-Top Box', audiodongle: 'Audio Dongle', gameconsole: 'Game Console', automobile: 'Car', tablet: 'Tablet' };
const typeLabel = t => TYPES[String(t || '').toLowerCase()] || t || 'Device';
const storedVolume = () => { try { const v = parseFloat(localStorage.getItem('spxVolume')); return Number.isFinite(v) ? v : 1; } catch (e) { return 1; } };

// api: handoff's deviceApi. player: handoff's play state + controls. volume: the volume.js control. setClipVolume: the scrub clips' master volume.
export function initDevicePlayer({ button, api, player, volume, setClipVolume }) {
    const panel = document.createElement('div');
    panel.className = 'spx-device-panel'; panel.id = 'spxDevicePanel'; panel.hidden = true;
    document.body.appendChild(panel);
    let devices = [], open = false, on = false, message = '', notice = '', loading = false, browserVol = 1, listTimer = 0;
    const dp = { quiet: false, active: () => on, panel, isOpen: () => open };

    const target = () => api.target();
    function sync() {
        const t = target();
        button.setAttribute('aria-pressed', String(!!t));
        button.setAttribute('aria-expanded', String(open));
        button.title = t ? 'Playing on ' + t.name : 'Play on a device';
    }
    function place() {
        const r = button.getBoundingClientRect();
        const w = panel.offsetWidth || setting('sliderDevicePanelWidth');
        panel.style.top = Math.max(4, r.bottom + setting('sliderDevicePanelOffsetY')) + 'px';
        panel.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + setting('sliderDevicePanelOffsetX'))) + 'px'; // the button is at the left edge: the list opens to its right
    }
    function render() {
        panel.textContent = '';
        const head = document.createElement('div'); head.className = 'spx-dev-head';
        const title = document.createElement('span'); title.textContent = 'Play On Device'; head.appendChild(title);
        const rf = document.createElement('button'); rf.type = 'button'; rf.className = 'spx-dev-refresh'; rf.textContent = '↻'; rf.title = 'Refresh the list';
        rf.addEventListener('click', () => refresh()); head.appendChild(rf);
        panel.appendChild(head);
        const list = document.createElement('div'); list.className = 'spx-dev-list';
        const t = target();
        const row = (name, meta, isOn, onClick) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'spx-dev-row' + (isOn ? ' on' : '');
            const n = document.createElement('span'); n.className = 'spx-dev-name'; n.textContent = name; b.appendChild(n);
            if (meta) { const m = document.createElement('span'); m.className = 'spx-dev-meta'; m.textContent = meta; b.appendChild(m); }
            b.addEventListener('click', onClick); list.appendChild(b);
        };
        if (isLoggedIn()) {
            if (setting('checkboxDeviceShowThisBrowser')) row('This Browser', 'SPOTTY EXPOTTY', !t, () => pick(null));
            devices.filter(d => !d.isThis).forEach(d => {
                const vol = setting('checkboxDeviceShowVolume') && d.supportsVolume && d.volume != null ? ' · ' + Math.round(d.volume * 100) + '%' : '';
                row(d.name, typeLabel(d.type) + vol, !!t && t.id === d.id, () => pick(d));
            });
        }
        panel.appendChild(list);
        const msg = document.createElement('div'); msg.className = 'spx-dev-msg';
        if (!hasClientId()) msg.textContent = 'Spotify login is not set up.';
        else if (!isLoggedIn()) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'spx-dev-login'; b.textContent = 'Log In With Spotify';
            b.addEventListener('click', () => loginPopup()); panel.appendChild(b);
            msg.textContent = 'Log in to see your devices.';
        } else msg.textContent = loading ? 'Looking for devices…' : message || notice || (devices.filter(d => !d.isThis).length ? '' : 'No other device found. Open Spotify on it first.');
        if (msg.textContent) panel.appendChild(msg);
        if (open) place();
    }
    async function refresh() {
        if (!isLoggedIn()) { render(); return; }
        loading = true; message = ''; render();
        try { devices = await api.list(); }
        catch (e) { message = 'Could not load the devices (' + e.message.replace(/^GET \S+ -> /, '') + ').'; }
        loading = false; render();
    }
    function setOpen(o) {
        open = o; panel.hidden = !o; clearInterval(listTimer);
        if (!o) notice = '';
        if (o) { render(); place(); refresh(); listTimer = setInterval(() => { if (!loading) refresh(); }, Math.max(1, setting('sliderDeviceListRefresh')) * 1000); }
        sync();
    }

    // Switching. d = a device from the list, or null = back to this browser. The song that is playing keeps playing on the new player, from where it was.
    function pick(d) {
        const t = target();
        if (!d ? !t : t && t.id === d.id) { if (setting('checkboxDeviceCloseOnPick')) setOpen(false); return; }
        notice = '';
        const was = player.isPlaying(), id = player.playingId(), pr = player.getProgress(), pos = pr ? pr.pos : 0;
        const keep = setting('checkboxDeviceKeepPlaying') && was && id;
        logEvent('playback', 'DEVICE ' + (d ? 'switch to ' + d.name : 'back to this browser') + (keep ? ' (keeps playing at ' + Math.round(pos) + ' ms)' : ''));
        player.pauseEmbed();         // the player that is playing now stops
        api.set(d);                  // fires onDevice (volume handover, button state)
        if (d) { try { localStorage.setItem(REMEMBER, JSON.stringify({ id: d.id, name: d.name })); } catch (e) { /* storage blocked */ } }
        else { try { localStorage.removeItem(REMEMBER); } catch (e) { /* storage blocked */ } }
        if (keep) player.playTrack(id, pos);
        if (setting('checkboxDeviceCloseOnPick')) setOpen(false); else render();
    }

    // The volume slider follows whichever player is the active one: on entering a device it shows that device's volume (or sends its own level
    // to it), on leaving it goes back to this browser's level. dp.quiet stops the slider's own onChange from echoing the value back.
    const setSlider = (v, persist) => { dp.quiet = true; try { volume.set(v, persist); } finally { dp.quiet = false; } };
    function onEnter(t) {
        browserVol = storedVolume();
        if (setting('checkboxDeviceMatchVolume') && t.volume != null) setSlider(t.volume, false);
        else player.setRealVolume(volume.get()); // the slider's level goes to the device instead
        if (setting('checkboxDeviceMuteClips')) setClipVolume(0);
    }
    api.callbacks({
        onDevice: (t, reason) => {
            if (t && !on) { on = true; onEnter(t); }
            else if (t && on) { if (setting('checkboxDeviceMatchVolume') && t.volume != null) setSlider(t.volume, false); } // followed Spotify to another device
            else if (!t && on) { on = false; volume.set(browserVol, true); } // not quiet: this browser's own level goes back to its player and the clips
            if (reason && reason !== 'followed') notice = reason;
            if (!t) { try { localStorage.removeItem(REMEMBER); } catch (e) { /* storage blocked */ } }
            sync(); if (open) render();
        },
        onVolume: v => setSlider(v, false), // the device's own volume changed
    });

    document.addEventListener('pointerdown', e => {
        if (open && setting('checkboxDevicePanelCloseOnOutside') && !panel.contains(e.target) && !button.contains(e.target)) setOpen(false);
    }, true);
    document.addEventListener('keydown', e => { if (open && e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', () => { if (open) place(); });
    button.addEventListener('click', () => setOpen(!open));
    onLoginChange(() => { if (open) refresh(); });

    // Reload: pick the remembered device again when it is still there (off by default).
    async function restore() {
        if (!setting('checkboxDeviceRemember') || !isLoggedIn()) return;
        let saved = null; try { saved = JSON.parse(localStorage.getItem(REMEMBER) || 'null'); } catch (e) { /* storage blocked */ }
        if (!saved) return;
        try { const list = await api.list(); const d = list.find(x => x.id === saved.id && !x.isThis); if (d && !target()) { api.set(d); sync(); } }
        catch (e) { /* offline: stays on this browser */ }
    }

    // Style + behaviour settings (called from applyLook).
    dp.applySettings = () => {
        const s = panel.style;
        s.setProperty('--spx-dev-width', setting('sliderDevicePanelWidth') + 'px'); s.setProperty('--spx-dev-font', setting('sliderDevicePanelFontSize') + 'px');
        const hex = setting('colorDevicePanelBg'), n = parseInt(hex.slice(1), 16), a = setting('sliderDevicePanelBgOpacity') / 100;
        s.setProperty('--spx-dev-bg', 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')');
        s.setProperty('--spx-dev-blur', setting('sliderDevicePanelBlur') + 'px'); s.setProperty('--spx-dev-accent', setting('colorDevicePanelAccent'));
        api.pollMs(setting('sliderDevicePollSeconds') * 1000);
        if (!setting('checkboxDeviceButtonEnabled') && open) setOpen(false);
        if (open) { render(); place(); }
    };
    sync();
    setTimeout(restore, 1500);
    return dp;
}
