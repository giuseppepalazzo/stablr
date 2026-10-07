import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";
jest.mock("../lib/supabase", () => ({ hasSupabaseConfig: true, supabase: { from: jest.fn(), rpc: jest.fn() } }));

test("Admin course detail → tee list → tee editor publishes only selected course tee; exit returns to same course", async () => {
  const tee = { id: "tee-nine", route_id: "course-nine", tee_name: "Giallo fixture", tee_color: "yellow", gender: null,
    holes_count: null, effective_holes_count: 9, course_rating: 34.8, slope_rating: 125, is_active: true, par_total: 35, estimated: false };
  const course = { id: "course-nine", name: "Percorso nove fixture", holes_count: 9, display_order: 0, is_active: true, route_holes: [], route_tees: [{ id: tee.id, is_active: true }] };
  const club = { id: "club-nine", name: "Club nove fixture", playable: true, is_active: true, data_status: "needs_review", source_payload: {}, course_routes: [course], route_combinations: [] };
  let draft = null;
  const fields = () => ({ course_rating: tee.course_rating, slope_rating: tee.slope_rating, is_active: tee.is_active });
  supabase.from.mockImplementation((table) => { const query = { select: jest.fn(() => query), eq: jest.fn(() => query), in: jest.fn(() => query),
    order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : [], error: null })) }; return query; });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (["admin_club_get_draft", "admin_course_get_draft"].includes(name)) return { data: null, error: null };
    if (name === "admin_course_tee_list") {
      expect(params.p_course_id).toBe(course.id);
      return { data: { course, tees: [{ ...tee, has_draft_changes: Boolean(draft && JSON.stringify(draft.snapshot) !== JSON.stringify(fields())) }] }, error: null };
    }
    if (name === "admin_course_tee_open_draft") {
      expect(params.p_tee_id).toBe(tee.id);
      if (!draft) draft = { draft_id: "tee-draft", entity_type: "route_tee", live_entity_id: tee.id, revision: 1, snapshot: fields(), base_snapshot: fields() };
      return { data: { draft, context: { tee, course } }, error: null };
    }
    if (name === "admin_course_tee_save_draft") { draft = { ...draft, revision: draft.revision + 1, snapshot: params.p_snapshot }; return { data: draft, error: null }; }
    if (name === "admin_course_tee_publish_draft") {
      expect(params).toEqual({ p_draft_id: draft.draft_id, p_expected_revision: draft.revision }); Object.assign(tee, draft.snapshot); draft = null;
      return { data: { version_id: "tee-version", context: { tee, course } }, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  render(<AdminShell onSignOut={jest.fn()} />);
  const sidebar = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(sidebar).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByText(club.name, { selector: "strong" }));
  fireEvent.click(screen.getByText(course.name, { selector: "strong" }).closest("button"));
  await screen.findByText(tee.tee_name); expect(draft).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Gestisci tee" }));
  fireEvent.click(await screen.findByRole("button", { name: `Apri tee ${tee.tee_name} · 9 buche`, exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati" })); await screen.findByLabelText("CR");
  fireEvent.change(screen.getByLabelText("CR"), { target: { value: "35.2" } });
  fireEvent.click(within(sidebar).getByRole("button", { name: "Panoramica" }));
  let dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" }); fireEvent.click(within(dialog).getByRole("button", { name: "Resta" }));
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true })); dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  expect(tee.course_rating).toBe(34.8); fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("button", { name: "Modifica dati" }); expect(tee.course_rating).toBe(35.2); expect(draft).toBeNull();
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: course.name, exact: true }));
  await screen.findByRole("heading", { name: course.name }); await screen.findByText("35.2");
  expect(course.name).toBe("Percorso nove fixture"); expect(course.holes_count).toBe(9);
  await waitFor(() => expect(screen.getByRole("button", { name: "Gestisci tee" })).toBeInTheDocument());
  expect(supabase.rpc.mock.calls.some(([name]) => name.startsWith("admin_course_open") || name.startsWith("admin_hole") || name.startsWith("admin_route_"))).toBe(false);
});
