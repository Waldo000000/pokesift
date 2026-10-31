"""Real HTTP boundary checks with local storage and a fake identity/provider."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from auth import mint_token
from cloud_http import CloudHTTP
from cloud_media import MediaStore
from cloud_store import CloudStore, Database, digest
from server import make_server

PNG = b'\x89PNG\r\n\x1a\nfixture'
ORIGIN = 'https://pokesift.example.test'
PASSWORD = 'fixture-signing-password'


class FakeAuth:
    def __init__(self): self.exchanges = 0
    def start(self, origin):
        return 'https://accounts.google.com/o/oauth2/auth?fixture=1', ['__Secure-neon-auth.session_challenge=fixture; Path=/; HttpOnly; Secure; SameSite=Lax']
    def complete(self, origin, verifier, cookie):
        self.exchanges += 1
        assert verifier == 'fixture-verifier'
        assert '__Secure-neon-auth.session_challenge=fixture' in cookie
        return dict(subject='google-fixture', email='alice@example.test', name='Alice', verified=True)


class CloudHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        db = Database('sqlite:' + str(Path(self.temp.name) / 'db')); db.migrate()
        self.store = CloudStore(db)
        self.a = self.store.account('alice', 'alice@example.test', 'Alice', True)['id']
        self.b = self.store.account('bob', 'bob@example.test', 'Bob', True)['id']
        self.cookie = '__Host-pokesift-account=' + self.store.create_session(self.a)
        self.other = '__Host-pokesift-account=' + self.store.create_session(self.b)
        self.calls = []; self.auth = FakeAuth()
        def provider(key, body, mime):
            self.calls.append(body)
            return 200, json.dumps({'data': {'status':'matched'}, 'echo':key}).encode()
        with patch.dict('os.environ', {'POKESIFT_CLOUD_ENABLED':'0', 'TCGAPI_KEY':'fixture-key', 'POKESIFT_PASSWORD':PASSWORD}):
            self.server = make_server(0, provider, public_origin=ORIGIN)
        self.cloud = CloudHTTP(self.store, MediaStore('','','','',local_dir=self.temp.name+'/media'), self.auth)
        self.server.cloud = self.cloud
        self.server.forward = self.cloud.wrap_scan(self.server.forward)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def request(self, path, body=None, cookie=None, origin=ORIGIN, **headers):
        method = 'GET' if body is None else 'POST'
        h = {'Host':'pokesift.example.test', 'Origin':origin, 'Cookie':self.cookie if cookie is None else cookie}
        if isinstance(body, dict): body=json.dumps(body).encode(); h['Content-Type']='application/json'
        h.update(headers)
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        c.request(method, path, body, h); r=c.getresponse()
        result=r.status,r.read(),r.getheaders(); c.close(); return result

    def test_origin_and_legacy_sessions_cannot_cross_account_boundary(self):
        legacy='__Host-pokesift='+mint_token(PASSWORD,'session',ORIGIN)
        self.assertEqual(self.request('/api/cloud/inventory',cookie=legacy)[0],401)
        self.assertEqual(self.request('/api/cloud/invite',{},origin='https://evil.example')[0],403)
        self.assertEqual(self.request('/api/cloud/invite',{})[0],403)
        self.assertEqual(self.request('/api/pair',{'token':'anything'})[0],410)
        self.assertEqual(self.calls,[])

    def test_photo_endpoint_enforces_owner_and_checksum(self):
        sha=digest(PNG); headers={'Content-Type':'image/png','X-Content-SHA256':sha}
        self.assertEqual(self.request('/api/cloud/media',PNG,**headers)[0],200)
        self.assertEqual(self.request('/api/cloud/media?hash='+sha)[1],PNG)
        self.assertEqual(self.request('/api/cloud/media?hash='+sha,cookie=self.other)[0],404)
        self.assertEqual(self.request('/api/cloud/media',PNG+b'x',**headers)[0],400)

    def test_paid_http_retry_replays_without_consuming_another_scan(self):
        headers={'Content-Type':'image/png','X-Request-ID':'scan-1'}
        self.assertEqual(self.request('/api/identify',PNG,**{'Content-Type':'image/png'})[0],400)
        first=self.request('/api/identify',PNG,**headers)
        second=self.request('/api/identify',PNG,**headers)
        self.assertEqual(first[:2],second[:2]); self.assertEqual(first[0],200)
        self.assertNotIn(b'fixture-key',first[1]); self.assertEqual(self.calls,[PNG])
        self.assertEqual(self.store.account_info(self.a)['scansUsed'],1)

    def test_approved_throttle_returns_retry_time_without_calling_provider(self):
        import time
        now=[int(time.time())];self.store.clock=lambda:now[0]
        self.store.promote_owner('alice');self.store.admin(self.a,{'action':'access','id':self.b,'approved':True})
        for i in range(6):
            now[0]+=2
            self.assertEqual(self.request('/api/identify',PNG+bytes([i]),cookie=self.other,**{'Content-Type':'image/png','X-Request-ID':'scan-'+str(i)})[0],200)
        now[0]+=2
        status,body,headers=self.request('/api/identify',PNG+b'later',cookie=self.other,**{'Content-Type':'image/png','X-Request-ID':'later'})
        self.assertEqual(status,429);self.assertEqual(json.loads(body)['error']['code'],'scan_throttled')
        self.assertTrue(any(k.lower()=='retry-after' and int(v)>0 for k,v in headers))
        self.assertTrue(any(k.lower()=='x-pokesift-scan-throttled' and v=='1' for k,v in headers))
        self.assertEqual(len(self.calls),6)

    def test_callback_needs_single_use_state_and_issues_private_cookie(self):
        callback='/auth/callback?neon_auth_session_verifier=fixture-verifier'
        self.assertEqual(self.request(callback,cookie='')[0],401)
        self.assertEqual(self.auth.exchanges,0)
        status,_,headers=self.request('/api/account/sign-in',{},cookie='')
        self.assertEqual(status,200)
        cookie='; '.join(v.split(';')[0] for k,v in headers if k.lower()=='set-cookie')
        status,_,headers=self.request(callback,cookie=cookie)
        self.assertEqual(status,303)
        session=next(v for k,v in headers if k.lower()=='set-cookie' and v.startswith('__Host-pokesift-account='))
        for flag in ['Path=/','HttpOnly','SameSite=Strict','Secure']: self.assertIn(flag,session)
        self.assertEqual(self.request('/api/session',cookie=session.split(';')[0])[0],200)
        self.assertEqual(self.request(callback,cookie=cookie)[0],401)
        self.assertEqual(self.auth.exchanges,1)

    def test_logout_revokes_server_side_session(self):
        self.assertEqual(self.request('/api/logout',{})[0],200)
        self.assertEqual(self.request('/api/cloud/inventory')[0],401)

    def test_lookup_replay_redacts_json_escaped_secret(self):
        key='fixture-"key'; calls=[]
        def transport(url, secret):
            calls.append(url); return 200,json.dumps({secret:[secret]}).encode(),'application/json'
        self.cloud.context.set((self.a,'lookup-1'))
        wrapped=self.cloud.wrap_lookup(transport)
        first=wrapped('https://example.test/cards',key)
        self.assertEqual(first,wrapped('https://example.test/cards',key))
        self.assertEqual(json.loads(first[1]),{'[REDACTED]':['[REDACTED]']})
        self.assertEqual(len(calls),1)
