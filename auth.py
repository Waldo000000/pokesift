"""Purpose-separated, origin-bound signed pairing and device tokens."""
import base64
import hashlib
import hmac
import json
import secrets
import time

LIFETIMES = {'invite': 600, 'session': 30 * 86400}


def _encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _key(password, purpose):
    return hmac.digest(password.encode('utf-8'), ('pokesift:v1:' + purpose).encode(), 'sha256')


def mint_token(password, purpose, origin, now=None):
    now = int(time.time() if now is None else now)
    claims = {'v': 1, 'type': purpose, 'aud': origin, 'iat': now,
              'exp': now + LIFETIMES[purpose], 'id': secrets.token_urlsafe(16)}
    payload = _encode(json.dumps(claims, separators=(',', ':'), sort_keys=True).encode())
    return payload + '.' + _encode(hmac.digest(_key(password, purpose), payload.encode(), 'sha256'))


def verify_token(token, password, purpose, origin, now=None):
    try:
        if not isinstance(token, str) or len(token) > 2048:
            return None
        payload, signature = token.split('.')
        expected = _encode(hmac.digest(_key(password, purpose), payload.encode('ascii'), 'sha256'))
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        now = int(time.time() if now is None else now)
        if (data.get('v') != 1 or data.get('type') != purpose or data.get('aud') != origin
                or type(data.get('iat')) is not int or type(data.get('exp')) is not int
                or data['exp'] - data['iat'] != LIFETIMES[purpose]
                or data['iat'] > now + 30 or data['exp'] <= now
                or not isinstance(data.get('id'), str) or len(data['id']) < 16):
            return None
        return data
    except (ValueError, TypeError, KeyError, UnicodeError):
        return None
