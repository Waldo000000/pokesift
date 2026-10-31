"""Local-only browser fixture: in-process cloud store and fake provider. Not an app route."""
import json
import os
import base64
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from server import make_server
from cloud_http import CloudHTTP
from cloud_store import Database,CloudStore
from cloud_media import MediaStore
from neon_auth import NeonAuth

root=Path(sys.argv[1]);port=int(sys.argv[2]);chinese_images=len(sys.argv)>3 and sys.argv[3]=='chinese-images'
card_id='db119de9-d875-467c-b962-4bdbdd7dc7ee'
card_image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAADQ/GvKAAAAEklEQVR4nGNIbI3HihhGJdARAG9VeeGlXk9cAAAAAElFTkSuQmCC')
chinese_read={'game':'pokemon','name':'Delibird','number':'011/058','set':'csvh5c','language':'other','finish':'non_holo','stamp':'Dragonite silhouette','kind':'raw'}
catalog_card={'id':card_id,'name':'Delibird','local_name':'信使鸟','card_number':'011','card_set_id':'csvh5c','variant':'dragonite-stamp','language':'zh-CN','prices':None,'image_url':'https://images.pikaqian.com/originals/csvh5c/'+card_id+'.png'}
stats={'scans':0,'catalog':0,'images':0,'cdn_key_used':False}
def record_stats():
 if chinese_images:(root/'image-stats.json').write_text(json.dumps(stats))
def catalog_transport(url,key=None):
 if url==catalog_card['image_url']:
  stats['images']+=1;stats['cdn_key_used']|=key is not None;record_stats();return 200,card_image,'image/png'
 stats['catalog']+=1;record_stats()
 if url.startswith('https://api.pikaqian.com/v1/cards?'):data={'data':[catalog_card],'pagination':{'next_cursor':None}}
 elif url=='https://api.pikaqian.com/v1/cards/'+card_id:data=catalog_card
 elif url=='https://api.pikaqian.com/v1/sets/csvh5c':data={'name':'Happy Set 5','card_count':{'printed':58}}
 elif url=='https://api.pikaqian.com/v1/cards/'+card_id+'/prices':data={'updated_at':'2026-10-31T00:00:00Z','grades':{'raw':{'price_cents':1850,'source':'fixture'}}}
 else:raise RuntimeError('Unexpected fixture catalog URL; no live provider requests are allowed')
 return 200,json.dumps(data).encode(),'application/json'
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
 if chinese_images:
  stats['scans']+=1;record_stats();return 200,json.dumps({'data':{'status':'unsupported','read':chinese_read}}).encode()
 return 200,json.dumps({'data':{'status':'matched','read':{'game':'pokemon','name':'Pikachu'},'candidates':[{'name':'Pikachu','prices':[{'currency':'USD','market_price':5}]}]},'fixtureCalls':calls}).encode()
with make_server(port,forward) as server:
 server.cloud=cloud;server.forward=cloud.wrap_scan(server.forward)
 if chinese_images:
  server.pikaqian.key='fixture-pika-image-key';server.pikaqian.transport=cloud.wrap_lookup(catalog_transport);server.pikaqian.hourly_limit=None;record_stats()
 else:server.pikaqian.transport=lambda *_:(_ for _ in ()).throw(RuntimeError('No provider calls allowed'))
 print('Cloud fixture ready',flush=True);server.serve_forever()
