"""Private immutable media, namespaced by authenticated account and content hash."""
import hashlib
import os
from pathlib import Path
import re
from cloud_store import CloudError


def validate_photo(body,mime):
    valid=(mime=='image/jpeg' and body.startswith(b'\xff\xd8\xff')) or (mime=='image/png' and body.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/webp' and body.startswith(b'RIFF') and body[8:12]==b'WEBP')
    if not valid:raise CloudError(400,'Image contents do not match their format.')


class MediaStore:
    def __init__(self,endpoint,bucket,access_key,secret_key,region='us-east-2',local_dir=None):
        self.local=Path(local_dir) if local_dir else None
        if self.local:
            self.local.mkdir(parents=True,exist_ok=True)
            self.client=None
        else:
            from urllib.parse import urlsplit
            url=urlsplit(endpoint)
            if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or not bucket or not access_key or not secret_key:
                raise ValueError('Private S3-compatible storage must be configured.')
            import boto3
            from botocore.config import Config
            self.client=boto3.client('s3',endpoint_url=endpoint,region_name=region,
                aws_access_key_id=access_key,aws_secret_access_key=secret_key,
                config=Config(s3={'addressing_style':'path'},retries={'total_max_attempts':1},connect_timeout=10,read_timeout=30))
            self.bucket=bucket

    @staticmethod
    def key(owner,sha):
        if not re.fullmatch(r'[A-Za-z0-9-]{1,100}',owner) or not re.fullmatch(r'[a-f0-9]{64}',sha):raise CloudError(400,'Invalid photo key.')
        return owner+'/'+sha

    def put(self,owner,sha,body,mime):
        key=self.key(owner,sha)
        validate_photo(body,mime)
        if hashlib.sha256(body).hexdigest()!=sha:raise CloudError(400,'Photo checksum mismatch.')
        if self.local:
            folder=self.local/owner;folder.mkdir(exist_ok=True)
            # A content-addressed object is immutable; atomic replace handles retry.
            import tempfile
            fd,tmp=tempfile.mkstemp(dir=folder)
            try:
                with os.fdopen(fd,'wb') as f:f.write(body)
                os.replace(tmp,self.local/key)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
        else:
            self.client.put_object(Bucket=self.bucket,Key=key,Body=body,ContentType=mime,Metadata={'sha256':sha})
            head=self.client.head_object(Bucket=self.bucket,Key=key)
            if head['ContentLength']!=len(body):raise CloudError(502,'Photo upload could not be verified. It can be resumed.')

    def get(self,owner,sha,size):
        key=self.key(owner,sha)
        if self.local:
            try:body=(self.local/key).read_bytes()
            except FileNotFoundError:raise CloudError(404,'Archived photo is unavailable.') from None
        else:
            response=self.client.get_object(Bucket=self.bucket,Key=key)
            try:body=response['Body'].read(size+1)
            finally:response['Body'].close()
        if len(body)!=size or hashlib.sha256(body).hexdigest()!=sha:raise CloudError(502,'Archived photo integrity check failed.')
        return body

    def remove(self,owner,sha):
        key=self.key(owner,sha)
        if self.local:(self.local/key).unlink(missing_ok=True)
        else:self.client.delete_object(Bucket=self.bucket,Key=key)
