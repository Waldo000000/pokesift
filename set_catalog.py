"""Read-only English physical-card catalog. No scan or pricing credentials.

The reviewed taxonomy ships with the app; card lists are fetched on demand.
Only catalog-supplied artwork on TCGdex's asset host can be requested.
"""
from collections import OrderedDict
import json
import os
from pathlib import Path
import re
import ssl
import threading
import time
import urllib.request

DATA = Path(__file__).parent / 'data'
INDEX = json.loads((DATA / 'set-catalog-en.json').read_text())
SEEDS = json.loads((DATA / 'set-cards-en.json').read_text())
SETS = {s['id']: s for s in INDEX['sets']}
MAX_JSON = 3 * 1024 * 1024
MAX_IMAGE = 2 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_public(url, limit):
    # URLs are built exclusively by the validated catalog methods below.
    context = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    request = urllib.request.Request(url, headers={'User-Agent': 'PokeSift/1.0 (set catalog)'})
    with opener.open(request, timeout=12) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Catalog response too large')
    return data


def image_base(value):
    return value if isinstance(value, str) and re.fullmatch(
        r'https://assets\.tcgdex\.net/en/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+', value
    ) and all(part not in ('.', '..') for part in value.split('/')[4:]) else None


class Catalog:
    def __init__(self, fetch=fetch_public):
        self.fetch = fetch
        self.items = OrderedDict()
        self.failures = OrderedDict()
        self.lock = threading.RLock()
        self.image_lock = threading.Lock()
        self.images = OrderedDict()
        self.image_bytes = 0
        self.image_slots = threading.BoundedSemaphore(3)

    @staticmethod
    def validate_set(set_id):
        if not isinstance(set_id, str) or set_id not in SETS:
            raise ValueError('Unknown set')

    def _cached(self, key, fetch, fallback=None):
        with self.lock:
            old = self.items.get(key)
            if old and time.monotonic() - old[0] < 86400:
                self.items.move_to_end(key)
                return old[1]
            if self.failures.get(key, 0) > time.monotonic():
                if old or fallback:
                    return (old[1] if old else fallback) | {'stale': True}
                raise RuntimeError('Catalog temporarily unavailable')
            try:
                value = fetch()
            except Exception:
                self.failures[key] = time.monotonic() + 60
                while len(self.failures) > 128:
                    self.failures.popitem(last=False)
                if old or fallback:
                    return (old[1] if old else fallback) | {'stale': True}
                raise
            self.items[key] = (time.monotonic(), value)
            self.items.move_to_end(key)
            while len(self.items) > 64:
                self.items.popitem(last=False)
            return value

    def cards(self, set_id):
        self.validate_set(set_id)
        metadata = SETS[set_id]
        source_set_id = metadata['parentId'] if metadata.get('embeddedNumberPrefix') else set_id

        def read(value):
            if not isinstance(value, dict) or value.get('id') != set_id or not isinstance(value.get('cards'), list) or len(value['cards']) > 3000:
                raise ValueError('Invalid catalog set')
            cards, seen = [], set()
            for c in value['cards']:
                if not isinstance(c, dict):
                    raise ValueError('Invalid catalog card')
                cid = c.get('id', '')
                if not isinstance(cid, str) or not re.fullmatch(re.escape(source_set_id) + r'-[A-Za-z0-9._-]{1,40}', cid) or cid in seen:
                    raise ValueError('Invalid catalog identity')
                seen.add(cid)
                cards.append({'id': cid, 'localId': str(c.get('localId', ''))[:40],
                    'name': str(c.get('name', ''))[:180], 'hasImage': bool(image_base(c.get('image'))),
                    'image': image_base(c.get('image'))})
            return {**SETS[set_id], 'language': 'en', 'cards': cards}

        # Reviewed lists are immediately available without a network roundtrip.
        if metadata.get('embeddedNumberPrefix'):
            parent = self.cards(source_set_id)
            return read({'id': set_id, 'cards': [c for c in parent['cards']
                if c['localId'].startswith(metadata['embeddedNumberPrefix'])]})
        if set_id in SEEDS:
            return read(SEEDS[set_id])
        return self._cached(('set', set_id), lambda: read(json.loads(self.fetch(
            'https://api.tcgdex.net/v2/en/sets/' + set_id, MAX_JSON))))

    def card(self, set_id, card_id):
        members = {c['id']: c for c in self.cards(set_id)['cards']}
        if not isinstance(card_id, str) or card_id not in members:
            raise ValueError('Card is not in this set')
        brief = members[card_id]

        def read():
            value = json.loads(self.fetch('https://api.tcgdex.net/v2/en/cards/' + card_id, MAX_JSON))
            source_set_id = SETS[set_id]['parentId'] if SETS[set_id].get('embeddedNumberPrefix') else set_id
            if not isinstance(value, dict) or value.get('id') != card_id or value.get('set', {}).get('id') != source_set_id:
                raise ValueError('Invalid catalog identity')
            result = {**brief, 'set': SETS[set_id], 'language': 'en', 'source': 'TCGdex'}
            for field in ('category', 'rarity', 'hp', 'stage', 'description', 'effect', 'illustrator', 'types', 'variants', 'abilities', 'attacks'):
                if field in value:
                    result[field] = value[field]
            return result

        return self._cached(('card', card_id), read,
            {**brief, 'set': SETS[set_id], 'language': 'en', 'source': 'TCGdex'})

    def artwork(self, set_id, card_id, quality='low'):
        if quality not in ('low', 'high'):
            raise ValueError('Invalid artwork quality')
        members = {c['id']: c for c in self.cards(set_id)['cards']}
        if not isinstance(card_id, str) or card_id not in members:
            raise ValueError('Card is not in this set')
        base = members[card_id]['image']
        if not base:
            raise LookupError('Catalog artwork not supplied')
        key = (card_id, quality)
        with self.image_lock:
            if key in self.images:
                self.images.move_to_end(key)
                return self.images[key]
            if self.failures.get(key, 0) > time.monotonic():
                raise RuntimeError('Artwork temporarily unavailable')
        if not self.image_slots.acquire(timeout=2):
            raise RuntimeError('Artwork busy')
        try:
            try:
                data = self.fetch(base + '/' + quality + '.webp', MAX_IMAGE)
                if len(data) > MAX_IMAGE or not (data[:4] == b'RIFF' and data[8:12] == b'WEBP'):
                    raise ValueError('Invalid artwork')
            except Exception:
                with self.lock:
                    self.failures[key] = time.monotonic() + 60
                    while len(self.failures) > 128:
                        self.failures.popitem(last=False)
                raise
            with self.image_lock:
                previous = self.images.pop(key, b'')
                self.images[key] = data
                self.image_bytes += len(data) - len(previous)
                while len(self.images) > 96 or self.image_bytes > 24 * 1024 * 1024:
                    self.image_bytes -= len(self.images.popitem(last=False)[1])
            return data
        finally:
            self.image_slots.release()
