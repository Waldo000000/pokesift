import base64
import http.client
import json
import threading
import unittest
from server import make_server, forward, fetch_card_image
from auth import mint_token
from unittest.mock import patch, MagicMock

PASSWORD = 'test-app-password-1234'


PNG = b'\x89PNG\r\n\x1a\n' + b'test'


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.reply = (200, json.dumps({'data': {'status': 'matched'}, 'echo': 'test-key'}).encode())
        def forward(key, photo, mime):
            self.calls.append((key, photo, mime))
            if isinstance(self.reply, Exception):
                raise self.reply
            return self.reply
        with patch.dict('os.environ', {'TCGAPI_KEY': 'test-key', 'POKESIFT_PASSWORD': PASSWORD}):
            self.server = make_server(0, forward)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host = f'127.0.0.1:{self.server.server_port}'
        self.cookie = 'pokesift=' + mint_token(PASSWORD, 'session', 'http://' + self.host)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, body=PNG, **changes):
        headers = {'Origin': 'http://' + self.host, 'Content-Type': 'image/png', 'Cookie': self.cookie}
        headers.update(changes)
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('POST', '/api/identify', body, headers)
        response = conn.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        conn.close()
        return result

    def test_forwards_once_and_redacts_key(self):
        status, body, headers = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(self.calls, [('test-key', PNG, 'image/png')])
        self.assertNotIn(b'test-key', body)
        self.assertIn(b'[REDACTED]', body)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_anonymous_cannot_spend_scans(self):
        status, _, headers = self.request(Cookie='')
        self.assertEqual(status, 401)
        self.assertNotIn('WWW-Authenticate', headers)
        self.assertEqual(self.calls, [])

    def test_wrong_password_cannot_spend_scans(self):
        self.assertEqual(self.request(Cookie='pokesift=invalid')[0], 401)
        self.assertEqual(self.calls, [])

    def test_browser_key_cannot_override_server_secret(self):
        self.assertEqual(self.request(**{'X-API-Key': 'attacker-key'})[0], 200)
        self.assertEqual(self.calls[0][0], 'test-key')

    def test_missing_configuration_fails_closed(self):
        for key, password in [('', PASSWORD), ('test-key', ''), ('test-key', 'short'), (PASSWORD, PASSWORD)]:
            self.server.api_key, self.server.app_password = key, password
            self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.calls, [])

    def test_hourly_scan_limit(self):
        for _ in range(10):
            self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request()[0], 429)
        self.assertEqual(len(self.calls), 10)

    def test_page_requires_login_and_has_no_key_field(self):
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('GET', '/')
        r = conn.getresponse()
        self.assertEqual(r.status, 200)
        self.assertNotIn('WWW-Authenticate', dict(r.getheaders()))
        r.read()
        conn.close()
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('GET', '/', headers={'Cookie': self.cookie})
        r = conn.getresponse()
        self.assertEqual(r.status, 200)
        body = r.read()
        self.assertNotIn(b'id="key"', body)
        self.assertNotIn(b'test-key', body)
        conn.close()

    def auth_request(self, path, body, cookie='', origin=None):
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('POST', path, json.dumps(body), {'Origin': origin or 'http://' + self.host, 'Content-Type': 'application/json', 'Cookie': cookie})
        response = conn.getresponse()
        result = response.status, json.loads(response.read()), dict(response.getheaders())
        conn.close()
        return result

    def test_enrichment_requires_session_origin_and_valid_details(self):
        from unittest.mock import Mock
        self.server.pikaqian.enrich = Mock(return_value={'status': 'not_found', 'candidates': []})
        body = {'read': {'game': 'pokemon', 'name': 'Delibird', 'number': '011/058'}}
        self.assertEqual(self.auth_request('/api/enrich', body)[0], 401)
        self.assertEqual(self.auth_request('/api/enrich', body, self.cookie, 'https://evil.example')[0], 403)
        self.server.pikaqian.enrich.assert_not_called()
        self.assertEqual(self.auth_request('/api/enrich', body, self.cookie)[0], 200)
        self.server.pikaqian.enrich.assert_called_once_with(body['read'])
        self.assertEqual(self.calls, [], 'Metadata fallback must not invoke a paid scan')

    def test_enrichment_errors_never_echo_provider_secrets(self):
        from unittest.mock import Mock
        self.server.pikaqian.enrich = Mock(side_effect=RuntimeError('secret-provider-key'))
        status, body, _ = self.auth_request('/api/enrich', {'read': {}}, self.cookie)
        self.assertEqual(status, 502)
        self.assertNotIn('secret-provider-key', json.dumps(body))

    def test_enrichment_exposes_safe_codes_for_bulk_stop(self):
        from unittest.mock import Mock
        from pikaqian import ProviderError
        for code in ('not_configured', 'auth_required', 'rate_limited', 'circuit_open'):
            self.server.pikaqian.enrich = Mock(side_effect=ProviderError(code))
            status, body, _ = self.auth_request('/api/enrich', {'read': {}}, self.cookie)
            self.assertEqual(status, 503)
            self.assertEqual(body['error']['code'], code)

    def test_price_refresh_is_authenticated_and_reports_stop_codes(self):
        from unittest.mock import Mock
        from pikaqian import ProviderError
        body = {'cardId': 'db119de9-d875-467c-b962-4bdbdd7dc7ee'}
        self.server.pikaqian.prices = Mock(side_effect=ProviderError('tier_required'))
        self.assertEqual(self.auth_request('/api/pikaqian-prices', body)[0], 401)
        self.assertEqual(self.auth_request('/api/pikaqian-prices', body, self.cookie, 'https://evil.example')[0], 403)
        self.server.pikaqian.prices.assert_not_called()
        status, result, _ = self.auth_request('/api/pikaqian-prices', body, self.cookie)
        self.assertEqual(status, 403)
        self.assertEqual(result['error']['code'], 'tier_required')
        self.assertEqual(self.calls, [])

    def test_pairing_cookie_and_invite_creation(self):
        invite = mint_token(PASSWORD, 'invite', 'http://' + self.host)
        status, result, headers = self.auth_request('/api/pair', {'invite': invite})
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        self.assertIn('Max-Age=2592000', cookie)
        status, result, _ = self.auth_request('/api/invites', {}, cookie.split(';')[0])
        self.assertEqual(status, 200)
        self.assertIn('/#invite=', result['url'])
        self.assertTrue(result['qr'].startswith('data:image/svg+xml;base64,'))
        self.assertNotIn(PASSWORD, json.dumps(result))
        self.assertEqual(self.auth_request('/api/pair', {'invite': invite})[0], 200)
        self.assertEqual(self.auth_request('/api/logout', {}, cookie.split(';')[0])[0], 200)
        self.assertEqual(self.calls, [])

    def test_production_pairing_uses_secure_host_cookie(self):
        origin = 'https://pokesift-test.onrender.com'
        self.server.public_origin = origin
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('POST', '/api/pair', json.dumps({'invite':mint_token(PASSWORD,'invite',origin)}), {'Host':'pokesift-test.onrender.com','Origin':origin,'Content-Type':'application/json'})
        r = conn.getresponse()
        self.assertEqual(r.status,200)
        cookie = r.getheader('Set-Cookie')
        self.assertTrue(cookie.startswith('__Host-pokesift='))
        for flag in ['Secure','HttpOnly','SameSite=Strict','Path=/']:
            self.assertIn(flag,cookie)
        self.assertNotIn('Domain=',cookie)
        r.read();conn.close()

    def test_pairing_rejects_expired_wrong_purpose_and_cross_origin(self):
        origin = 'http://' + self.host
        for token in ['invalid', mint_token(PASSWORD, 'invite', origin, now=0), mint_token(PASSWORD, 'session', origin)]:
            self.assertEqual(self.auth_request('/api/pair', {'invite': token})[0], 401)
        invite = mint_token(PASSWORD,'invite',origin)
        self.assertEqual(self.auth_request('/api/pair', {'invite':invite}, origin='https://evil.example')[0],403)
        self.assertEqual(self.auth_request('/api/invites', {})[0],401)

    def test_foreign_origin_never_forwarded(self):
        self.assertEqual(self.request(Origin='https://foreign.example')[0], 403)
        self.assertEqual(self.calls, [])

    def test_invalid_photo_never_forwarded(self):
        self.assertEqual(self.request(body=b'not an image')[0], 400)
        self.assertEqual(self.calls, [])

    def test_oversize_never_forwarded(self):
        self.assertEqual(self.request(**{'Content-Length': str(8 * 1024 * 1024 + 1)})[0], 413)
        self.assertEqual(self.calls, [])

    def test_provider_failure_is_not_retried_or_logged_in_response(self):
        self.reply = RuntimeError('test-key private details')
        status, body, _ = self.request()
        self.assertEqual(status, 502)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn(b'test-key', body)
        self.assertIn(b'No retry', body)

    def test_provider_auth_status_preserved(self):
        self.reply = (401, b'{"error":"Invalid key"}')
        self.assertEqual(self.request()[0], 401)
        self.assertEqual(len(self.calls), 1)

    def test_hosted_origin_forwards(self):
        self.server.public_origin = 'https://pokesift-test.onrender.com'
        status, _, _ = self.request(Host='pokesift-test.onrender.com', Origin='https://pokesift-test.onrender.com', Cookie='__Host-pokesift='+mint_token(PASSWORD,'session','https://pokesift-test.onrender.com'))
        self.assertEqual(status, 200)
        self.assertEqual(len(self.calls), 1)

    def test_spoofed_host_rejected(self):
        self.server.public_origin = 'https://pokesift-test.onrender.com'
        self.assertEqual(self.request(Host='attacker.example', Origin='https://attacker.example')[0], 403)
        self.assertEqual(self.calls, [])

    def test_health_check(self):
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('GET', '/healthz')
        response = conn.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.read()), {'status': 'ok'})
        conn.close()
        self.assertEqual(self.calls, [])

    def test_exchange_rates_are_authenticated_cached_and_fall_back(self):
        rates = {'base': 'AUD', 'date': '2026-10-26', 'rates': {'USD': 0.7, 'AUD': 1}, 'stale': False}
        self.server.exchange_rates = MagicMock(return_value=rates)
        def request(auth):
            conn = http.client.HTTPConnection(self.host, timeout=5)
            conn.request('GET', '/api/exchange-rates', headers={'Cookie': auth})
            r = conn.getresponse()
            result = r.status, json.loads(r.read())
            conn.close()
            return result
        self.assertEqual(request('')[0], 401)
        self.server.exchange_rates.assert_not_called()
        self.assertEqual(request(self.cookie), (200, rates))
        self.assertEqual(request(self.cookie), (200, rates))
        self.server.exchange_rates.assert_called_once()
        self.server.fx_cached_at = -999999
        self.server.exchange_rates.side_effect = OSError('Offline')
        status, result = request(self.cookie)
        self.assertEqual(status, 200)
        self.assertTrue(result['stale'])
        self.assertEqual(result['rates'], rates['rates'])
        self.server.fx_cache = None
        self.assertEqual(request(self.cookie)[0], 503)

    def test_catalog_image_requires_auth(self):
        conn = http.client.HTTPConnection(self.host, timeout=5)
        conn.request('GET', '/api/card-image?id=12345')
        r = conn.getresponse()
        self.assertEqual(r.status, 401)
        r.read()
        conn.close()

    def test_catalog_image_never_accepts_arbitrary_urls(self):
        self.server.card_image = MagicMock(return_value=(PNG, 'image/png'))
        for query, expected in [('id=12345', 200), ('id=https://evil.example', 400), ('id=12345&url=x', 400), ('id=0', 400)]:
            conn = http.client.HTTPConnection(self.host, timeout=5)
            conn.request('GET', '/api/card-image?' + query, headers={'Cookie': self.cookie})
            r = conn.getresponse()
            self.assertEqual(r.status, expected)
            r.read()
            conn.close()
        self.server.card_image.assert_called_once_with('12345')
        self.assertEqual(self.calls, [])

    def test_non_json_is_safe_error(self):
        self.reply = (200, b'<html>test-key</html>')
        status, body, _ = self.request()
        self.assertEqual(status, 502)
        self.assertNotIn(b'test-key', body)

class ProviderRequestTests(unittest.TestCase):
    def test_catalog_request_has_no_provider_credentials(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers.get_content_type.return_value = 'image/png'
        response.read.return_value = PNG
        with patch('server.urllib.request.build_opener') as build:
            build.return_value.open.return_value = response
            body, mime = fetch_card_image('12345')
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://product-images.tcgplayer.com/fit-in/600x600/12345.jpg')
            self.assertIsNone(request.get_header('X-api-key'))
            self.assertIsNone(request.get_header('Authorization'))
            self.assertEqual((body, mime), (PNG, 'image/png'))

    def test_application_identification_and_json_negotiation(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 401
        response.read.return_value = b'{"error":"Invalid key"}'
        with patch('server.urllib.request.build_opener') as build:
            build.return_value.open.return_value = response
            status, body = forward('test-key', PNG, 'image/png')
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header('User-agent'), 'PokeSift/0.1 (+https://github.com/Waldo000000/pokesift)')
            self.assertEqual(request.get_header('Accept'), 'application/json')
            self.assertEqual(status, 401)
            self.assertEqual(build.return_value.open.call_count, 1)


if __name__ == '__main__':
    unittest.main()
