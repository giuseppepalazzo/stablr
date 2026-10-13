import { createNewClubHolesService, normalizeNewClubHoles, validateNewClubHoles } from "./new-club-holes-data";
const owner = "admin", course = { draft_id: "course", entity_type: "route", created_by: owner, parent_draft_id: "club",
  live_entity_id: null, workflow_status: "draft", revision: 2, snapshot: { name: "Nove", holes_count: 9, display_order: 0 } };
const grid = (count) => ({ holes_count: count, holes: Array.from({ length: count }, (_, i) => ({ physical_hole_number: i + 1, par: 4, stroke_index: i + 1 })) });
const draft = { draft_id: "grid", entity_type: "new_course_holes_grid", created_by: owner, parent_draft_id: "course", live_entity_id: null,
  workflow_status: "draft", schema_version: 1, revision: 1, snapshot: grid(9) };
test.each([9,18])("private %i grid is configured only with complete Par 3/4/5 and SI permutation 1..N", (count) => {
  const full = grid(count);expect(validateNewClubHoles(full)).toMatchObject({ configured: true, totalPar: count * 4 });
  const incomplete = structuredCloneForTest(full);incomplete.holes[0].par = null;
  expect(validateNewClubHoles(incomplete)).toMatchObject({ canSave: true, configured: false, completePar: false });
  for (const value of [2,6,4.5]) { incomplete.holes[0].par = value;expect(validateNewClubHoles(incomplete).canSave).toBe(false); }
  const duplicate = structuredCloneForTest(full);duplicate.holes[1].stroke_index = 1;
  expect(validateNewClubHoles(duplicate)).toMatchObject({ configured: false, canSave: false, duplicateSi: true, missingSi: [2] });
  duplicate.holes[1].stroke_index = count + 1;expect(validateNewClubHoles(duplicate).canSave).toBe(false);
  const number = structuredCloneForTest(full);number.holes[1].physical_hole_number = 1;expect(validateNewClubHoles(number).canSave).toBe(false);
  expect(validateNewClubHoles({ ...full, holes: full.holes.slice(1) }).configured).toBe(false);
});
const structuredCloneForTest = (value) => JSON.parse(JSON.stringify(value));
test("private RPC contract uses parent/owner and both revisions, never live hole identity or publisher", async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: { course, draft }, error: null }) }, service = createNewClubHolesService(client);
  expect(await service.openCourseHoleDraft(course, owner)).toEqual({ course, draft });
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_course_holes_open", { p_course_draft_id: "course" });
  const edited = grid(9);edited.holes[0].par = "3";edited.holes[0].stroke_index = "";
  client.rpc.mockResolvedValue({ data: [{ ...draft, snapshot: normalizeNewClubHoles(edited), revision: 2 }], error: null });
  await service.saveCourseHoleDraft(course, draft, edited, owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_course_holes_save", { p_draft_id: "grid", p_expected_revision: 1, p_course_revision: 2, p_snapshot: normalizeNewClubHoles(edited) });
  client.rpc.mockResolvedValue({ data: { ...draft, workflow_status: "archived", revision: 2 }, error: null });
  await service.abandonCourseHoleDraft(course, draft, owner);
  expect(client.rpc).toHaveBeenLastCalledWith("admin_new_course_holes_archive", { p_draft_id: "grid", p_expected_revision: 1, p_course_revision: 2 });
  expect(service.publishDraft).toBeUndefined();
  const count = client.rpc.mock.calls.length;
  await expect(service.openCourseHoleDraft({ ...course, live_entity_id: "live" }, owner)).rejects.toThrow("Owned private");
  await expect(service.saveCourseHoleDraft(course, { ...draft, parent_draft_id: "other" }, draft.snapshot, owner)).rejects.toThrow("Invalid private");
  expect(client.rpc).toHaveBeenCalledTimes(count);
  client.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
  await expect(service.saveCourseHoleDraft(course, draft, draft.snapshot, owner)).rejects.toEqual({ code: "40001" });
});
