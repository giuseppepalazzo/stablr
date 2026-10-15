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
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit, parse_qs
from uuid import uuid4


class BackupError(Exception):
    """Only fixed, non-sensitive messages may leave this module."""


def run(args, env=None, text=None):
    try:
        result = subprocess.run(args, env=env, input=text, text=True,
                                capture_output=True, timeout=1800)
    except (OSError, subprocess.TimeoutExpired):
        raise BackupError('Tool unavailable or timed out.') from None
    if result.returncode:
        # pg_dump errors can contain row values/connection details: never relay.
        raise BackupError('Tool failed; no sensitive stderr has been logged.')
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
        raise BackupError('Invalid connection: backup needs TLS/direct or session pooler; restore needs loopback stablr_restore_* .') from None
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
        self.errors = tempfile.TemporaryFile()
        self.process = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                        env=self.env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.errors, text=True)
        try:
            self.process.stdin.write(INVENTORY_SQL)
            self.process.stdin.flush()
            line = self.process.stdout.readline()
            self.inventory = json.loads(line)
        except Exception:
            self.__exit__(None, None, None)
            raise BackupError('Read-only inventory/Auth coverage failed.') from None
        return self.inventory

    def __exit__(self, *_):
        if self.process.poll() is None:
            try:
                self.process.stdin.write('ROLLBACK;\n\\q\n')
                self.process.stdin.flush()
                self.process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait()
        self.process.stdin.close()
        self.process.stdout.close()
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
        raise BackupError('Archive coverage incomplete; upload refused.')
    return {'local_tables': len([t for t in inventory['tables'] if not t['extension_owned'] and t['kind'] != 'f']),
            'auth_tables': len(auth),
            'excluded_foreign_tables': len([t for t in inventory['tables'] if t['kind'] == 'f'])}


def collect(folder, env):
    dump = folder / 'database.dump'
    with Snapshot(env) as inventory:
        client = run(['pg_dump', '--version'])
        major = int(re.search(r'(\d+)\.', client).group(1))
        if major < inventory['server_version_num'] // 10000:
            raise BackupError('PostgreSQL client older than source server.')
        run(['pg_dump', '--format=custom', '--compress=6', '--lock-wait-timeout=60s',
             '--snapshot=' + inventory['snapshot'], '--file=' + str(dump)], env)
        # Exercise all compressed data streams without connecting/restoring SQL.
        run(['pg_restore', '--file=' + os.devnull, str(dump)])
        toc = run(['pg_restore', '--list', str(dump)])
        coverage = verify_coverage(inventory, toc)
        # Globals are separate: role passwords intentionally excluded.
        roles = run(['pg_dumpall', '--roles-only', '--no-role-passwords'], env)
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
    if not re.fullmatch(r'age1[0-9a-z]+', recipient):
        raise BackupError('A native age public recipient is required.')
    bundle = folder / 'bundle.tar'
    with tarfile.open(bundle, 'w') as archive:
        for name in ('database.dump', 'roles.sql', 'archive.list', 'manifest.json'):
            archive.add(folder / name, arcname=name)
    encrypted = folder / 'backup.tar.age'
    run(['age', '--recipient', recipient, '--output', str(encrypted), str(bundle)])
    if not encrypted.is_file() or encrypted.stat().st_size == 0:
        raise BackupError('Encryption failed; upload refused.')
    return encrypted


def upload_verified(client, bucket, key, encrypted):
    digest = sha256(encrypted)
    # Unique key + atomic precondition: no overwrite, including on a race.
    with encrypted.open('rb') as body:
        client.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch='*',
                          ContentType='application/octet-stream', Metadata={'sha256': digest})
    response = client.get_object(Bucket=bucket, Key=key)
    observed = hashlib.sha256()
    try:
        for block in iter(lambda: response['Body'].read(1024 * 1024), b''):
            observed.update(block)
    finally:
        response['Body'].close()
    if observed.hexdigest() != digest or response.get('Metadata', {}).get('sha256') != digest:
        raise BackupError('R2 read-back integrity failed. Backup is not verified.')
    # Success receipt written ONLY after read-back. It contains no DB inventory.
    receipt = json.dumps({'format': 1, 'sha256': digest, 'bytes': encrypted.stat().st_size,
                          'verified_at': datetime.now(timezone.utc).isoformat()}).encode()
    client.put_object(Bucket=bucket, Key=key + '.verified.json', Body=receipt,
                      IfNoneMatch='*', ContentType='application/json')
    return digest


def backup():
    names = ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_R2_ENDPOINT',
             'BACKUP_R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
    if any(not os.environ.get(name) for name in names):
        raise BackupError('Required GitHub Secrets missing.')
    if os.environ.get('BACKUP_RETENTION_10_DAYS_CONFIGURED') != 'true':
        raise BackupError('Configure the R2 10-day lifecycle and acknowledge it before backup.')
    endpoint = os.environ['BACKUP_R2_ENDPOINT']
    if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', endpoint):
        raise BackupError('Invalid R2 HTTPS endpoint.')
    env = db_env(os.environ['BACKUP_DATABASE_URL'])
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=endpoint, region_name='auto',
                          config=Config(retries={'max_attempts': 3, 'mode': 'standard'},
                                        connect_timeout=30, read_timeout=120,
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
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
