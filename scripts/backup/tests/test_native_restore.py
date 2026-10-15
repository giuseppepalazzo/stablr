"""Optional real-tools smoke test, synthetic loopback DB only (never Supabase).

CI runs this as the unprivileged postgres user before injecting any Secrets.
Locally skipped if PostgreSQL/age tools are absent or the user is root.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('native_backup', Path(__file__).resolve().parents[1] / 'database_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
TOOLS = ('initdb', 'pg_ctl', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'age', 'age-keygen')
READY = all(shutil.which(name) for name in TOOLS) and os.geteuid() != 0


@unittest.skipUnless(READY, 'Requires real PostgreSQL/age tools and non-root local user')
class NativeRestoreTest(unittest.TestCase):
    def test_synthetic_schema_auth_acl_encrypt_decrypt_restore_and_tamper(self):
        with tempfile.TemporaryDirectory(prefix='stablr-backup-native-') as root:
            folder = Path(root)
            cluster = folder / 'pgdata'
            with socket.socket() as candidate:
                candidate.bind(('127.0.0.1', 0))
                port = candidate.getsockname()[1]
            backup.run(['initdb', '-D', str(cluster), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'])
            started = False
            try:
                backup.run(['pg_ctl', 'start', '-D', str(cluster), '-l', str(folder / 'postgres.log'),
                            '-o', f'-h 127.0.0.1 -p {port} -k {root}', '-w'])
                started = True
                env = {k: v for k, v in os.environ.items() if not k.startswith('PG') and not k.startswith('BACKUP_') and not k.startswith('AWS_')}
                env.update(PGHOST='127.0.0.1', PGPORT=str(port), PGUSER='postgres', PGDATABASE='postgres', PGSSLMODE='disable')
                backup.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1'], env, """
CREATE ROLE authenticated NOLOGIN;
CREATE DATABASE fixture_source;
CREATE DATABASE stablr_restore_fixture;
""")
                env['PGDATABASE'] = 'fixture_source'
                backup.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1'], env, """
CREATE SCHEMA auth;
CREATE TABLE auth.users(id integer PRIMARY KEY, email text, encrypted_password text);
CREATE TABLE auth.identities(id integer PRIMARY KEY, user_id integer REFERENCES auth.users);
CREATE TABLE public.clubs(id integer PRIMARY KEY, name text);
CREATE TABLE public.profiles(id integer REFERENCES auth.users, name text);
CREATE TABLE public.partition_root(id integer) PARTITION BY RANGE(id);
CREATE TABLE public.partition_one PARTITION OF public.partition_root FOR VALUES FROM(0) TO(10);
CREATE MATERIALIZED VIEW public.club_count AS SELECT count(*) n FROM public.clubs;
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_fixture ON public.clubs FOR SELECT TO authenticated USING(true);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.clubs TO authenticated;
CREATE FUNCTION public.fixture_rpc() RETURNS integer LANGUAGE sql STABLE AS 'SELECT 1';
INSERT INTO auth.users VALUES(1,'fixture@example.invalid','synthetic-hash');
INSERT INTO auth.identities VALUES(1,1);
INSERT INTO public.clubs VALUES(1,'Synthetic fixture');
INSERT INTO public.profiles VALUES(1,'Synthetic fixture');
INSERT INTO public.partition_one VALUES(1);
REFRESH MATERIALIZED VIEW public.club_count;
""")
                env['PGOPTIONS'] = '-c default_transaction_read_only=on'
                exported = folder / 'export'
                exported.mkdir()
                manifest = backup.collect(exported, env)
                self.assertEqual(manifest['inventory']['auth_counts'], {'users': 1, 'identities': 1})
                identity = folder / 'offline.key'
                backup.run(['age-keygen', '-o', str(identity)])
                recipient = backup.run(['age-keygen', '-y', str(identity)]).strip()
                encrypted = backup.encrypt(exported, recipient)
                receipt = folder / 'receipt.json'
                receipt.write_text(json.dumps({'sha256': backup.sha256(encrypted)}))
                decoded = folder / 'decode'
                decoded.mkdir()
                verified = backup.open_bundle(encrypted, receipt, identity, decoded)
                backup.restore(decoded, verified, f'postgres://postgres@127.0.0.1:{port}/stablr_restore_fixture')
                env['PGDATABASE'] = 'stablr_restore_fixture'
                restored = backup.run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', """
SELECT json_build_object('club',(SELECT name FROM public.clubs),'profiles',(SELECT count(*) FROM public.profiles),
 'partition',(SELECT count(*) FROM public.partition_root),'materialized',(SELECT n FROM public.club_count),
 'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass),
 'grant',has_table_privilege('authenticated','public.clubs','SELECT'),
 'rpc',public.fixture_rpc());
"""], env)
                self.assertEqual(json.loads(restored), dict(club='Synthetic fixture', profiles=1, partition=1, materialized=1, rls=True, grant=True, rpc=1))
                # Integrity failure before any decryption/restore call.
                encrypted.write_bytes(encrypted.read_bytes() + b'corrupted')
                with self.assertRaises(backup.BackupError):
                    backup.open_bundle(encrypted, receipt, identity, decoded)
            finally:
                if started:
                    backup.run(['pg_ctl', 'stop', '-D', str(cluster), '-m', 'fast', '-w'])
