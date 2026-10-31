"""Operator commands. No credentials in arguments; reads configured environment.

Read-only listing and explicit identity promotion; budgets never inferred from
provider balances. Erasure needs a matching typed account ID and --execute.
"""
import argparse
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from cloud_store import Database,CloudStore
from cloud_http import CloudHTTP

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['migrate','accounts','promote-owner','budget','cleanup','erase-account'])
    p.add_argument('--subject');p.add_argument('--name',choices=['public_daily','public_monthly','public_catalog_daily','public_catalog_monthly','approved_per_minute','provider_calls_enabled']);p.add_argument('--amount',type=int)
    p.add_argument('--account-id');p.add_argument('--confirm-account-id');p.add_argument('--execute',action='store_true')
    a=p.parse_args();db=Database(os.environ['DATABASE_URL']);db.migrate();store=CloudStore(db)
    if a.command=='migrate':print('Schema ready. No collection data imported.');return
    if a.command=='accounts':
        with db.transaction() as q:print(json.dumps([dict(r) for r in q('SELECT id,subject,email,name,role,disabled FROM cloud_accounts ORDER BY created_at').fetchall()],indent=2))
        return
    if a.command=='promote-owner':
        if not a.subject:p.error('--subject is required; obtain it from accounts after signing in')
        print('Owner account:',store.promote_owner(a.subject));return
    if a.command=='budget':
        if not a.name or a.amount is None or not 0<=a.amount<=100000:p.error('--name and --amount (0–100000) are required')
        if a.name=='approved_per_minute' and not 1<=a.amount<=60:p.error('Approved pacing must be between 1 and 60 scans/minute')
        if a.name=='provider_calls_enabled' and a.amount not in {0,1}:p.error('Provider calls must be 0 (paused) or 1 (enabled)')
        with db.transaction(True) as q:
            q('INSERT INTO cloud_budgets(name,amount) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET amount=excluded.amount',(a.name,a.amount))
            store._audit(q,'operator','budget',a.name,{'amount':a.amount})
        print('Access policy saved. Public pools count submitted calls, including uncertain outcomes.');return
    cloud=CloudHTTP.from_environment(os.environ.get('PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL',''))
    if not cloud:p.error('Configure the cloud environment before media maintenance')
    if a.command=='cleanup':print(json.dumps(cloud.store.cleanup(cloud.media)));return
    if not a.account_id:p.error('--account-id required')
    if a.execute and a.confirm_account_id!=a.account_id:p.error('--confirm-account-id must exactly match before erasure')
    print(json.dumps(cloud.store.erase_account(a.account_id,cloud.media,a.execute),indent=2))

if __name__=='__main__':
    try:main()
    except Exception:
        print('Command failed. Verify configuration and arguments; no credentials were logged.',file=sys.stderr);sys.exit(1)
