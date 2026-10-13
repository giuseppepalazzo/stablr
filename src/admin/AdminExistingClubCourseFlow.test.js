import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminShell } from "./AdminApp";
import { supabase } from "../lib/supabase";
jest.mock("../lib/supabase", () => ({ hasSupabaseConfig: true, supabase: { from: jest.fn(), rpc: jest.fn() } }));
test("existing Club entry resumes private course and publishes only its receipt into the catalog summary", async () => {
  const oldCourse = { id: "old-course", name: "Percorso pubblicato", holes_count: 9, is_active: true, display_order: 0,
    route_holes: [{ id: "old-hole", par: 4, stroke_index: 1 }], route_tees: [{ id: "old-tee", is_active: true }] };
  const liveClub = { id: "existing-club", name: "Club esistente", city: "Roma", is_active: true, playable: true,
    data_status: "verified", source_type: "stablr", source_payload: { historical: true }, course_routes: [oldCourse], route_combinations: [] };
  const original = JSON.parse(JSON.stringify(liveClub));
  const draft = { draft_id: "private-course", entity_type: "route", parent_draft_id: "context", live_entity_id: null, workflow_status: "draft",
    created_by: "admin", revision: 1, schema_version: 1, snapshot: { name: "Nuovo Percorso", holes_count: 9, display_order: 1 } };
  const holes = Array.from({ length: 9 }, (_, i) => ({ physical_hole_number: i + 1, par: 4, stroke_index: i + 1 }));
  const fields = { name: "Giallo", tee_color: "giallo", rating_category: "men", course_rating: 36, slope_rating: 113, is_active: true, display_order: 0 };
  let pending = [draft];
  const plan = { draft_id: draft.draft_id, revision: 1, club: { id: liveClub.id, name: liveClub.name },
    course: { fields: draft.snapshot, holes, total_par: 36, tees: [{ draft_id: "private-tee", revision: 1, fields, holes_count: 9, par_total: 36 }] },
    checklist: { unique_name: true, club_playable: true, holes: true, tees: true }, blockers: [], can_publish: true,
    counts: { holes: 9, tees: 1 }, confirmation_hash: "a".repeat(64) };
  const published = { id: "new-live-course", club_id: liveClub.id, name: draft.snapshot.name, holes_count: 9, display_order: 1,
    total_par: 36, is_active: true, route_holes: holes, route_tees: [{ id: "new-live-tee", tee_name: "Giallo", course_rating: 36, slope_rating: 113, par_total: 36, is_active: true }] };
  supabase.from.mockImplementation(table => {
    const query = { select: jest.fn(() => query), eq: jest.fn(() => query), is: jest.fn(() => query), in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [liveClub] : [], error: null })) };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (["admin_club_get_draft", "admin_course_get_draft"].includes(name)) return { data: null, error: null };
    if (name === "admin_existing_club_courses") return { data: { club_id: liveClub.id, courses: pending, grid_summaries: [{ course_draft_id: draft.draft_id, grid_draft_id: "grid", configured: true, total_par: 36 }] }, error: null };
    if (name === "admin_existing_club_course_preview") return { data: plan, error: null };
    if (name === "admin_existing_club_course_publish") {
      expect(params).toEqual({ p_draft_id: draft.draft_id, p_expected_revision: 1, p_confirmation_hash: plan.confirmation_hash, p_note: "Percorso verificato" });
      pending = [];return { data: { draft_id: draft.draft_id, publication_id: "receipt", version_id: "version", course: published }, error: null };
    }
    throw new Error(`Unexpected test RPC ${name}`);
  });
  render(<AdminShell adminUserId="admin" onSignOut={jest.fn()} />);
  const navigation = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByText("Club esistente", { selector: "strong" }));
  fireEvent.click(screen.getByRole("button", { name: "Aggiungi percorso" }));
  await screen.findByRole("button", { name: "Anteprima pubblicazione Nuovo Percorso" });
  expect(supabase.rpc.mock.calls.some(([name]) => /save|publish/.test(name))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Anteprima pubblicazione Nuovo Percorso" }));
  const preview = await screen.findByRole("dialog", { name: "Anteprima pubblicazione Percorso" });await within(preview).findByText(/Totale Par: 36/);
  fireEvent.click(within(preview).getByRole("button", { name: "Pubblica Percorso" }));
  fireEvent.change(screen.getByLabelText("Motivazione breve"), { target: { value: "Percorso verificato" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferma pubblicazione Percorso" }));
  await screen.findByRole("heading", { name: "Club esistente" });
  expect(screen.getByRole("button", { name: /Nuovo Percorso.*9 buche.*Completo/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Percorso pubblicato.*9 buche/ })).toBeInTheDocument();expect(liveClub).toEqual(original);
  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Club esistente.*2 percorsi/ })).toBeInTheDocument());
});
