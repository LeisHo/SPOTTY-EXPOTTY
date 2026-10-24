// SPOTTY EXPOTTY -- Vercel serverless function: turns Deezer track ids into
// fresh 30-second preview URLs. Deezer's preview links carry an exp= token
// and are valid ~15 minutes (measured 14.98 min), and Deezer's API sends no
// CORS header, so the browser can't call it directly -- this proxies it.
// GET /api/preview?ids=1,2,3   ->   { "1": "https://...mp3?...", "2": null }
// null means Deezer returned no preview for that id.
const TTL_MS = 10 * 60 * 1000; // refresh before the ~15 min link expiry
const MAX_IDS = 40;
const cache = new Map(); // id -> { url, at }

async function lookup(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
    try {
        const res = await fetch(`https://api.deezer.com/track/${encodeURIComponent(id)}`);
        const body = await res.json();
        const url = body && body.preview ? body.preview : null;
        // Only cache real URLs: a Deezer quota error must not stick for 10 minutes.
        if (url) cache.set(id, { url, at: Date.now() });
        return url;
    } catch (e) {
        return null;
    }
}

export default async function handler(req, res) {
    const ids = String(req.query.ids || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => /^\d+$/.test(s))
        .slice(0, MAX_IDS);
    if (!ids.length) {
        res.status(400).json({ error: 'ids=comma,separated,deezer,ids required' });
        return;
    }
    const urls = await Promise.all(ids.map(lookup));
    const out = {};
    ids.forEach((id, i) => { out[id] = urls[i]; });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(out);
}
