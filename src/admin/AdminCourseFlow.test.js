import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";

jest.mock("../lib/supabase", () => ({ hasSupabaseConfig: true, supabase: { from: jest.fn(), rpc: jest.fn() } }));

test("both course entry points, sidebar save exit, resume, publish and inactive reactivation", async () => {
  const course = { id: "course-fixture", name: "Percorso fixture", holes_count: 9, display_order: 1,
    is_active: true, route_holes: [{ id: "hole-1", par: 4, stroke_index: 1 }], route_tees: [] };
  const inactive = { ...course, id: "inactive-fixture", name: "Percorso disattivato", is_active: false, display_order: 2 };
  const club = { id: "club-fixture", name: "Club fixture", city: "Roma", playable: true, is_active: true,
    data_status: "needs_review", source_type: "fig_import", source_payload: {},
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-02T12:00:00Z", course_routes: [course, inactive], route_combinations: [] };
  const drafts = new Map();
  supabase.from.mockImplementation((table) => {
    const query = { select: jest.fn(() => query), eq: jest.fn(() => query), in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : [], error: null })) };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (name === "admin_club_get_draft") return { data: null, error: null };
    if (name === "admin_course_get_draft") return { data: drafts.get(params.p_course_id) || null, error: null };
    if (name === "admin_course_open_draft") {
      const live = club.course_routes.find((item) => item.id === params.p_course_id);
      if (!drafts.has(live.id)) {
        const snapshot = { name: live.name, holes_count: live.holes_count, display_order: live.display_order, is_active: live.is_active };
        drafts.set(live.id, { draft_id: live.id, live_entity_id: live.id, revision: 1, snapshot, base_snapshot: snapshot });
      }
      return { data: { draft: drafts.get(live.id), context: { can_edit_structure: false } }, error: null };
    }
    if (name === "admin_course_save_draft") {
      const old = drafts.get(params.p_draft_id);
      const saved = { ...old, revision: old.revision + 1, snapshot: params.p_snapshot };
      drafts.set(old.live_entity_id, saved);
      return { data: saved, error: null };
    }
    if (name === "admin_course_publish_draft") {
      const draft = drafts.get(params.p_draft_id);
      const live = { id: draft.live_entity_id, club_id: club.id, ...draft.snapshot, updated_at: "2026-10-06T12:00:00Z" };
      const result = { draft_id: draft.draft_id, version_id: "version-fixture", course: live };
      drafts.delete(live.id);
      return { data: result, error: null };
    }
    if (name === "admin_catalog_archive_draft") {
      const old = drafts.get(params.p_draft_id);
      const result = { ...old, workflow_status: "archived", revision: old.revision + 1 };
      drafts.delete(old.live_entity_id);
      return { data: result, error: null };
    }
    if (name === "admin_course_tee_list") return { data: { course: { id: params.p_course_id }, tees: [] }, error: null };
    throw new Error(`Unexpected test RPC ${name}`);
  });

  render(<AdminShell onSignOut={jest.fn()} />);
  const navigation = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByText("Club fixture", { selector: "strong" }));
  // The inactive record is not lost, but the catalog still counts only active courses.
  expect(screen.getByRole("button", { name: "Modifica percorso Percorso disattivato" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica percorso Percorso fixture" }));
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByLabelText("Struttura")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Bozza percorso" } });
  fireEvent.click(within(navigation).getByRole("button", { name: "Utenti e giri" }));
  const exitDialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(exitDialog).getByRole("button", { name: "Salva bozza" }));
  await screen.findByRole("tab", { name: "Utenti" });
  expect(course.name).toBe("Percorso fixture");

  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(screen.getByText("Club fixture", { selector: "strong" }));
  await screen.findByText("Bozza in corso");
  fireEvent.click(screen.getByRole("button", { name: /Percorso fixture.*9 buche/ }));
  await screen.findByRole("heading", { name: "Percorso fixture" });
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati", exact: true }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza percorso"));
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "false" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  let dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  expect(within(dialog).getByText("Disattivato")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("heading", { name: "Bozza percorso" });
  await waitFor(() => expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Club fixture", exact: true }));
  expect(screen.getByRole("button", { name: "Modifica percorso Bozza percorso" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica percorso Percorso disattivato" }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "true" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  dialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("heading", { name: "Percorso disattivato" });
  expect(screen.getByText("Attivo", { selector: "span" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Modifica dati", exact: true }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const abandonDialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  fireEvent.click(within(abandonDialog).getByRole("button", { name: "Conferma abbandono" }));
  await screen.findByRole("heading", { name: "Percorso disattivato" });
  await waitFor(() => expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument());
});
