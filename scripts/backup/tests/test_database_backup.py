"""Safety/contract tests. All DB/S3/age calls are fakes, never production.

Run: python3 -m unittest discover -s scripts/backup/tests -v
Actual encryption/Auth/restore compatibility must be verified with the first
controlled backup in an isolated compatible PostgreSQL installation.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import tarfile

MODULE = Path(__file__).resolve().parents[1] / 'database_backup.py'
spec = importlib.util.spec_from_file_location('database_backup', MODULE)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def inventory():
    return {'snapshot': '00000001-00000001-1', 'server_version': '17.6', 'server_version_num': 170006,
            'tables': [dict(oid=oid, schema=schema, name=name, kind='r', extension_owned=False)
                       for oid, schema, name in [(100, 'auth', 'users'), (101, 'auth', 'identities'),
                                                 (102, 'public', 'clubs')]],
            'roles': ['postgres', 'authenticated', 'anon'], 'extensions': [{'name': 'plpgsql', 'version': '1.0'}],
            'auth_counts': {'users': 8, 'identities': 8}}


TOC = '\n'.join(f'{oid}; 1259 {oid} {kind} {schema} {name} postgres'
                for oid, schema, name in [(100, 'auth', 'users'), (101, 'auth', 'identities'),
                                          (102, 'public', 'clubs')] for kind in ('TABLE', 'TABLE DATA'))


class Store:
    def __init__(self, corrupt=False):
        self.objects = {}
        self.corrupt = corrupt
        self.calls = []

    def put_object(self, **args):
        self.calls.append(args)
        if args['IfNoneMatch'] != '*' or args['Key'] in self.objects:
            raise RuntimeError('Precondition failed')
        body = args['Body'].read() if hasattr(args['Body'], 'read') else args['Body']
        if args['ContentLength'] != len(body):
            raise AssertionError('Incorrect explicit request length')
        self.objects[args['Key']] = (body, args.get('Metadata', {}))

    def get_object(self, **args):
        body, metadata = self.objects[args['Key']]
        return {'Body': io.BytesIO(body + b'corrupted' if self.corrupt else body), 'Metadata': metadata}


class BackupTests(unittest.TestCase):
    def test_connection_credentials_not_in_command_line_tls_readonly_and_no_transaction_pool(self):
        env = backup.db_env('postgresql://postgres.ref:secret%3Avalue@db.example:5432/postgres')
        self.assertEqual(env['PGPASSWORD'], 'secret:value')
        self.assertEqual(env['PGSSLMODE'], 'require')
        self.assertIn('default_transaction_read_only=on', env['PGOPTIONS'])
        for url in ['postgres://u:p@db.example:6543/postgres', 'postgres://u:p@db.example/db?sslmode=disable', 'https://db.example/db']:
            with self.assertRaises(backup.BackupError):
                backup.db_env(url)

    def test_inherited_pg_redirects_removed(self):
        with patch.dict(os.environ, {'PGSERVICE': 'production', 'PGHOSTADDR': '9.9.9.9', 'BACKUP_DATABASE_URL': 'private'}):
            env = backup.db_env('postgres://u:p@db.example/db')
        self.assertNotIn('PGSERVICE', env)
        self.assertNotIn('PGHOSTADDR', env)
        self.assertNotIn('BACKUP_DATABASE_URL', env)

    def test_auth_and_every_application_table_must_have_definition_and_data(self):
        self.assertEqual(backup.verify_coverage(inventory(), TOC)['auth_tables'], 2)
        for line in ['TABLE DATA auth users', 'TABLE auth identities', 'TABLE DATA public clubs']:
            damaged = '\n'.join(item for item in TOC.splitlines() if line not in item)
            with self.assertRaises(backup.BackupError):
                backup.verify_coverage(inventory(), damaged)
        missing_auth = inventory()
        missing_auth['tables'] = missing_auth['tables'][2:]
        with self.assertRaises(backup.BackupError):
            backup.verify_coverage(missing_auth, TOC)

    def test_partition_and_extension_foreign_limits_are_explicit(self):
        data = inventory()
        data['tables'] += [dict(oid=104, schema='public', name='partition_root', kind='p', extension_owned=False),
                           dict(oid=105, schema='extensions', name='managed', kind='r', extension_owned=True),
                           dict(oid=106, schema='public', name='remote', kind='f', extension_owned=False)]
        coverage = backup.verify_coverage(data, TOC + '\n104; 1259 104 TABLE public partition_root postgres')
        self.assertEqual(coverage['local_tables'], 4)
        self.assertEqual(coverage['excluded_foreign_tables'], 1)

    def test_export_shared_snapshot_no_owner_filter_no_schema_exclusion(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            snapshot = MagicMock()
            snapshot.__enter__.return_value = inventory()
            calls = []

            def runner(args, env=None, text=None):
                calls.append(args)
                if args[0] == 'pg_dump' and '--version' in args:
                    return 'pg_dump (PostgreSQL) 18.3'
                if args[0] == 'pg_dump':
                    (folder / 'database.dump').write_bytes(b'PGDMP-fixture')
                    return ''
                if args[0] == 'pg_restore':
                    return TOC
                if args[0] == 'pg_dumpall':
                    return 'CREATE ROLE authenticated;'
                self.fail('Unexpected tool')

            with patch.object(backup, 'Snapshot', return_value=snapshot), patch.object(backup, 'run', side_effect=runner):
                manifest = backup.collect(folder, {})
            dump = next(args for args in calls if args[0] == 'pg_dump' and '--version' not in args)
            self.assertIn('--snapshot=00000001-00000001-1', dump)
            self.assertTrue(any('--file=' + os.devnull in args for args in calls if args[0] == 'pg_restore'))
            self.assertFalse(any(arg.startswith('--exclude') or arg == '--no-acl' for arg in dump))
            self.assertIn('--no-role-passwords', calls[-1])
            self.assertNotIn('snapshot', manifest['inventory'])
            self.assertEqual(manifest['inventory']['auth_counts']['users'], 8)
            self.assertEqual(manifest['files']['database.dump'], backup.sha256(folder / 'database.dump'))

    def test_older_client_refuses_export(self):
        with tempfile.TemporaryDirectory() as root:
            snapshot = MagicMock()
            snapshot.__enter__.return_value = inventory()
            with patch.object(backup, 'Snapshot', return_value=snapshot), patch.object(backup, 'run', return_value='pg_dump (PostgreSQL) 16.4') as tool:
                with self.assertRaises(backup.BackupError):
                    backup.collect(Path(root), {})
                self.assertEqual(tool.call_count, 1)

    def test_snapshot_is_readonly_and_kept_open_then_rolled_back(self):
        process = MagicMock()
        process.stdout.readline.return_value = json.dumps(inventory()) + '\n'
        process.poll.return_value = None
        with patch.object(backup.subprocess, 'Popen', return_value=process) as popen:
            with backup.Snapshot({}) as data:
                self.assertEqual(data['snapshot'], inventory()['snapshot'])
                self.assertFalse(process.wait.called)
            self.assertIn('READ ONLY', process.stdin.write.call_args_list[0].args[0])
            self.assertEqual(process.stdin.write.call_args_list[1].args[0], 'ROLLBACK;\n\\q\n')
            self.assertNotIn('secret', repr(popen.call_args.args))

    def test_encryption_precedes_upload_plain_files_only_inside_encrypted_bundle(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            for name in ('database.dump', 'roles.sql', 'archive.list', 'manifest.json'):
                (folder / name).write_text('private fixture')

            def age(args, *unused):
                self.assertEqual(args[0], 'age')
                with tarfile.open(folder / 'bundle.tar') as archive:
                    self.assertEqual(len(archive.getnames()), 4)
                (folder / 'backup.tar.age').write_bytes(b'age-encrypted-fixture')

            with patch.object(backup, 'run', side_effect=age):
                encrypted = backup.encrypt(folder, 'age1fixture')
            store = Store()
            digest = backup.upload_verified(store, 'bucket', 'database/fixture.tar.age', encrypted)
            self.assertEqual(len(store.objects), 2)
            self.assertEqual(store.objects['database/fixture.tar.age'][0], b'age-encrypted-fixture')
            self.assertEqual(json.loads(store.objects['database/fixture.tar.age.verified.json'][0])['sha256'], digest)
            self.assertNotIn(b'private fixture', repr(store.objects).encode())
            with self.assertRaises(backup.BackupError):
                backup.upload_verified(store, 'bucket', 'database/fixture.tar.age', encrypted)

    def test_failed_encryption_cannot_return_file_for_upload(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            for name in ('database.dump', 'roles.sql', 'archive.list', 'manifest.json'):
                (folder / name).write_text('private')
            with patch.object(backup, 'run', side_effect=backup.BackupError('Failed.')):
                with self.assertRaises(backup.BackupError):
                    backup.encrypt(folder, 'age1fixture')

    def test_corrupt_r2_readback_never_writes_success_receipt(self):
        with tempfile.TemporaryDirectory() as root:
            encrypted = Path(root) / 'cipher.age'
            encrypted.write_bytes(b'encrypted')
            store = Store(corrupt=True)
            with self.assertRaises(backup.BackupError):
                backup.upload_verified(store, 'bucket', 'database/cipher.age', encrypted)
            self.assertEqual(len(store.objects), 1)

    def test_restore_refuses_remote_and_normal_database_names(self):
        for url in ['postgres://u:p@supabase.example/stablr_restore_test',
                    'postgres://u:p@127.0.0.1/postgres', 'postgres://u:p@localhost/stablr_restore_../x']:
            with self.assertRaises(backup.BackupError):
                backup.db_env(url, restore=True)
        self.assertEqual(backup.db_env('postgres://u:p@127.0.0.1/stablr_restore_test', True)['PGSSLMODE'], 'disable')

    def test_restore_refuses_nonempty_database_before_any_write(self):
        with patch.object(backup, 'run', return_value='1') as tool:
            with self.assertRaises(backup.BackupError):
                backup.restore(Path('/unused'), {}, 'postgres://u:p@localhost/stablr_restore_test')
        self.assertEqual(tool.call_count, 1)

    def test_restore_single_transaction_and_auth_counts(self):
        data = inventory()
        results = ['0', json.dumps(data['roles']), '', json.dumps(data['auth_counts'])]
        with patch.object(backup, 'run', side_effect=results) as tool, contextlib.redirect_stdout(io.StringIO()):
            backup.restore(Path('/unused'), {'inventory': data}, 'postgres://u:p@localhost/stablr_restore_test')
        restore_args = tool.call_args_list[2].args[0]
        self.assertIn('--single-transaction', restore_args)
        self.assertIn('--exit-on-error', restore_args)
        self.assertNotIn('--clean', restore_args)

    def test_ciphertext_mismatch_fails_before_decryption(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            encrypted = folder / 'cipher.age'
            encrypted.write_bytes(b'bad')
            receipt = folder / 'receipt.json'
            receipt.write_text(json.dumps({'sha256': '0' * 64}))
            with patch.object(backup, 'run') as tool:
                with self.assertRaises(backup.BackupError):
                    backup.open_bundle(encrypted, receipt, 'offline.key', folder)
                tool.assert_not_called()

    def test_bundle_checksums_and_traversal(self):
        for unsafe in (False, True):
            with tempfile.TemporaryDirectory() as root:
                folder = Path(root)
                encrypted = folder / 'cipher.age'
                encrypted.write_bytes(b'ciphertext')
                receipt = folder / 'receipt.json'
                receipt.write_text(json.dumps({'sha256': backup.sha256(encrypted)}))

                def decrypt(args):
                    contents = {'database.dump': b'PGDMP', 'roles.sql': b'roles', 'archive.list': TOC.encode()}
                    contents['manifest.json'] = json.dumps({'format': 1, 'inventory': inventory(),
                        'files': {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}}).encode()
                    with tarfile.open(folder / 'bundle.tar', 'w') as archive:
                        for name, content in contents.items():
                            entry = tarfile.TarInfo('../escape' if unsafe and name == 'roles.sql' else name)
                            entry.size = len(content)
                            archive.addfile(entry, io.BytesIO(content))

                def runner(args):
                    if args[0] == 'age':
                        decrypt(args)
                    else:
                        return TOC

                with patch.object(backup, 'run', side_effect=runner):
                    if unsafe:
                        with self.assertRaises(backup.BackupError):
                            backup.open_bundle(encrypted, receipt, 'offline.key', folder)
                    else:
                        self.assertEqual(backup.open_bundle(encrypted, receipt, 'offline.key', folder)['format'], 1)

    def test_tool_and_sdk_errors_never_log_credentials_or_row_data(self):
        failed = MagicMock(returncode=1, stderr='password-secret auth-user@example.com', stdout='private')
        with patch.object(backup.subprocess, 'run', return_value=failed):
            with self.assertRaises(backup.BackupError) as caught:
                backup.run(['pg_dump'])
            self.assertNotIn('password-secret', str(caught.exception))
        with patch.object(backup.sys, 'argv', ['backup', 'backup']), patch.object(backup, 'backup', side_effect=Exception('secret endpoint token')), contextlib.redirect_stderr(io.StringIO()) as output:
            self.assertEqual(backup.main(), 1)
        self.assertNotIn('token', output.getvalue())
        self.assertNotIn('endpoint', output.getvalue())

    def test_missing_secrets_and_unacknowledged_retention_prevent_any_export(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(backup, 'collect') as export:
            with self.assertRaises(backup.BackupError):
                backup.backup()
            export.assert_not_called()
        env = {name: 'test' for name in ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_R2_ENDPOINT', 'BACKUP_R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')}
        with patch.dict(os.environ, env, clear=True), patch.object(backup, 'collect') as export:
            with self.assertRaises(backup.BackupError):
                backup.backup()
            export.assert_not_called()

    def test_workflow_no_pr_secrets_only_backup_step_daily_manual_no_artifacts(self):
        workflow = MODULE.parents[2] / '.github/workflows/database-backup.yml'
        text = workflow.read_text()
        self.assertIn('workflow_dispatch:', text)
        self.assertIn("cron: '43 3 * * *'", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)
        self.assertIn('cancel-in-progress: false', text)
        for forbidden in ['pull_request:', 'upload-artifact', 'service_role', 'SUPABASE_SERVICE_ROLE', 'set -x', 'id-token: write']:
            self.assertNotIn(forbidden, text)

    def test_only_explicit_ten_day_retention_acknowledgement_passes_gate(self):
        env = {name: 'test' for name in ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')}
        env['BACKUP_R2_ENDPOINT'] = 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com'
        acknowledgements = [
            {},
            {'BACKUP_RETENTION_10_DAYS_CONFIGURED': 'false'},
            {'BACKUP_RETENTION_10_DAYS_CONFIGURED': 'TRUE'},
            {'BACKUP_RETENTION_30_DAYS_CONFIGURED': 'true'},
            {'BACKUP_RETENTION_CONFIGURED': 'true'},
        ]
        for acknowledgement in acknowledgements:
            with self.subTest(acknowledgement=acknowledgement), patch.dict(os.environ, {**env, **acknowledgement}, clear=True), patch.object(backup, 'db_env') as connection:
                with self.assertRaisesRegex(backup.BackupError, '10-day lifecycle'):
                    backup.backup()
                connection.assert_not_called()
        with patch.dict(os.environ, {**env, 'BACKUP_RETENTION_10_DAYS_CONFIGURED': 'true'}, clear=True), patch.object(backup, 'db_env', side_effect=backup.BackupError('Reached database check.')):
            with self.assertRaisesRegex(backup.BackupError, 'Reached database check'):
                backup.backup()

    def test_ten_day_retention_consistent_in_workflow_and_documentation(self):
        workflow = (MODULE.parents[2] / '.github/workflows/database-backup.yml').read_text()
        documentation = (MODULE.parent / 'README.md').read_text()
        self.assertIn('BACKUP_RETENTION_10_DAYS_CONFIGURED: ${{ vars.BACKUP_RETENTION_10_DAYS_CONFIGURED }}', workflow)
        self.assertNotIn('BACKUP_RETENTION_30_DAYS_CONFIGURED', workflow)
        self.assertIn('dopo **10 giorni**', documentation)
        self.assertIn('BACKUP_RETENTION_10_DAYS_CONFIGURED=true', documentation)

    def test_failed_postgres_connection_cleanup_preserves_reason_without_secrets(self):
        for reason, code in [
            ('password authentication failed', 'PG_AUTH_FAILED'),
            ('could not translate host name', 'PG_DNS_FAILED'),
            ('Network is unreachable', 'PG_NETWORK_UNREACHABLE'),
            ('connection timed out', 'PG_CONNECTION_TIMEOUT'),
            ('SSL error', 'PG_SSL_FAILED'),
            ('Tenant or user not found', 'PG_POOLER_REJECTED'),
            ('permission denied', 'PG_PERMISSION_DENIED'),
        ]:
            with self.subTest(code=code):
                process = MagicMock()
                process.stdout.readline.return_value = ''
                process.poll.return_value = None
                # Reproduce the original failure: EOF, then flush AND close fail.
                process.stdin.flush.side_effect = [None, BrokenPipeError()]
                process.stdin.close.side_effect = BrokenPipeError()
                errors = io.BytesIO((reason + ': password-secret private-host user@example.invalid').encode())
                with patch.object(backup.tempfile, 'TemporaryFile', return_value=errors), patch.object(backup.subprocess, 'Popen', return_value=process), contextlib.redirect_stdout(io.StringIO()) as output:
                    with self.assertRaises(backup.BackupError) as caught:
                        with backup.Snapshot({}):
                            self.fail('A failed connection cannot yield a snapshot')
                self.assertEqual(caught.exception.code, code)
                self.assertIn('phase=postgres_connection status=failed code=' + code, output.getvalue())
                for secret in ('password-secret', 'private-host', 'user@example.invalid'):
                    self.assertNotIn(secret, output.getvalue() + str(caught.exception))
                process.kill.assert_called_once()
                self.assertTrue(errors.closed)

    def test_postgres_tool_errors_classified_without_echoing_stderr(self):
        for reason, code in [('permission denied for table private', 'PG_PERMISSION_DENIED'),
                             ('aborting because of server version mismatch', 'PG_VERSION_MISMATCH'),
                             ('invalid snapshot identifier', 'PG_SNAPSHOT_FAILED'),
                             ('connection refused', 'PG_CONNECTION_REFUSED')]:
            result = MagicMock(returncode=1, stderr=reason + ' password-secret raw-record', stdout='private')
            with self.subTest(code=code), patch.object(backup.subprocess, 'run', return_value=result), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError) as caught:
                    with backup.phase('database_export'):
                        backup.run(['pg_dump'])
            self.assertEqual(caught.exception.code, code)
            self.assertIn('phase=database_export status=failed code=' + code, output.getvalue())
            self.assertNotIn('password-secret', output.getvalue() + str(caught.exception))
            self.assertNotIn('raw-record', output.getvalue() + str(caught.exception))

    def test_missing_psql_and_tool_timeout_have_safe_codes(self):
        with patch.object(backup.subprocess, 'Popen', side_effect=FileNotFoundError('secret path')), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(backup.BackupError) as caught:
                with backup.Snapshot({}):
                    pass
        self.assertEqual(caught.exception.code, 'TOOL_NOT_FOUND')
        self.assertNotIn('secret path', output.getvalue())
        with patch.object(backup.subprocess, 'run', side_effect=backup.subprocess.TimeoutExpired('secret command', 1)):
            with self.assertRaises(backup.BackupError) as caught:
                backup.run(['pg_dump'])
        self.assertEqual(caught.exception.code, 'TOOL_TIMEOUT')
        self.assertNotIn('secret command', str(caught.exception))

    def test_r2_codes_allowlisted_and_no_receipt_after_failed_upload_or_readback(self):
        class ClientError(Exception):
            def __init__(self, code):
                super().__init__('secret raw SDK error')
                self.response = {'Error': {'Code': code, 'Message': 'secret raw payload'}, 'ResponseMetadata': {'RequestId': 'private request'}}

        with tempfile.TemporaryDirectory() as root:
            encrypted = Path(root) / 'cipher.age'
            encrypted.write_bytes(b'encrypted fixture')
            for remote_code, expected in [('AccessDenied', 'R2_ACCESS_DENIED'),
                                          ('InvalidAccessKeyId', 'R2_CREDENTIALS_INVALID'),
                                          ('SignatureDoesNotMatch', 'R2_SIGNATURE_INVALID'),
                                          ('NoSuchBucket', 'R2_BUCKET_NOT_FOUND'),
                                          ('PreconditionFailed', 'R2_PRECONDITION_FAILED'),
                                          ('RequestTimeout', 'R2_TIMEOUT'),
                                          ('secret unknown code', 'R2_REQUEST_FAILED')]:
                for method, phase in [('put_object', 'r2_upload'), ('get_object', 'r2_verification')]:
                    client = MagicMock()
                    getattr(client, method).side_effect = ClientError(remote_code)
                    with self.subTest(code=remote_code, phase=phase), contextlib.redirect_stdout(io.StringIO()) as output:
                        with self.assertRaises(backup.BackupError) as caught:
                            backup.upload_verified(client, 'private bucket', 'private key', encrypted)
                    self.assertEqual(caught.exception.code, expected)
                    self.assertIn('phase=' + phase + ' status=failed code=' + expected, output.getvalue())
                    self.assertEqual(client.put_object.call_count, 1)
                    for forbidden in ['secret', 'private bucket', 'private key', 'raw payload', 'private request']:
                        self.assertNotIn(forbidden, output.getvalue() + str(caught.exception))

    def test_r2_receipt_failure_and_encryption_failure_are_separate_phases(self):
        with tempfile.TemporaryDirectory() as root:
            encrypted = Path(root) / 'cipher.age'
            encrypted.write_bytes(b'cipher')
            client = MagicMock()
            client.put_object.side_effect = [None, RuntimeError('secret receipt failure')]
            client.get_object.return_value = {'Body': io.BytesIO(b'cipher'), 'Metadata': {'sha256': backup.sha256(encrypted)}}
            with contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError):
                    backup.upload_verified(client, 'bucket', 'key', encrypted)
            self.assertIn('phase=r2_receipt status=failed', output.getvalue())
            self.assertNotIn('secret receipt failure', output.getvalue())
            with contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError) as caught:
                    backup.encrypt(Path(root), 'secret invalid recipient')
            self.assertEqual(caught.exception.code, 'AGE_RECIPIENT_INVALID')
            self.assertIn('phase=encryption status=failed', output.getvalue())
            self.assertNotIn('secret invalid recipient', output.getvalue())

    def test_s3_protocol_error_and_http_status_are_logged_without_response_contents(self):
        class ClientError(Exception):
            def __init__(self, code, status):
                super().__init__('private exception URL https://private-host secret-key')
                self.response = {
                    'Error': {'Code': code, 'Message': 'private raw payload secret-key', 'Resource': 'private-object'},
                    'ResponseMetadata': {'HTTPStatusCode': status, 'RequestId': 'private-request',
                                         'HTTPHeaders': {'authorization': 'secret-key', 'location': 'https://private-host'}},
                }

        for s3_code, status, mapped in [
            ('NotImplemented', 501, 'R2_NOT_IMPLEMENTED'),
            ('InvalidArgument', 400, 'R2_INVALID_ARGUMENT'),
            ('InvalidRequest', 400, 'R2_INVALID_REQUEST'),
            ('BadDigest', 400, 'R2_BAD_DIGEST'),
            ('MissingContentLength', 411, 'R2_MISSING_CONTENT_LENGTH'),
            ('EntityTooLarge', 413, 'R2_ENTITY_TOO_LARGE'),
            ('RequestTimeTooSkewed', 403, 'R2_CLOCK_SKEW'),
            ('PreconditionFailed', 412, 'R2_PRECONDITION_FAILED'),
            ('AuthorizationHeaderMalformed', 400, 'R2_REQUEST_FAILED'),
        ]:
            with self.subTest(s3_code=s3_code), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError):
                    with backup.phase('r2_upload'):
                        raise ClientError(s3_code, status)
            self.assertIn('code=' + mapped + ' s3_code=' + s3_code + ' http_status=' + str(status), output.getvalue())
            for forbidden in ['private', 'secret-key', 'authorization', 'https://', 'raw payload']:
                self.assertNotIn(forbidden, output.getvalue())

        for code, status in [('secret-key', '400 secret-key'), (['secret-key'], True), (None, 999), ('secret\n::warning::key', -1)]:
            with self.subTest(code=code), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError):
                    with backup.phase('r2_upload'):
                        raise ClientError(code, status)
            self.assertIn('s3_code=Other http_status=Unavailable', output.getvalue())
            self.assertNotIn('secret', output.getvalue())
            self.assertNotIn('::warning::', output.getvalue())

    def test_sdk_suite_runs_with_installed_boto3_in_workflow(self):
        workflow = (MODULE.parents[2] / '.github/workflows/database-backup.yml').read_text()
        self.assertIn('/tmp/backup-venv/bin/python -m unittest discover -s scripts/backup/tests -v', workflow)

    def test_unexpected_errors_in_each_phase_never_echo_sensitive_content(self):
        for name in sorted(backup.PHASES):
            with self.subTest(phase=name), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(backup.BackupError) as caught:
                    with backup.phase(name):
                        raise ValueError('private raw dump password-secret https://private-host')
            self.assertIn('phase=' + name + ' status=failed code=UNEXPECTED_ERROR', output.getvalue())
            for secret in ['private', 'raw dump', 'password-secret', 'https://']:
                self.assertNotIn(secret, output.getvalue() + str(caught.exception))


if __name__ == '__main__':
    unittest.main()
