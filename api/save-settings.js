// SPOTTY EXPOTTY -- Vercel serverless function backing the dev panel's Sync (Save)
// and Reset buttons (CLAUDE.md S12l). POST commits the posted settings dump to
// data/processed/dev-panel-settings.json in this repo via GitHub's Contents API, so
// any device/browser sees the same saved state. GET reads that file back LIVE from
// the Contents API (not the static file, which only reflects the last deployment).
// Ported from HANDO's api/save-settings.js (its working version): same defaults
// mechanism, gzip transport, and large-file download_url fallback.
//
// Required Vercel project environment variables:
//   GITHUB_TOKEN            - fine-grained PAT, contents:read+write on this repo
//   DEV_PANEL_SAVE_SECRET   - shared anti-abuse token (POST only; GET is a read)
// Optional (defaulted below):
//   GITHUB_REPO             - "owner/repo", defaults to "LeisHo/SPOTTY-EXPOTTY"
//   GITHUB_BRANCH           - defaults to "main"
//   SETTINGS_FILE_PATH      - defaults to "data/processed/dev-panel-settings.json"
//
// Both directions can travel gzipped + base64 as { gz } (Vercel caps request/response
// bodies at 4.5 MB); plain JSON is still accepted/returned.
import zlib from 'zlib';
import crypto from 'crypto';

const DEFAULT_REPO = 'LeisHo/SPOTTY-EXPOTTY';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PATH = 'data/processed/dev-panel-settings.json';

