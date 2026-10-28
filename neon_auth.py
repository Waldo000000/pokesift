"""Narrow Python adapter for Neon's server-proxy Google OAuth flow.

Protocol matches @neondatabase/auth 0.7 server adapter: middleware header,
challenge cookie and neon_auth_session_verifier exchange through get-session.
No third-party cookie dependency; no generic URL proxy or email/password API.
The hosted integration must be smoke-tested before enabling public accounts.
"""
import json
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit, urlencode
import urllib.request
import urllib.error
import ssl
import os
from cloud_store import CloudError

PREFIX='__Secure-neon-auth.'
CHALLENGES={PREFIX+'session_challenge',PREFIX+'session_challange'}
TOKEN=PREFIX+'session_token'
VERIFIER='neon_auth_session_verifier'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def transport(url,body,headers):
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))))
    request=urllib.request.Request(url,data=body,headers=headers,method='POST' if body is not None else 'GET')
    try:r=opener.open(request,timeout=15)
    except urllib.error.HTTPError as e:r=e
    with r:
        data=r.read(256*1024+1)
        if len(data)>256*1024:raise CloudError(502,'Sign-in response was too large.')
        return r.status,data,r.headers.get_all('Set-Cookie',[])


class NeonAuth:
    def __init__(self,url,request=transport):
        parsed=urlsplit(url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('NEON_AUTH_BASE_URL must be a fixed HTTPS URL.')
        self.base=url.rstrip('/');self.request=request

    def call(self,path,origin,data=None,cookie=''):
        if not (path=='sign-in/social' or path=='get-session' or path.startswith('get-session?')):raise ValueError('Unsupported auth operation')
        headers={'Accept':'application/json','Origin':origin,'Content-Type':'application/json','x-neon-auth-middleware':'true','User-Agent':'PokeSift/1'}
        if cookie:headers['Cookie']=cookie
        status,body,cookies=self.request(self.base+'/'+path,json.dumps(data).encode() if data is not None else None,headers)
        if status!=200:raise CloudError(502,'Google sign-in is temporarily unavailable. Please try again.')
        try:value=json.loads(body)
        except (ValueError,UnicodeError):raise CloudError(502,'Sign-in returned an invalid response.') from None
        if not isinstance(value,dict):raise CloudError(401,'Sign-in could not be verified.')
        return value,cookies

    def start(self,origin):
        data,cookies=self.call('sign-in/social',origin,{'provider':'google','callbackURL':origin+'/auth/callback','errorCallbackURL':origin+'/?signin=failed','disableRedirect':True})
        url=data.get('url','');parsed=urlsplit(url)
        if parsed.scheme!='https' or parsed.hostname!='accounts.google.com' or parsed.username or parsed.password:
            raise CloudError(502,'Sign-in returned an unexpected destination.')
        challenge=[]
        for line in cookies:
            try:c=SimpleCookie(line.split(';',1)[0])
            except CookieError:continue
            for name,m in c.items():
                if name in CHALLENGES:
                    # Preserve the opaque value, discard upstream Domain/Partitioned.
                    challenge.append(f'{name}={m.coded_value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600')
        if not challenge:raise CloudError(502,'The authentication service did not issue a sign-in challenge.')
        return url,challenge

    def complete(self,origin,verifier,cookie):
        if not isinstance(verifier,str) or not 1<=len(verifier)<=4096:raise CloudError(401,'Invalid sign-in callback.')
        try:c=SimpleCookie(cookie)
        except CookieError:raise CloudError(401,'Invalid sign-in challenge.') from None
        challenge='; '.join(f'{name}={m.coded_value}' for name,m in c.items() if name in CHALLENGES)
        if not challenge:raise CloudError(401,'Sign-in challenge expired. Please start again.')
        # The verifier is meaningful only with this browser's challenge cookie.
        data,_=self.call('get-session?'+urlencode({VERIFIER:verifier}),origin,cookie=challenge)
        session,user=data.get('session'),data.get('user')
        if not isinstance(session,dict) or not isinstance(user,dict) or session.get('userId')!=user.get('id') or not user.get('id') or user.get('emailVerified') is not True or user.get('banned'):
            raise CloudError(401,'A verified Google account is required.')
        import datetime,time
        try:expiry=datetime.datetime.fromisoformat(session['expiresAt'].replace('Z','+00:00')).timestamp()
        except (KeyError,ValueError,TypeError):raise CloudError(401,'Invalid sign-in session.') from None
        if expiry<=time.time():raise CloudError(401,'Sign-in session expired.')
        return {'subject':user['id'],'email':user.get('email',''),'name':user.get('name','Collector'),'verified':True}
