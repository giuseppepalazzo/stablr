import { createNewClubCourseService, isNewCourseValid } from "./new-club-course-data";
const owner = "admin-fixture";
const parent = { draft_id: "parent", created_by: owner, entity_type: "club", live_entity_id: null, workflow_status: "draft" };
const child = { draft_id: "child", created_by: owner, entity_type: "route", parent_draft_id: "parent",
  live_entity_id: null, base_version_id: null, base_snapshot: null, schema_version: 1, workflow_status: "draft", revision: 1,
  snapshot: { name: "Percorso", holes_count: 9, display_order: 0 } };
test("uses only the dedicated null-live child workflow RPCs with exact parent, owner and revision", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: [child], error: null }) };
  const service = createNewClubCourseService(client);
  expect(await service.listCourseDrafts(parent, owner)).toEqual([child]);
  expect(await service.saveCourseDraft(parent, null, { name: " Percorso ", holes_count: "9", display_order: "0", tee: "ignored" }, owner)).toEqual(child);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_club_course_save", { p_club_draft_id: "parent", p_draft_id: null, p_expected_revision: null,
    p_snapshot: child.snapshot });
  await service.saveCourseDraft(parent, child, child.snapshot, owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_club_course_save", expect.objectContaining({ p_draft_id: "child", p_expected_revision: 1 }));
  client.rpc.mockResolvedValue({ data: { ...child, workflow_status: "archived", revision: 2 }, error: null });
  await service.abandonCourseDraft(parent, child, owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_club_course_archive", { p_club_draft_id: "parent", p_draft_id: "child", p_expected_revision: 1 });
  expect(service.publishDraft).toBeUndefined();
});
test("name, 9/18 structure and integer order are required; incompatible responses and errors fail explicitly", async () => {
  for (const update of [{ name: " " }, { holes_count: "" }, { holes_count: 12 }, { display_order: "" }, { display_order: 1.2 }, { display_order: 2147483648 }]) {
    expect(isNewCourseValid({ ...child.snapshot, ...update })).toBe(false);
  }
  const client = { rpc: jest.fn() }, service = createNewClubCourseService(client);
  await expect(service.listCourseDrafts(parent, "other-admin")).rejects.toThrow("Owned private");
  expect(client.rpc).not.toHaveBeenCalled();
  for (const update of [{ parent_draft_id: "other" }, { live_entity_id: "live" }, { created_by: "other-admin" },
    { entity_type: "course" }, { base_snapshot: {} }, { snapshot: { ...child.snapshot, is_active: true } },
    { snapshot: { ...child.snapshot, holes_count: "9" } }]) {
    client.rpc.mockResolvedValue({ data: [{ ...child, ...update }], error: null });
    await expect(service.listCourseDrafts(parent, owner)).rejects.toThrow("Invalid private");
  }
  client.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
  await expect(service.saveCourseDraft(parent, child, child.snapshot, owner)).rejects.toEqual({ code: "40001" });
  client.rpc.mockResolvedValue({ data: null, error: null });
  await expect(service.listCourseDrafts(parent, owner)).rejects.toThrow("Invalid private Percorso list");
});
