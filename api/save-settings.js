// SPOTTY EXPOTTY -- Vercel serverless function for CLAUDE.md S12l's
// optional git-tracked dev-panel-settings upgrade. Does nothing (dev panel
// falls back to localStorage) until GITHUB_TOKEN + GITHUB_REPO are set as
// real Vercel environment variables for this project's deployment, and
// DEV_PANEL_SAVE_SECRET is set both there and as the matching client-side
// secret in src/main.js. See CLAUDE.md S12l for what each secret is for --
// don't put either value in this file or any other committed file.
const GITHUB_API = 'https://api.github.com';

async function ghRequest(url, token, method = 'GET', payload) {
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

export default async function handler(req, res) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    const settingsPath = process.env.SETTINGS_FILE_PATH || 'data/processed/dev-panel-settings.json';

    if (!token || !repo) {
        return res.status(503).json({ ok: false, error: 'GITHUB_TOKEN/GITHUB_REPO not configured; client falls back to localStorage.' });
    }

    const fileUrl = `${GITHUB_API}/repos/${repo}/contents/${settingsPath}`;

    if (req.method === 'GET') {
        const { status, body } = await ghRequest(`${fileUrl}?ref=${branch}`, token);
        if (status === 404) return res.status(200).json({ ok: true, settings: null });
        if (status !== 200) return res.status(502).json({ ok: false, error: body.message });
        const settings = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8'));
        return res.status(200).json({ ok: true, settings });
    }

    if (req.method === 'POST') {
        const secret = process.env.DEV_PANEL_SAVE_SECRET;
        if (secret && req.headers['x-dev-panel-secret'] !== secret) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        const settings = req.body && req.body.settings;
        if (!settings) return res.status(400).json({ ok: false, error: 'Missing settings' });

        const { status: getStatus, body: getBody } = await ghRequest(`${fileUrl}?ref=${branch}`, token);
        const sha = getStatus === 200 ? getBody.sha : undefined;
        const content = Buffer.from(JSON.stringify(settings, null, 2) + '\n').toString('base64');
        const { status, body } = await ghRequest(fileUrl, token, 'PUT', {
            message: 'Update dev-panel-settings.json via dev panel',
            content,
            branch,
            ...(sha ? { sha } : {}),
        });
        if (status !== 200 && status !== 201) {
            return res.status(502).json({ ok: false, error: body.message });
        }
        return res.status(200).json({ ok: true, written: [settingsPath] });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
