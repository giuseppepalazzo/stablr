"""Real boto3 serialization/signing, intercepted before ALL network I/O.

Uses only synthetic credentials/data. Requires the workflow's installed boto3;
skips on local machines without it. No R2/HTTP endpoint is ever contacted.
"""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('r2_backup', Path(__file__).resolve().parents[1] / 'database_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


@unittest.skipUnless(importlib.util.find_spec('boto3'), 'Requires boto3 (installed in backup workflow)')
class R2SdkRequestTest(unittest.TestCase):
    def test_actual_putobject_has_fixed_length_no_streaming_trailers_and_cannot_overwrite(self):
        import boto3
        from botocore.awsrequest import AWSResponse

        class Raw(io.BytesIO):
            def stream(self, *args, **kwargs):
                yield self.read()

        objects = {}
        requests = []
        ciphertext = b'synthetic encrypted fixture'
        digest = hashlib.sha256(ciphertext).hexdigest()

        def intercept(request, **unused):
            headers = {key.lower(): value.decode('ascii') if isinstance(value, bytes) else value
                       for key, value in request.headers.items()}
            requests.append(request.method)
            self.assertNotIn('transfer-encoding', headers)
            self.assertNotIn('aws-chunked', headers.get('content-encoding', ''))
            self.assertNotIn('x-amz-trailer', headers)
            self.assertNotIn('x-amz-sdk-checksum-algorithm', headers)
            self.assertNotIn('x-amz-checksum-crc32', headers)
            self.assertFalse(headers.get('x-amz-content-sha256', '').startswith('STREAMING-'))
            if request.method == 'PUT':
                self.assertEqual(headers['if-none-match'], '*')
                body = request.body.read() if hasattr(request.body, 'read') else request.body
                self.assertEqual(int(headers['content-length']), len(body))
                if request.url in objects:
                    return AWSResponse(request.url, 412, {}, Raw(b'<Error><Code>PreconditionFailed</Code></Error>'))
                objects[request.url] = body
                if len(objects) == 1:
                    self.assertEqual(body, ciphertext)
                    self.assertEqual(headers['x-amz-meta-sha256'], digest)
                return AWSResponse(request.url, 200, {'etag': '"fixture"'}, Raw(b''))
            self.assertEqual(request.method, 'GET')
            return AWSResponse(request.url, 200,
                               {'content-length': str(len(ciphertext)), 'x-amz-meta-sha256': digest}, Raw(ciphertext))

        env = {'AWS_ACCESS_KEY_ID': 'synthetic-key', 'AWS_SECRET_ACCESS_KEY': 'synthetic-secret',
               'AWS_EC2_METADATA_DISABLED': 'true'}
        with patch.dict(os.environ, env, clear=True), patch.object(boto3, 'DEFAULT_SESSION', None):
            client = backup.r2_client('https://r2.example.invalid')
            client.meta.events.register('before-send.s3.PutObject', intercept)
            client.meta.events.register('before-send.s3.GetObject', intercept)
            with patch.object(client._endpoint.http_session, 'send', side_effect=AssertionError('Network forbidden')) as network:
                with tempfile.TemporaryDirectory() as root, contextlib.redirect_stdout(io.StringIO()):
                    encrypted = Path(root) / 'fixture.age'
                    encrypted.write_bytes(ciphertext)
                    self.assertEqual(backup.upload_verified(client, 'fixture-bucket', 'database/fixture.age', encrypted), digest)
                    self.assertEqual(requests, ['PUT', 'GET', 'PUT'])
                    self.assertEqual(len(objects), 2)
                    before = objects.copy()
                    with self.assertRaises(backup.BackupError) as caught:
                        backup.upload_verified(client, 'fixture-bucket', 'database/fixture.age', encrypted)
                    self.assertEqual(caught.exception.code, 'R2_PRECONDITION_FAILED')
                    self.assertEqual(objects, before)
                    network.assert_not_called()
