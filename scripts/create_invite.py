"""Create a ten-minute bootstrap QR using a securely injected app password."""
import argparse
import datetime
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
import qrcode
import qrcode.image.svg
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth import mint_token, verify_token

parser = argparse.ArgumentParser()
parser.add_argument('--origin', required=True, help='Exact deployed HTTPS origin, without trailing slash')
parser.add_argument('--output', required=True, help='Private local SVG output path; never commit the invite')
args = parser.parse_args()
origin = urlsplit(args.origin)
if origin.scheme != 'https' or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username:
    parser.error('Use an HTTPS origin without path, credentials, query or fragment')
password = os.environ.get('POKESIFT_PASSWORD', '')
if len(password) < 16:
    parser.error('Inject POKESIFT_PASSWORD securely; at least 16 characters required')
token = mint_token(password, 'invite', args.origin)
claims = verify_token(token, password, 'invite', args.origin)
qr = qrcode.make(args.origin + '/#invite=' + token, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=4)
with open(args.output, 'xb') as output:
    os.chmod(args.output, 0o600)
    qr.save(output)
print('QR saved. Expires:', datetime.datetime.fromtimestamp(claims['exp'], datetime.timezone.utc).isoformat())
