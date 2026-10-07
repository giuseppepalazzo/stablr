import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";
import { hasCourseDraftChanges } from "./course-editor-data";

jest.mock("../lib/supabase", () => ({ hasSupabaseConfig: true, supabase: { from: jest.fn(), rpc: jest.fn() } }));

// Test-only records with the nested catalog SELECT and complete RPC row shapes.
function fixtures(patch) {
  const course = {
    id: "75a1e5ee-a1ef-4623-b909-682338bbc5bb", name: "Percorso", holes_count: 9,
    display_order: null, is_active: true, updated_at: "2026-10-07T06:00:00Z",
    route_holes: Array.from({ length: 9 }, (_,i) => ({ id: `hole-${i+1}`, par: 4, stroke_index: i+1 })),
    route_tees: [{ id: "tee-fixture", is_active: true }]
  };
  const club = {
    id: "club-fixture", name: "Mare di Roma", city: null, data_status: "ready",
    source_type: "stablr", source_payload: {}, fig_club_id: "fig-club-mare-di-roma",
    fig_match_status: "matched", fig_match_confidence: 1, playable: true,
    created_at: "2026-07-22T12:00:00Z", updated_at: "2026-07-22T12:00:00Z",
    fig_clubs: { source_external_id: null }, course_routes: [course], route_combinations: []
  };
  const snapshot = { name: course.name, holes_count: course.holes_count, display_order: course.display_order, is_active: course.is_active };
  const draft = {
    draft_id: "draft-fixture", entity_type: "route", entity_key: course.id, live_entity_id: course.id,
    parent_draft_id: null, base_version_id: null, schema_version: 1,
    snapshot: { ...snapshot, ...patch },
    base_snapshot: { ...snapshot, _context: { club_id: club.id, total_par: 36,
      source_system: "fig", source_external_id: null, source_payload: {} } },
    base_live_updated_at: course.updated_at, workflow_status: "draft", revision: 1,
    created_by: "admin-fixture", updated_by: "admin-fixture",
    created_at: "2026-10-07T06:10:00Z", updated_at: "2026-10-07T06:10:00Z"
  };
  return { club, course, draft };
}

test.each([
  ["identical live values", {}, false],
  ["changed name", { name: "Percorso modificato" }, true],
  ["changed structure", { holes_count: 18 }, true],
  ["changed order (zero differs from null)", { display_order: 0 }, true],
  ["changed operational state", { is_active: false }, true]
])("catalog query → draft RPC → summary/detail/editor badge: %s", async (_,patch,expected) => {
  const { club, course, draft } = fixtures(patch);
  const originalDraft = JSON.stringify(draft);
  supabase.from.mockImplementation((table) => {
    const query = { select: jest.fn(() => query), eq: jest.fn(() => query), in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : [], error: null })) };
    return query;
  });
  supabase.rpc.mockImplementation(async (name,params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (name === "admin_club_get_draft") return { data: null, error: null };
    if (name === "admin_course_get_draft") {
      expect(params).toEqual({ p_course_id: course.id });
      return { data: draft, error: null };
    }
    if (name === "admin_course_open_draft") return { data: { draft, context: { can_edit_structure: false,
      original_name: null, gesgolf_name: null, source_system: "fig" } }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const openSummary = async () => {
    fireEvent.click(within(screen.getByRole("navigation", { name: "Navigazione amministrazione" }))
      .getByRole("button", { name: "Club e percorsi" }));
    fireEvent.click(await screen.findByText(club.name, { selector: "strong" }));
    await waitFor(() => expect(screen.queryByText("Verifica bozza…")).not.toBeInTheDocument());
  };
  const assertBadge = () => expect(Boolean(screen.queryByText("Bozza in corso"))).toBe(expected);
  const view = render(<AdminShell onSignOut={jest.fn()} />);
  await openSummary(); assertBadge();
  fireEvent.click(screen.getByRole("button", { name: /Percorso.*9 buche/ }));
  await waitFor(() => expect(screen.queryByText("Verifica bozza…")).not.toBeInTheDocument());
  assertBadge();
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati", exact: true }));
  await screen.findByLabelText("Nome visualizzato"); assertBadge();
  // Recreate the app from the same loaded responses, as after a browser refresh.
  view.unmount(); render(<AdminShell onSignOut={jest.fn()} />);
  await openSummary(); assertBadge();
  expect(JSON.stringify(draft)).toBe(originalDraft);
  expect(supabase.rpc.mock.calls.every(([name]) => !/save|publish|archive|delete/.test(name))).toBe(true);
});

test("shared badge comparison normalizes formats, ignores workflow metadata and preserves false/null/zero", () => {
  const { course, draft } = fixtures();
  const viewCourse = { id: course.id, name: course.name, holesCount: course.holes_count,
    displayOrder: course.display_order, isActive: course.is_active, status: "Attivo", completeness: "Completo" };
  expect(hasCourseDraftChanges(course, draft)).toBe(false);
  expect(hasCourseDraftChanges(viewCourse, draft)).toBe(false);
  expect(hasCourseDraftChanges(viewCourse, { ...draft, snapshot: { ...draft.snapshot, name: " Percorso ", holes_count: "9", display_order: "" } })).toBe(false);
  expect(hasCourseDraftChanges({ ...viewCourse, displayOrder: 0 }, draft)).toBe(true);
  expect(hasCourseDraftChanges({ ...viewCourse, isActive: false }, draft)).toBe(true);
  expect(hasCourseDraftChanges(viewCourse, null)).toBe(false);
});
