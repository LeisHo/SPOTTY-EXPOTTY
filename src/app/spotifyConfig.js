// The Client ID of the Spotify app created at https://developer.spotify.com/dashboard for this project.
// It is NOT a secret (the login uses PKCE, which has no client secret), so it can be committed. While it is empty the
// Spotify login / Web Playback SDK stays switched off and the page keeps using the embedded player as before.
//
// Setup (once): in the dashboard create an app, tick "Web Playback SDK" (and "Web API"), add these Redirect URIs EXACTLY:
//   https://spottypotty.vercel.app/
//   http://127.0.0.1:8000/
// then paste the Client ID below. Playing full songs through the SDK needs a Spotify Premium account.
export const SPOTIFY_CLIENT_ID = '402c7d78d7e94af481b86d21f81490d7';
