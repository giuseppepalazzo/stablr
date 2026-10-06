// Isolated PostgreSQL integration test; fixtures never reach production.
// Uses @electric-sql/pglite (PostgreSQL WASM) installed outside the application.
// node --test scripts/tests/admin-catalog-workflow.test.mjs
// Set STABLR_PGLITE_MODULE to its absolute entrypoint if not installed locally.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const { PGlite } = await import(process.env.STABLR_PGLITE_MODULE || "@electric-sql/pglite");
const migration = await readFile(new URL("../../supabase/admin-catalog-workflow.sql", import.meta.url), "utf8");
const admin = "11111111-1111-4111-8111-111111111111";
const player = "22222222-2222-4222-8222-222222222222";
const club = "33333333-3333-4333-8333-333333333333";

test("catalog workflow foundation on isolated PostgreSQL", async (t) => {
  const db = new PGlite();
  const asRole = async (role, userId = "") => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [userId, role]);
  };
  const create = async (type, snapshot = {}, target = null, parent = null, base = null, schemaVersion = 1) => {
    const result = await db.query("select * from public.admin_catalog_create_draft($1, $2::jsonb, $3::uuid, $4::uuid, $5::uuid, $6)", [type, JSON.stringify(snapshot), target, parent, base, schemaVersion]);
    return result.rows[0];
  };
  const save = async (draftId, snapshot, revision) => {
    const result = await db.query("select * from public.admin_catalog_save_draft($1::uuid, $2::jsonb, $3::bigint)", [draftId, JSON.stringify(snapshot), revision]);
    return result.rows[0];
  };
  const count = async (table) => (await db.query(`select count(*)::int as total from public.${table}`)).rows[0].total;
  const failsWith = async (operation, code) => assert.rejects(operation, (error) => error.code === code);

  try {
    // Minimum schema contracts matching the inspected catalog. All records below
    // are test fixtures, including the published version inserted by the owner.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.profiles (id uuid primary key references auth.users, role text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role', true), '');
      $$;
      grant usage on schema auth to anon, authenticated, service_role;
      create function public.is_admin() returns boolean language sql stable security definer
        set search_path = pg_catalog as $$
          select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
        $$;
      insert into auth.users values ('${admin}'), ('${player}');
      insert into public.profiles values ('${admin}', 'admin'), ('${player}', 'user');
      create table public.clubs (id uuid primary key, name text, is_active boolean, data_status text);
      insert into public.clubs values ('${club}', 'Live fixture', true, 'needs_review');
      create table public.course_routes (id uuid primary key);
      create table public.route_combinations (id uuid primary key);
      create table public.route_holes (id uuid primary key);
      create table public.route_combination_holes (id uuid primary key);
      create table public.route_tees (id uuid primary key);
      create table public.combination_tees (id uuid primary key);
    `);
    const liveBefore = (await db.query("select * from public.clubs")).rows;
    await db.exec(migration);
    let newDraft;
    let existingDraft;
    let versionId;

    await t.test("migration creates no drafts or versions", async () => {
      assert.equal(await count("admin_catalog_drafts"), 0);
      assert.equal(await count("admin_catalog_versions"), 0);
    });

    await t.test("anon cannot read tables or execute any workflow RPC", async () => {
      await asRole("anon");
      await failsWith(() => count("admin_catalog_drafts"), "42501");
      await failsWith(() => count("admin_catalog_versions"), "42501");
      await failsWith(() => create("club"), "42501");
      await failsWith(() => save(club, {}, 1), "42501");
      await failsWith(() => db.query("select public.admin_catalog_restore_version($1::uuid)", [club]), "42501");
    });

    await t.test("authenticated players cannot execute workflow mutations", async () => {
      await asRole("authenticated", player);
      assert.equal(await count("admin_catalog_drafts"), 0);
      await failsWith(() => create("club"), "42501");
      await failsWith(() => save(club, {}, 1), "42501");
      await failsWith(() => db.query("select public.admin_catalog_restore_version($1::uuid)", [club]), "42501");
      await failsWith(() => db.query("select public.admin_catalog_require_admin()"), "42501");
      await asRole("authenticated");
      await failsWith(() => create("club"), "42501");
    });

    await t.test("Admin creates independent new and live-linked drafts", async () => {
      await asRole("authenticated", admin);
      newDraft = await create("club", { name: "New fixture" });
      assert.ok(newDraft.draft_id);
      assert.ok(newDraft.entity_key);
      assert.equal(newDraft.live_entity_id, null);
      assert.equal(newDraft.created_by, admin);
      assert.equal(newDraft.updated_by, admin);
      assert.equal(newDraft.workflow_status, "draft");
      assert.equal(newDraft.schema_version, 1);
      existingDraft = await create("club", { name: "Edited fixture" }, club);
      assert.equal(existingDraft.live_entity_id, club);
      assert.equal(existingDraft.entity_key, club);
      assert.equal(await count("admin_catalog_drafts"), 2);
      await failsWith(() => db.query("update public.admin_catalog_drafts set workflow_status = 'archived'"), "42501");
      await failsWith(() => db.query("delete from public.admin_catalog_drafts"), "42501");
      await failsWith(() => db.query("insert into public.admin_catalog_versions default values"), "42501");
    });

    await t.test("validates entity types, live references, snapshots and parent hierarchy", async () => {
      await failsWith(() => create("auth.users"), "22023");
      await failsWith(() => create("club", {}, player), "22023");
      await failsWith(() => create("course", {}, club), "22023");
      await failsWith(() => create("club", []), "22023");
      await failsWith(() => create("club", null), "22023");
      await failsWith(() => create("club", {}, null, null, null, 2), "22023");
      const courseDraft = await create("course", {}, null, newDraft.draft_id);
      const routeDraft = await create("route", {}, null, courseDraft.draft_id);
      const holeDraft = await create("hole", {}, null, routeDraft.draft_id);
      assert.equal(holeDraft.parent_draft_id, routeDraft.draft_id);
      await create("route_tee", {}, null, routeDraft.draft_id);
      await failsWith(() => create("club", {}, null, holeDraft.draft_id), "22023");
      await failsWith(() => create("hole", {}, null, newDraft.draft_id), "22023");
      await failsWith(() => create("route", {}, null, player), "22023");
    });

    await t.test("saving is atomic and rejects stale or archived drafts", async () => {
      const results = await Promise.allSettled([
        save(existingDraft.draft_id, { name: "Save A" }, 1),
        save(existingDraft.draft_id, { name: "Save B" }, 1)
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.code, "40001");
      await failsWith(() => save(existingDraft.draft_id, {}, null), "22023");
      await db.exec("reset role");
      await db.query("update public.admin_catalog_drafts set workflow_status = 'archived' where draft_id = $1", [existingDraft.draft_id]);
      await asRole("authenticated", admin);
      await failsWith(() => save(existingDraft.draft_id, {}, 2), "40001");
    });

    await t.test("published versions are immutable, including owner writes and truncate", async () => {
      await db.exec("reset role");
      const result = await db.query(`insert into public.admin_catalog_versions (
        entity_type, entity_key, live_entity_id, source_draft_id, version_number, snapshot, published_by
      ) values ('club', $1, $2, $3, 1, '{"name":"Published fixture"}', $4) returning version_id`,
      [newDraft.entity_key, club, newDraft.draft_id, admin]);
      versionId = result.rows[0].version_id;
      await failsWith(() => db.query("update public.admin_catalog_versions set snapshot = '{}'"), "55000");
      await failsWith(() => db.query("delete from public.admin_catalog_versions"), "55000");
      await failsWith(() => db.exec("truncate public.admin_catalog_versions cascade"), "55000");
      await failsWith(() => db.query("delete from public.admin_catalog_drafts"), "55000");
      await failsWith(() => db.exec("truncate public.admin_catalog_drafts cascade"), "55000");
      await failsWith(() => db.query("delete from auth.users where id = $1", [admin]), "23503");
    });

    await t.test("restore creates a fresh draft with base, stable lineage and snapshot", async () => {
      await asRole("authenticated", admin);
      const before = await count("admin_catalog_drafts");
      const restored = (await db.query("select * from public.admin_catalog_restore_version($1)", [versionId])).rows[0];
      assert.notEqual(restored.draft_id, newDraft.draft_id);
      assert.equal(restored.entity_key, newDraft.entity_key);
      assert.equal(restored.live_entity_id, club);
      assert.equal(restored.base_version_id, versionId);
      assert.deepEqual(restored.snapshot, { name: "Published fixture" });
      assert.equal(await count("admin_catalog_drafts"), before + 1);
      assert.equal(await count("admin_catalog_versions"), 1);
      await failsWith(() => create("route", {}, null, null, versionId), "22023");
      await failsWith(() => db.query("select public.admin_catalog_restore_version($1)", [player]), "22023");
    });

    await t.test("players cannot read persisted drafts/versions; service API cannot write", async () => {
      await asRole("authenticated", player);
      assert.equal(await count("admin_catalog_drafts"), 0);
      assert.equal(await count("admin_catalog_versions"), 0);
      await asRole("service_role");
      await failsWith(() => create("club"), "42501");
      await failsWith(() => db.query("insert into public.admin_catalog_drafts default values"), "42501");
      await failsWith(() => db.query("insert into public.admin_catalog_versions default values"), "42501");
    });

    await t.test("live catalog and external review status remain unchanged", async () => {
      await db.exec("reset role");
      assert.deepEqual((await db.query("select * from public.clubs")).rows, liveBefore);
    });

    await t.test("a repeated application fails atomically and preserves stored history", async () => {
      const before = await count("admin_catalog_drafts");
      await failsWith(() => db.exec(migration), "42P07");
      await db.exec("rollback");
      assert.equal(await count("admin_catalog_drafts"), before);
      assert.equal(await count("admin_catalog_versions"), 1);
    });
  } finally {
    await db.close();
  }
});
