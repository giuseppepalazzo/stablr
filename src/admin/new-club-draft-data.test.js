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

const fig = { id: "fig-fixture", name: "Club FIG", city: "Roma", source_system: "fig", source_external_id: "fig-club-fixture" };
function figClient({ linked = [], prior = [], source = fig, error = null } = {}) {
  const queries = [];
  const client = { rpc: jest.fn().mockImplementation(async (name, params) => ({ data: {
    ...draft, snapshot: params.p_snapshot, revision: name.includes("save") ? 2 : 1
  }, error: null })), from: jest.fn((table) => {
    const query = { table, filters: [],
      select: jest.fn(() => query),
      eq: jest.fn((key, value) => { query.filters.push([key, value]);return query; }),
      is: jest.fn(() => query), in: jest.fn(() => query), contains: jest.fn(() => query), ilike: jest.fn(() => query),
      order: jest.fn(() => query), limit: jest.fn(() => query),
      single: jest.fn(async () => ({ data: source, error })),
      maybeSingle: jest.fn(async () => ({ data: source ? { id: source.id } : null, error })),
      then: (resolve) => Promise.resolve({ data: table === "clubs" ? linked : table === "fig_clubs" ? [source] : prior, error }).then(resolve)
    };
    queries.push(query);return query;
  }) };
  return { client, queries };
}

test("search reads only minimal DB FIG fields by literal name/city/reference and deduplicates results", async () => {
  const { client, queries } = figClient();
  const service = createNewClubDraftService(client);
  expect(await service.searchFigClubs("  Roma_%  ", ownerId)).toEqual([{ ...fig, existingClubs: [] }]);
  expect(queries).toHaveLength(7);
  for (const [index, field] of ["name", "city", "source_external_id"].entries()) {
    expect(queries[index].select).toHaveBeenCalledWith("id,name,city,source_system,source_external_id");
    expect(queries[index].eq).toHaveBeenCalledWith("source_system", "fig");
    expect(queries[index].ilike).toHaveBeenCalledWith(field, "%Roma\\_\\%%");
  }
  expect(client.rpc).not.toHaveBeenCalled();
  client.from.mockClear();
  expect(await service.searchFigClubs(" ", ownerId)).toEqual([]);
  expect(client.from).not.toHaveBeenCalled();
});

test("explicit FIG confirmation rereads the record and creates only a null-live draft with reduced provenance", async () => {
  const { client, queries } = figClient();
  const opened = await createNewClubDraftService(client).openDraft(null, ownerId, fig.id);
  expect(queries[0].eq).toHaveBeenCalledWith("id", fig.id);
  expect(queries[1].in).toHaveBeenCalledWith("fig_club_id", [fig.id]);
  expect(opened.snapshot).toEqual({ name: fig.name, city: fig.city, fig_code: fig.source_external_id, fig_source: fig });
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_create_draft", expect.objectContaining({
    p_live_entity_id: null, p_snapshot: opened.snapshot, p_parent_draft_id: null
  }));
  expect(client.rpc).toHaveBeenCalledTimes(1);
  expect(opened.snapshot.fig_club_id).toBeUndefined();
});

test("a FIG-linked live Club (including inactive) blocks creation and returns its exact identity", async () => {
  const existing = { id: "club-existing", name: "Club esistente", is_active: false, fig_club_id: fig.id };
  const { client } = figClient({ linked: [existing] });
  await expect(createNewClubDraftService(client).openDraft(null, ownerId, fig.id)).rejects.toMatchObject({ code: "FIG_CLUB_EXISTS", club: existing });
  expect(client.rpc).not.toHaveBeenCalled();
});

test("confirmation resumes a prior owned FIG draft rather than creating a duplicate", async () => {
  const prior = { ...draft, snapshot: { name: "Bozza curata", city: null, fig_code: fig.source_external_id, fig_source: fig } };
  const { client, queries } = figClient({ prior: [prior] });
  expect(await createNewClubDraftService(client).openDraft(null, ownerId, fig.id)).toEqual(prior);
  expect(queries[5].contains).toHaveBeenCalledWith("snapshot", { fig_source: { id: fig.id } });
  expect(client.rpc).not.toHaveBeenCalled();
});

test("save allows prefilled values to change but preserves selected FIG source without accepting live fields", async () => {
  const figDraft = { ...draft, snapshot: { name: fig.name, city: fig.city, fig_code: fig.source_external_id, fig_source: fig } };
  const { client } = figClient({ source: null });
  const saved = await createNewClubDraftService(client).saveDraft(figDraft, {
    name: "Nome curato", city: "Milano", fig_code: " Codice curato ", fig_source: { id: "forged" }, fig_club_id: "forbidden"
  }, ownerId);
  expect(saved.snapshot).toEqual({ name: "Nome curato", city: "Milano", fig_code: "Codice curato", fig_source: fig });
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_save_draft", expect.objectContaining({ p_snapshot: saved.snapshot, p_expected_revision: 1 }));
});

