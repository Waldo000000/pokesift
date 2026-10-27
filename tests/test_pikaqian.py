import copy
import json
import unittest
from unittest.mock import patch
from pikaqian import PikaQian, ProviderError, normalized_card, request

CARD_ID = 'db119de9-d875-467c-b962-4bdbdd7dc7ee'
CARD = {'id': CARD_ID, 'name': 'Delibird', 'local_name': '信使鸟', 'card_number': '011',
        'card_set_id': 'csvh5c', 'variant': 'dragonite-stamp', 'language': 'zh-CN',
        'image_url': f'https://images.pikaqian.com/originals/csvh5c/{CARD_ID}.png', 'prices': None}
READ = {'game': 'pokemon', 'name': 'Delibird', 'number': '011/058', 'set': 'csvh5c',
        'finish': 'non_holo', 'stamp': 'Dragonite silhouette', 'language': 'other', 'kind': 'raw'}
PRICES = {'updated_at': '2026-10-27T00:00:00Z', 'recent_sale_count': 2,
          'grades': {'raw': {'price_cents': 1850, 'source': 'ebay'}, 'psa10': {'price_cents': 99900, 'source': 'ebay'}}}


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.card = copy.deepcopy(CARD)
        self.prices = copy.deepcopy(PRICES)
        self.price_status = 200
        self.printed = 58
        self.listing = [copy.deepcopy(CARD)]
        self.cursor = None
        def transport(url, key=None):
            self.calls.append((url, key))
            if url.startswith('https://images.'):
                return 200, b'\x89PNG\r\n\x1a\nimage', 'image/png'
            if '/cards?' in url:
                data = {'data': self.listing, 'pagination': {'next_cursor': self.cursor}}
            elif '/sets/' in url:
                data = {'name': 'Happy Set 5', 'card_count': {'printed': self.printed}}
            elif url.endswith('/prices'):
                return self.price_status, json.dumps(self.prices).encode(), 'application/json'
            else:
                data = self.card
            return 200, json.dumps(data).encode(), 'application/json'
        self.provider = PikaQian('private-provider-key', transport)

    def test_exact_printing_and_explicit_usd_cents(self):
        result = self.provider.enrich(READ)
        self.assertEqual(result['status'], 'matched')
        card = result['candidates'][0]['card']
        self.assertEqual(card['prices'][0]['market_price'], 18.50)
        self.assertEqual(card['prices'][0]['original_price_cents'], 1850)
        self.assertEqual(card['prices'][0]['currency'], 'USD')
        self.assertFalse(card['prices'][0]['currency_assumed'])
        self.assertEqual(len(card['prices']), 1)
        self.assertEqual(result['candidates'][0]['observation']['response']['prices'], PRICES)
        calls = len(self.calls)
        self.provider.enrich(READ)
        self.assertEqual(len(self.calls), calls, 'Repeated lookup should use cache')

    def test_ocr_error_and_missing_printed_total_require_confirmation(self):
        for read in [{**READ, 'set': 'CSWhSC'}, {**READ, 'finish': ''}, {**READ, 'stamp': ''}, {**READ, 'number': '011/059'}]:
            self.assertEqual(self.provider.enrich(read)['status'], 'review')
        self.printed = None
        self.provider.cache.clear()
        self.assertEqual(self.provider.enrich(READ)['status'], 'review')

    def test_free_tier_cannot_substitute_base_for_reverse(self):
        result = self.provider.enrich({**READ, 'finish': 'reverse_holo'})
        self.assertEqual(result['status'], 'review')

    def test_plan_required_is_not_no_sales_and_rechecks_after_upgrade(self):
        self.price_status = 403
        self.prices = {'error': {'code': 'tier_required'}}
        result = self.provider.enrich(READ)
        self.assertEqual(result['candidates'][0]['card']['pricing_status'], 'plan_required')
        self.assertEqual(result['pricingError'], 'tier_required')
        self.assertEqual(result['candidates'][0]['card']['prices'], [])
        self.provider.pricing_disabled_until = 0
        self.price_status = 200
        self.prices = PRICES
        self.assertEqual(self.provider.enrich(READ)['candidates'][0]['card']['prices'][0]['market_price'], 18.5)

    def test_no_sales_never_uses_graded_price(self):
        self.prices['grades']['raw']['price_cents'] = None
        result = self.provider.enrich(READ)
        self.assertEqual(result['candidates'][0]['card']['prices'], [])
        self.assertEqual(result['candidates'][0]['card']['pricing_status'], 'no_sales')
        self.provider.cache.clear()
        self.price_status = 404
        self.prices = {'error': {'code': 'price_not_found'}}
        self.assertEqual(self.provider.enrich(READ)['candidates'][0]['card']['pricing_status'], 'no_sales')

    def test_catalog_preserves_identity_when_pricing_quota_stops_bulk(self):
        self.price_status = 429
        result = self.provider.enrich(READ)
        self.assertEqual(result['pricingError'], 'rate_limited')
        self.assertEqual(result['candidates'][0]['card']['provider_id'], CARD_ID)
        self.assertEqual(result['candidates'][0]['card']['prices'], [])

    def test_incomplete_search_and_other_printings_are_not_auto_matched(self):
        self.cursor = 'more'
        self.assertEqual(self.provider.enrich(READ)['status'], 'review')
        self.assertEqual(self.provider.enrich({**READ, 'number': '012/058'})['status'], 'not_found')
        self.assertEqual(self.provider.enrich({**READ, 'kind': 'graded'})['status'], 'not_found')

    def test_image_host_validation_and_no_key_on_cdn(self):
        self.provider.image(CARD_ID)
        self.assertIsNone(self.calls[-1][1])
        self.provider.cache.clear()
        self.card['image_url'] = 'https://evil.example/steal'
        with self.assertRaises(ProviderError):
            self.provider.image(CARD_ID)
        self.assertFalse(any('evil.example' in url for url, _ in self.calls))
        with self.assertRaises(ValueError):
            self.provider.image('../etc/passwd')

    def test_quota_and_secret_redaction(self):
        self.card['local_name'] = 'echo private-provider-key'
        self.assertNotIn('private-provider-key', json.dumps(self.provider.enrich(READ)))
        self.provider.cache.clear()
        self.provider.attempts.extend([__import__('time').monotonic()] * 60)
        with self.assertRaises(ProviderError) as error:
            self.provider.enrich(READ)
        self.assertEqual(error.exception.code, 'rate_limited')

    def test_direct_price_lookup_does_not_fetch_metadata_or_images(self):
        result = self.provider.prices(CARD_ID)
        self.assertEqual(result['prices'][0]['original_price_cents'], 1850)
        self.assertEqual(result['pricingStatus'], 'available')
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(self.calls[0][0].endswith('/cards/' + CARD_ID + '/prices'))
        self.assertEqual(result['observation']['operation'], 'price_lookup')
        self.provider.prices(CARD_ID)
        self.assertEqual(len(self.calls), 1)
        with self.assertRaises(ValueError):
            self.provider.prices('../cards')

    def test_circuit_breaker_stops_network_after_three_failures(self):
        self.price_status = 500
        self.prices = {'error': {'code': 'server_error'}}
        for _ in range(3):
            with self.assertRaises(ProviderError):
                self.provider.prices(CARD_ID)
        self.assertEqual(len(self.calls), 3)
        with self.assertRaises(ProviderError) as error:
            self.provider.prices(CARD_ID)
        self.assertEqual(error.exception.code, 'circuit_open')
        self.assertEqual(len(self.calls), 3)

    def test_plan_and_quota_denials_do_not_keep_spending(self):
        for status, code in [(403, 'tier_required'), (429, 'rate_limited'), (401, 'auth_required')]:
            self.setUp()
            self.price_status = status
            self.prices = {'error': {'code': code}}
            for _ in range(2):
                with self.assertRaises(ProviderError) as error:
                    self.provider.prices(CARD_ID)
                self.assertEqual(error.exception.code, code)
            self.assertEqual(len(self.calls), 1)

    def test_no_sales_is_cached_and_not_a_circuit_failure(self):
        self.price_status = 404
        self.prices = {'error': {'code': 'price_not_found'}}
        for _ in range(4):
            self.assertEqual(self.provider.prices(CARD_ID)['pricingStatus'], 'no_sales')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.provider.failures, 0)
        self.assertEqual(self.provider.blocked_until, 0)

    def test_malformed_prices_open_circuit_instead_of_saying_no_sales(self):
        self.prices = {'unexpected': 'schema'}
        with self.assertRaises(ProviderError) as error:
            self.provider.prices(CARD_ID)
        self.assertEqual(error.exception.code, 'circuit_open')
        with self.assertRaises(ProviderError):
            self.provider.prices(CARD_ID)
        self.assertEqual(len(self.calls), 1)

    def test_transport_refuses_redirects_and_bounds_response(self):
        from pikaqian import NoRedirect, MAX_BODY
        self.assertIsNone(NoRedirect().redirect_request(None, None, None, None, None, None))
        with patch('pikaqian.urllib.request.build_opener') as build:
            response = build.return_value.open.return_value
            response.read.return_value = b'x' * (MAX_BODY + 1)
            with self.assertRaises(ProviderError):
                request('https://api.pikaqian.com/v1/cards', 'private-key')
