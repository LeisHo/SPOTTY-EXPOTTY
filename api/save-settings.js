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

const DEFAULT_REPO = 'LeisHo/SPOTTY-EXPOTTY';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PATH = 'data/processed/dev-panel-settings.json';

export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.status(405).json({ ok: false, error: 'Method not allowed' });
        return;
    }

    const token = process.env.GITHUB_TOKEN;
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
            const getResp = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
            if (getResp.status === 404) {
                res.status(200).json({ ok: true, settings: null }); // nothing saved yet -- not an error
                return;
            }
            if (!getResp.ok) {
                const errText = await getResp.text();
                res.status(502).json({ ok: false, error: `GitHub lookup failed (${getResp.status}): ${errText}` });
                return;
            }
            const getData = await getResp.json();
            let jsonText;
            if (getData.content) {
                jsonText = Buffer.from(getData.content, 'base64').toString('utf-8');
            } else if (getData.download_url) {
                // Above ~1 MB the Contents API omits `content`; fetch the raw file instead.
                const rawResp = await fetch(getData.download_url, { headers: { Authorization: headers.Authorization }, cache: 'no-store' });
                if (!rawResp.ok) {
                    res.status(502).json({ ok: false, error: `download_url fetch failed (${rawResp.status})` });
                    return;
                }
                jsonText = await rawResp.text();
            } else {
                res.status(500).json({ ok: false, error: 'GitHub response had neither content nor download_url' });
                return;
            }
            if (req.query && req.query.gz === '1') {
                const gz = zlib.gzipSync(Buffer.from(jsonText, 'utf-8')).toString('base64');
                res.status(200).json({ ok: true, gz });
            } else {
                res.status(200).json({ ok: true, settings: JSON.parse(jsonText) });
            }
        } catch (err) {
            res.status(500).json({ ok: false, error: String((err && err.message) || err) });
        }
        return;
    }

    let body = req.body;
    if (body && typeof body === 'object' && typeof body.gz === 'string') {
        try {
            body = JSON.parse(zlib.gunzipSync(Buffer.from(body.gz, 'base64')).toString('utf-8'));
        } catch (err) {
            res.status(400).json({ ok: false, error: 'Bad gz payload: ' + String((err && err.message) || err) });
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
        const getResp = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
        if (getResp.ok) {
            const getData = await getResp.json();
            sha = getData.sha;
        } else if (getResp.status !== 404) {
            const errText = await getResp.text();
            res.status(502).json({ ok: false, error: `GitHub lookup failed (${getResp.status}): ${errText}` });
            return;
        }

        const content = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf-8').toString('base64');
        const putResp = await fetch(apiUrl, {
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
            res.status(502).json({ ok: false, error: `GitHub commit failed (${putResp.status}): ${errText}` });
            return;
        }
        const putData = await putResp.json();
        res.status(200).json({ ok: true, commitSha: putData.commit && putData.commit.sha });
    } catch (err) {
        res.status(500).json({ ok: false, error: String((err && err.message) || err) });
    }
}
