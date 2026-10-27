"""PokéSift development service; public deployments require an HTTPS reverse proxy."""
import base64
from pikaqian import PikaQian, ProviderError
from pokemon_art import ArtworkCache
import io
from http.cookies import SimpleCookie, CookieError
from auth import mint_token, verify_token, LIFETIMES
import hashlib
import hmac
import time
from collections import deque, OrderedDict
import datetime
import math
import json
import os
import re
from pathlib import Path
import ssl
import threading
from urllib.parse import urlsplit, parse_qs
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent / 'dist'
API = 'https://api.tcgapi.dev/v1/identify?game=pokemon&include=prices'
MAX_IMAGE = 8 * 1024 * 1024
MAX_RESPONSE = 2 * 1024 * 1024


def forward(key, data, mime):
    request = urllib.request.Request(API, data=data, headers={'X-API-Key': key, 'Content-Type': mime,
        'Accept': 'application/json',
        'User-Agent': 'PokeSift/0.1 (+https://github.com/Waldo000000/pokesift)'}, method='POST')
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


def fetch_card_image(product_id):
    # Fixed CDN and numeric product ID only: never proxy arbitrary URLs or keys.
    if not re.fullmatch(r'[1-9][0-9]{0,9}', product_id):
        raise ValueError('Invalid product ID')
    request = urllib.request.Request(
        f'https://product-images.tcgplayer.com/fit-in/600x600/{product_id}.jpg',
        headers={'User-Agent': 'PokeSift/0.1', 'Accept': 'image/jpeg,image/png,image/webp'})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))))
    with opener.open(request, timeout=15) as response:
        mime = response.headers.get_content_type()
        if mime not in ('image/jpeg', 'image/png', 'image/webp'):
            raise ValueError('Unsupported image')
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError('Image too large')
        return body, mime


def fetch_exchange_rates():
    request = urllib.request.Request('https://api.frankfurter.dev/v1/latest?base=AUD',
        headers={'Accept': 'application/json', 'User-Agent': 'PokeSift/0.1'})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))))
    with opener.open(request, timeout=12) as response:
        body = response.read(65537)
        if len(body) > 65536:
            raise ValueError('Rates too large')
        data = json.loads(body)
    if data.get('base') != 'AUD':
        raise ValueError('Unexpected rate base')
    datetime.date.fromisoformat(data['date'])
    rates = {code: float(rate) for code, rate in data['rates'].items()
        if re.fullmatch(r'[A-Z]{3}', code) and isinstance(rate, (float, int)) and math.isfinite(rate) and rate > 0}
    if not rates:
        raise ValueError('Missing exchange rates')
    rates['AUD'] = 1.0
    return {'base': 'AUD', 'date': data['date'], 'rates': rates,
        'source': 'Frankfurter / ECB', 'source_url': 'https://frankfurter.dev/',
        'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stale': False}


