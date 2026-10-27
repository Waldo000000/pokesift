import http.client
import json
import threading
import unittest
from server import make_server, forward
from unittest.mock import patch, MagicMock

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
        self.server = make_server(0, forward)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host = f'127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, body=PNG, **changes):
        headers = {'Origin': 'http://' + self.host, 'Content-Type': 'image/png', 'X-API-Key': 'test-key'}
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
        status, _, _ = self.request(Host='pokesift-test.onrender.com', Origin='https://pokesift-test.onrender.com')
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

    def test_non_json_is_safe_error(self):
        self.reply = (200, b'<html>test-key</html>')
        status, body, _ = self.request()
        self.assertEqual(status, 502)
        self.assertNotIn(b'test-key', body)

class ProviderRequestTests(unittest.TestCase):
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
