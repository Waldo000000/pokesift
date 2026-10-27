"""Bounded cache for public Pokémon artwork. No identification or pricing API."""
from collections import OrderedDict
import os, re, ssl, threading, time, urllib.request
MAX_BYTES = 2 * 1024 * 1024

def fetch_artwork(species_id):
    if not re.fullmatch(r'[1-9][0-9]{0,3}', str(species_id)) or not 1 <= int(species_id) <= 1025:
        raise ValueError('Invalid species ID')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))))
    request = urllib.request.Request(f'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{species_id}.png', headers={'User-Agent':'PokeSift/0.1','Accept':'image/png'})
    with opener.open(request, timeout=12) as response:
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Invalid artwork')
        return data

class ArtworkCache:
    def __init__(self, fetch=fetch_artwork):
        self.fetch = fetch
        self.items = OrderedDict()
        self.lock = threading.Lock()
        self.failed_until = 0
    def get(self, species_id):
        if not isinstance(species_id, str) or not re.fullmatch(r'[1-9][0-9]{0,3}', species_id) or not 1 <= int(species_id) <= 1025: raise ValueError('Invalid species ID')
        with self.lock:
            if species_id in self.items:
                self.items.move_to_end(species_id)
                return self.items[species_id]
            if time.monotonic() < self.failed_until: raise RuntimeError('Artwork temporarily unavailable')
            try: data = self.fetch(species_id)
            except Exception:
                self.failed_until = time.monotonic() + 30
                raise
            self.items[species_id] = data
            while len(self.items) > 48: self.items.popitem(last=False)
            return data
