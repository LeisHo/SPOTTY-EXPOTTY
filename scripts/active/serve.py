#!/usr/bin/env python3
"""Local static server for SPOTTY EXPOTTY.

Required instead of `python -m http.server`: that server sends .mjs as
text/plain, and browsers reject a <script type="module"> import with that
MIME type -- every lib/ui-engine/*.mjs import would fail. Adapted from
LENTICULOSO's own scripts/active/serve.py (itself adapted from the UI
Layout Engine's demo/serve.py), which documents the same gotcha.

Usage: python scripts/active/serve.py [port] [--open]   (port defaults to 8000 -- change this if it collides with a sibling project's own server)

The optional /api/save-settings local stand-in for CLAUDE.md S12l's
git-tracked settings upgrade only activates if GITHUB_TOKEN and
GITHUB_REPO are set in this server's own environment; without them the
dev panel's Save/Sync correctly falls back to localStorage.
"""
import base64
import http.server
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

GITHUB_API = 'https://api.github.com'
_PREVIEW_CACHE = {}  # deezer id -> (url, fetched_at); links expire ~15 min, refreshed after 10
# Deezer allows ~50 requests / 5 s per IP (observed: bursts beyond that return error code 4).
# One process-wide limiter keeps all lookups, across requests, under 8 per second.
_DEEZER_PER_SEC = 8
_deezer_lock = threading.Lock()
_deezer_next = [0.0]


def _deezer_wait():
    with _deezer_lock:
        now = time.time()
        t = max(now, _deezer_next[0])
        _deezer_next[0] = t + 1.0 / _DEEZER_PER_SEC
    if t > now:
        time.sleep(t - now)


def _gh_config():
    return {
        'token': os.environ.get('GITHUB_TOKEN'),
        'repo': os.environ.get('GITHUB_REPO'),
        'branch': os.environ.get('GITHUB_BRANCH', 'main'),
        'settings_path': os.environ.get('SETTINGS_FILE_PATH', 'data/processed/dev-panel-settings.json'),
    }


