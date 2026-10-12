import { createNewClubDraftService } from "./new-club-draft-data";

const ownerId = "admin-fixture";
const draft = {
  draft_id: "new-club-fixture", entity_type: "club", live_entity_id: null,
  parent_draft_id: null, base_version_id: null, base_snapshot: null,
  created_by: ownerId, workflow_status: "draft", schema_version: 1, revision: 1,
  snapshot: { name: "", city: null }
};
function makeClient(data = draft) {
  const query = {
    select: jest.fn(() => query), eq: jest.fn(() => query), is: jest.fn(() => query),
    order: jest.fn().mockResolvedValue({ data: [data], error: null }),
    single: jest.fn().mockResolvedValue({ data, error: null })
  };
  return { query, from: jest.fn(() => query), rpc: jest.fn().mockResolvedValue({ data, error: null }) };
}

test("creates only an independent Club workflow draft with no live or FIG identity", async () => {
  const client = makeClient();
  const service = createNewClubDraftService(client);
  expect(await service.openDraft(null, ownerId)).toEqual(draft);
  expect(client.rpc).toHaveBeenCalledTimes(1);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_create_draft", {
    p_entity_type: "club", p_snapshot: { name: "", city: null }, p_live_entity_id: null,
    p_parent_draft_id: null, p_base_version_id: null, p_schema_version: 1
  });
  expect(client.from).not.toHaveBeenCalled();
  expect(service.publishDraft).toBeUndefined();
});

test("lists and resumes only current Admin's independent open Club drafts", async () => {
  const client = makeClient();
  const service = createNewClubDraftService(client);
  expect(await service.listDrafts(ownerId)).toEqual([draft]);
  expect(client.from).toHaveBeenCalledWith("admin_catalog_drafts");
  for (const [field, value] of [["created_by", ownerId], ["entity_type", "club"], ["workflow_status", "draft"], ["schema_version", 1]]) {
    expect(client.query.eq).toHaveBeenCalledWith(field, value);
  }
  for (const field of ["live_entity_id", "parent_draft_id", "base_version_id", "base_snapshot"]) {
    expect(client.query.is).toHaveBeenCalledWith(field, null);
  }
  expect(await service.openDraft(draft.draft_id, ownerId)).toEqual(draft);
  expect(client.query.eq).toHaveBeenCalledWith("draft_id", draft.draft_id);
  expect(client.rpc).not.toHaveBeenCalled();
});

test("save sends only normalized name/city and the expected revision, never live fields", async () => {
  const saved = { ...draft, revision: 2, snapshot: { name: "Nuovo club", city: null } };
  const client = makeClient([saved]);
  const service = createNewClubDraftService(client);
  expect(await service.saveDraft(draft, { name: " Nuovo club ", city: "  ", fig_club_id: "forbidden", playable: true }, ownerId)).toEqual(saved);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_save_draft", {
    p_draft_id: draft.draft_id, p_snapshot: { name: "Nuovo club", city: null },
    p_expected_revision: 1, p_schema_version: 1
  });
  expect(client.from).not.toHaveBeenCalled();
});

test("name is required on save and respects existing Club field lengths", async () => {
  const client = makeClient();
  const service = createNewClubDraftService(client);
  for (const fields of [{ name: " " }, { name: "x".repeat(201) }, { name: "Club", city: "x".repeat(201) }]) {
    await expect(service.saveDraft(draft, fields, ownerId)).rejects.toThrow("validation failed");
  }
  expect(client.rpc).not.toHaveBeenCalled();
});

test.each([
  { created_by: "another-admin" }, { live_entity_id: "existing-club" },
  { entity_type: "route" }, { workflow_status: "archived" }, { schema_version: 2 },
  { base_snapshot: { name: "Existing" } }, { parent_draft_id: "parent" },
  { base_version_id: "version" }, { snapshot: { name: "Club", city: null, fig_club_id: "fig" } }
])("rejects a different owner, live-linked or incompatible draft: %j", async (change) => {
  const client = makeClient({ ...draft, ...change });
  const service = createNewClubDraftService(client);
  await expect(service.openDraft(draft.draft_id, ownerId)).rejects.toThrow("Invalid owned");
  await expect(service.saveDraft({ ...draft, ...change }, { name: "Club" }, ownerId)).rejects.toThrow("Invalid owned");
  await expect(service.abandonDraft({ ...draft, ...change }, ownerId)).rejects.toThrow("Invalid owned");
  expect(client.rpc).not.toHaveBeenCalled();
});

test("archives the owned draft without deletion, publication or live queries", async () => {
  const archived = { ...draft, workflow_status: "archived", revision: 2 };
  const client = makeClient(archived);
  expect(await createNewClubDraftService(client).abandonDraft(draft, ownerId)).toEqual(archived);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_archive_draft", {
    p_draft_id: draft.draft_id, p_entity_type: "club", p_expected_revision: 1
  });
  expect(client.from).not.toHaveBeenCalled();
});

test("missing identity and RPC/query failures never become empty success", async () => {
  const client = makeClient();
  const service = createNewClubDraftService(client);
  await expect(service.openDraft(null, null)).rejects.toThrow("Authenticated Admin required");
  await expect(service.listDrafts(null)).rejects.toThrow("Authenticated Admin required");
  expect(client.rpc).not.toHaveBeenCalled();
  const failure = { code: "40001" };
  client.rpc.mockResolvedValue({ data: null, error: failure });
  await expect(service.saveDraft(draft, { name: "Club" }, ownerId)).rejects.toEqual(failure);
  client.query.order.mockResolvedValue({ data: null, error: { code: "42501" } });
  await expect(service.listDrafts(ownerId)).rejects.toEqual({ code: "42501" });
});
