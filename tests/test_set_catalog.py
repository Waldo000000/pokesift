import http.client
import json
import threading
import unittest
from unittest.mock import Mock, patch

from auth import mint_token
from server import make_server
from set_catalog import Catalog, INDEX, SEEDS, MAX_IMAGE, MAX_JSON, image_base, fetch_public

WEBP = b'RIFF\x10\x00\x00\x00WEBPfixture'


class CatalogTests(unittest.TestCase):
    def test_reviewed_taxonomy_and_seeds(self):
        self.assertEqual(len(INDEX['series']), 20)
        self.assertEqual(len(INDEX['sets']), 205)
        self.assertNotIn('tcgp', {s['seriesId'] for s in INDEX['sets']})
        ids = {s['id'] for s in INDEX['sets']}
        self.assertTrue(all(s['parentId'] in ids for s in INDEX['sets'] if s['parentId']))
        fetch = Mock(side_effect=AssertionError('Unexpected network'))
        catalog = Catalog(fetch)
        for sid, value in SEEDS.items():
            cards = catalog.cards(sid)['cards']
            self.assertEqual(len(cards), len(value['cards']))
            self.assertEqual(len({c['id'] for c in cards}), len(cards))
        self.assertEqual(len(catalog.cards('30th')['cards']) + len(catalog.cards('30th-c')['cards']), 188)
        self.assertFalse(any(c['hasImage'] for c in catalog.cards('30th-c')['cards']))
        self.assertEqual(len(catalog.cards('rc')['cards']),25)
        self.assertTrue(all(c['id'].startswith('bw11-RC') for c in catalog.cards('rc')['cards']))
        fetch.assert_not_called()

    def test_id_validation_prevents_arbitrary_requests(self):
        fetch = Mock(return_value=WEBP)
        catalog = Catalog(fetch)
        for sid in ('../me01', 'tcgp', 'https://example.com', 'me01?key=x', ''):
            with self.assertRaises(ValueError):
                catalog.cards(sid)
        for cid in ('../123', 'me01-9999999', 'sv10-001', 'https://example.com'):
            with self.assertRaises(ValueError):
                catalog.artwork('me01', cid)
        with self.assertRaises(ValueError):
            catalog.artwork('me01', 'me01-003', '../x')
        with self.assertRaises(LookupError):
            catalog.artwork('30th-c', '30th-c-001')
        fetch.assert_not_called()
        for url in ('http://assets.tcgdex.net/en/me/me01/003', 'https://evil.example/en/me/me01/003', 'https://assets.tcgdex.net/en/../me01/003', 'https://assets.tcgdex.net/en/me/me01/003?token=x'):
            self.assertIsNone(image_base(url))

    def test_card_list_cache_and_failure_cooldown(self):
        payload={'id':'base1','cards':[{'id':'base1-1','localId':'1','name':'Alakazam','image':'https://assets.tcgdex.net/en/base/base1/1'}]}
        fetch=Mock(return_value=json.dumps(payload).encode());catalog=Catalog(fetch)
        self.assertEqual(catalog.cards('base1')['cards'][0]['id'],'base1-1')
        catalog.cards('base1');fetch.assert_called_once_with('https://api.tcgdex.net/v2/en/sets/base1',MAX_JSON)
        fetch.side_effect=OSError('Offline')
        with patch('set_catalog.time.monotonic',return_value=10000000):
            self.assertTrue(catalog.cards('base1')['stale']);calls=fetch.call_count
            self.assertTrue(catalog.cards('base1')['stale']);self.assertEqual(fetch.call_count,calls)
        for bad in ({'id':'base2','cards':[]},{'id':'base1','cards':[{'id':'base2-1'}]},{'id':'base1','cards':[payload['cards'][0]]*2}):
            with self.assertRaises(ValueError):Catalog(Mock(return_value=json.dumps(bad).encode())).cards('base1')

    def test_detail_drops_prices_and_checks_membership(self):
        value={'id':'me01-003','set':{'id':'me01'},'rarity':'Double rare','pricing':{'anything':'not used'},'attacks':[{'name':'Test'}]}
        fetch=Mock(return_value=json.dumps(value).encode());catalog=Catalog(fetch)
        card=catalog.card('me01','me01-003');self.assertEqual(card['rarity'],'Double rare');self.assertNotIn('pricing',card)
        self.assertEqual(card['attacks'],[{'name':'Test'}]);catalog.card('me01','me01-003');self.assertEqual(fetch.call_count,1)
        value['set']['id']='sv10'
        fallback=Catalog(Mock(return_value=json.dumps(value).encode())).card('me01','me01-003')
        self.assertTrue(fallback['stale']);self.assertNotIn('rarity',fallback)

    def test_artwork_limits_mime_cache_and_failure_cooldown(self):
        fetch=Mock(return_value=WEBP);catalog=Catalog(fetch)
        self.assertEqual(catalog.artwork('me01','me01-003'),WEBP)
        catalog.artwork('me01','me01-003')
        fetch.assert_called_once_with('https://assets.tcgdex.net/en/me/me01/003/low.webp',MAX_IMAGE)
        for invalid in (b'<html>not an image</html>',WEBP+b'x'*MAX_IMAGE):
            fail=Mock(return_value=invalid);cache=Catalog(fail)
            with self.assertRaises(ValueError):cache.artwork('me01','me01-003')
            with self.assertRaises(RuntimeError):cache.artwork('me01','me01-003')
            self.assertEqual(fail.call_count,1)


class CatalogHTTPTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ',{'POKESIFT_CLOUD_ENABLED':'0','TCGAPI_KEY':'fixture-api-key','POKESIFT_PASSWORD':'fixture-password-long'}):self.server=make_server(0)
        self.server.set_catalog=Catalog(Mock(side_effect=AssertionError('Unexpected upstream call')))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.origin='http://127.0.0.1:'+str(self.server.server_port)
        self.cookie='pokesift='+mint_token('fixture-password-long','session',self.origin)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def get(self,path,authenticated=True):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        conn.request('GET',path,headers={'Cookie':self.cookie if authenticated else ''});response=conn.getresponse();result=response.status,response.read(),dict(response.getheaders());conn.close();return result

    def test_authenticated_read_only_routes(self):
        for path in ('/api/set-catalog','/api/set-catalog?set=me01','/api/set-card?set=me01&card=me01-003','/api/set-art?set=me01&card=me01-003'):
            self.assertEqual(self.get(path,False)[0],401)
        status,body,headers=self.get('/api/set-catalog');self.assertEqual(status,200);self.assertEqual(len(json.loads(body)['sets']),205);self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(self.get('/api/set-catalog?set=me01')[0],200)
        for query in ('?set=../x','?set=me01&set=sv10','?set=me01&url=https://example.com','?set='):
            self.assertEqual(self.get('/api/set-catalog'+query)[0],400)
        self.assertEqual(self.get('/api/set-art?set=30th-c&card=30th-c-001')[0],404)
        self.assertEqual(self.get('/api/set-art?set=me01&card=sv10-001')[0],400)
        for path in ('/sets.js','/sets.css'):
            self.assertEqual(self.get(path,False)[0],200)
