import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";

jest.mock("../lib/supabase", () => ({ hasSupabaseConfig: true, supabase: { from: jest.fn(), rpc: jest.fn() } }));

test("Route editor from Club and Percorso, saved resume, atomic confirmation, abandon and reactivation", async () => {
  const courses = ["A", "B"].map((name, i) => ({ id: `course-${i}`, name: `Percorso ${name}`, holes_count: 9,
    display_order: i, is_active: true, route_holes: [{ id: `hole-${i}`, par: 4, stroke_index: 1 }], route_tees: [] }));
  const routes = [{ id: "route-1", name: "Combinazione fixture", is_active: true },
    { id: "route-2", name: "Combinazione inattiva", is_active: false }].map((route) => ({ ...route,
    holes_count: 18, front_route_id: courses[0].id, back_route_id: courses[1].id, combination_tees: [] }));
  const club = { id: "club-1", name: "Club fixture", city: "Roma", playable: true, is_active: true,
    data_status: "needs_review", source_type: "fig_import", source_payload: {},
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-02T12:00:00Z", course_routes: courses, route_combinations: routes };
  const context = {
    route: { holes_count: 18, total_par: 72, source_system: "fig" },
    origins: courses.map((course, i) => ({ position: i + 1, name: course.name, holes_count: 9, is_active: true })),
    checks: { expected_holes: 18, actual_holes: 18, missing_round_numbers: [], duplicate_round_numbers: 0,
      duplicate_physical_holes: 0, invalid_origin_holes: 0, coherent: true, origins_active: true, par_sum: 72 },
    holes: Array.from({ length: 18 }, (_, i) => ({ round_hole_number: i + 1, route_position: i < 9 ? 1 : 2,
      physical_hole_number: i % 9 + 1, par: 4, stroke_index: i + 1 }))
  };
  const drafts = new Map();
  supabase.from.mockImplementation((table) => {
    const query = { select: jest.fn(() => query), eq: jest.fn(() => query), in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : [], error: null })) };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (["admin_club_get_draft", "admin_course_get_draft"].includes(name)) return { data: null, error: null };
    if (name === "admin_route_get_draft") return { data: { draft: drafts.get(params.p_route_id) || null, context }, error: null };
    if (name === "admin_route_open_draft") {
      const live = routes.find((route) => route.id === params.p_route_id);
      if (!drafts.has(live.id)) {
        const snapshot = { name: live.name, is_active: live.is_active };
        drafts.set(live.id, { draft_id: live.id, live_entity_id: live.id, revision: 1, snapshot, base_snapshot: snapshot });
      }
      return { data: { draft: drafts.get(live.id), context }, error: null };
    }
    if (name === "admin_route_save_draft") {
      const old = drafts.get(params.p_draft_id);
      const saved = { ...old, revision: old.revision + 1, snapshot: params.p_snapshot };
      drafts.set(old.live_entity_id, saved);
      return { data: saved, error: null };
    }
    if (name === "admin_route_publish_draft") {
      const draft = drafts.get(params.p_draft_id);
      const live = { id: draft.live_entity_id, club_id: club.id, ...draft.snapshot, updated_at: "2026-10-06T12:00:00Z" };
      Object.assign(routes.find((route) => route.id === live.id), draft.snapshot);
      drafts.delete(live.id);
      return { data: { draft_id: draft.draft_id, version_id: "version-fixture", route: live }, error: null };
    }
    if (name === "admin_catalog_archive_draft") {
      const old = drafts.get(params.p_draft_id);
      drafts.delete(old.live_entity_id);
      return { data: { ...old, workflow_status: "archived", revision: old.revision + 1 }, error: null };
    }
    throw new Error(`Unexpected test RPC ${name}`);
  });

  render(<AdminShell onSignOut={jest.fn()} />);
  const navigation = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByText("Club fixture", { selector: "strong" }));
  expect(screen.getByRole("button", { name: "Modifica Route Combinazione inattiva" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica Route Combinazione fixture" }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Bozza Route" } });
  fireEvent.click(within(navigation).getByRole("button", { name: "Utenti e giri" }));
  const exit = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(exit).getByRole("button", { name: "Salva bozza" }));
  await screen.findByRole("tab", { name: "Utenti" });
  expect(routes[0].name).toBe("Combinazione fixture");

  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(screen.getByText("Club fixture", { selector: "strong" }));
  await screen.findByText("Bozza in corso");
  fireEvent.click(screen.getByRole("button", { name: /Percorso A.*9 buche/ }));
  fireEvent.click(screen.getByRole("button", { name: "Modifica Route Combinazione fixture" }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Bozza Route"));
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "false" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const confirmation = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  expect(within(confirmation).getByText("Combinazione fixture")).toBeInTheDocument();
  expect(within(confirmation).getByText("Bozza Route")).toBeInTheDocument();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("heading", { name: "Bozza Route" });
  await screen.findByText("18 / 18");
  expect(screen.getByText("Disattivata", { selector: "span" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Modifica dati", exact: true }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Da abbandonare" } });
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const abandon = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  fireEvent.click(within(abandon).getByRole("button", { name: "Conferma abbandono" }));
  await screen.findByRole("heading", { name: "Bozza Route" });
  await screen.findByText("18 / 18");
  expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument();

  const breadcrumb = screen.getByRole("navigation", { name: "Percorso di navigazione" });
  fireEvent.click(within(breadcrumb).getByRole("button", { name: "Percorso A" }));
  await screen.findByRole("heading", { name: "Percorso A" });
  expect(screen.getByRole("button", { name: "Modifica Route Bozza Route" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modifica Route Combinazione inattiva" }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.change(screen.getByLabelText("Stato operativo"), { target: { value: "true" } });
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const reactivate = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  fireEvent.click(within(reactivate).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("heading", { name: "Combinazione inattiva" });
  expect(screen.getByText("Attiva", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Percorso di navigazione" })).getByRole("button", { name: "Club e percorsi" }));
  expect(screen.getByText("Roma · 2 percorsi · 3 route")).toBeInTheDocument();
});
