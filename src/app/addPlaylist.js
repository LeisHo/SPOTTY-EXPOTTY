// Add To Playlist: the button under Play On Device. Opens a small panel with dropdowns for the owner's own (or collaborative) Spotify playlists,
// where in the playlist the song goes, and a "+ New Playlist" choice; Add puts the song that is shown (the cover / title) in the chosen playlist.
// Needs the Spotify login with the playlist scopes (spotifyAuth.js SCOPES); a login made before those were added is asked to log in once more.
// Dev panel: UI Layout > Add To Playlist.
import { setting } from './settings.js';
import { hasClientId, isLoggedIn, loginPopup, onLoginChange, getAccessToken, hasPlaylistScope } from './spotifyAuth.js';
import { logEvent } from './debugLog.js';

const REMEMBER = 'spxAddPlaylistLast';
const NEW = '__new__';
const API = 'https://api.spotify.com/v1';

async function call(method, path, body) {
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    const text = await r.text().catch(() => '');
    if (!r.ok) { const e = new Error(method + ' ' + path + ' -> ' + r.status + ' ' + text.slice(0, 140)); e.status = r.status; throw e; }
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}
// Spotify renamed some playlist endpoints for newer apps (/tracks -> /items, /users/{id}/playlists -> /me/playlists); the old name is tried when the new one is not found.
const missing = e => e && (e.status === 404 || e.status === 405 || e.status === 410);

let meId = null;
async function me() { if (!meId) meId = (await call('GET', '/me')).id; return meId; }

async function loadPlaylists() {
    const uid = await me(), out = [];
    for (let offset = 0; offset < 1000; offset += 50) {
        const page = await call('GET', '/me/playlists?limit=50&offset=' + offset);
        const items = (page && page.items || []).filter(Boolean);
        items.forEach(p => { if ((p.owner && p.owner.id === uid) || p.collaborative) out.push({ id: p.id, name: p.name || '(no name)', count: p.tracks && p.tracks.total != null ? p.tracks.total : (p.items && p.items.total != null ? p.items.total : null), collaborative: !!p.collaborative }); });
        if (!page || !page.next) break;
    }
    return out;
}
async function addTrack(playlistId, trackId, atStart) {
    const body = { uris: ['spotify:track:' + trackId], ...(atStart ? { position: 0 } : {}) };
    try { return await call('POST', '/playlists/' + playlistId + '/tracks', body); }
    catch (e) { if (!missing(e)) throw e; return call('POST', '/playlists/' + playlistId + '/items', body); }
}
async function createPlaylist(name, isPublic) {
    const body = { name, public: !!isPublic, description: 'Made with SPOTTY EXPOTTY' };
    try { return await call('POST', '/me/playlists', body); }
    catch (e) { if (!missing(e)) throw e; return call('POST', '/users/' + (await me()) + '/playlists', body); }
}

