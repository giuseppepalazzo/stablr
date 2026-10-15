"""Logical DB backup. No application imports; secrets never appear in argv/logs.

Only the backup command connects remotely. inspect/restore accept local files;
restore is restricted to an empty, loopback-only stablr_restore_* database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit, parse_qs
from uuid import uuid4


class BackupError(Exception):
    """Only fixed, non-sensitive messages may leave this module."""

    def __init__(self, message, code='BACKUP_FAILED'):
        super().__init__(message)
        self.code = code


PHASES = {'configuration', 'postgres_connection', 'database_export',
          'archive_verification', 'roles_export', 'encryption',
          'r2_client', 'r2_upload', 'r2_verification', 'r2_receipt'}
ERROR_CODES = {
    'BACKUP_FAILED', 'TOOL_NOT_FOUND', 'TOOL_TIMEOUT', 'TOOL_FAILED',
    'PG_AUTH_FAILED', 'PG_DNS_FAILED', 'PG_NETWORK_UNREACHABLE',
    'PG_CONNECTION_REFUSED', 'PG_CONNECTION_TIMEOUT', 'PG_CONNECTION_CLOSED',
    'PG_SSL_FAILED', 'PG_POOLER_REJECTED', 'PG_PERMISSION_DENIED',
    'PG_VERSION_MISMATCH', 'PG_SNAPSHOT_FAILED', 'PG_INVENTORY_FAILED',
    'ENCRYPTION_FAILED', 'AGE_RECIPIENT_INVALID', 'ARCHIVE_COVERAGE_FAILED',
    'R2_ACCESS_DENIED', 'R2_CREDENTIALS_INVALID', 'R2_SIGNATURE_INVALID',
    'R2_BUCKET_NOT_FOUND', 'R2_OBJECT_NOT_FOUND', 'R2_PRECONDITION_FAILED',
    'R2_TIMEOUT', 'R2_CONNECTION_FAILED', 'R2_TLS_FAILED',
    'R2_INTEGRITY_FAILED', 'R2_REQUEST_FAILED', 'UNEXPECTED_ERROR',
    'CONFIG_MISSING_SECRETS', 'CONFIG_RETENTION_NOT_CONFIRMED',
    'CONFIG_R2_ENDPOINT_INVALID', 'CONFIG_DATABASE_URL_INVALID',
    'R2_NOT_IMPLEMENTED', 'R2_INVALID_ARGUMENT', 'R2_INVALID_REQUEST',
    'R2_BAD_DIGEST', 'R2_MISSING_CONTENT_LENGTH', 'R2_ENTITY_TOO_LARGE',
    'R2_CLOCK_SKEW',
    'CONFIG_R2_ACCESS_KEY_INVALID', 'CONFIG_R2_SECRET_KEY_INVALID',
}

# Only canonical protocol codes may reach logs. Never echo arbitrary server
# strings even when they look like an identifier: they could contain secrets.
S3_ERROR_CODES = {
    'AccessDenied', 'Unauthorized', 'InvalidAccessKeyId', 'SignatureDoesNotMatch',
    'NoSuchBucket', 'NoSuchKey', 'PreconditionFailed', 'ConditionalRequestConflict',
    'RequestTimeout', 'RequestTimeoutException', 'NotImplemented',
    'InvalidArgument', 'InvalidRequest', 'InvalidBucketName',
    'AuthorizationHeaderMalformed', 'AuthorizationQueryParametersError',
    'BadDigest', 'InvalidDigest', 'XAmzContentSHA256Mismatch',
    'MissingContentLength', 'IncompleteBody', 'EntityTooLarge', 'EntityTooSmall',
    'InvalidToken', 'ExpiredToken', 'RequestTimeTooSkewed', 'RequestExpired',
    'PermanentRedirect', 'TemporaryRedirect', 'MethodNotAllowed', 'InternalError',
    'ServiceUnavailable', 'SlowDown', 'TooManyRequests', 'InvalidHostHeader',
}


def s3_reason(details):
    """Reduce a provider message to a fixed cause; never return its contents."""
    if not isinstance(details, dict) or not isinstance(details.get('Message'), str):
        return 'Unclassified'
    message = details['Message'].lower()
    if 'credential access key' in message and ('length' in message or 'invalid' in message):
        return 'AccessKeyFormat'
    if 'jurisdiction' in message:
        return 'JurisdictionEndpoint'
    if 'aws-chunked' in message or 'content-encoding' in message:
        return 'ContentEncoding'
    if 'x-amz-trailer' in message or 'checksum' in message:
        return 'Checksum'
    if 'x-amz-content-sha256' in message:
        return 'PayloadSignature'
    if 'if-none-match' in message:
        return 'ConditionalWrite'
    if 'content-length' in message or 'content length' in message:
        return 'ContentLength'
    if 'authorization' in message or 'credential scope' in message:
        return 'Authorization'
    return 'Unclassified'


def s3_diagnostic(error):
    response = getattr(error, 'response', None)
    if not isinstance(response, dict):
        return ''
    details = response.get('Error')
    code = details.get('Code') if isinstance(details, dict) else None
    if not isinstance(code, str) or code not in S3_ERROR_CODES:
        code = 'Other'
    metadata = response.get('ResponseMetadata')
    status = metadata.get('HTTPStatusCode') if isinstance(metadata, dict) else None
    if type(status) is not int or not 100 <= status <= 599:
        status = 'Unavailable'
    return f' s3_code={code} http_status={status} s3_reason={s3_reason(details)}'


def tool_error_code(tool, stderr):
    """Match known diagnostics privately; return constants, never server text."""
    text = stderr.lower() if isinstance(stderr, str) else ''
    if Path(tool).name in ('psql', 'pg_dump', 'pg_dumpall', 'pg_restore'):
        rules = (
            ('PG_AUTH_FAILED', ('password authentication failed', 'no password supplied', 'no pg_hba.conf entry')),
            ('PG_DNS_FAILED', ('could not translate host name', 'name or service not known', 'nodename nor servname', 'temporary failure in name resolution')),
            ('PG_NETWORK_UNREACHABLE', ('network is unreachable', 'no route to host', 'cannot assign requested address')),
            ('PG_CONNECTION_REFUSED', ('connection refused',)),
            ('PG_CONNECTION_TIMEOUT', ('timeout expired', 'connection timed out')),
            ('PG_CONNECTION_CLOSED', ('server closed the connection unexpectedly',)),
            ('PG_SSL_FAILED', ('certificate verify failed', 'ssl error', 'server does not support ssl', 'root certificate file')),
            ('PG_POOLER_REJECTED', ('tenant or user not found', 'max client connections reached')),
            ('PG_PERMISSION_DENIED', ('permission denied', 'must be superuser', 'must have privileges')),
            ('PG_VERSION_MISMATCH', ('server version mismatch',)),
            ('PG_SNAPSHOT_FAILED', ('invalid snapshot identifier', 'cannot import a snapshot')),
        )
        for code, fragments in rules:
            if any(fragment in text for fragment in fragments):
                return code
    if Path(tool).name == 'age' and any(fragment in text for fragment in ('invalid recipient', 'malformed recipient', 'bad checksum')):
        return 'AGE_RECIPIENT_INVALID'
    return 'TOOL_FAILED'


def error_code(error):
    code = getattr(error, 'code', None)
    if isinstance(code, str) and code in ERROR_CODES:
        return code
    # botocore ClientError responses can contain URLs/request IDs/body content.
    # Read only a known status and map it to a hardcoded diagnostic.
    response = getattr(error, 'response', None)
    if isinstance(response, dict):
        code = response.get('Error', {}).get('Code') if isinstance(response.get('Error'), dict) else None
        if not isinstance(code, str):
            return 'R2_REQUEST_FAILED'
        return {
            'AccessDenied': 'R2_ACCESS_DENIED', 'InvalidAccessKeyId': 'R2_CREDENTIALS_INVALID',
            'SignatureDoesNotMatch': 'R2_SIGNATURE_INVALID', 'NoSuchBucket': 'R2_BUCKET_NOT_FOUND',
            'NoSuchKey': 'R2_OBJECT_NOT_FOUND', 'PreconditionFailed': 'R2_PRECONDITION_FAILED',
            'RequestTimeout': 'R2_TIMEOUT', 'RequestTimeoutException': 'R2_TIMEOUT',
            'NotImplemented': 'R2_NOT_IMPLEMENTED', 'InvalidArgument': 'R2_INVALID_ARGUMENT',
            'InvalidRequest': 'R2_INVALID_REQUEST', 'BadDigest': 'R2_BAD_DIGEST',
            'InvalidDigest': 'R2_BAD_DIGEST', 'XAmzContentSHA256Mismatch': 'R2_BAD_DIGEST',
            'MissingContentLength': 'R2_MISSING_CONTENT_LENGTH', 'EntityTooLarge': 'R2_ENTITY_TOO_LARGE',
            'RequestTimeTooSkewed': 'R2_CLOCK_SKEW', 'RequestExpired': 'R2_CLOCK_SKEW',
        }.get(code, 'R2_REQUEST_FAILED')
    return {
        'EndpointConnectionError': 'R2_CONNECTION_FAILED', 'ConnectTimeoutError': 'R2_TIMEOUT',
        'ReadTimeoutError': 'R2_TIMEOUT', 'SSLError': 'R2_TLS_FAILED',
        'NoCredentialsError': 'R2_CREDENTIALS_INVALID', 'PartialCredentialsError': 'R2_CREDENTIALS_INVALID',
    }.get(type(error).__name__, 'UNEXPECTED_ERROR')


@contextmanager
def phase(name):
    if name not in PHASES:
        raise BackupError('Invalid diagnostic phase.')
    print(f'BACKUP phase={name} status=started', flush=True)
    try:
        yield
    except Exception as error:
        code = error_code(error)
        print(f'BACKUP phase={name} status=failed code={code}' + s3_diagnostic(error), flush=True)
        if isinstance(error, BackupError):
            raise
        raise BackupError(f'Phase {name} failed ({code}).', code) from None
    print(f'BACKUP phase={name} status=ok', flush=True)


def run(args, env=None, text=None):
    try:
        result = subprocess.run(args, env=env, input=text, text=True,
                                capture_output=True, timeout=1800)
    except subprocess.TimeoutExpired:
        raise BackupError('Tool timed out.', 'TOOL_TIMEOUT') from None
    except OSError:
        raise BackupError('Tool unavailable.', 'TOOL_NOT_FOUND') from None
    if result.returncode:
        # pg_dump errors can contain row values/connection details: never relay.
        raise BackupError('Tool failed; no sensitive stderr has been logged.', tool_error_code(args[0], result.stderr))
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def db_env(url, restore=False):
    try:
        parsed = urlsplit(url)
        database = unquote(parsed.path[1:])
        port = parsed.port or 5432
        if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not database or not parsed.username:
            raise ValueError()
        if restore:
            if parsed.hostname not in ('localhost', '127.0.0.1', '::1') or not re.fullmatch(r'stablr_restore_[a-z0-9_]+', database):
                raise ValueError()
        elif port == 6543 or parse_qs(parsed.query).get('sslmode', ['require'])[0] not in ('require', 'verify-ca', 'verify-full'):
            raise ValueError()
    except ValueError:
        raise BackupError('Invalid connection: backup needs TLS/direct or session pooler; restore needs loopback stablr_restore_* .', 'CONFIG_DATABASE_URL_INVALID') from None
    # Drop inherited PG service/options which might redirect the connection.
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG') and not k.startswith('BACKUP_')}
    env.update(PGHOST=parsed.hostname, PGPORT=str(port), PGDATABASE=database,
               PGUSER=unquote(parsed.username), PGPASSWORD=unquote(parsed.password or ''),
               PGSSLMODE='disable' if restore else parse_qs(parsed.query).get('sslmode', ['require'])[0],
               PGCONNECT_TIMEOUT='30', PGAPPNAME='stablr-db-backup',
               PGOPTIONS='' if restore else '-c default_transaction_read_only=on -c statement_timeout=1800000')
    return env


# The holder keeps one read-only exported snapshot alive for pg_dump AND counts.
# No SQL functions/tables are created in the source DB.
INVENTORY_SQL = """
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'snapshot', pg_export_snapshot(),
 'server_version', current_setting('server_version'),
 'server_version_num', current_setting('server_version_num')::int,
 'tables', (SELECT coalesce(json_agg(json_build_object('oid',c.oid,'schema',n.nspname,'name',c.relname,
   'kind',c.relkind,'extension_owned',exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')) ORDER BY n.nspname,c.relname),'[]'::json)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'),
 'roles', (SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles),
 'extensions', (SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension),
 'auth_counts', json_build_object('users',(SELECT count(*) FROM auth.users),'identities',(SELECT count(*) FROM auth.identities))
);
"""


class Snapshot:
    def __init__(self, env):
        self.env = env

    def __enter__(self):
        with phase('postgres_connection'):
            self.errors = tempfile.TemporaryFile()
            self.process = None
            try:
                self.process = subprocess.Popen(['psql', '-X', '-qAt', '-w', '-v', 'ON_ERROR_STOP=1'],
                                                env=self.env, stdin=subprocess.PIPE,
                                                stdout=subprocess.PIPE, stderr=self.errors, text=True)
                self.process.stdin.write(INVENTORY_SQL)
                self.process.stdin.flush()
                line = self.process.stdout.readline()
                self.inventory = json.loads(line)
            except Exception as error:
                self.errors.seek(0)
                code = tool_error_code('psql', self.errors.read(16384).decode('utf-8', errors='replace'))
                if isinstance(error, FileNotFoundError):
                    code = 'TOOL_NOT_FOUND'
                elif code == 'TOOL_FAILED':
                    code = 'PG_INVENTORY_FAILED'
                self.__exit__(None, None, None)
                raise BackupError('Read-only inventory/Auth coverage failed.', code) from None
        return self.inventory

    def __exit__(self, *_):
        process = self.process
        if process is not None and process.poll() is None:
            try:
                process.stdin.write('ROLLBACK;\n\\q\n')
                process.stdin.flush()
                process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                if process.poll() is None:
                    process.kill()
                process.wait()
        if process is not None:
            for stream in (process.stdin, process.stdout):
                try:
                    stream.close()
                except OSError:
                    # Closing a failed buffered pipe must never hide the cause.
                    pass
        self.errors.close()


def verify_coverage(inventory, toc):
    """TOC catalog OIDs prove each non-extension local table was included."""
    missing = []
    for table in inventory['tables']:
        if table['extension_owned'] or table['kind'] == 'f':
            continue
        oid = str(table['oid'])
        definition = 'MATERIALIZED VIEW' if table['kind'] == 'm' else 'TABLE'
        if not re.search(r'^\d+; \d+ ' + oid + ' ' + definition + r' (?!DATA )', toc, re.M):
            missing.append(oid)
        if table['kind'] in ('r', 'm'):
            data = 'MATERIALIZED VIEW DATA' if table['kind'] == 'm' else 'TABLE DATA'
            if not re.search(r'^\d+; \d+ ' + oid + ' ' + data + r' ', toc, re.M):
                missing.append(oid)
    auth = {t['name'] for t in inventory['tables'] if t['schema'] == 'auth' and not t['extension_owned']}
    if missing or not {'users', 'identities'}.issubset(auth):
        raise BackupError('Archive coverage incomplete; upload refused.', 'ARCHIVE_COVERAGE_FAILED')
    return {'local_tables': len([t for t in inventory['tables'] if not t['extension_owned'] and t['kind'] != 'f']),
            'auth_tables': len(auth),
            'excluded_foreign_tables': len([t for t in inventory['tables'] if t['kind'] == 'f'])}


def collect(folder, env):
    dump = folder / 'database.dump'
    with Snapshot(env) as inventory:
        with phase('database_export'):
            client = run(['pg_dump', '--version'])
            major = int(re.search(r'(\d+)\.', client).group(1))
            if major < inventory['server_version_num'] // 10000:
                raise BackupError('PostgreSQL client older than source server.', 'PG_VERSION_MISMATCH')
            run(['pg_dump', '-w', '--format=custom', '--compress=6', '--lock-wait-timeout=60s',
                 '--snapshot=' + inventory['snapshot'], '--file=' + str(dump)], env)
        with phase('archive_verification'):
            # Exercise all compressed streams without connecting/restoring SQL.
            run(['pg_restore', '--file=' + os.devnull, str(dump)])
            toc = run(['pg_restore', '--list', str(dump)])
            coverage = verify_coverage(inventory, toc)
        with phase('roles_export'):
            # Globals are separate: role passwords intentionally excluded.
            roles = run(['pg_dumpall', '-w', '--roles-only', '--no-role-passwords'], env)
    (folder / 'roles.sql').write_text(roles)
    (folder / 'archive.list').write_text(toc)
    inventory.pop('snapshot')
    manifest = {'format': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
                'client_version': client.strip(), 'inventory': inventory, 'coverage': coverage,
                'files': {name: sha256(folder / name) for name in ('database.dump', 'roles.sql', 'archive.list')},
                'limits': ['no Storage object bytes', 'no Supabase project settings/secrets',
                           'no database role passwords', 'foreign table contents excluded',
                           'extension-owned objects follow pg_dump extension rules; matching extensions required',
                           'role globals are not part of the database MVCC snapshot']}
    (folder / 'manifest.json').write_text(json.dumps(manifest))
    return manifest


def encrypt(folder, recipient):
    with phase('encryption'):
        if not re.fullmatch(r'age1[0-9a-z]+', recipient):
            raise BackupError('A native age public recipient is required.', 'AGE_RECIPIENT_INVALID')
        bundle = folder / 'bundle.tar'
        with tarfile.open(bundle, 'w') as archive:
            for name in ('database.dump', 'roles.sql', 'archive.list', 'manifest.json'):
                archive.add(folder / name, arcname=name)
        encrypted = folder / 'backup.tar.age'
        run(['age', '--recipient', recipient, '--output', str(encrypted), str(bundle)])
        if not encrypted.is_file() or encrypted.stat().st_size == 0:
            raise BackupError('Encryption failed; upload refused.', 'ENCRYPTION_FAILED')
    return encrypted


def upload_verified(client, bucket, key, encrypted):
    digest = sha256(encrypted)
    # Unique key + atomic precondition: no overwrite, including on a race.
    with phase('r2_upload'):
        with encrypted.open('rb') as body:
            client.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch='*',
                              ContentLength=encrypted.stat().st_size,
                              ContentType='application/octet-stream', Metadata={'sha256': digest})
    with phase('r2_verification'):
        response = client.get_object(Bucket=bucket, Key=key)
        observed = hashlib.sha256()
        try:
            for block in iter(lambda: response['Body'].read(1024 * 1024), b''):
                observed.update(block)
        finally:
            response['Body'].close()
        if observed.hexdigest() != digest or response.get('Metadata', {}).get('sha256') != digest:
            raise BackupError('R2 read-back integrity failed. Backup is not verified.', 'R2_INTEGRITY_FAILED')
    # Success receipt written ONLY after read-back. It contains no DB inventory.
    receipt = json.dumps({'format': 1, 'sha256': digest, 'bytes': encrypted.stat().st_size,
                          'verified_at': datetime.now(timezone.utc).isoformat()}).encode()
    with phase('r2_receipt'):
        client.put_object(Bucket=bucket, Key=key + '.verified.json', Body=receipt,
                          ContentLength=len(receipt), IfNoneMatch='*', ContentType='application/json')
    return digest


def r2_client(endpoint):
    # R2 S3 credentials are the token ID (32 hex) and hashed token value
    # (64 hex), NOT the Cloudflare bearer token/account ID. Never transform
    # tokens or silently exchange swapped fields; report configuration errors.
    access_key = os.environ.get('AWS_ACCESS_KEY_ID', '')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY', '')
    account = (urlsplit(endpoint).hostname or '').split('.')[0]
    if not re.fullmatch(r'[a-fA-F0-9]{32}', access_key) or access_key.lower() == account.lower():
        raise BackupError('Use the R2 S3 Access Key ID, not a Cloudflare API bearer token.', 'CONFIG_R2_ACCESS_KEY_INVALID')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', secret_key):
        raise BackupError('Use the R2 S3 Secret Access Key paired with the Access Key ID.', 'CONFIG_R2_SECRET_KEY_INVALID')
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=endpoint, region_name='auto',
                        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
                        aws_session_token=None,
                        config=Config(retries={'max_attempts': 3, 'mode': 'standard'},
                                      signature_version='s3v4', s3={'addressing_style': 'path'},
                                      connect_timeout=30, read_timeout=120,
                                      request_checksum_calculation='when_required',
                                      response_checksum_validation='when_required'))


def backup():
    names = ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_R2_ENDPOINT',
             'BACKUP_R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
    with phase('configuration'):
        if any(not os.environ.get(name) for name in names):
            raise BackupError('Required GitHub Secrets missing.', 'CONFIG_MISSING_SECRETS')
        if os.environ.get('BACKUP_RETENTION_10_DAYS_CONFIGURED') != 'true':
            raise BackupError('Configure the R2 10-day lifecycle and acknowledge it before backup.', 'CONFIG_RETENTION_NOT_CONFIRMED')
        endpoint = os.environ['BACKUP_R2_ENDPOINT']
        if not re.fullmatch(r'https://[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com', endpoint):
            raise BackupError('Invalid R2 HTTPS endpoint.', 'CONFIG_R2_ENDPOINT_INVALID')
        env = db_env(os.environ['BACKUP_DATABASE_URL'])
    with phase('r2_client'):
        client = r2_client(endpoint)
    with tempfile.TemporaryDirectory(prefix='stablr-backup-') as private:
        folder = Path(private)
        manifest = collect(folder, env)
        encrypted = encrypt(folder, os.environ['BACKUP_AGE_RECIPIENT'])
        key = 'database/' + datetime.now(timezone.utc).strftime('%Y/%m/%d/') + str(uuid4()) + '.tar.age'
        digest = upload_verified(client, os.environ['BACKUP_R2_BUCKET'], key, encrypted)
    # Object key and ciphertext hash are non-sensitive; never output inventory.
    summary = 'Verified encrypted backup: ' + key + '\nSHA256: ' + digest + '\nCoverage: schema/data, Auth; ' + str(manifest['coverage']['auth_tables']) + ' Auth tables.\n'
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(summary)


def open_bundle(encrypted, receipt, identity, folder):
    expected = json.loads(Path(receipt).read_text())
    if not re.fullmatch(r'[a-f0-9]{64}', expected.get('sha256', '')) or sha256(encrypted) != expected['sha256']:
        raise BackupError('Ciphertext checksum mismatch.')
    bundle = folder / 'bundle.tar'
    run(['age', '--decrypt', '--identity', str(identity), '--output', str(bundle), str(encrypted)])
    allowed = {'database.dump', 'roles.sql', 'archive.list', 'manifest.json'}
    with tarfile.open(bundle) as archive:
        members = archive.getmembers()
        if len(members) != 4 or {m.name for m in members} != allowed or any(not m.isfile() for m in members):
            raise BackupError('Unsafe archive entries.')
        # Do not use extractall: no paths or symlinks from an archive.
        for member in members:
            with archive.extractfile(member) as source, (folder / member.name).open('wb') as dest:
                while block := source.read(1024 * 1024):
                    dest.write(block)
    manifest = json.loads((folder / 'manifest.json').read_text())
    if manifest.get('format') != 1 or set(manifest.get('files', {})) != allowed - {'manifest.json'}:
        raise BackupError('Invalid backup manifest.')
    if any(sha256(folder / name) != digest for name, digest in manifest['files'].items()):
        raise BackupError('Decrypted archive checksum mismatch.')
    verify_coverage(manifest['inventory'], run(['pg_restore', '--list', str(folder / 'database.dump')]))
    return manifest


def restore(folder, manifest, url):
    env = db_env(url, restore=True)
    # Require a new empty DB, not a running Supabase installation. No DROP/CLEAN.
    count = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c',
                 "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'"], env).strip()
    if count != '0':
        raise BackupError('Restore target must be empty; existing data will not be overwritten.')
    existing = json.loads(run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT json_agg(rolname) FROM pg_roles'], env))
    # Forensic sandbox only: inert names satisfy policies/ACL; never replay role
    # passwords, login privileges or superuser/BYPASSRLS globals automatically.
    for name in manifest['inventory']['roles']:
        if name not in existing and not name.startswith('pg_'):
            quoted = '"' + name.replace('"', '""') + '"'
            run(['psql', '-X', '-v', 'ON_ERROR_STOP=1'], env, 'CREATE ROLE ' + quoted + ' NOLOGIN;')
    run(['pg_restore', '--exit-on-error', '--single-transaction', '--no-owner',
         '--dbname=' + env['PGDATABASE'], str(folder / 'database.dump')], env)
    counts = json.loads(run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c',
                            "SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'identities',(SELECT count(*) FROM auth.identities))"], env))
    if counts != manifest['inventory']['auth_counts']:
        raise BackupError('Restored Auth counts mismatch.')
    print('Isolated database restore and Auth counts verified. Production security/configuration NOT certified.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=('backup', 'inspect', 'restore'))
    parser.add_argument('--encrypted')
    parser.add_argument('--receipt')
    parser.add_argument('--identity')
    parser.add_argument('--confirm-isolated', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.operation == 'backup':
            backup()
        else:
            if not all((args.encrypted, args.receipt, args.identity)):
                raise BackupError('Encrypted file, receipt and offline identity are required.')
            if args.operation == 'restore' and not args.confirm_isolated:
                raise BackupError('Explicit isolated restore confirmation required.')
            with tempfile.TemporaryDirectory(prefix='stablr-restore-') as private:
                folder = Path(private)
                manifest = open_bundle(args.encrypted, args.receipt, args.identity, folder)
                if args.operation == 'inspect':
                    print('Archive decrypted; coverage and file checksums verified.')
                else:
                    restore(folder, manifest, os.environ.get('RESTORE_DATABASE_URL', ''))
    except BackupError as error:
        print('Backup/restore failed: ' + str(error), file=sys.stderr)
        return 1
    except Exception:
        # Never stringify arbitrary exceptions: SDK errors can contain URLs/keys.
        print('Backup/restore failed; no credentials or database content logged. Check configuration, tools, coverage and isolated target.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