test("manual exact FIG reference and a newly linked resumed FIG draft cannot bypass existing-Club detection", async () => {
  const existing = { id: "club-existing", name: "Club esistente", fig_club_id: fig.id };
  const { client } = figClient({ linked: [existing] });
  const service = createNewClubDraftService(client);
  await expect(service.saveDraft(draft, { name: "Club manuale", fig_code: fig.source_external_id }, ownerId)).rejects.toMatchObject({ code: "FIG_CLUB_EXISTS" });
  expect(client.rpc).not.toHaveBeenCalled();
  const figDraft = { ...draft, snapshot: { name: fig.name, city: null, fig_source: fig, fig_code: fig.source_external_id } };
  const resumed = figClient({ source: figDraft, linked: [existing] });
  await expect(createNewClubDraftService(resumed.client).openDraft(draft.draft_id, ownerId)).rejects.toMatchObject({ code: "FIG_CLUB_EXISTS" });
  expect(resumed.client.rpc).not.toHaveBeenCalled();
});

test("FIG read errors, ambiguous links and malformed sources fail closed before any draft mutation", async () => {
  for (const options of [{ error: { code: "42501" } }, { linked: [{ id: "1", fig_club_id: fig.id }, { id: "2", fig_club_id: fig.id }] }, { source: { ...fig, source_payload: { secret: "not-allowed" } } }]) {
    const { client } = figClient(options);
    await expect(createNewClubDraftService(client).openDraft(null, ownerId, fig.id)).rejects.toBeDefined();
    expect(client.rpc).not.toHaveBeenCalled();
  }
});

const mareFig = { id: "mare-fig-fixture", name: "Mare Di Roma", city: null, source_system: "fig", source_external_id: "fig-club-mare-di-roma" };
test.each([
  { fig_club_id: mareFig.id, fig_match_status: "matched" },
  { source_system: "fig", source_external_id: mareFig.source_external_id },
  { fig_payload_code: mareFig.source_external_id },
  { fig_payload_legacy_code: mareFig.source_external_id }
])("Mare di Roma is already present from exact stored FIG identity: %j", async (identity) => {
  const existing = { id: "mare-live-fixture", name: "Nome STABLR curato", ...identity };
  const { client, queries } = figClient({ source: mareFig, linked: [existing] });
  const service = createNewClubDraftService(client);
  const results = await service.searchFigClubs("Mare di Roma", ownerId);
  expect(results).toEqual([{ ...mareFig, existingClubs: [existing] }]);
  expect(queries[3].in).toHaveBeenCalledWith("fig_club_id", [mareFig.id]);
  expect(queries[4].eq).toHaveBeenCalledWith("source_system", "fig");
  expect(queries[4].in).toHaveBeenCalledWith("source_external_id", [mareFig.source_external_id]);
  expect(queries[5].in).toHaveBeenCalledWith("source_payload->>figClubCode", [mareFig.source_external_id]);
  expect(queries[6].in).toHaveBeenCalledWith("source_payload->>fig_club_code", [mareFig.source_external_id]);
  expect(queries[3].select.mock.calls[0][0]).not.toMatch(/(?:^|,)source_payload(?:,|$)/);
  await expect(service.openDraft(null, ownerId, mareFig.id)).rejects.toMatchObject({ code: "FIG_CLUB_EXISTS", club: existing });
  expect(client.rpc).not.toHaveBeenCalled();
});

test("identical names, matching status alone and IDs from non-FIG sources do not establish a FIG link", async () => {
  const { client } = figClient({ source: mareFig, linked: [
    { id: "unrelated", name: mareFig.name, fig_match_status: "matched", source_system: "gesgolf", source_external_id: mareFig.source_external_id }
  ] });
  expect(await createNewClubDraftService(client).searchFigClubs("Mare di Roma", ownerId)).toEqual([{ ...mareFig, existingClubs: [] }]);
  expect(client.rpc).not.toHaveBeenCalled();
});

test("failure to check exact links never exposes a FIG result as eligible", async () => {
  const { client } = figClient();
  const from = client.from.getMockImplementation();
  client.from.mockImplementation((table) => {
    const query = from(table);
    if (table === "clubs") query.then = (resolve) => Promise.resolve({ data: null, error: { code: "42501" } }).then(resolve);
    return query;
  });
  await expect(createNewClubDraftService(client).searchFigClubs("Mare", ownerId)).rejects.toEqual({ code: "42501" });
  expect(client.rpc).not.toHaveBeenCalled();
});