// getSong: () => { id, name, artist } of the song that is shown. button: #spxAddPlaylist.
export function initAddPlaylist({ button, getSong }) {
    const panel = document.createElement('div');
    panel.className = 'spx-device-panel spx-addpl-panel'; panel.id = 'spxAddPlaylistPanel'; panel.hidden = true;
    document.body.appendChild(panel);
    let open = false, playlists = [], loading = false, busy = false, message = '', needLogin = false;
    let chosen = '', newName = '', newPublic = false, pos = '';
    try { chosen = localStorage.getItem(REMEMBER) || ''; } catch (e) { /* storage blocked */ }
    const ap = { panel, isOpen: () => open };

    function sync() { button.setAttribute('aria-pressed', String(open)); button.setAttribute('aria-expanded', String(open)); }
    function place() {
        const r = button.getBoundingClientRect();
        const w = panel.offsetWidth || setting('sliderAddPlaylistPanelWidth');
        panel.style.top = Math.max(4, r.bottom + setting('sliderAddPlaylistPanelOffsetY')) + 'px';
        panel.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + setting('sliderAddPlaylistPanelOffsetX'))) + 'px';
    }
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    function field(label, control) { const w = el('label', 'spx-addpl-field'); w.appendChild(el('span', 'spx-addpl-label', label)); w.appendChild(control); return w; }
    function select(options, value, onChange) {
        const s = el('select', 'spx-addpl-select');
        options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); });
        s.value = value; s.addEventListener('change', () => onChange(s.value)); return s;
    }
    function render() {
        panel.textContent = '';
        const head = el('div', 'spx-dev-head'); head.appendChild(el('span', '', 'Add To Playlist'));
        const rf = el('button', 'spx-dev-refresh', '↻'); rf.type = 'button'; rf.title = 'Refresh the playlists'; rf.addEventListener('click', () => refresh()); head.appendChild(rf);
        panel.appendChild(head);
        const msg = el('div', 'spx-dev-msg');
        if (!hasClientId()) msg.textContent = 'Spotify login is not set up.';
        else if (!isLoggedIn() || needLogin || !hasPlaylistScope()) {
            const b = el('button', 'spx-dev-login', isLoggedIn() ? 'Log In Again To Allow Playlists' : 'Log In With Spotify'); b.type = 'button';
            b.addEventListener('click', () => loginPopup()); panel.appendChild(b);
            msg.textContent = isLoggedIn() ? 'Spotify needs your permission to change playlists (one time).' : 'Log in to add songs to your playlists.';
            panel.appendChild(msg); if (open) place(); return;
        }
        const song = getSong();
        if (setting('checkboxAddPlaylistShowSong')) panel.appendChild(el('div', 'spx-addpl-song', song && song.name ? song.name + (song.artist ? ' - ' + song.artist : '') : 'No song'));
        const opts = [['', loading ? 'Loading playlists…' : 'Choose A Playlist'], ...playlists.map(p => [p.id, p.name + (p.count != null ? ' (' + p.count + ')' : '') + (p.collaborative ? ' · shared' : '')]), [NEW, '+ New Playlist…']];
        if (chosen && chosen !== NEW && !playlists.some(p => p.id === chosen)) chosen = '';
        panel.appendChild(field('Playlist', select(opts, chosen, v => { chosen = v; message = ''; try { if (v && v !== NEW) localStorage.setItem(REMEMBER, v); } catch (e) { /* storage blocked */ } render(); })));
        if (chosen === NEW) {
            const inp = el('input', 'spx-addpl-input'); inp.type = 'text'; inp.placeholder = 'Playlist name'; inp.value = newName; inp.maxLength = 100;
            inp.addEventListener('input', () => { newName = inp.value; });
            panel.appendChild(field('Name', inp));
            panel.appendChild(field('Who Can See It', select([['0', 'Private'], ['1', 'Public']], newPublic ? '1' : '0', v => { newPublic = v === '1'; })));
        }
        panel.appendChild(field('Add To', select([['end', 'End Of The Playlist'], ['start', 'Beginning Of The Playlist']], pos || setting('selectAddPlaylistPosition'), v => { pos = v; })));
        const add = el('button', 'spx-dev-login spx-addpl-add', busy ? 'Adding…' : 'Add'); add.type = 'button'; add.disabled = busy || loading; add.addEventListener('click', doAdd); panel.appendChild(add);
        msg.textContent = message; if (msg.textContent) panel.appendChild(msg);
        if (open) place();
    }
    async function refresh() {
        if (!isLoggedIn() || !hasPlaylistScope()) { render(); return; }
        loading = true; render();
        try { playlists = await loadPlaylists(); logEvent('playback', 'PLAYLISTS loaded: ' + playlists.length); message = ''; needLogin = false; }
        catch (e) { message = 'Could not load the playlists (' + e.message.replace(/^GET \S+ -> /, '') + ').'; if (e.status === 401 || e.status === 403) needLogin = true; logEvent('playback', 'PLAYLISTS load FAILED: ' + e.message); }
        loading = false; render();
    }
    async function doAdd() {
        const song = getSong();
        if (!song || !song.id) { message = 'This song has no Spotify id.'; render(); return; }
        if (!chosen) { message = 'Choose a playlist first.'; render(); return; }
        if (chosen === NEW && !newName.trim()) { message = 'Type a name for the new playlist.'; render(); return; }
        busy = true; message = ''; render();
        const atStart = (pos || setting('selectAddPlaylistPosition')) === 'start';
        try {
            let target = null;
            const isNew = chosen === NEW;
            if (isNew) {
                const made = await createPlaylist(newName.trim(), newPublic);
                target = { id: made.id, name: made.name || newName.trim() };
                playlists.unshift({ id: made.id, name: target.name, count: 0, collaborative: false });
                chosen = made.id; newName = '';
                try { localStorage.setItem(REMEMBER, made.id); } catch (e) { /* storage blocked */ }
            } else target = playlists.find(p => p.id === chosen);
            await addTrack(target.id, song.id, atStart && !isNew);
            const p = playlists.find(x => x.id === target.id); if (p && p.count != null) p.count++;
            message = 'Added to ' + target.name + '.';
            logEvent('playback', 'PLAYLIST add ' + song.id + ' -> ' + target.name + (atStart ? ' (start)' : ''));
            busy = false;
            if (setting('checkboxAddPlaylistCloseAfterAdd')) setOpen(false); else render();
            return;
        } catch (e) {
            message = e.status === 403 || e.status === 401 ? 'Spotify refused (' + e.status + '). Log in again to allow playlists.' : 'Could not add it (' + e.message.replace(/^\w+ \S+ -> /, '') + ').';
            if (e.status === 401 || e.status === 403) needLogin = true;
            logEvent('playback', 'PLAYLIST add FAILED: ' + e.message);
        }
        busy = false; render();
    }
    function setOpen(o) {
        open = o; panel.hidden = !o;
        if (o) { message = ''; render(); place(); refresh(); }
        sync();
    }

    document.addEventListener('pointerdown', e => {
        if (open && setting('checkboxAddPlaylistCloseOnOutside') && !panel.contains(e.target) && !button.contains(e.target)) setOpen(false);
    }, true);
    document.addEventListener('keydown', e => { if (open && e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', () => { if (open) place(); });
    button.addEventListener('click', () => setOpen(!open));
    onLoginChange(() => { needLogin = false; if (open) refresh(); });
    ap.songChanged = () => { if (open) { message = ''; render(); } };

    // Style + behaviour settings (called from applyLook).
    ap.applySettings = () => {
        const s = panel.style;
        s.setProperty('--spx-dev-width', setting('sliderAddPlaylistPanelWidth') + 'px'); s.setProperty('--spx-dev-font', setting('sliderAddPlaylistPanelFontSize') + 'px');
        const hex = setting('colorAddPlaylistPanelBg'), n = parseInt(hex.slice(1), 16), a = setting('sliderAddPlaylistPanelBgOpacity') / 100;
        s.setProperty('--spx-dev-bg', 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')');
        s.setProperty('--spx-dev-blur', setting('sliderAddPlaylistPanelBlur') + 'px'); s.setProperty('--spx-dev-accent', setting('colorAddPlaylistPanelAccent'));
        if (!setting('checkboxAddPlaylistButtonEnabled') && open) setOpen(false);
        if (open) { render(); place(); }
    };
    sync();
    return ap;
}