class Handler(BaseHTTPRequestHandler):
    # Do not log URLs, request headers, keys, images, or provider responses.
    def log_message(self, *args):
        pass

    def send(self, status, body, mime='application/json', cookie=None, cache='no-store'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()')
        ancestors = "'self'" if urlsplit(self.path).path == '/collection-room.html' else "'none'"
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors " + ancestors)
        if cookie:
            self.send_header('Set-Cookie', cookie)
        if self.server.public_origin:
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
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

    def configured(self):
        key, password = self.server.api_key, self.server.app_password
        if not key or len(password) < 16 or key == password:
            self.error(503, 'App access has not been configured. Contact the app owner.')
            return False
        return True

    def cookie_name(self):
        return '__Host-pokesift' if self.server.public_origin else 'pokesift'

    def session_cookie(self, token='', clear=False):
        secure = '; Secure' if self.server.public_origin else ''
        return f'{self.cookie_name()}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else LIFETIMES["session"]}{secure}'

    def authorize(self):
        if not self.configured():
            return False
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            token = cookies[self.cookie_name()].value
        except (KeyError, CookieError):
            token = ''
        claims = verify_token(token, self.server.app_password, 'session', self.expected_origin())
        if not claims:
            self.error(401, 'Pair this device using a fresh invite QR.')
            return False
        self.device_id = claims['id']
        return True

    def read_auth_json(self):
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError()
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 4096:
            raise ValueError()
        return json.loads(self.rfile.read(length))

    def pairing(self):
        if not self.configured():
            return
        with self.server.auth_lock:
            now = time.monotonic()
            while self.server.auth_attempts and now - self.server.auth_attempts[0] > 60:
                self.server.auth_attempts.popleft()
            if len(self.server.auth_attempts) >= 30:
                return self.error(429, 'Too many pairing attempts. Wait a minute and try again.')
            self.server.auth_attempts.append(now)
        try:
            data = self.read_auth_json()
            claims = verify_token(data.get('invite'), self.server.app_password, 'invite', self.expected_origin())
        except (ValueError, AttributeError, UnicodeError):
            claims = None
        if not claims:
            return self.error(401, 'This invite is invalid or expired. Ask for a fresh QR code.')
        token = mint_token(self.server.app_password, 'session', self.expected_origin())
        self.send(200, b'{"paired":true}', cookie=self.session_cookie(token))

    def create_invite(self):
        import qrcode
        import qrcode.image.svg
        token = mint_token(self.server.app_password, 'invite', self.expected_origin())
        claims = verify_token(token, self.server.app_password, 'invite', self.expected_origin())
        url = self.expected_origin() + '/#invite=' + token
        image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=6, border=4)
        output = io.BytesIO()
        image.save(output)
        self.send(200, json.dumps({'url': url, 'expiresAt': claims['exp'],
            'qr': 'data:image/svg+xml;base64,' + base64.b64encode(output.getvalue()).decode()}).encode())

    def do_GET(self):
        if self.path == '/healthz':
            return self.send(200, b'{"status":"ok"}')
        if not self.valid_host():
            return self.error(403, 'Unrecognized host')
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/index.html': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'), '/auth.js': ('auth.js', 'text/javascript'), '/photo-store.js': ('photo-store.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
        files.update({f'/{name}': (name, mime) for name, mime in [('species-index.js','text/javascript'),('collection-views.js','text/javascript'),('collection-room.js','text/javascript'),('collection-room.css','text/css'),('collection-room.html','text/html; charset=utf-8')]})
        # Public, static design samples. These use demo data and never call providers.
        files.update({f'/concepts/{name}.html': (f'concepts/{name}.html', 'text/html; charset=utf-8') for name in ('binder', 'desk', 'zoo', 'card-study')})
        files.update({f'/concepts/{name}': (f'concepts/{name}', mime) for name, mime in [('concepts.css', 'text/css'), ('concepts.js', 'text/javascript'), ('tactile.js', 'text/javascript'), ('art.js', 'text/javascript')]})
        files.update({f'/concepts/card-study.{ext}': (f'concepts/card-study.{ext}', mime) for ext, mime in [('css', 'text/css'), ('js', 'text/javascript')]})
        if self.path in files:
            name, mime = files[self.path]
            return self.send(200, (ROOT / name).read_bytes(), mime)
        if not self.authorize():
            return
        if self.path == '/api/session':
            return self.send(200, b'{"authenticated":true}')
        target = urlsplit(self.path)
        if target.path == '/api/pokemon-art':
            query = parse_qs(target.query)
            if set(query) != {'id'} or len(query['id']) != 1:
                return self.error(400, 'Invalid species ID')
            try:
                body = self.server.pokemon_art.get(query['id'][0])
            except ValueError:
                return self.error(400, 'Invalid species ID')
            except Exception:
                return self.error(502, 'Pokémon artwork temporarily unavailable')
            return self.send(200, body, 'image/png', cache='private, max-age=604800')
        if target.path == '/api/exchange-rates':
            with self.server.fx_lock:
                if self.server.fx_cache and time.monotonic() - self.server.fx_cached_at < 6 * 3600:
                    return self.send(200, json.dumps(self.server.fx_cache).encode())
                try:
                    rates = self.server.exchange_rates()
                    self.server.fx_cache = rates
                    self.server.fx_cached_at = time.monotonic()
                except Exception:
                    if self.server.fx_cache:
                        return self.send(200, json.dumps({**self.server.fx_cache, 'stale': True}).encode())
                    return self.error(503, 'AUD exchange rates are temporarily unavailable')
                return self.send(200, json.dumps(rates).encode())
        if target.path == '/api/pikaqian-image':
            query = parse_qs(target.query)
            if set(query) != {'id'} or len(query['id']) != 1:
                return self.error(400, 'Invalid card ID')
            try:
                body, mime = self.server.pikaqian.image(query['id'][0])
            except ValueError:
                return self.error(400, 'Invalid card ID')
            except Exception:
                return self.error(502, 'Catalog image unavailable')
            return self.send(200, body, mime)
        if target.path == '/api/card-image':
            query = parse_qs(target.query)
            product_id = query.get('id', [''])[0]
            if set(query) != {'id'} or len(query['id']) != 1 or not re.fullmatch(r'[1-9][0-9]{0,9}', product_id):
                return self.error(400, 'Invalid product ID')
            try:
                body, mime = self.server.card_image(product_id)
            except Exception:
                return self.error(502, 'Catalog image unavailable')
            return self.send(200, body, mime)
        self.error(404, 'Not found')

    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin') != self.expected_origin():
            return self.error(403, 'Same-origin requests required')
        if self.path == '/api/pair':
            return self.pairing()
        if not self.authorize():
            return
        if self.path == '/api/invites':
            return self.create_invite()
        if self.path == '/api/logout':
            return self.send(200, b'{"signedOut":true}', cookie=self.session_cookie(clear=True))
        if self.path == '/api/pikaqian-prices':
            try:
                data = self.read_auth_json()
                result = self.server.pikaqian.prices(data.get('cardId'))
            except (ValueError, AttributeError, UnicodeError):
                return self.error(400, 'A valid saved card ID is required.')
            except ProviderError as error:
                messages = {'tier_required': (403, 'PikaQian pricing requires Hobby or above.'),
                    'rate_limited': (429, 'PikaQian request limit reached. Try again later.'),
                    'auth_required': (503, 'PikaQian rejected the saved API key. Contact the app owner.'),
                    'not_configured': (503, 'PikaQian access is not configured.'),
                    'circuit_open': (503, 'PikaQian requests paused after errors. Try again in five minutes.')}
                status, message = messages.get(error.code, (502, 'PikaQian price lookup failed. No retry was made.'))
                return self.send(status, json.dumps({'error': {'code': error.code, 'message': message}}).encode())
            except Exception:
                return self.send(502, b'{"error":{"code":"unavailable","message":"PikaQian price lookup failed. No retry was made."}}')
            return self.send(200, json.dumps(result).encode())
        if self.path == '/api/enrich':
            try:
                data = self.read_auth_json()
                result = self.server.pikaqian.enrich(data.get('read'))
            except (ValueError, AttributeError, UnicodeError):
                return self.error(400, 'A Pokémon name and collector number are needed for catalog lookup.')
            except ProviderError as error:
                message = {'not_configured': 'Chinese catalog access is not configured.',
                    'rate_limited': 'Chinese catalog lookup limit reached. Try again later.',
                    'auth_required': 'PikaQian rejected the saved API key. Contact the app owner.',
                    'tier_required': 'PikaQian access requires a higher plan.',
                    'circuit_open': 'PikaQian requests paused after errors. Try again in five minutes.'}.get(error.code,
                    'Chinese catalog is temporarily unavailable. Your scan is saved.')
                return self.send(503, json.dumps({'error': {'code': error.code, 'message': message}}).encode())
            except Exception:
                return self.error(502, 'Chinese catalog is temporarily unavailable. Your scan is saved.')
            return self.send(200, json.dumps(result).encode())
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
        key = self.server.api_key
        self.connection.settimeout(15)
        try:
            photo = self.rfile.read(length)
            if len(photo) != length:
                return self.error(400, 'Incomplete image')
            valid = (mime == 'image/jpeg' and photo.startswith(b'\xff\xd8\xff')) or (mime == 'image/png' and photo.startswith(b'\x89PNG\r\n\x1a\n')) or (mime == 'image/webp' and photo.startswith(b'RIFF') and photo[8:12] == b'WEBP')
            if not valid:
                return self.error(400, 'Image contents do not match its format')
            # Paired devices may scan continuously. Only short bursts are limited;
            # failures still count and no upstream request is automatically retried.
            with self.server.scan_lock:
                now = time.monotonic()
                for device in list(self.server.scan_times):
                    times = self.server.scan_times[device]
                    while times and now - times[0] >= 1:
                        times.popleft()
                    if not times:
                        del self.server.scan_times[device]
                times = self.server.scan_times.setdefault(self.device_id, deque())
                if len(times) >= 2:
                    return self.error(429, 'Scanning too quickly. Allow a second between batches. This photo was not sent to the provider.')
                times.append(now)
                while len(self.server.scan_times) > 1024:
                    self.server.scan_times.popitem(last=False)
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
                return self.error(502, f'Provider returned a non-JSON response (HTTP {status}). A scan may have been used. No retry was made.')
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
    server.pokemon_art = ArtworkCache()
    server.card_image = fetch_card_image
    server.exchange_rates = fetch_exchange_rates
    server.fx_cache = None
    server.fx_cached_at = 0
    server.fx_lock = threading.Lock()
    server.pikaqian = PikaQian(os.environ.get('PIKAQIAN_API_KEY', '').strip())
    server.api_key = os.environ.get('TCGAPI_KEY', '').strip()
    server.app_password = os.environ.get('POKESIFT_PASSWORD', '')
    server.auth_lock = threading.Lock()
    server.auth_attempts = deque()
    server.scan_times = OrderedDict()
    server.scan_lock = threading.Lock()
    return server


if __name__ == '__main__':
    origin = os.environ.get('PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL', '')
    bind = '0.0.0.0' if origin else '127.0.0.1'
    with make_server(int(os.environ.get('PORT', '8000')), public_origin=origin, bind=bind) as server:
        print('PokéSift server started; request logging disabled.', flush=True)
        server.serve_forever()
