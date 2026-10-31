"""Bounded, server-only Simplified Chinese catalog enrichment; never submits photos."""
import datetime
import json
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from urllib.parse import urlencode, urlsplit

ID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
MAX_BODY = 2 * 1024 * 1024


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, key=None):
    headers = {'User-Agent': 'PokeSift/0.1', 'Accept': 'application/json' if key else 'image/png,image/jpeg,image/webp'}
    if key:
        headers['X-API-Key'] = key
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))))
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ProviderError('unavailable')
        return response.status, body, response.headers.get_content_type()


def clean_read(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid card details')
    result = {}
    for field in ('game', 'name', 'number', 'set', 'language', 'finish', 'stamp', 'kind'):
        item = value.get(field)
        if item is not None and (not isinstance(item, str) or len(item) > 150):
            raise ValueError('Invalid card details')
        result[field] = (item or '').strip()
    if not result['name'] or not re.fullmatch(r'\d{1,4}(?:/\d{1,4})?', result['number']):
        raise ValueError('A card name and collector number are needed')
    if result['game'] not in ('', 'pokemon'):
        raise ValueError('Only Pokémon cards are supported')
    return result


def compatible_finish(read, variant):
    finish = read['finish'].lower().replace('_', '-')
    stamp = read['stamp'].lower().strip()
    variant = (variant or '').lower()
    if '-stamp' in variant:
        mascot = variant.removeprefix('reverse-').removesuffix('-stamp')
        if not stamp or mascot not in stamp:
            return False
    elif stamp and stamp not in ('none', 'no stamp'):
        return False
    if finish in ('non-holo', 'normal'):
        return variant == 'non-holo' or (variant.endswith('-stamp') and not variant.startswith('reverse-'))
    if finish in ('reverse', 'reverse-holo', 'reverse-holofoil'):
        return variant == 'reverse' or variant.startswith('reverse-')
    return finish in ('holo', 'holofoil') and variant == 'holo'


def normalized_card(card, price_record, pricing_status, set_info):
    prices = []
    # Only raw quotes can value an ungraded capture. Never substitute a graded price.
    raw = (price_record or {}).get('grades', {}).get('raw')
    cents = raw.get('price_cents') if isinstance(raw, dict) else None
    if type(cents) is int and cents > 0:
        prices.append({'printing': card.get('variant') or 'Printing unspecified', 'market_price': cents / 100,
            'original_price_cents': cents, 'original_price_unit': 'USD cents', 'currency': 'USD',
            'provider_currency': 'USD', 'currency_assumed': False, 'currency_source': 'provider',
            'source': 'PikaQian', 'source_url': 'https://pikaqian.com/cards/' + card['id'],
            'last_updated_at': price_record.get('updated_at'), 'recent_sale_count': price_record.get('recent_sale_count'), 'marketplace': raw.get('source')})
    if pricing_status == 'available' and not prices:
        pricing_status = 'no_sales'
    return {'name': card.get('name') or card.get('local_name'), 'local_name': card.get('local_name'),
        'number': card.get('card_number'), 'set': {'id': card.get('card_set_id'), 'name': set_info.get('name') or card.get('card_set_id')},
        'rarity': card.get('rarity_label') or card.get('rarity'), 'suggested_printing': card.get('variant'),
        'language': 'zh-CN', 'provider': 'pikaqian', 'provider_id': card['id'],
        'source_url': 'https://pikaqian.com/cards/' + card['id'], 'prices': prices, 'pricing_status': pricing_status}


class PikaQian:
    def __init__(self, key='', transport=request):
        self.key = key
        self.transport = transport
        self.cache = {}
        self.lock = threading.RLock()
        self.attempts = deque()
        self.hourly_limit = 60
        self.pricing_disabled_until = 0
        self.failures = 0
        self.blocked_until = 0
        self.blocked_code = 'circuit_open'

    def get(self, path):
        if not self.key:
            raise ProviderError('not_configured')
        # Serialize cache misses to avoid consuming quota for concurrent duplicates.
        with self.lock:
            now = time.monotonic()
            cached = self.cache.get(path)
            if cached and now - cached[0] < 300:
                if isinstance(cached[1], ProviderError):
                    raise cached[1]
                return cached[1]
            if now < self.blocked_until:
                raise ProviderError(self.blocked_code)
            if path.endswith('/prices') and now < self.pricing_disabled_until:
                raise ProviderError('tier_required')
            while self.attempts and now - self.attempts[0] >= 3600:
                self.attempts.popleft()
            if self.hourly_limit is not None and len(self.attempts) >= self.hourly_limit:
                raise ProviderError('rate_limited')
            self.attempts.append(now)
            try:
                status, body, mime = self.transport('https://api.pikaqian.com/v1/' + path, self.key)
                data = {} if status in (401, 403, 429) else json.loads(body)
            except ProviderError:
                raise
            except Exception:
                self.record_failure(now)
                raise ProviderError('unavailable') from None
            if status != 200:
                code = data.get('error', {}).get('code') if isinstance(data, dict) else ''
                if code == 'price_not_found' and status == 404:
                    self.failures = 0
                    self.cache[path] = (now, ProviderError('price_not_found'))
                    if len(self.cache) > 250:
                        self.cache.pop(next(iter(self.cache)))
                    raise ProviderError('price_not_found')
                if status == 401:
                    self.blocked_until, self.blocked_code = now + 300, 'auth_required'
                    raise ProviderError('auth_required')
                if status == 429 or code == 'rate_limited':
                    self.blocked_until, self.blocked_code = now + 300, 'rate_limited'
                    raise ProviderError('rate_limited')
                if status == 403:
                    self.pricing_disabled_until = now + 60
                    raise ProviderError('tier_required')
                self.record_failure(now)
                raise ProviderError('unavailable')
            if not isinstance(data, dict):
                self.record_failure(now)
                raise ProviderError('unavailable')
            self.failures = 0
            def redact(v):
                if isinstance(v, str): return v.replace(self.key, '[REDACTED]')
                if isinstance(v, list): return [redact(x) for x in v]
                if isinstance(v, dict): return {redact(k): redact(x) for k, x in v.items()}
                return v
            data = redact(data)
            if len(self.cache) >= 250:
                self.cache.pop(next(iter(self.cache)))
            self.cache[path] = (now, data)
            return data

    def record_failure(self, now):
        self.failures += 1
        if self.failures >= 3:
            self.blocked_until, self.blocked_code = now + 300, 'circuit_open'

    def prices(self, card_id):
        if not isinstance(card_id, str) or not ID.fullmatch(card_id):
            raise ValueError('Invalid card ID')
        status = 'available'
        try:
            record = self.get('cards/' + card_id + '/prices')
        except ProviderError as error:
            if error.code != 'price_not_found':
                raise
            record, status = None, 'no_sales'
        # Malformed responses count as errors, not as healthy missing prices.
        if record is not None:
            raw = record.get('grades', {}).get('raw') if isinstance(record.get('grades'), dict) else None
            if not isinstance(raw, dict) or 'price_cents' not in raw or (raw['price_cents'] is not None and (type(raw['price_cents']) is not int or raw['price_cents'] < 0)):
                with self.lock:
                    self.cache.pop('cards/' + card_id + '/prices', None)
                    self.blocked_until, self.blocked_code = time.monotonic() + 300, 'circuit_open'
                raise ProviderError('circuit_open')
        card = normalized_card({'id': card_id}, record, status, {})
        checked = datetime.datetime.now(datetime.timezone.utc).isoformat()
        return {'provider': 'pikaqian', 'cardId': card_id, 'pricingStatus': card['pricing_status'],
            'prices': card['prices'], 'checkedAt': checked,
            'observation': {'provider': 'pikaqian', 'operation': 'price_lookup', 'receivedAt': checked,
                'snapshotKind': 'provider_response', 'response': {'cardId': card_id, 'prices': record},
                'pricingStatus': card['pricing_status']}}

    def enrich(self, read):
        read = clean_read(read)
        if read['kind'] not in ('', 'raw'):
            return {'provider': 'pikaqian', 'status': 'not_found', 'candidates': [], 'incomplete': False}
        number = int(read['number'].split('/')[0])
        listing = self.get('cards?' + urlencode({'name_contains': read['name'], 'page_size': 100}))
        # Limit pagination and candidate detail work. An incomplete search never auto-matches.
        rows = listing.get('data', [])
        incomplete = bool(listing.get('pagination', {}).get('next_cursor'))
        candidates = [c for c in rows if isinstance(c, dict) and ID.fullmatch(str(c.get('id', '')))
            and (c.get('name') or '').casefold() == read['name'].casefold()
            and str(c.get('card_number', '')).isdigit() and int(c['card_number']) == number]
        exact = [c for c in candidates if str(c.get('card_set_id', '')).casefold() == read['set'].casefold()]
        if exact:
            candidates = exact
        output = []
        pricing_error = None
        for brief in candidates[:3]:
            card = self.get('cards/' + brief['id'])
            if (card.get('id') != brief['id'] or card.get('language') != 'zh-CN'
                    or (card.get('name') or '').casefold() != read['name'].casefold()
                    or str(card.get('card_number', '')).lstrip('0') != str(number)):
                continue
            set_id = card.get('card_set_id', '')
            if not re.fullmatch(r'[a-z0-9.-]{1,40}', set_id):
                continue
            set_info = self.get('sets/' + set_id)
            price_record = card.get('prices')
            pricing_status = 'available'
            if price_record is None:
                if time.monotonic() < self.pricing_disabled_until:
                    pricing_status = 'plan_required'
                    pricing_error = 'tier_required'
                else:
                    try:
                        price_record = self.get('cards/' + card['id'] + '/prices')
                    except ProviderError as error:
                        pricing_status = {'tier_required': 'plan_required', 'price_not_found': 'no_sales'}.get(error.code, 'unavailable')
                        if error.code != 'price_not_found':
                            pricing_error = error.code
                        if error.code == 'tier_required':
                            self.pricing_disabled_until = time.monotonic() + 60
            printed = set_info.get('card_count', {}).get('printed')
            denominator = read['number'].split('/')[1] if '/' in read['number'] else None
            total_agrees = denominator is None or (printed is not None and str(printed).lstrip('0') == denominator.lstrip('0'))
            exact_match = bool(exact) and total_agrees and compatible_finish(read, card.get('variant')) and not incomplete
            output.append({'card': normalized_card(card, price_record, pricing_status, set_info),
                'exact': exact_match, 'observation': {'provider': 'pikaqian', 'operation': 'catalog_lookup',
                    'receivedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'snapshotKind': 'provider_response',
                    'response': {'card': card, 'prices': price_record, 'set': set_info}, 'pricingStatus': pricing_status}})
            if pricing_error in ('auth_required', 'rate_limited', 'circuit_open', 'unavailable'):
                incomplete = incomplete or len(output) < len(candidates)
                if incomplete:
                    for candidate in output:
                        candidate['exact'] = False
                break
        matches = [c for c in output if c['exact']]
        # A free-tier partial catalog must not resolve unknown finishes or stamps implicitly.
        return {'provider': 'pikaqian', 'status': 'matched' if len(matches) == 1 and len(candidates) <= 3 else 'review' if output else 'not_found',
            'candidates': matches if len(matches) == 1 and len(candidates) <= 3 else output, 'incomplete': incomplete or len(candidates) > 3,
            'pricingError': pricing_error}

    def image(self, card_id):
        if not ID.fullmatch(card_id):
            raise ValueError('Invalid card ID')
        card = self.get('cards/' + card_id)
        url = card.get('image_url', '')
        target = urlsplit(url)
        if target.scheme != 'https' or target.netloc != 'images.pikaqian.com' or target.query or target.fragment or not re.fullmatch(r'/originals/[a-z0-9.-]+/' + re.escape(card_id) + r'\.(png|jpg|jpeg|webp)', target.path):
            raise ProviderError('image_unavailable')
        status, body, mime = self.transport(url)
        if status != 200 or mime not in ('image/png', 'image/jpeg', 'image/webp') or len(body) > MAX_BODY:
            raise ProviderError('image_unavailable')
        return body, mime
