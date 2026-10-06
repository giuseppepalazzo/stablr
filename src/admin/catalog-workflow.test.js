import { createCatalogWorkflow } from "./catalog-workflow";

test("creates a new draft without a live target and preserves its server identity", async () => {
  const draft = { draft_id: "draft-1", revision: 1, live_entity_id: null };
  const client = { rpc: jest.fn().mockResolvedValue({ data: draft, error: null }) };
  await expect(createCatalogWorkflow(client).createDraft({ entityType: "club", snapshot: { name: "Fixture" } })).resolves.toBe(draft);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_create_draft", expect.objectContaining({
    p_live_entity_id: null, p_parent_draft_id: null, p_base_version_id: null, p_schema_version: 1
  }));
});

test("propagates concurrent-save conflicts instead of reporting a successful save", async () => {
  const conflict = { code: "40001", message: "Draft changed by another save" };
  const client = { rpc: jest.fn().mockResolvedValue({ data: null, error: conflict }) };
  await expect(createCatalogWorkflow(client).saveDraft({ draftId: "draft-1", snapshot: {}, expectedRevision: 2 })).rejects.toBe(conflict);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_save_draft", expect.objectContaining({ p_expected_revision: 2 }));
});

test("restores through the draft RPC and surfaces authorization errors", async () => {
  const denied = { code: "42501", message: "Admin access required" };
  const client = { rpc: jest.fn().mockResolvedValue({ data: null, error: denied }) };
  await expect(createCatalogWorkflow(client).restoreVersion({ versionId: "version-1" })).rejects.toBe(denied);
  expect(client.rpc).toHaveBeenCalledWith("admin_catalog_restore_version", { p_version_id: "version-1", p_parent_draft_id: null });
});

test("accepts a single PostgREST row and rejects an empty result", async () => {
  const draft = { draft_id: "restored-draft", base_version_id: "version-1" };
  const client = { rpc: jest.fn().mockResolvedValueOnce({ data: [draft], error: null }).mockResolvedValueOnce({ data: [], error: null }) };
  const workflow = createCatalogWorkflow(client);
  await expect(workflow.restoreVersion({ versionId: "version-1" })).resolves.toBe(draft);
  await expect(workflow.restoreVersion({ versionId: "version-1" })).rejects.toThrow("no single draft");
});
