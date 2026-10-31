"""Local-only browser fixture: in-process cloud store and fake provider. Not an app route."""
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from server import make_server
from cloud_http import CloudHTTP
from cloud_store import Database,CloudStore
from cloud_media import MediaStore
from neon_auth import NeonAuth

root=Path(sys.argv[1]);port=int(sys.argv[2])
os.environ['POKESIFT_CLOUD_ENABLED']='0'
os.environ['TCGAPI_KEY']='cloud-fixture-key'
os.environ['PIKAQIAN_API_KEY']=''
os.environ['POKESIFT_PASSWORD']='cloud-fixture-password'
db=Database('sqlite:'+str(root/'cloud.sqlite'));db.migrate()
store=CloudStore(db)
a=store.account('fixture-a','alice@example.test','Alice',True);b=store.account('fixture-b','bob@example.test','Bob',True)
store.promote_owner('fixture-a')
(root/'sessions.json').write_text(json.dumps({'alice':store.create_session(a['id']),'bob':store.create_session(b['id']),'aliceId':a['id'],'bobId':b['id']}))
cloud=CloudHTTP(store,MediaStore('','','','',local_dir=str(root/'media')),NeonAuth('https://test.neonauth.neon.tech/neondb/auth',request=lambda *_:(_ for _ in ()).throw(RuntimeError('No live authentication in fixtures'))))
calls=0
def forward(*_):
 global calls
 calls+=1
 return 200,json.dumps({'data':{'status':'matched','read':{'game':'pokemon','name':'Pikachu'},'candidates':[{'name':'Pikachu','prices':[{'currency':'USD','market_price':5}]}]},'fixtureCalls':calls}).encode()
with make_server(port,forward) as server:
 server.cloud=cloud;server.forward=cloud.wrap_scan(server.forward)
 server.pikaqian.transport=lambda *_:(_ for _ in ()).throw(RuntimeError('No provider calls allowed'))
 print('Cloud fixture ready',flush=True);server.serve_forever()
