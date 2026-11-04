import http.client
import json
import struct
import threading
import unittest
from unittest.mock import patch

from server import make_server


class InstallableAppTests(unittest.TestCase):
    def setUp(self):
        # Installation assets are public even before account/scan configuration.
        with patch.dict('os.environ', {'POKESIFT_CLOUD_ENABLED': '0', 'TCGAPI_KEY': '', 'POKESIFT_PASSWORD': ''}):
            self.server = make_server(0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def get(self, path):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request('GET', path)
        response = conn.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        conn.close()
        return result

    def test_manifest_and_icons_can_be_installed_without_sign_in(self):
        status, body, headers = self.get('/manifest.webmanifest')
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('application/manifest+json'))
        manifest = json.loads(body)
        self.assertEqual(manifest['id'], '/')
        self.assertEqual(manifest['scope'], '/')
        self.assertEqual(manifest['start_url'], '/')
        self.assertEqual(manifest['display'], 'standalone')
        self.assertEqual(manifest['orientation'], 'any')
        self.assertFalse(manifest['prefer_related_applications'])
        self.assertTrue({'192x192', '512x512'} <= {i['sizes'] for i in manifest['icons']})
        self.assertTrue(any(i['purpose'] == 'maskable' for i in manifest['icons']))
        for icon in manifest['icons'] + [{'src': '/icons/apple-touch-icon.png', 'sizes': '180x180'}]:
            status, body, headers = self.get(icon['src'])
            self.assertEqual(status, 200)
            self.assertEqual(headers['Content-Type'], 'image/png')
            self.assertEqual(body[:8], b'\x89PNG\r\n\x1a\n')
            width, height = struct.unpack('!II', body[16:24])
            self.assertEqual(f'{width}x{height}', icon['sizes'])
            self.assertEqual(body[25], 2, 'App icons must have opaque RGB backgrounds')

    def test_worker_and_offline_assets_preserve_policy(self):
        for path in ('/', '/pwa.js', '/pwa.css', '/sw.js', '/offline.html', '/offline.js'):
            status, body, headers = self.get(path)
            self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertNotIn('Set-Cookie', headers)
            policy = headers['Content-Security-Policy']
            for directive in ("worker-src 'self'", "manifest-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"):
                self.assertIn(directive, policy)
            self.assertNotIn('unsafe-inline', policy)
            self.assertNotIn('*', policy)
        self.assertEqual(self.get('/sw.js')[2]['Service-Worker-Allowed'], '/')
        document = self.get('/')[1].decode()
        self.assertIn('rel="manifest"', document)
        self.assertIn('apple-mobile-web-app-capable', document)
        self.assertIn('rel="apple-touch-icon"', document)


if __name__ == '__main__':
    unittest.main()
