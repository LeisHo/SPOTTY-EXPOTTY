// "Log in with Spotify": Authorization Code flow with PKCE (no client secret), run in a small popup so the page is never left.
//   1. loginPopup() opens Spotify's authorize page in a popup, with redirect_uri = this site's root.
//   2. Spotify sends the popup back to /?code=...&state=...; main.js calls handleRedirectIfAny() first thing, which trades the code
//      for tokens (POST accounts.spotify.com/api/token, allowed from a browser), stores them in localStorage and closes the popup.
//   3. The opener sees the localStorage change (onLoginChange) and starts the Web Playback SDK (sdkPlayer.js).
//   getAccessToken() refreshes the access token with the refresh token when it is about to expire.
// Everything is inert while spotifyConfig.js has no Client ID.
import { SPOTIFY_CLIENT_ID } from './spotifyConfig.js';
import { logEvent } from './debugLog.js';

const TOKENS = 'spxSpotifyTokens', VERIFIER = 'spxSpotifyVerifier', STATE = 'spxSpotifyState';
// streaming = the Web Playback SDK; user-read-private tells us whether the account is Premium; the two playback scopes let us start a track
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const clientId = () => window.__spxClientIdOverride || SPOTIFY_CLIENT_ID; // the override is for tests
export const hasClientId = () => !!clientId();
export const redirectUri = () => location.origin + '/';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
export async function codeChallenge(verifier) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }

const read = () => { try { return JSON.parse(localStorage.getItem(TOKENS)) || null; } catch (e) { return null; } };
const write = t => { try { if (t) localStorage.setItem(TOKENS, JSON.stringify(t)); else localStorage.removeItem(TOKENS); } catch (e) { /* storage blocked */ } };
export const isLoggedIn = () => { const t = read(); return !!(t && t.refresh_token); };
export function logout() { write(null); logEvent('playback', 'SPOTIFY logged out'); }

export async function buildAuthUrl() {
    const verifier = randomString(48), state = randomString(16); // 64 + 22 characters: within PKCE's 43-128 / any unguessable state
    try { localStorage.setItem(VERIFIER, verifier); localStorage.setItem(STATE, state); } catch (e) { /* storage blocked */ }
    const q = new URLSearchParams({
        client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES,
        code_challenge_method: 'S256', code_challenge: await codeChallenge(verifier), state,
    });
    return 'https://accounts.spotify.com/authorize?' + q.toString();
}
// Must run from a click / key press (browsers block other popups). If the popup is blocked the page itself goes to Spotify and comes back.
export async function loginPopup() {
    if (!hasClientId()) return false;
    const url = await buildAuthUrl();
    logEvent('playback', 'SPOTIFY login popup opened');
    const w = window.open(url, 'spxSpotifyAuth', 'popup=yes,width=480,height=760');
    if (!w) location.href = url;
    return true;
}

async function tokenRequest(body) {
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('token request failed: ' + r.status + ' ' + (j.error_description || j.error || ''));
    return j;
}
const store = j => {
    const prev = read() || {};
    write({ access_token: j.access_token, refresh_token: j.refresh_token || prev.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
};

// Called first thing at boot. If this page load IS the redirect back from Spotify, finish the login and report it.
export async function handleRedirectIfAny() {
    const p = new URLSearchParams(location.search);
    if (!p.has('code') && !p.has('error')) return false;
    const clean = () => history.replaceState(null, '', location.pathname);
    let expected = null, verifier = null;
    try { expected = localStorage.getItem(STATE); verifier = localStorage.getItem(VERIFIER); } catch (e) { /* storage blocked */ }
    if (!p.has('code') || !expected || p.get('state') !== expected || !verifier) { clean(); logEvent('playback', 'SPOTIFY login returned without a usable code: ' + (p.get('error') || 'state mismatch')); return false; }
    try {
        store(await tokenRequest({ client_id: clientId(), grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), code_verifier: verifier }));
        logEvent('playback', 'SPOTIFY logged in (tokens stored)');
    } catch (e) { logEvent('playback', 'SPOTIFY login FAILED: ' + e.message); }
    try { localStorage.removeItem(VERIFIER); localStorage.removeItem(STATE); } catch (e) { /* ignore */ }
    clean();
    return true;
}

let refreshing = null;
export async function getAccessToken() {
    const t = read();
    if (!t) throw new Error('not logged in');
    if (t.access_token && t.expires_at - Date.now() > 60000) return t.access_token;
    if (!refreshing) refreshing = tokenRequest({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: t.refresh_token }).then(j => { store(j); return j.access_token; }).finally(() => { refreshing = null; });
    return refreshing;
}

// Fires (in OTHER tabs / the opener) when the popup stores or clears the tokens.
export function onLoginChange(fn) { window.addEventListener('storage', e => { if (e.key === TOKENS) fn(isLoggedIn()); }); }
