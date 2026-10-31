"""Account HTTP routes. Disabled unless explicitly configured at deployment."""
import contextvars
import json
import os
import re
import secrets
from http.cookies import SimpleCookie,CookieError
from urllib.parse import urlsplit,parse_qs
from cloud_store import CloudStore,Database,CloudError,digest,identifier
from cloud_media import MediaStore,validate_photo
from neon_auth import NeonAuth,CHALLENGES,VERIFIER


class CloudHTTP:
    def __init__(self,store,media,auth):
        self.store,self.media,self.auth=store,media,auth
        self.context=contextvars.ContextVar('cloud_request',default=None)
        self.scan_retry=contextvars.ContextVar('cloud_scan_retry',default=None)

    @staticmethod
    def configured():
        return os.environ.get('POKESIFT_CLOUD_ENABLED')=='1'

    @classmethod
    def from_environment(cls,public_origin):
        if not cls.configured():return None
        url=os.environ.get('DATABASE_URL','')
        if public_origin and url.startswith('sqlite:'):raise ValueError('SQLite fixture storage cannot serve a public deployment.')
        if public_origin and os.environ.get('POKESIFT_MEDIA_DIR'):raise ValueError('Local media storage is only for development.')
        db=Database(url);db.migrate()
        limits={k:int(os.environ[env]) for k,env in [('public_daily','POKESIFT_PUBLIC_DAILY_LIMIT'),('public_monthly','POKESIFT_PUBLIC_MONTHLY_LIMIT'),('approved_per_minute','POKESIFT_APPROVED_SCANS_PER_MINUTE')] if env in os.environ}
        store=CloudStore(db,limits=limits)
        media=MediaStore(os.environ.get('S3_ENDPOINT_URL',''),os.environ.get('S3_BUCKET',''),os.environ.get('S3_ACCESS_KEY_ID',''),os.environ.get('S3_SECRET_ACCESS_KEY',''),os.environ.get('S3_REGION','us-east-2'),local_dir=os.environ.get('POKESIFT_MEDIA_DIR'))
        return cls(store,media,NeonAuth(os.environ.get('NEON_AUTH_BASE_URL','')))

    @staticmethod
    def cookie_name(h):return '__Host-pokesift-account' if h.server.public_origin else 'pokesift-account'

    def cookie(self,h,token='',clear=False):
        return f'{self.cookie_name(h)}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else 30*86400}'+('; Secure' if h.server.public_origin else '')

    @staticmethod
    def login_cookie(h,token='',clear=False):
        return f'pokesift-login={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={0 if clear else 600}'+('; Secure' if h.server.public_origin else '')

    def authorize(self,h):
        try:token=SimpleCookie(h.headers.get('Cookie',''))[self.cookie_name(h)].value
        except (KeyError,CookieError):token=''
        account=self.store.session(token)
        if not account:
            h.error(401,'Sign in to your PokéSift account.');return False
        h.cloud_user=account;h.device_id=account['session_id']
        request_id=h.headers.get('X-Request-ID')
        if h.command=='POST' and h.path in {'/api/identify','/api/enrich','/api/pikaqian-prices'}:
            try:identifier(request_id)
            except CloudError as e:h.error(e.status,e.message);return False
        self.context.set((account['id'],request_id or secrets.token_hex(16)))
        self.scan_retry.set(h.headers.get('X-PokeSift-Retry-Of') if h.path=='/api/identify' else None)
        return True

    @staticmethod
    def read_json(h,limit=5*1024*1024):
        if h.headers.get('Transfer-Encoding') or h.headers.get('Content-Type','').split(';')[0]!='application/json':raise CloudError(400,'A JSON request with Content-Length is required.')
        try:size=int(h.headers.get('Content-Length','0'))
        except ValueError:raise CloudError(400,'Invalid request length.') from None
        if not 0<size<=limit:raise CloudError(413,'Request exceeds its size limit.')
        body=h.rfile.read(size)
        if len(body)!=size:raise CloudError(400,'Incomplete request.')
        try:data=json.loads(body,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
        except (ValueError,UnicodeError):raise CloudError(400,'Invalid JSON request.') from None
        if not isinstance(data,dict):raise CloudError(400,'A JSON object is required.')
        return data

    @staticmethod
    def json(h,data,status=200,cookie=None,extra_headers=None):h.send(status,json.dumps(data,allow_nan=False).encode(),cookie=cookie,extra_headers=extra_headers)

    def dispatch(self,h):
        target=urlsplit(h.path)
        matches=target.path.startswith('/api/cloud/') or target.path in {'/api/session','/api/logout','/api/account/sign-in','/auth/callback','/api/pair','/api/invites'}
        if not matches:return False
        try:self.handle(h,target)
        except CloudError as e:self.json(h,{'error':{'message':e.message,**e.extra}},e.status,extra_headers={'Retry-After':str(e.extra['retryAfter'])} if 'retryAfter' in e.extra else None)
        except Exception:h.error(503,'Cloud service temporarily unavailable. Local data has been kept; try again.')
        return True

    def handle(self,h,target):
        route=target.path;method=h.command;origin=h.expected_origin()
        if route in {'/api/pair','/api/invites'}:raise CloudError(410,'Use your Google account and week-long invitations. Device QR pairing has ended.')
        if route=='/api/account/sign-in' and method=='POST':
            # Restrict per-client and aggregate expensive auth starts without trusting arbitrary headers.
            self.store.rate('login:global',100,60)
            self.store.rate('login:ip:'+digest(h.client_address[0]),20,60)
            url,cookies=self.auth.start(origin)
            state=self.store.login_state()
            self.json(h,{'url':url},cookie=[self.login_cookie(h,state),*cookies]);return
        if route=='/auth/callback' and method=='GET':
            query=parse_qs(target.query)
            try:state=SimpleCookie(h.headers.get('Cookie',''))['pokesift-login'].value
            except (KeyError,CookieError):raise CloudError(401,'Sign-in expired. Please return to the collection and start again.') from None
            # Bound single use before an upstream exchange; failures restart Google sign-in.
            self.store.login_state(state)
            identity=self.auth.complete(origin,query.get(VERIFIER,[''])[0],h.headers.get('Cookie',''))
            account=self.store.account(**identity)
            token=self.store.create_session(account['id'],h.headers.get('User-Agent','Browser'))
            clear=[f'{name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' for name in CHALLENGES]
            h.send(303,b'',cookie=[self.cookie(h,token),self.login_cookie(h,clear=True),*clear],extra_headers={'Location':'/'});return
        if not self.authorize(h):return
        owner=h.cloud_user['id']
        if route=='/api/session' and method=='GET':
            self.json(h,{'authenticated':True,'cloud':True,'account':self.store.account_info(owner)});return
        if route=='/api/logout' and method=='POST':
            self.store.revoke_session(owner,h.cloud_user['session_id']);self.json(h,{'signedOut':True},cookie=self.cookie(h,clear=True));return
        query=parse_qs(target.query)
        if method=='GET':
            if route=='/api/cloud/inventory':return self.json(h,self.store.inventory(owner))
            if route=='/api/cloud/card':return self.json(h,self.store.card(owner,query.get('id',[''])[0]))
            if route=='/api/cloud/sessions':return self.json(h,{'sessions':self.store.sessions(owner),'current':h.cloud_user['session_id']})
            if route=='/api/cloud/admin':return self.json(h,self.store.admin(owner))
            if route=='/api/cloud/media':
                sha=query.get('hash',[''])[0];record=self.store.media(owner,sha)
                body=self.media.get(owner,sha,record['bytes'])
                return h.send(200,body,record['mime'])
            raise CloudError(404,'Not found.')
        if route=='/api/cloud/media' and method=='POST':
            sha=h.headers.get('X-Content-SHA256','');mime=h.headers.get('Content-Type','')
            try:size=int(h.headers.get('Content-Length','0'))
            except ValueError:raise CloudError(400,'Invalid photo length.') from None
            if h.headers.get('Transfer-Encoding') or not 0<size<=8*1024*1024:raise CloudError(413,'Choose an image up to 8 MB.')
            body=h.rfile.read(size)
            if len(body)!=size or digest(body)!=sha:raise CloudError(400,'Photo checksum mismatch.')
            validate_photo(body,mime)
            if not self.store.reserve_media(owner,sha,size,mime):
                self.media.put(owner,sha,body,mime)
                self.store.complete_media(owner,sha)
            return self.json(h,{'sha256':sha,'bytes':size,'verified':True})
        if method!='POST':raise CloudError(405,'Method not allowed.')
        data=self.read_json(h)
        if route=='/api/cloud/card':return self.json(h,self.store.put_card(owner,data))
        if route=='/api/cloud/layout':return self.json(h,self.store.put_layout(owner,data))
        if route=='/api/cloud/migration':return self.json(h,self.store.migration(owner,data.get('id'),data.get('manifest')))
        if route=='/api/cloud/redeem':return self.json(h,self.store.redeem(owner,data.get('code')))
        if route=='/api/cloud/invite':
            result=self.store.invite(owner,data.get('email'));result['url']=origin+'/#join='+result['code'];return self.json(h,result)
        if route=='/api/cloud/admin':return self.json(h,self.store.admin(owner,data))
        if route=='/api/cloud/request-scans':return self.json(h,self.store.request_more(owner,data.get('note','')))
        if route=='/api/cloud/revoke-session':
            self.store.revoke_session(owner,data.get('id'));return self.json(h,{'revoked':True})
        raise CloudError(404,'Not found.')

    def wrap_scan(self,forward):
        def wrapped(key,body,mime):
            account=self.context.get()
            if not account:raise CloudError(401,'Account required.')
            owner,rid=account
            cached=self.store.reserve_paid(owner,rid,'tcgapi',digest(mime.encode()+body),retry_of=self.scan_retry.get())
            if cached:return cached
            status,response=forward(key,body,mime)
            try:
                value=json.loads(response)
                def redact(x):
                    if isinstance(x,str):return x.replace(key,'[REDACTED]')
                    if isinstance(x,list):return [redact(v) for v in x]
                    if isinstance(x,dict):return {redact(k):redact(v) for k,v in x.items()}
                    return x
                response=json.dumps(redact(value)).encode()
            except (ValueError,UnicodeError):
                status,response=502,b'{"error":{"message":"Provider returned an unreadable response. A scan may have been used. No retry was made."}}'
            self.store.finish_paid(owner,rid,'tcgapi',status,response)
            return status,response
        return wrapped

    def wrap_lookup(self,transport):
        def wrapped(url,key=None):
            from pikaqian import ProviderError
            account=self.context.get()
            if not account:raise ProviderError('rate_limited')
            # PikaQian validates its fixed CDN URL before fetching an image.
            # Images are opaque bytes, carry no key and use no catalog/scan credit.
            if key is None:return transport(url)
            owner,rid=account;subid=digest(rid+'\n'+url)
            try:cached=self.store.reserve_paid(owner,subid,'pikaqian',digest(url))
            except CloudError:raise ProviderError('rate_limited') from None
            if cached:
                data=json.loads(cached[1]);return data['status'],data['body'].encode(),data['mime']
            status,body,mime=transport(url,key)
            # Redact before retaining replay results, even JSON-escaped echoes.
            try:
                data=json.loads(body)
                def redact(x):
                    if isinstance(x,str):return x.replace(key,'[REDACTED]')
                    if isinstance(x,list):return [redact(v) for v in x]
                    if isinstance(x,dict):return {redact(k):redact(v) for k,v in x.items()}
                    return x
                encoded=json.dumps(redact(data))
            except (ValueError,UnicodeError):encoded='{}'
            result={'status':status,'body':encoded,'mime':mime}
            self.store.finish_paid(owner,subid,'pikaqian',200,json.dumps(result).encode())
            return status,encoded.encode(),mime
        return wrapped
