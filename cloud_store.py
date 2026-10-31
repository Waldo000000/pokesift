"""Owner-scoped persistence, optimistic writes, invitations and durable allowances.

PostgreSQL in production; SQLite only for isolated development/tests. No query
accepts an owner from browser input: HTTP routes derive it from the session.
"""
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import uuid

ID = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
HASH = re.compile(r'^[0-9a-f]{64}$')
STATUSES = {'matched','preparing','queued','scanning','ambiguous','retake','not_found','unsupported','error','interrupted'}
IMAGE = re.compile(r'^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')
MAX_DOCUMENT = 4 * 1024 * 1024


def packed(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True, ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()


def identifier(value):
    if not isinstance(value,str) or not ID.fullmatch(value) or value in {'__proto__','constructor','prototype'}:
        raise CloudError(400,'Invalid record identifier.')
    return value


class CloudError(Exception):
    def __init__(self,status,message,**extra):
        super().__init__(message)
        self.status,self.message,self.extra=status,message,extra


class Database:
    def __init__(self,url):
        self.url=url
        self.sqlite=url.startswith('sqlite:')
        if not self.sqlite and not url.startswith(('postgresql://','postgres://')):
            raise ValueError('A PostgreSQL database URL is required.')
        self.lock=threading.RLock()

    @contextlib.contextmanager
    def transaction(self,write=False):
        # SQLite is a fixture adapter, not a production fallback.
        with self.lock if self.sqlite else contextlib.nullcontext():
            if self.sqlite:
                connection=sqlite3.connect(self.url[7:],timeout=20)
                connection.row_factory=sqlite3.Row
                connection.execute('PRAGMA foreign_keys=ON')
                connection.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            else:
                import psycopg
                from psycopg.rows import dict_row
                from urllib.parse import urlsplit
                tls={} if urlsplit(self.url).hostname in {'127.0.0.1','localhost','::1'} else {'sslmode':'verify-full','sslrootcert':'system'}
                connection=psycopg.connect(self.url,connect_timeout=10,row_factory=dict_row,**tls)
                connection.execute("SET LOCAL statement_timeout='15s'")
                connection.execute("SET LOCAL lock_timeout='10s'")
            try:
                def query(sql,args=()):
                    return connection.execute(sql if self.sqlite else sql.replace('?','%s'),args)
                if write:
                    # Serialize budget reservations and multi-row writes across instances.
                    query('UPDATE cloud_mutex SET marker=marker WHERE id=1')
                yield query
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

    def migrate(self):
        schema='\n'.join(p.read_text() for p in sorted((Path(__file__).parent/'migrations').glob('*.sql')))
        # Initial bootstrap precedes the mutex's existence.
        if self.sqlite:
            with sqlite3.connect(self.url[7:]) as c:
                c.executescript(schema)
        else:
            import psycopg
            from urllib.parse import urlsplit
            tls={} if urlsplit(self.url).hostname in {'127.0.0.1','localhost','::1'} else {'sslmode':'verify-full','sslrootcert':'system'}
            with psycopg.connect(self.url,connect_timeout=10,**tls) as c:
                c.execute('SELECT pg_advisory_xact_lock(704321590)')
                c.execute(schema,prepare=False)


class CloudStore:
    def __init__(self,database,clock=time.time,limits=None):
        self.db,self.clock=database,clock
        self.limits={'cards':1000,'account_media':512*1024*1024,'global_media':4*1024**3,
                     'account_metadata':64*1024*1024,'global_metadata':512*1024*1024,
                     'public_daily':30,'public_monthly':300,'public_catalog_daily':100,
                     'public_catalog_monthly':1000,'approved_per_minute':6,'provider_calls_enabled':1,**(limits or {})}

    def now(self): return int(self.clock())

    def _rate(self,q,name,limit,seconds):
        now=self.now();row=q('SELECT * FROM cloud_rate_limits WHERE name=?',(name,)).fetchone()
        if row and row['expires_at']>now and row['used']>=limit:
            raise CloudError(429,'Too many requests. Please try again shortly.',retryAfter=max(1,row['expires_at']-now))
        used=row['used']+1 if row and row['expires_at']>now else 1
        end=row['expires_at'] if row and row['expires_at']>now else now+seconds
        q('INSERT INTO cloud_rate_limits(name,used,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET used=excluded.used,expires_at=excluded.expires_at',(name,used,end))

    def rate(self,name,limit=60,seconds=60):
        with self.db.transaction(True) as q: self._rate(q,name,limit,seconds)

    def account(self,subject,email,name,verified):
        if not verified or not isinstance(subject,str) or not 1<=len(subject)<=200 or not isinstance(email,str) or len(email)>320:
            raise CloudError(403,'A verified Google account is required before joining.')
        with self.db.transaction(True) as q:
            row=q('SELECT * FROM cloud_accounts WHERE subject=?',(subject,)).fetchone()
            if not row:
                # Public signup can never elect itself administrator.
                self._rate(q,'signup:global',100,86400)
                uid=str(uuid.uuid4())
                q('INSERT INTO cloud_accounts(id,subject,email,name,created_at) VALUES(?,?,?,?,?)',(uid,subject,email,str(name)[:100],self.now()))
                row=q('SELECT * FROM cloud_accounts WHERE id=?',(uid,)).fetchone()
            if row['disabled']: raise CloudError(403,'This account has been disabled.')
            return dict(row)

    def promote_owner(self,subject):
        with self.db.transaction(True) as q:
            row=q('SELECT * FROM cloud_accounts WHERE subject=?',(subject,)).fetchone()
            if not row: raise CloudError(404,'Sign in once before assigning the owner role.')
            q("UPDATE cloud_accounts SET role='owner',tier='approved' WHERE id=?",(row['id'],))
            return row['id']

    def session(self,token):
        if not isinstance(token,str) or not 20<=len(token)<=200: return None
        with self.db.transaction() as q:
            row=q('SELECT a.*,s.token_hash AS session_id,s.label AS device_label FROM cloud_sessions s JOIN cloud_accounts a ON a.id=s.owner_id WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND a.disabled=0',(digest(token),self.now())).fetchone()
            return dict(row) if row else None

    def create_session(self,owner,label='Browser'):
        token=secrets.token_urlsafe(32)
        with self.db.transaction(True) as q:
            # Keep the device list and authorization cost bounded.
            q('DELETE FROM cloud_sessions WHERE expires_at<?',(self.now(),))
            count=q('SELECT COUNT(*) AS n FROM cloud_sessions WHERE owner_id=? AND revoked=0',(owner,)).fetchone()['n']
            if count>=30: raise CloudError(409,'Too many signed-in devices. Revoke an old session first.')
            q('INSERT INTO cloud_sessions(token_hash,owner_id,expires_at,created_at,label) VALUES(?,?,?,?,?)',(digest(token),owner,self.now()+30*86400,self.now(),str(label)[:100]))
        return token

    def sessions(self,owner):
        with self.db.transaction() as q:
            return [dict(r) for r in q('SELECT token_hash AS id,label,created_at,expires_at FROM cloud_sessions WHERE owner_id=? AND revoked=0 AND expires_at>? ORDER BY created_at DESC',(owner,self.now())).fetchall()]

    def revoke_session(self,owner,session_id):
        with self.db.transaction(True) as q:
            q('UPDATE cloud_sessions SET revoked=1 WHERE owner_id=? AND token_hash=?',(owner,session_id))

    def login_state(self,token=None):
        if token is None:
            token=secrets.token_urlsafe(32)
            with self.db.transaction(True) as q:
                q('DELETE FROM cloud_login_states WHERE expires_at<?',(self.now(),))
                q('INSERT INTO cloud_login_states(token_hash,expires_at,created_at) VALUES(?,?,?)',(digest(token),self.now()+600,self.now()))
            return token
        with self.db.transaction(True) as q:
            row=q('SELECT * FROM cloud_login_states WHERE token_hash=? AND expires_at>?',(digest(token),self.now())).fetchone()
            if not row: raise CloudError(401,'Sign-in expired. Please start again.')
            q('DELETE FROM cloud_login_states WHERE token_hash=?',(digest(token),))

    @staticmethod
    def card_row(row):
        return {'id':row['id'],'revision':row['revision'],'document':json.loads(row['document']),
                'deletedAt':row['deleted_at'],'updatedAt':row['updated_at']}

    def inventory(self,owner):
        with self.db.transaction() as q:
            cards=q('SELECT id,revision,deleted_at,updated_at FROM cloud_cards WHERE owner_id=?',(owner,)).fetchall()
            layout=q('SELECT * FROM cloud_layouts WHERE owner_id=?',(owner,)).fetchone()
            migrations=q('SELECT id,state,manifest,updated_at FROM cloud_migrations WHERE owner_id=? ORDER BY created_at DESC LIMIT 20',(owner,)).fetchall()
            return {'cards':[{'id':r['id'],'revision':r['revision'],'deletedAt':r['deleted_at']} for r in cards],
                    'layout':{'revision':layout['revision'],'document':json.loads(layout['document'])} if layout else {'revision':0,'document':None},
                    'migrations':[{'id':r['id'],'state':r['state'],'manifest':json.loads(r['manifest'])} for r in migrations]}

    def card(self,owner,card_id):
        identifier(card_id)
        with self.db.transaction() as q:
            row=q('SELECT * FROM cloud_cards WHERE owner_id=? AND id=?',(owner,card_id)).fetchone()
            if not row: raise CloudError(404,'Card not found.')
            return self.card_row(row)

    def _validate_card(self,doc):
        if not isinstance(doc,dict) or doc.get('status') not in STATUSES:
            raise CloudError(400,'Invalid card document.')
        identifier(doc.get('id'))
        if not isinstance(doc.get('thumbnail'),str) or len(doc['thumbnail'])>2*1024*1024 or not IMAGE.fullmatch(doc['thumbnail']):
            raise CloudError(400,'Invalid card thumbnail.')
        if doc.get('canonicalImage') and (not isinstance(doc['canonicalImage'],str) or len(doc['canonicalImage'])>2*1024*1024 or not IMAGE.fullmatch(doc['canonicalImage'])):
            raise CloudError(400,'Invalid canonical image.')
        history=doc.get('scanHistory',[])
        if not isinstance(history,list) or len(history)>1000: raise CloudError(400,'Invalid scan history.')
        seen={doc['id']}
        for record in history:
            if not isinstance(record,dict) or identifier(record.get('id')) in seen: raise CloudError(400,'Duplicate capture identifier.')
            seen.add(record['id'])
        for record in [doc,*history]:
            photo=record.get('scanPhoto')
            if photo and (not isinstance(photo,dict) or (photo.get('sha256') and not HASH.fullmatch(str(photo['sha256'])))):
                raise CloudError(400,'Invalid photo reference.')
        body=packed(doc)
        if len(body.encode())>MAX_DOCUMENT: raise CloudError(413,'Card history exceeds the cloud record limit. Export it for safekeeping.')
        return body

    def _operation(self,q,owner,op_id,request):
        if not q('SELECT id FROM cloud_accounts WHERE id=? AND disabled=0',(owner,)).fetchone():raise CloudError(403,'Account is disabled.')
        identifier(op_id)
        row=q('SELECT * FROM cloud_operations WHERE owner_id=? AND id=?',(owner,op_id)).fetchone()
        if row:
            if row['request_hash']!=digest(packed(request)): raise CloudError(409,'Operation identifier reused with different data.')
            return json.loads(row['response'])
        self._rate(q,'write:'+owner,240,60)
        return None

    def _record_operation(self,q,owner,op_id,request,result):
        q('INSERT INTO cloud_operations(owner_id,id,request_hash,response,created_at) VALUES(?,?,?,?,?)',(owner,op_id,digest(packed(request)),packed(result),self.now()))

    def put_card(self,owner,op):
        card_id=identifier(op.get('id'));revision=op.get('baseRevision')
        if type(revision) is not int or revision<0: raise CloudError(400,'Invalid card revision.')
        action=op.get('action','put')
        if action not in {'put','delete','restore'}: raise CloudError(400,'Invalid card operation.')
        body=self._validate_card(op.get('document')) if action=='put' else None
        if body and op['document']['id']!=card_id: raise CloudError(400,'Card identifier mismatch.')
        with self.db.transaction(True) as q:
            previous=self._operation(q,owner,op.get('operationId'),op)
            if previous:return previous
            row=q('SELECT * FROM cloud_cards WHERE owner_id=? AND id=?',(owner,card_id)).fetchone()
            if (row['revision'] if row else 0)!=revision or (row and row['deleted_at'] is not None and action=='put'):
                raise CloudError(409,'This card changed on another device.',current=self.card_row(row) if row else None)
            if action!='put' and not row: raise CloudError(404,'Card not found.')
            if action=='restore' and (row['deleted_at'] is None or row['deleted_at']<self.now()-30*86400):
                raise CloudError(409,'This card is outside the recovery window.')
            if action=='put':
                count=q('SELECT COUNT(*) AS n FROM cloud_cards WHERE owner_id=?',(owner,)).fetchone()['n']
                if not row and count>=self.limits['cards']: raise CloudError(409,'Cloud card limit reached. Your local copy is retained.')
                # Byte sizes are bounded conservatively (UTF-8 can exceed SQL LENGTH).
                size=len(body.encode());old=len(row['document'].encode()) if row else 0
                self._reserve(q,'metadata:'+owner,size-old,self.limits['account_metadata'])
                self._reserve(q,'metadata:global',size-old,self.limits['global_metadata'])
                for record in [op['document'],*op['document'].get('scanHistory',[])]:
                    sha=(record.get('scanPhoto') or {}).get('sha256')
                    if sha and not q("SELECT hash FROM cloud_media WHERE owner_id=? AND hash=? AND state='complete'",(owner,sha)).fetchone():
                        raise CloudError(409,'Upload the archived photo before saving this card.',code='photo_pending')
            deleted=self.now() if action=='delete' else None
            if action!='put':body=row['document']
            q('INSERT INTO cloud_cards(owner_id,id,revision,document,deleted_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,document=excluded.document,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at',(owner,card_id,revision+1,body,deleted,self.now()))
            result={'id':card_id,'revision':revision+1,'deletedAt':deleted}
            self._record_operation(q,owner,op['operationId'],op,result)
            return result

    @staticmethod
    def layout_document(doc,ids):
        if not isinstance(doc,dict): raise CloudError(400,'Invalid arrangement.')
        valid=set(ids);seen=set()
        slots=doc.get('slots',[]);piles=doc.get('piles',[[],[]]);positions=doc.get('positions',{})
        if not isinstance(slots,list) or len(slots)>10080 or not isinstance(piles,list) or len(piles)!=2 or any(not isinstance(p,list) for p in piles) or not isinstance(positions,dict) or len(positions)>1025:
            raise CloudError(400,'Invalid arrangement.')
        def place(value):
            if value is None:return None
            if value not in valid:return None
            if value in seen:raise CloudError(409,'A card cannot occupy two places in the binder.')
            seen.add(value);return value
        result={'version':1,'slots':[place(v) for v in slots],'piles':[[v for x in p if (v:=place(x)) is not None] for p in piles],'positions':{}}
        for k,p in positions.items():
            if not str(k).isdigit() or not 1<=int(k)<=1025 or not isinstance(p,list) or len(p)!=2 or any(type(n) not in (int,float) or not 0<=n<=100 for n in p):
                raise CloudError(400,'Invalid Zoo position.')
            result['positions'][k]=p
        result['piles'][0].extend(i for i in ids if i not in seen)
        return result

    def put_layout(self,owner,op):
        with self.db.transaction(True) as q:
            previous=self._operation(q,owner,op.get('operationId'),op)
            if previous:return previous
            row=q('SELECT * FROM cloud_layouts WHERE owner_id=?',(owner,)).fetchone()
            revision=row['revision'] if row else 0
            if type(op.get('baseRevision')) is not int or op['baseRevision']!=revision:
                raise CloudError(409,'Your arrangement changed on another device.',current={'revision':revision,'document':json.loads(row['document']) if row else None})
            ids=[r['id'] for r in q('SELECT id FROM cloud_cards WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id',(owner,)).fetchall()]
            document=self.layout_document(op.get('document'),ids)
            q('INSERT INTO cloud_layouts(owner_id,revision,document,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at',(owner,revision+1,packed(document),self.now()))
            result={'revision':revision+1,'document':document}
            self._record_operation(q,owner,op['operationId'],op,result)
            return result

    def _reserve(self,q,name,amount,limit,*,message=None,code='budget_exhausted'):
        row=q('SELECT used FROM cloud_usage WHERE name=?',(name,)).fetchone();used=row['used'] if row else 0
        if used+amount>limit:raise CloudError(429,message or 'The shared or account allowance is currently full. Your collection is still available.',code=code)
        q('INSERT INTO cloud_usage(name,used) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET used=excluded.used',(name,max(0,used+amount)))

    def reserve_media(self,owner,sha,size,mime):
        if not HASH.fullmatch(sha) or type(size) is not int or not 0<size<=8*1024*1024 or mime not in {'image/jpeg','image/png','image/webp'}:
            raise CloudError(400,'Invalid photo upload.')
        with self.db.transaction(True) as q:
            if not q('SELECT id FROM cloud_accounts WHERE id=? AND disabled=0',(owner,)).fetchone():raise CloudError(403,'Account is disabled.')
            row=q('SELECT * FROM cloud_media WHERE owner_id=? AND hash=?',(owner,sha)).fetchone()
            if row:
                if row['bytes']!=size or row['mime']!=mime:raise CloudError(409,'Photo metadata does not match.')
                if row['state']=='deleting':raise CloudError(503,'Photo cleanup is in progress. Retry shortly.')
                if row['state']=='pending':q('UPDATE cloud_media SET created_at=? WHERE owner_id=? AND hash=?',(self.now(),owner,sha))
                return row['state']=='complete'
            self._rate(q,'media:'+owner,120,60)
            self._reserve(q,'media:'+owner,size,self.limits['account_media'])
            self._reserve(q,'media:global',size,self.limits['global_media'])
            q("INSERT INTO cloud_media(owner_id,hash,bytes,mime,state,created_at) VALUES(?,?,?,?,'pending',?)",(owner,sha,size,mime,self.now()))
            return False

    def complete_media(self,owner,sha):
        with self.db.transaction(True) as q:q("UPDATE cloud_media SET state='complete' WHERE owner_id=? AND hash=? AND state='pending'",(owner,sha))

    def media(self,owner,sha):
        if not HASH.fullmatch(sha):raise CloudError(400,'Invalid photo reference.')
        with self.db.transaction() as q:
            row=q("SELECT * FROM cloud_media WHERE owner_id=? AND hash=? AND state='complete'",(owner,sha)).fetchone()
            if not row:raise CloudError(404,'Archived photo not found.')
            return dict(row)

    def migration(self,owner,mid,manifest=None):
        identifier(mid)
        with self.db.transaction(True) as q:
            row=q('SELECT * FROM cloud_migrations WHERE owner_id=? AND id=?',(owner,mid)).fetchone()
            if not row:
                if not isinstance(manifest,dict) or not isinstance(manifest.get('cards'),list) or len(manifest['cards'])>1000 or not isinstance(manifest.get('photos'),list) or len(manifest['photos'])>10000 or len(packed(manifest))>1024*1024:raise CloudError(400,'Invalid migration manifest.')
                for cid in manifest['cards']:identifier(cid)
                for sha in manifest['photos']:
                    if not isinstance(sha,str) or not HASH.fullmatch(sha):raise CloudError(400,'Invalid photo manifest.')
                count=q('SELECT COUNT(*) AS n FROM cloud_migrations WHERE owner_id=?',(owner,)).fetchone()['n']
                if count>=100:raise CloudError(409,'Migration batch limit reached.')
                q('INSERT INTO cloud_migrations(owner_id,id,manifest,state,created_at,updated_at) VALUES(?,?,?,?,?,?)',(owner,mid,packed(manifest),'pending',self.now(),self.now()))
            else:
                saved=json.loads(row['manifest'])
                if manifest is not None and manifest!=saved:raise CloudError(409,'Migration identifier already has a different manifest.')
                manifest=saved
            missing_cards=[cid for cid in manifest['cards'] if not q('SELECT id FROM cloud_cards WHERE owner_id=? AND id=? AND deleted_at IS NULL',(owner,cid)).fetchone()]
            missing_photos=[sha for sha in manifest['photos'] if not q("SELECT hash FROM cloud_media WHERE owner_id=? AND hash=? AND state='complete'",(owner,sha)).fetchone()]
            state='pending' if missing_cards or missing_photos else 'complete_with_missing' if manifest.get('missingPhotos') else 'complete'
            q('UPDATE cloud_migrations SET state=?,updated_at=? WHERE owner_id=? AND id=?',(state,self.now(),owner,mid))
            return {'id':mid,'state':state,'pendingCards':missing_cards,'pendingPhotos':missing_photos,'missingPhotos':manifest.get('missingPhotos',[])}

    def require_admin(self,q,owner):
        row=q('SELECT * FROM cloud_accounts WHERE id=? AND disabled=0',(owner,)).fetchone()
        if not row or row['role']!='owner':raise CloudError(403,'Owner access required.')
        return row

    def _audit(self,q,actor,action,target,details):
        q('INSERT INTO cloud_audit(id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)',(str(uuid.uuid4()),actor,action,target,packed(details),self.now()))

    def invite(self,owner,email):
        token=secrets.token_urlsafe(24);iid=str(uuid.uuid4())
        with self.db.transaction(True) as q:
            self.require_admin(q,owner)
            if not isinstance(email,str) or len(email)>320 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email.strip()):raise CloudError(400,'Enter the Google email address for this invitation.')
            email=email.strip().lower()
            q('INSERT INTO cloud_invites(id,token_hash,created_by,expires_at,max_uses,allowance,created_at) VALUES(?,?,?,?,?,?,?)',(iid,digest(token),owner,self.now()+7*86400,1,0,self.now()))
            q('INSERT INTO cloud_invite_recipients(invite_id,email) VALUES(?,?)',(iid,email))
            self._audit(q,owner,'invite.create',iid,{'recipientEmail':email,'access':'ongoing'})
        return {'id':iid,'code':token,'expiresAt':self.now()+7*86400,'maxUses':1,'recipientEmail':email,'access':'ongoing'}

    def redeem(self,owner,token):
        self.rate('redeem:'+owner,10,3600)
        if not isinstance(token,str) or not 20<=len(token)<=100:raise CloudError(400,'Invalid invitation code.')
        with self.db.transaction(True) as q:
            invite=q('SELECT * FROM cloud_invites WHERE token_hash=?',(digest(token),)).fetchone()
            if not invite or invite['revoked'] or invite['expires_at']<=self.now():raise CloudError(400,'This invitation has expired or was revoked.')
            recipient=q('SELECT email FROM cloud_invite_recipients WHERE invite_id=?',(invite['id'],)).fetchone()
            if not recipient:raise CloudError(400,'Ask the owner for a new invitation addressed to your Google email.')
            account=q('SELECT * FROM cloud_accounts WHERE id=? AND disabled=0',(owner,)).fetchone()
            if not account or account['email'].lower()!=recipient['email']:raise CloudError(403,'Sign in with the Google account this invitation was created for.')
            if q('SELECT owner_id FROM cloud_redemptions WHERE invite_id=? AND owner_id=?',(invite['id'],owner)).fetchone():return {'redeemed':True}
            count=q('SELECT COUNT(*) AS n FROM cloud_redemptions WHERE invite_id=?',(invite['id'],)).fetchone()['n']
            if count>=invite['max_uses']:raise CloudError(409,'This invitation has no places left. Ask for a new one.')
            q('INSERT INTO cloud_redemptions(invite_id,owner_id,created_at) VALUES(?,?,?)',(invite['id'],owner,self.now()))
            q("UPDATE cloud_accounts SET tier=CASE WHEN tier='public' THEN 'invited' ELSE tier END WHERE id=?",(owner,))
            q('DELETE FROM cloud_requests WHERE owner_id=?',(owner,))
            return {'redeemed':True}

    def _budget(self,q,name):
        row=q('SELECT amount FROM cloud_budgets WHERE name=?',(name,)).fetchone()
        return row['amount'] if row else self.limits[name]

    def reserve_paid(self,owner,request_id,provider,fingerprint,retry_of=None):
        identifier(request_id)
        if retry_of is not None:identifier(retry_of)
        if provider not in {'tcgapi','pikaqian'}:raise CloudError(400,'Unknown provider.')
        with self.db.transaction(True) as q:
            existing=q('SELECT * FROM cloud_paid_requests WHERE owner_id=? AND id=? AND provider=?',(owner,request_id,provider)).fetchone()
            if existing:
                if existing['fingerprint']!=fingerprint:raise CloudError(409,'Request identifier reused with different content.')
                if existing['state']=='complete':return (existing['status'],existing['response'].encode())
                raise CloudError(409,'This request was already submitted. Its outcome is uncertain; no retry was made.',code='request_pending',requestId=request_id)
            a=q('SELECT * FROM cloud_accounts WHERE id=? AND disabled=0',(owner,)).fetchone()
            if not a:raise CloudError(401,'Sign in again.')
            retry=None
            if retry_of is not None:
                retry=q('SELECT * FROM cloud_paid_requests WHERE owner_id=? AND id=? AND provider=?',(owner,retry_of,provider)).fetchone()
                if retry and retry['fingerprint']!=fingerprint:raise CloudError(409,'Retry photo differs from the original request.')
                # Manual retries must not bypass an uncertain submission, even
                # after the short duplicate-photo cache has expired.
                pending=q("SELECT id FROM cloud_paid_requests WHERE owner_id=? AND provider=? AND fingerprint=? AND state!='complete' LIMIT 1",(owner,provider,fingerprint)).fetchone()
                if pending:raise CloudError(409,'The earlier scan has not confirmed its outcome. No new scan was sent. Try again later to recover its result.',code='request_pending',requestId=pending['id'])
                if retry and 200<=retry['status']<300:
                    q("INSERT INTO cloud_paid_requests(owner_id,id,provider,fingerprint,state,response,status,created_at) VALUES(?,?,?,?,'complete',?,?,?)",(owner,request_id,provider,fingerprint,retry['response'],retry['status'],self.now()))
                    return retry['status'],retry['response'].encode()
            if not self._budget(q,'provider_calls_enabled'):raise CloudError(503,'Scanning and catalog lookups are paused by the owner. Your collection is still available.',code='provider_paused')
            recent=q('SELECT id,state,status,response FROM cloud_paid_requests WHERE owner_id=? AND provider=? AND fingerprint=? AND created_at>? ORDER BY created_at DESC LIMIT 1',(owner,provider,fingerprint,self.now()-300)).fetchone()
            if recent:
                if recent['state']!='complete':raise CloudError(409,'This photo or lookup was already submitted. Its outcome is not yet confirmed; no new provider call was made.',code='request_pending',requestId=recent['id'])
                if not (retry_of is not None and not 200<=recent['status']<300):
                    q("INSERT INTO cloud_paid_requests(owner_id,id,provider,fingerprint,state,response,status,created_at) VALUES(?,?,?,?,'complete',?,?,?)",(owner,request_id,provider,fingerprint,recent['response'],recent['status'],self.now()))
                    return recent['status'],recent['response'].encode()
            public=a['role']!='owner' and a['tier'] not in {'approved','invited'}
            try:
                self._rate(q,'burst:'+provider+':'+owner,2 if provider=='tcgapi' else 30,1 if provider=='tcgapi' else 60)
                if provider=='tcgapi' and not public and a['role']!='owner':self._rate(q,'approved-scans:'+owner,self._budget(q,'approved_per_minute'),60)
            except CloudError as error:
                if provider=='tcgapi':raise CloudError(429,'Scanning too quickly. Please wait briefly before the next card.',code='scan_throttled',retryAfter=error.extra['retryAfter']) from None
                raise
            now=datetime.datetime.fromtimestamp(self.now(),datetime.timezone.utc);month=now.strftime('%Y-%m');day=now.strftime('%Y-%m-%d')
            if provider=='tcgapi':
                if public:
                    if a['spent']>=3:raise CloudError(429,'Your three trial scans are complete. Request ongoing access from the owner to keep scanning.',code='trial_exhausted')
                    for period,name in [(day,'public_daily'),(month,'public_monthly')]:
                        self._reserve(q,'public:'+period,1,self._budget(q,name),message='The shared public trial pool is busy. Request ongoing access from the owner, or try again later.',code='public_trial_busy')
                q('UPDATE cloud_accounts SET spent=spent+1 WHERE id=?',(owner,))
            elif public:
                for name,limit in [('public-catalog:'+owner,15),('public-lookup:'+day,self._budget(q,'public_catalog_daily')),('public-lookup:'+month,self._budget(q,'public_catalog_monthly'))]:
                    self._reserve(q,name,1,limit,message='Public trial catalog access is busy. Request ongoing access from the owner to continue.',code='public_trial_busy')
            q('INSERT INTO cloud_usage(name,used) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET used=cloud_usage.used+1',(provider+':'+month,))
            q("INSERT INTO cloud_paid_requests(owner_id,id,provider,fingerprint,state,created_at) VALUES(?,?,?,?,'pending',?)",(owner,request_id,provider,fingerprint,self.now()))
        return None

    def finish_paid(self,owner,request_id,provider,status,body):
        # Responses are already redacted by the provider adapter. No request images.
        with self.db.transaction(True) as q:q("UPDATE cloud_paid_requests SET state='complete',status=?,response=? WHERE owner_id=? AND id=? AND provider=?",(status,body.decode(),owner,request_id,provider))

    def account_info(self,owner):
        with self.db.transaction() as q:
            a=q('SELECT * FROM cloud_accounts WHERE id=?',(owner,)).fetchone()
            access='owner' if a['role']=='owner' else 'approved' if a['tier'] in {'approved','invited'} else 'trial'
            return {'id':a['id'],'name':a['name'],'email':a['email'],'role':a['role'],'tier':a['tier'],'accessLevel':access,'scansRemaining':max(0,3-a['spent']) if access=='trial' else None,'scanAllowance':3 if access=='trial' else None,'scansUsed':a['spent']}

    def request_more(self,owner,note):
        if not isinstance(note,str) or len(note)>500:raise CloudError(400,'Keep your request under 500 characters.')
        with self.db.transaction(True) as q:
            self._rate(q,'more:'+owner,3,86400)
            q('INSERT INTO cloud_requests(owner_id,note,created_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET note=excluded.note,created_at=excluded.created_at',(owner,note,self.now()))
        return {'requested':True}

    def admin(self,owner,change=None):
        with self.db.transaction(True) as q:
            self.require_admin(q,owner)
            if change:
                action=change.get('action');target=change.get('id','')
                if action=='budget':
                    if target not in {'public_daily','public_monthly','public_catalog_daily','public_catalog_monthly','approved_per_minute','provider_calls_enabled'} or type(change.get('amount')) is not int or not 0<=change['amount']<=100000:raise CloudError(400,'Reload the app to manage access policy.')
                    if target=='approved_per_minute' and not 1<=change['amount']<=60:raise CloudError(400,'Choose between 1 and 60 scans per minute.')
                    if target=='provider_calls_enabled' and change['amount'] not in {0,1}:raise CloudError(400,'Invalid pause setting.')
                    q('INSERT INTO cloud_budgets(name,amount) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET amount=excluded.amount',(target,change['amount']))
                elif action=='access':
                    if type(change.get('approved')) is not bool:raise CloudError(400,'Choose trial or ongoing access.')
                    account=q('SELECT role FROM cloud_accounts WHERE id=?',(target,)).fetchone()
                    if not account or account['role']=='owner':raise CloudError(400,'Owner access is managed separately.')
                    q('UPDATE cloud_accounts SET tier=? WHERE id=?',('approved' if change['approved'] else 'public',target))
                    q('DELETE FROM cloud_requests WHERE owner_id=?',(target,))
                elif action=='disable':
                    if target==owner:raise CloudError(400,'You cannot disable your own owner account.')
                    q('UPDATE cloud_accounts SET disabled=? WHERE id=?',(1 if change.get('disabled',True) else 0,target))
                elif action=='revoke_invite':q('UPDATE cloud_invites SET revoked=1 WHERE id=?',(target,))
                else:raise CloudError(400,'Unknown admin action.')
                self._audit(q,owner,action,str(target),{k:v for k,v in change.items() if k in {'amount','disabled','approved'}})
            return {'accounts':[dict(r) for r in q('SELECT id,name,email,role,tier,allowance,spent,disabled FROM cloud_accounts ORDER BY created_at DESC LIMIT 500').fetchall()],
                    'invites':[dict(r) for r in q('SELECT i.id,i.expires_at,i.max_uses,i.revoked,t.email AS recipient_email,(SELECT COUNT(*) FROM cloud_redemptions r WHERE r.invite_id=i.id) AS uses FROM cloud_invites i LEFT JOIN cloud_invite_recipients t ON t.invite_id=i.id ORDER BY i.created_at DESC LIMIT 100').fetchall()],
                    'requests':[dict(r) for r in q('SELECT * FROM cloud_requests ORDER BY created_at DESC LIMIT 100').fetchall()],
                    'policy':{name:self._budget(q,name) for name in ['public_daily','public_monthly','public_catalog_daily','public_catalog_monthly','approved_per_minute','provider_calls_enabled']},
                    'usage':[dict(r) for r in q('SELECT * FROM cloud_usage ORDER BY name').fetchall()]}

    def cleanup(self,media,limit=20):
        """Retire expired payloads and orphaned blobs; keep tombstones against resurrection.

        Object deletion is resumable. The deleting state prevents a concurrent
        card write or upload from reusing an object while it is being removed.
        Call from an operator job; do not claim exact deletion timing on a sleeping host.
        """
        cutoff=self.now()-30*86400
        with self.db.transaction(True) as q:
            for r in q('SELECT * FROM cloud_cards WHERE deleted_at IS NOT NULL AND deleted_at<?',(cutoff,)).fetchall():
                doc=json.loads(r['document'])
                if doc.get('purged'):continue
                reduced=packed({'id':r['id'],'purged':True})
                delta=len(reduced.encode())-len(r['document'].encode())
                self._reserve(q,'metadata:'+r['owner_id'],delta,self.limits['account_metadata'])
                self._reserve(q,'metadata:global',delta,self.limits['global_metadata'])
                q('UPDATE cloud_cards SET document=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?',(reduced,self.now(),r['owner_id'],r['id']))
            # Replay identity is retained; older response bodies can be discarded safely.
            q("UPDATE cloud_paid_requests SET response=NULL,state='expired' WHERE created_at<? AND response IS NOT NULL",(cutoff,))
            q('DELETE FROM cloud_operations WHERE created_at<?',(cutoff,))
            q('DELETE FROM cloud_rate_limits WHERE expires_at<?',(self.now(),))
            q('DELETE FROM cloud_sessions WHERE expires_at<? OR revoked=1',(self.now(),))
            referenced=set()
            for r in q('SELECT owner_id,document FROM cloud_cards').fetchall():
                doc=json.loads(r['document'])
                for capture in [doc,*doc.get('scanHistory',[])]:
                    sha=(capture.get('scanPhoto') or {}).get('sha256')
                    if sha:referenced.add((r['owner_id'],sha))
            # Incomplete migrations also protect their uploaded blobs during the window.
            for r in q("SELECT owner_id,manifest FROM cloud_migrations WHERE state='pending' AND updated_at>=?",(cutoff,)).fetchall():
                for sha in json.loads(r['manifest']).get('photos',[]):referenced.add((r['owner_id'],sha))
            candidates=[]
            for r in q("SELECT * FROM cloud_media WHERE created_at<? OR state='deleting' ORDER BY created_at",(cutoff,)).fetchall():
                if (r['owner_id'],r['hash']) in referenced:continue
                q("UPDATE cloud_media SET state='deleting' WHERE owner_id=? AND hash=?",(r['owner_id'],r['hash']))
                candidates.append(dict(r))
                if len(candidates)>=limit:break
        removed=0
        for r in candidates:
            media.remove(r['owner_id'],r['hash'])
            with self.db.transaction(True) as q:
                existing=q("SELECT bytes FROM cloud_media WHERE owner_id=? AND hash=? AND state='deleting'",(r['owner_id'],r['hash'])).fetchone()
                if existing:
                    q('DELETE FROM cloud_media WHERE owner_id=? AND hash=?',(r['owner_id'],r['hash']))
                    self._reserve(q,'media:'+r['owner_id'],-existing['bytes'],self.limits['account_media'])
                    self._reserve(q,'media:global',-existing['bytes'],self.limits['global_media'])
                    removed+=1
        return {'photosRemoved':removed}

    def erase_account(self,owner,media,execute=False):
        """Operator-only erasure. Keeps a disabled identity tombstone to prevent recreation.
        Upstream Neon identity and provider backup retention require separate handling.
        """
        with self.db.transaction(True) as q:
            a=q('SELECT * FROM cloud_accounts WHERE id=?',(owner,)).fetchone()
            if not a:raise CloudError(404,'Account not found.')
            photos=[dict(r) for r in q('SELECT * FROM cloud_media WHERE owner_id=?',(owner,)).fetchall()]
            cards=q('SELECT COUNT(*) AS n FROM cloud_cards WHERE owner_id=?',(owner,)).fetchone()['n']
            if not execute:return {'cards':cards,'photos':len(photos),'bytes':sum(r['bytes'] for r in photos)}
            q('UPDATE cloud_accounts SET disabled=1 WHERE id=?',(owner,))
            q('UPDATE cloud_sessions SET revoked=1 WHERE owner_id=?',(owner,))
        for r in photos:media.remove(owner,r['hash'])
        with self.db.transaction(True) as q:
            self._reserve(q,'media:global',-sum(r['bytes'] for r in photos),self.limits['global_media'])
            size=sum(len(r['document'].encode()) for r in q('SELECT document FROM cloud_cards WHERE owner_id=?',(owner,)).fetchall())
            self._reserve(q,'metadata:global',-size,self.limits['global_metadata'])
            q('DELETE FROM cloud_redemptions WHERE owner_id=? OR invite_id IN (SELECT id FROM cloud_invites WHERE created_by=?)',(owner,owner))
            q('DELETE FROM cloud_invite_recipients WHERE email=? OR invite_id IN (SELECT id FROM cloud_invites WHERE created_by=?)',(a['email'].lower(),owner))
            q('DELETE FROM cloud_invites WHERE created_by=?',(owner,))
            for table in ['cloud_cards','cloud_layouts','cloud_media','cloud_migrations','cloud_operations','cloud_sessions','cloud_paid_requests','cloud_requests']:
                q(f'DELETE FROM {table} WHERE owner_id=?',(owner,))
            q("UPDATE cloud_accounts SET email='',name='Deleted account',role='member',allowance=0,disabled=1 WHERE id=?",(owner,))
            self._audit(q,'operator','account.erase',owner,{'cards':cards,'photos':len(photos)})
        return {'erased':True,'upstreamIdentityDeletionRequired':True}