// Error text goes back to the browser (and GET needs no secret), so it must never contain a credential:
// an earlier version returned the exception message verbatim and that message contained the whole token.
const scrub = v => String(v)
    .replace(/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
const safeErr = err => scrub((err && err.message) || err);
// A file's git blob sha = sha1("blob <bytes>\0" + bytes): the same id GitHub reports as `sha`, so a raw read can say which version it returned without a second request.
const gitBlobSha = buf => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');

export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.status(405).json({ ok: false, error: 'Method not allowed' });
        return;
    }

    // The env var may hold several whitespace-separated tokens (it was once saved with two pasted together, which
    // as ONE header value made GitHub reject every request). Each is tried in order: a fine-grained token can read
    // a public repo but answer 403 on a write, and then the next token (e.g. a classic "repo"-scope one) is used.
    // Anything that is not shaped like a GitHub token (stray label text, a smart quote, ...) is ignored: a value
    // with a character that cannot be sent in a header made the whole request fail ("invalid header value").
    const rawTokens = (process.env.GITHUB_TOKEN || '').split(/\s+/).filter(t => /^[\x21-\x7e]+$/.test(t));
    const shaped = rawTokens.filter(t => /^(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}$/.test(t));
    const tokens = shaped.length ? shaped : rawTokens;
    const token = tokens[0] || '';
    const ghFetch = async (url, init = {}) => {
        let r;
        for (const t of tokens) {
            try { r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } }); } catch (e) { continue; }
            if (r.status !== 401 && r.status !== 403) return r;
        }
        if (!r) throw new Error('no usable GitHub token in GITHUB_TOKEN');
        return r;
    };
    const secret = process.env.DEV_PANEL_SAVE_SECRET;
    // Report exactly which var is missing. DEV_PANEL_SAVE_SECRET only gates POST.
    const missing = [];
    if (!token) missing.push('GITHUB_TOKEN');
    if (req.method === 'POST' && !secret) missing.push('DEV_PANEL_SAVE_SECRET');
    if (missing.length) {
        res.status(500).json({ ok: false, error: `Server not configured - missing: ${missing.join(', ')}` });
        return;
    }
    if (req.method === 'POST' && req.headers['x-dev-panel-secret'] !== secret) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
    const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
    const path = process.env.SETTINGS_FILE_PATH || DEFAULT_PATH;
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
    };

    if (req.method === 'GET') {
        try {
            res.setHeader('Cache-Control', 'no-store');
            // The settings file is over 1 MB, where the Contents API omits `content` and the old code fell back to `download_url`, i.e. raw.githubusercontent.com's CDN, which keeps a
            // file for MINUTES: a refresh right after a save showed the PREVIOUS settings (checked boxes came back, and a save made from that view overwrote the newer one).
            // The raw media type returns the CURRENT file straight from the API (up to 100 MB), so ask for that first and only fall back to the older lookups if it fails.
            let jsonText = null, fileSha = null;
            try {
                const rawResp = await ghFetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
                if (rawResp.ok) { const buf = Buffer.from(await rawResp.arrayBuffer()); jsonText = buf.toString('utf-8'); fileSha = gitBlobSha(buf); }
            } catch (e) { /* fall back below */ }
            if (jsonText === null) {
            const getResp = await ghFetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
            if (getResp.status === 404) {
                res.status(200).json({ ok: true, settings: null }); // nothing saved yet -- not an error
                return;
            }
            if (!getResp.ok) {
                const errText = await getResp.text();
                res.status(502).json({ ok: false, error: `GitHub lookup failed (${getResp.status}): ${scrub(errText)}` });
                return;
            }
            const getData = await getResp.json();
            fileSha = getData.sha || null;
            if (getData.content) {
                jsonText = Buffer.from(getData.content, 'base64').toString('utf-8');
            } else if (getData.download_url) {
                // Above ~1 MB the Contents API omits `content`; fetch the raw file instead.
                const rawResp = await ghFetch(getData.download_url, { headers: { Authorization: headers.Authorization }, cache: 'no-store' });
                if (!rawResp.ok) {
                    res.status(502).json({ ok: false, error: `download_url fetch failed (${rawResp.status})` });
                    return;
                }
                jsonText = await rawResp.text();
            } else {
                res.status(500).json({ ok: false, error: 'GitHub response had neither content nor download_url' });
                return;
            }
            }
            if (req.query && req.query.gz === '1') {
                const gz = zlib.gzipSync(Buffer.from(jsonText, 'utf-8')).toString('base64');
                res.status(200).json({ ok: true, gz, sha: fileSha });
            } else {
                res.status(200).json({ ok: true, settings: JSON.parse(jsonText), sha: fileSha });
            }
        } catch (err) {
            res.status(500).json({ ok: false, error: safeErr(err) });
        }
        return;
    }

    let body = req.body;
    if (body && typeof body === 'object' && typeof body.gz === 'string') {
        try {
            body = JSON.parse(zlib.gunzipSync(Buffer.from(body.gz, 'base64')).toString('utf-8'));
        } catch (err) {
            res.status(400).json({ ok: false, error: 'Bad gz payload: ' + safeErr(err) });
            return;
        }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ ok: false, error: 'Body must be a JSON object' });
        return;
    }

    try {
        // The current file's sha is required to update an existing file (a 404 just means "create").
        let sha;
        const getResp = await ghFetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
        if (getResp.ok) {
            const getData = await getResp.json();
            sha = getData.sha;
            // Stale-save guard: the page sends the version it loaded (X-Base-Sha). If the file has changed since (another device or tab saved), refuse - this save would
            // replace the newer settings with older values. No header (an older page) = no check; X-Force-Save: 1 = the owner chose to overwrite anyway.
            const baseSha = req.headers['x-base-sha'];
            if (baseSha && baseSha !== sha && req.headers['x-force-save'] !== '1') {
                res.status(409).json({ ok: false, stale: true, sha, error: 'The saved settings changed since this page loaded (saved from another device or tab).' });
                return;
            }
        } else if (getResp.status !== 404) {
            const errText = await getResp.text();
            res.status(502).json({ ok: false, error: `GitHub lookup failed (${getResp.status}): ${scrub(errText)}` });
            return;
        }

        const content = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf-8').toString('base64');
        const putResp = await ghFetch(apiUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                message: 'Update dev-panel-settings.json via Save Settings',
                content,
                branch,
                ...(sha ? { sha } : {}),
            }),
        });
        if (!putResp.ok) {
            const errText = await putResp.text();
            res.status(502).json({ ok: false, error: `GitHub commit failed (${putResp.status}): ${scrub(errText)}` });
            return;
        }
        const putData = await putResp.json();
        res.status(200).json({ ok: true, commitSha: putData.commit && putData.commit.sha, sha: putData.content && putData.content.sha }); // the new version: the page's next save is based on it
    } catch (err) {
        res.status(500).json({ ok: false, error: safeErr(err) });
    }
}
