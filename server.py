"""PokéSift development service; public deployments require an HTTPS reverse proxy."""
import json
import os
from pathlib import Path
import ssl
import threading
from urllib.parse import urlsplit
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent / 'dist'
API = 'https://api.tcgapi.dev/v1/identify?game=pokemon&include=prices'
MAX_IMAGE = 8 * 1024 * 1024
MAX_RESPONSE = 2 * 1024 * 1024


def forward(key, data, mime):
    request = urllib.request.Request(API, data=data, headers={'X-API-Key': key, 'Content-Type': mime}, method='POST')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    ca = os.environ.get('SSL_CERT_FILE')
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca)))
    try:
        response = opener.open(request, timeout=50)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError('Response too large')
        return response.status, body


class Handler(BaseHTTPRequestHandler):
    # Do not log URLs, request headers, keys, images, or provider responses.
    def log_message(self, *args):
        pass

    def send(self, status, body, mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, message):
        self.send(status, json.dumps({'error': {'message': message}}).encode())

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def valid_host(self):
        if self.server.public_origin:
            return self.headers.get('Host') == urlsplit(self.server.public_origin).netloc
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def expected_origin(self):
        return self.server.public_origin or 'http://' + self.headers.get('Host', '')

    def do_GET(self):
        if self.path == '/healthz':
            return self.send(200, b'{"status":"ok"}')
        if not self.valid_host():
            return self.error(403, 'Unrecognized host')
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/index.html': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
        if self.path not in files:
            return self.error(404, 'Not found')
        name, mime = files[self.path]
        self.send(200, (ROOT / name).read_bytes(), mime)

    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin') != self.expected_origin():
            return self.error(403, 'Same-origin requests required')
        if self.path != '/api/identify':
            return self.error(404, 'Not found')
        if self.headers.get('Transfer-Encoding'):
            return self.error(400, 'Content-Length required')
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.error(400, 'Invalid image length')
        if not 0 < length <= MAX_IMAGE:
            return self.error(413, 'Choose an image up to 8 MB')
        mime = self.headers.get('Content-Type', '')
        if mime not in ('image/jpeg', 'image/png', 'image/webp'):
            return self.error(415, 'Choose JPEG, PNG or WebP')
        key = self.headers.get('X-API-Key', '').strip()
        if not key or len(key) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in key):
            return self.error(400, 'Enter a valid API key')
        self.connection.settimeout(15)
        try:
            photo = self.rfile.read(length)
            if len(photo) != length:
                return self.error(400, 'Incomplete image')
            valid = (mime == 'image/jpeg' and photo.startswith(b'\xff\xd8\xff')) or (mime == 'image/png' and photo.startswith(b'\x89PNG\r\n\x1a\n')) or (mime == 'image/webp' and photo.startswith(b'RIFF') and photo[8:12] == b'WEBP')
            if not valid:
                return self.error(400, 'Image contents do not match its format')
            status, body = self.server.forward(key, photo, mime)
            # Parse before redaction so JSON-escaped key echoes are removed too.
            try:
                parsed = json.loads(body)
                def redact(value):
                    if isinstance(value, str):
                        return value.replace(key, '[REDACTED]')
                    if isinstance(value, list):
                        return [redact(v) for v in value]
                    if isinstance(value, dict):
                        return {redact(k): redact(v) for k, v in value.items()}
                    return value
                body = json.dumps(redact(parsed)).encode()
            except (ValueError, UnicodeError):
                return self.error(502, 'Provider returned an unreadable response. A scan may have been used. No retry was made.')
            if 300 <= status < 400:
                return self.error(502, 'Provider redirect refused. No retry was made.')
            self.send(status, body)
        except Exception:
            self.error(502, 'Provider request failed or timed out. A scan may have been used. Check your provider dashboard before retrying. No retry was made.')


class BoundedServer(ThreadingHTTPServer):
    # Bound simultaneous uploads/provider calls on a small development instance.
    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        # Never dump exceptions containing request data to hosting logs.
        pass


def make_server(port=8000, forward_request=forward, public_origin='', bind='127.0.0.1'):
    if public_origin:
        parsed = urlsplit(public_origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('PUBLIC_ORIGIN must be an HTTPS origin without a path')
    server = BoundedServer((bind, port), Handler)
    server.public_origin = public_origin
    server.forward = forward_request
    return server


if __name__ == '__main__':
    origin = os.environ.get('PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL', '')
    bind = '0.0.0.0' if origin else '127.0.0.1'
    with make_server(int(os.environ.get('PORT', '8000')), public_origin=origin, bind=bind) as server:
        print('PokéSift server started; request logging disabled.', flush=True)
        server.serve_forever()
