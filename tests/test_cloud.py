import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from cloud_store import CloudStore,Database,CloudError,packed
from cloud_media import MediaStore
from neon_auth import NeonAuth,CHALLENGES

IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII='
PNG=__import__('base64').b64decode(IMAGE.split(',')[1])

class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.now=1800000000
        self.db=Database(os.environ.get('TEST_POSTGRES_URL') or 'sqlite:'+self.temp.name+'/db.sqlite')
        self.db.migrate();self.store=CloudStore(self.db,clock=lambda:self.now,limits={'public_daily':30})
        self.a=self.store.account(str(uuid.uuid4()),'a@example.test','A',True)['id'];self.b=self.store.account(str(uuid.uuid4()),'b@example.test','B',True)['id']
        self.media=MediaStore('','','','',local_dir=self.temp.name+'/photos')
        # Each test has isolated identities and persistent policy counters.
        with self.db.transaction(True) as q:
            q('DELETE FROM cloud_usage');q('DELETE FROM cloud_budgets');q('DELETE FROM cloud_rate_limits')
    def tearDown(self):self.temp.cleanup()
    def doc(self,cid='one',**extra):return {'id':cid,'status':'matched','thumbnail':IMAGE,'result':{'data':{'read':{'name':'Pikachu'}}},**extra}
    def op(self,doc=None,rev=0,**extra):return {'operationId':str(uuid.uuid4()),'id':doc['id'] if doc else 'one','baseRevision':rev,'document':doc,'action':'put',**extra}
    def assert_error(self,status,fn):
        with self.assertRaises(CloudError) as ctx:fn()
        self.assertEqual(ctx.exception.status,status);return ctx.exception
    def test_account_sessions_isolate_and_revoke(self):
        self.assert_error(403,lambda:self.store.account('unverified','b@example.test','B',False))
        token=self.store.create_session(self.a)
        self.assertEqual(self.store.session(token)['id'],self.a)
        self.store.revoke_session(self.b,hashlib.sha256(token.encode()).hexdigest())
        self.assertIsNotNone(self.store.session(token))
        self.store.revoke_session(self.a,hashlib.sha256(token.encode()).hexdigest());self.assertIsNone(self.store.session(token))
        self.assertEqual(self.store.account_info(self.a)['role'],'member')
    def test_card_roundtrip_preserves_all_fields_and_ownership(self):
        doc=self.doc(providerObservations=[{'provider':'tcgapi','response':{'x':1}}],visualFinish={'profile':'sparkle'},selectedPriceKey='example',currencyAssumed=True,futureField={'keep':[1,2]})
        self.store.put_card(self.a,self.op(doc));self.assertEqual(self.store.card(self.a,'one')['document'],doc)
        self.assert_error(404,lambda:self.store.card(self.b,'one'));self.assertEqual(self.store.inventory(self.b)['cards'],[])
    def test_idempotency_and_stale_write_conflicts(self):
        op=self.op(self.doc());first=self.store.put_card(self.a,op);self.assertEqual(first,self.store.put_card(self.a,op))
        self.assert_error(409,lambda:self.store.put_card(self.a,{**op,'document':self.doc(note='different')}))
        e=self.assert_error(409,lambda:self.store.put_card(self.a,self.op(self.doc(note='stale'))));self.assertEqual(e.extra['current']['revision'],1)
    def test_duplicate_printings_remain_separate_cards(self):
        for cid in ['one','two']:self.store.put_card(self.a,self.op(self.doc(cid)))
        self.assertEqual(len(self.store.inventory(self.a)['cards']),2)
    def test_delete_markers_block_old_backup_and_restore_is_explicit(self):
        self.store.put_card(self.a,self.op(self.doc()))
        self.store.put_card(self.a,self.op(None,1,action='delete'))
        self.assert_error(409,lambda:self.store.put_card(self.a,self.op(self.doc(),2)))
        self.store.put_card(self.a,self.op(None,2,action='restore'))
        self.assertIsNone(self.store.card(self.a,'one')['deletedAt'])
        self.store.put_card(self.a,self.op(None,3,action='delete'));self.now+=31*86400
        self.assert_error(409,lambda:self.store.put_card(self.a,self.op(None,4,action='restore')))
    def test_layout_compare_and_swap_prevents_overlapping_cards(self):
        for cid in ['one','two']:self.store.put_card(self.a,self.op(self.doc(cid)))
        def layout(value,rev=0):return {'operationId':str(uuid.uuid4()),'baseRevision':rev,'document':value}
        doc={'slots':['one'],'piles':[['two'],[]],'positions':{'25':[10,20]}}
        self.store.put_layout(self.a,layout(doc))
        self.assert_error(409,lambda:self.store.put_layout(self.a,layout(doc)))
        self.assert_error(409,lambda:self.store.put_layout(self.a,layout({'slots':['one'],'piles':[['one'],[]]},1)))
        self.assertEqual(self.store.inventory(self.a)['layout']['document']['positions'],{'25':[10,20]})
    def test_photo_checksum_private_namespaces_and_no_partial_success(self):
        sha=hashlib.sha256(PNG).hexdigest();self.assertFalse(self.store.reserve_media(self.a,sha,len(PNG),'image/png'))
        self.assert_error(404,lambda:self.store.media(self.a,sha))
        self.media.put(self.a,sha,PNG,'image/png');self.store.complete_media(self.a,sha)
        self.assertTrue(self.store.reserve_media(self.a,sha,len(PNG),'image/png'))
        self.assertEqual(self.media.get(self.a,sha,len(PNG)),PNG)
        self.assert_error(404,lambda:self.store.media(self.b,sha))
        self.assert_error(400,lambda:self.media.put(self.a,sha,PNG+b'changed','image/png'))
        self.assert_error(409,lambda:self.store.put_card(self.a,self.op(self.doc(scanPhoto={'sha256':'f'*64}))))
    def test_migration_resumes_and_reports_missing_old_photos(self):
        sha=hashlib.sha256(PNG).hexdigest();manifest={'cards':['one'],'photos':[sha],'missingPhotos':['old-retake']}
        m=self.store.migration(self.a,'batch',manifest);self.assertEqual(m['state'],'pending')
        self.store.put_card(self.a,self.op(self.doc()));self.store.reserve_media(self.a,sha,len(PNG),'image/png');self.store.complete_media(self.a,sha)
        self.assertEqual(self.store.migration(self.a,'batch')['state'],'complete_with_missing')
        self.assert_error(409,lambda:self.store.migration(self.a,'batch',{'cards':[],'photos':[]}))
    def owner(self):
        with self.db.transaction(True) as q:q("UPDATE cloud_accounts SET role='owner' WHERE id=?",(self.a,))
    def test_email_bound_invite_grants_ongoing_access_without_owner_privileges(self):
        self.assert_error(403,lambda:self.store.invite(self.a,'b@example.test'))
        self.owner();invite=self.store.invite(self.a,' B@EXAMPLE.TEST ')
        c=self.store.account(str(uuid.uuid4()),'c@example.test','C',True)['id']
        self.assert_error(403,lambda:self.store.redeem(c,invite['code']))
        self.store.redeem(self.b,invite['code']);self.store.redeem(self.b,invite['code'])
        info=self.store.account_info(self.b)
        self.assertIsNone(info['scanAllowance']);self.assertEqual(info['accessLevel'],'approved');self.assertEqual(info['role'],'member')
        second=self.store.invite(self.a,'c@example.test');self.now+=7*86400
        self.assert_error(400,lambda:self.store.redeem(c,second['code']))
    def test_concurrent_invite_redemptions_respect_capacity(self):
        self.owner();invite=self.store.invite(self.a,'x@example.test')
        ids=[self.store.account(str(uuid.uuid4()),'x@example.test','X',True)['id'] for _ in range(4)]
        def redeem(uid):
            try:self.store.redeem(uid,invite['code']);return True
            except CloudError:return False
        with concurrent.futures.ThreadPoolExecutor(4) as pool:results=list(pool.map(redeem,ids))
        self.assertEqual(sum(results),1)
    def test_requests_show_email_and_owner_can_approve_or_remove_access(self):
        self.store.request_more(self.b,'Please approve my account');self.owner()
        admin=self.store.admin(self.a)
        self.assertEqual(next(a for a in admin['accounts'] if a['id']==self.b)['email'],'b@example.test')
        self.assertTrue(any(r['owner_id']==self.b for r in admin['requests']))
        self.assert_error(403,lambda:self.store.admin(self.b,{'action':'access','id':self.b,'approved':True}))
        self.store.admin(self.a,{'action':'access','id':self.b,'approved':True})
        self.assertEqual(self.store.account_info(self.b)['accessLevel'],'approved')
        self.assertFalse(any(r['owner_id']==self.b for r in self.store.admin(self.a)['requests']))
        self.store.admin(self.a,{'action':'access','id':self.b,'approved':False})
        self.assertEqual(self.store.account_info(self.b)['accessLevel'],'trial')
        self.assert_error(400,lambda:self.store.admin(self.a,{'action':'access','id':self.a,'approved':False}))
    def test_paid_request_replay_never_spends_twice_or_refunds_uncertainty(self):
        self.assertIsNone(self.store.reserve_paid(self.a,'req','tcgapi','fingerprint'))
        self.assert_error(409,lambda:self.store.reserve_paid(self.a,'req','tcgapi','fingerprint'))
        self.store.finish_paid(self.a,'req','tcgapi',200,b'{"result":"ok"}')
        self.assertEqual(self.store.reserve_paid(self.a,'req','tcgapi','fingerprint'),(200,b'{"result":"ok"}'))
        self.assertEqual(self.store.account_info(self.a)['scansUsed'],1)
    def test_account_farm_cannot_multiply_public_pool(self):
        self.store.limits['public_daily']=2
        ids=[self.store.account(str(uuid.uuid4()),'farm'+str(i)+'@example.test','Trial',True)['id'] for i in range(80)]
        def reserve(uid):
            try:self.store.reserve_paid(uid,str(uuid.uuid4()),'tcgapi','same-photo');return True
            except CloudError:return False
        with concurrent.futures.ThreadPoolExecutor(8) as pool:results=list(pool.map(reserve,ids))
        self.assertEqual(sum(results),2)
        self.assertEqual(sum(self.store.account_info(uid)['scansUsed'] for uid in ids),2)
    def test_public_gets_three_trials_and_then_can_request_access(self):
        for i in range(3):
            self.now+=2;self.store.reserve_paid(self.b,'scan-'+str(i),'tcgapi','photo-'+str(i))
        self.now+=2
        error=self.assert_error(429,lambda:self.store.reserve_paid(self.b,'fourth','tcgapi','new-photo'))
        self.assertEqual(error.extra['code'],'trial_exhausted')
        self.assertEqual(self.store.account_info(self.b)['scansRemaining'],0)
        self.store.request_more(self.b,'More please')
    def test_public_monthly_pool_cannot_be_multiplied_by_new_accounts_or_new_days(self):
        self.store.limits['public_monthly']=3
        for i in range(3):
            uid=self.store.account(str(uuid.uuid4()),str(i)+'@example.test','Trial',True)['id']
            self.store.reserve_paid(uid,'scan','tcgapi','photo')
        self.now+=86400
        uid=self.store.account(str(uuid.uuid4()),'new@example.test','New',True)['id']
        self.assertEqual(self.assert_error(429,lambda:self.store.reserve_paid(uid,'scan','tcgapi','photo')).extra['code'],'public_trial_busy')
    def test_owner_and_approved_have_no_lifetime_or_public_pool_caps(self):
        self.owner();self.store.admin(self.a,{'action':'access','id':self.b,'approved':True})
        self.store.limits.update({'public_daily':0,'public_monthly':0})
        with self.db.transaction(True) as q:q('UPDATE cloud_accounts SET spent=10000,allowance=0')
        for i in range(8):
            self.now+=61
            for uid in [self.a,self.b]:self.store.reserve_paid(uid,'s-'+str(i),'tcgapi','photo-'+str(i))
        self.assertIsNone(self.store.account_info(self.a)['scansRemaining'])
        self.assertEqual(self.store.account_info(self.b)['scansUsed'],10008)
    def test_approved_pacing_recovers_and_global_pause_is_explicit(self):
        self.owner();self.store.admin(self.a,{'action':'access','id':self.b,'approved':True})
        for i in range(6):self.now+=2;self.store.reserve_paid(self.b,'s-'+str(i),'tcgapi','photo-'+str(i))
        self.now+=2
        error=self.assert_error(429,lambda:self.store.reserve_paid(self.b,'later','tcgapi','later'))
        self.assertEqual(error.extra['code'],'scan_throttled');self.assertGreater(error.extra['retryAfter'],0)
        self.assertEqual(self.store.account_info(self.b)['scansUsed'],6)
        self.now+=61;self.store.reserve_paid(self.b,'later','tcgapi','later')
        self.store.admin(self.a,{'action':'budget','id':'provider_calls_enabled','amount':0})
        self.assertEqual(self.assert_error(503,lambda:self.store.reserve_paid(self.a,'paused','tcgapi','paused')).extra['code'],'provider_paused')
        self.store.admin(self.a,{'action':'budget','id':'provider_calls_enabled','amount':1})
        self.store.reserve_paid(self.a,'paused','tcgapi','paused')
    def test_same_photo_different_request_is_replayed_without_extra_spend(self):
        self.store.reserve_paid(self.a,'first','tcgapi','photo')
        self.assert_error(409,lambda:self.store.reserve_paid(self.a,'second','tcgapi','photo'))
        self.store.finish_paid(self.a,'first','tcgapi',200,b'ok')
        self.assertEqual(self.store.reserve_paid(self.a,'second','tcgapi','photo'),(200,b'ok'))
        self.assertEqual(self.store.account_info(self.a)['scansUsed'],1)
        self.assert_error(409,lambda:self.store.reserve_paid(self.a,'second','tcgapi','different'))
    def test_public_catalog_abuse_is_bounded_independently_of_scan_accounts(self):
        self.store.limits['public_catalog_daily']=2
        for i in range(2):self.store.reserve_paid(self.a,'lookup-'+str(i),'pikaqian','url-'+str(i))
        self.assertEqual(self.assert_error(429,lambda:self.store.reserve_paid(self.b,'lookup','pikaqian','url')).extra['code'],'public_trial_busy')
        self.owner();self.store.reserve_paid(self.a,'owner-lookup','pikaqian','owner-url')

    def test_approved_catalog_access_is_not_capped_at_one_hundred_per_day(self):
        self.owner();self.store.admin(self.a,{'action':'access','id':self.b,'approved':True})
        self.store.limits.update({'public_catalog_daily':0,'public_catalog_monthly':0})
        for i in range(110):
            self.now+=3;self.store.reserve_paid(self.b,'lookup-'+str(i),'pikaqian','url-'+str(i))
    def test_owner_erasure_handles_email_bound_invites(self):
        self.owner();invite=self.store.invite(self.a,'b@example.test')
        self.store.erase_account(self.a,self.media,True)
        with self.db.transaction() as q:self.assertEqual(q('SELECT count(*) AS n FROM cloud_invite_recipients WHERE invite_id=?',(invite['id'],)).fetchone()['n'],0)
    def test_private_storage_quota_is_reserved_before_upload(self):
        self.store.limits['account_media']=10
        self.assert_error(429,lambda:self.store.reserve_media(self.a,'a'*64,11,'image/png'))
        self.assertFalse(self.store.reserve_media(self.a,'b'*64,10,'image/png'))
        self.assert_error(429,lambda:self.store.reserve_media(self.a,'c'*64,1,'image/png'))
    def test_cleanup_retains_live_photos_and_removes_expired_orphans(self):
        sha=hashlib.sha256(PNG).hexdigest()
        self.store.reserve_media(self.a,sha,len(PNG),'image/png');self.media.put(self.a,sha,PNG,'image/png');self.store.complete_media(self.a,sha)
        self.store.put_card(self.a,self.op(self.doc(scanPhoto={'sha256':sha})))
        self.now+=31*86400
        self.store.cleanup(self.media)
        self.assertEqual(self.media.get(self.a,sha,len(PNG)),PNG)
        self.store.put_card(self.a,self.op(None,1,action='delete'));self.now+=31*86400
        self.store.cleanup(self.media)
        self.assert_error(404,lambda:self.store.media(self.a,sha))
        row=self.store.card(self.a,'one');self.assertTrue(row['document']['purged'])
        self.assert_error(409,lambda:self.store.put_card(self.a,self.op(self.doc(),row['revision'])))
    def test_account_erasure_needs_explicit_execute_and_retains_disabled_identity(self):
        self.store.put_card(self.a,self.op(self.doc()))
        self.store.put_card(self.b,self.op(self.doc()))
        self.assertEqual(self.store.erase_account(self.a,self.media)['cards'],1)
        self.assertIsNotNone(self.store.card(self.a,'one'))
        self.store.erase_account(self.a,self.media,True)
        self.assert_error(404,lambda:self.store.card(self.a,'one'))
        self.assertIsNotNone(self.store.card(self.b,'one'))
        self.assert_error(403,lambda:self.store.put_card(self.a,self.op(self.doc())))
    def test_login_state_is_short_lived_and_single_use(self):
        state=self.store.login_state();self.store.login_state(state)
        self.assert_error(401,lambda:self.store.login_state(state))
        state=self.store.login_state();self.now+=601
        self.assert_error(401,lambda:self.store.login_state(state))

    def test_neon_proxy_checks_google_destination_and_session_identity(self):
        calls=[]
        def transport(url,body,headers):
            calls.append((url,body,headers))
            if url.endswith('sign-in/social'):return 200,b'{"url":"https://accounts.google.com/o/oauth2/auth?state=x"}',[next(iter(CHALLENGES))+'=opaque; Domain=neon.tech; Secure; HttpOnly; Partitioned']
            return 200,json.dumps({'session':{'userId':'google-123','expiresAt':'2099-01-01T00:00:00Z'},'user':{'id':'google-123','email':'a@example.test','name':'A','emailVerified':True}}).encode(),[]
        auth=NeonAuth('https://example.neonauth.neon.tech/neondb/auth',transport)
        url,cookies=auth.start('https://app.example');self.assertIn('accounts.google.com',url);self.assertNotIn('Domain=',cookies[0]);self.assertNotIn('Partitioned',cookies[0])
        identity=auth.complete('https://app.example','verifier',cookies[0]);self.assertEqual(identity['subject'],'google-123');self.assertEqual(calls[-1][2]['x-neon-auth-middleware'],'true')
        self.assert_error(401,lambda:auth.complete('https://app.example','verifier',''))
        bad=NeonAuth(auth.base,lambda *_:(200,b'{"url":"https://evil.example"}',[]));self.assert_error(502,lambda:bad.start('https://app.example'))

    def test_neon_proxy_accepts_only_configured_social_init_endpoint(self):
        base='https://example.neonauth.neon.tech/neondb/auth'
        init=base+'/sign-in/social/init?token=one-time-token'
        def adapter(destination):
            return NeonAuth(base,lambda *_:(200,json.dumps({'url':destination}).encode(),
                [next(iter(CHALLENGES))+'=opaque; Secure; HttpOnly']))
        self.assertEqual(adapter(init).start('https://app.example')[0],init)
        for destination in [init.replace('example.neonauth.neon.tech','evil.example'),
            init.replace('/neondb/','/another-db/'),init.replace('/init?','/other?'),
            init.replace('https:','http:'),init+'&token=second',init.replace('one-time-token',''),
            init+'&redirect=https://evil.example',init+'#fragment']:
            with self.subTest(destination=destination):
                self.assert_error(502,lambda:adapter(destination).start('https://app.example'))

if __name__=='__main__':unittest.main()