def _gh_request(url, token, method='GET', payload=None):
    req = urllib.request.Request(url, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('X-GitHub-Api-Version', '2022-11-28')
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data) as resp:
            return resp.getcode(), json.loads(resp.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(body or '{}')
        except json.JSONDecodeError:
            return e.code, {'message': body[:400]}


def _gh_put_file(cfg, path, content_b64, message):
    url = f"{GITHUB_API}/repos/{cfg['repo']}/contents/{path}"
    code, body = _gh_request(f"{url}?ref={cfg['branch']}", cfg['token'])
    sha = body.get('sha') if code == 200 else None
    payload = {'message': message, 'content': content_b64, 'branch': cfg['branch']}
    if sha:
        payload['sha'] = sha
    return _gh_request(url, cfg['token'], 'PUT', payload)


def _gh_get_file(cfg, path):
    url = f"{GITHUB_API}/repos/{cfg['repo']}/contents/{path}?ref={cfg['branch']}"
    code, body = _gh_request(url, cfg['token'])
    if code == 404:
        return None
    if code != 200:
        raise RuntimeError(f'GitHub read failed ({code}): {body.get("message")}')
    return base64.b64decode(body.get('content', '') or '')


_args = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(_args[0]) if _args else 8000
OPEN_BROWSER = '--open' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'text/javascript',
        '.js': 'text/javascript',
        '.json': 'application/json',
    }
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if '/lib/' in self.path:
            self.send_header('Cache-Control', 'public, max-age=3600')
        else:
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def _json(self, code, obj):
        raw = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _is_api(self):
        return self.path.split('?')[0].rstrip('/') == '/api/save-settings'

    def _preview(self):
        """Local stand-in for api/preview.js: Deezer ids -> fresh preview URLs."""
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        ids = [i for i in (qs.get('ids', [''])[0].split(',')) if i.strip().isdigit()][:40]
        if not ids:
            return self._json(400, {'error': 'ids=comma,separated,deezer,ids required'})
        def one(i):
            hit = _PREVIEW_CACHE.get(i)
            if hit and time.time() - hit[1] < 600:
                return hit[0]
            for attempt in range(3):
                _deezer_wait()
                try:
                    req = urllib.request.Request(f'https://api.deezer.com/track/{i}', headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        body = json.loads(resp.read().decode('utf-8'))
                except Exception:  # noqa: BLE001
                    return None  # transient failure: don't cache, the client retries
                if body.get('error', {}).get('code') == 4:  # Deezer quota exceeded: back off, retry
                    time.sleep(0.7 * (attempt + 1))
                    continue
                url = body.get('preview') or None
                if url:  # only cache real URLs
                    _PREVIEW_CACHE[i] = (url, time.time())
                return url
            return None
        with ThreadPoolExecutor(4) as ex:
            out = dict(zip(ids, ex.map(one, ids)))
        return self._json(200, out)

    def do_GET(self):
        if self.path.split('?')[0].rstrip('/') == '/api/preview':
            return self._preview()
        if not self._is_api():
            return super().do_GET()
        cfg = _gh_config()
        if not cfg['token'] or not cfg['repo']:
            return self._json(503, {'ok': False, 'error': "GITHUB_TOKEN/GITHUB_REPO not set; falling back to localStorage."})
        try:
            raw = _gh_get_file(cfg, cfg['settings_path'])
            settings = json.loads(raw.decode('utf-8')) if raw else None
            return self._json(200, {'ok': True, 'settings': settings})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {'ok': False, 'error': str(e)})

    def do_POST(self):
        # Always consume the request body first: an early error return that leaves it unread makes the
        # next keep-alive request parse the leftover bytes as a request line (a bogus 501).
        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw_body = self.rfile.read(length) if length else b''
        except Exception:  # noqa: BLE001
            raw_body = b''
        if not self._is_api():
            return self._json(404, {'ok': False, 'error': 'Not found'})
        cfg = _gh_config()
        if not cfg['token'] or not cfg['repo']:
            return self._json(503, {'ok': False, 'error': "GITHUB_TOKEN/GITHUB_REPO not set; falling back to localStorage."})
        secret = os.environ.get('DEV_PANEL_SAVE_SECRET')
        if secret and self.headers.get('x-dev-panel-secret') != secret:
            return self._json(401, {'ok': False, 'error': 'Unauthorized'})
        try:
            body = json.loads(raw_body.decode('utf-8') or '{}')
        except Exception as e:  # noqa: BLE001
            return self._json(400, {'ok': False, 'error': f'Bad JSON body: {e}'})
        try:
            settings = body.get('settings')
            if settings is None:
                return self._json(400, {'ok': False, 'error': 'Missing settings'})
            content = base64.b64encode(
                (json.dumps(settings, indent=2) + '\n').encode('utf-8')).decode('ascii')
            code, resp = _gh_put_file(cfg, cfg['settings_path'], content,
                                      'Update dev-panel-settings.json via dev panel')
            if code not in (200, 201):
                return self._json(502, {'ok': False, 'error': f'Settings write failed: {resp.get("message")}'})
            return self._json(200, {'ok': True, 'written': [cfg['settings_path']]})
        except Exception as e:  # noqa: BLE001
            return self._json(500, {'ok': False, 'error': str(e)})

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith(('4', '5')):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    url = f'http://localhost:{PORT}/index.html'
    try:
        httpd = http.server.ThreadingHTTPServer(('', PORT), Handler)
    except OSError:
        print(f'Port {PORT} is already in use. Pass another port: python scripts/active/serve.py <port> --open')
        sys.exit(1)
    with httpd:
        print(f'SPOTTY EXPOTTY: {url}   (serving {ROOT})')
        print('Keep this window open. Ctrl+C stops it.')
        if OPEN_BROWSER:
            import webbrowser
            webbrowser.open(url)
        httpd.serve_forever()
