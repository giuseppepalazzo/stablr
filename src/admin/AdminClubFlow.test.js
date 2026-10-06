import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";

jest.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { from: jest.fn(), rpc: jest.fn() }
}));

test("sidebar exit saves the Club draft, resuming and publishing refreshes the summary", async () => {
  const club = {
    id: "club-fixture", name: "Club fixture", city: null, playable: true, is_active: true,
    data_status: "needs_review", source_type: "fig_import", source_payload: {},
    fig_club_id: "fig-fixture", fig_match_status: "matched", fig_clubs: { source_external_id: "FIG-1" },
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-02T12:00:00Z", course_routes: [], route_combinations: []
  };
  let saved = null;
  supabase.from.mockImplementation((table) => {
    const query = {
      select: jest.fn(() => query), eq: jest.fn(() => query), in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : [], error: null }))
    };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (name === "admin_club_get_draft") return { data: saved, error: null };
    if (name === "admin_club_open_draft") {
      if (!saved) saved = { draft_id: "draft-fixture", revision: 1, snapshot: { name: club.name, city: null }, base_snapshot: { name: club.name, city: null } };
      return { data: saved, error: null };
    }
    if (name === "admin_club_save_draft") {
      saved = { ...saved, revision: saved.revision + 1, snapshot: params.p_snapshot };
      return { data: saved, error: null };
    }
    if (name === "admin_club_publish_draft") {
      const live = { id: club.id, ...saved.snapshot, updated_at: "2026-10-06T12:00:00Z" };
      const result = { draft_id: saved.draft_id, club: live };
      saved = null;
      return { data: result, error: null };
    }
    if (name === "admin_catalog_archive_draft") {
      const result = { ...saved, workflow_status: "archived", revision: saved.revision + 1 };
      saved = null;
      return { data: result, error: null };
    }
    throw new Error(`Unexpected test RPC ${name}`);
  });
  render(<AdminShell onSignOut={jest.fn()} />);
  const navigation = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByText("Club fixture", { selector: "strong" }));
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati" }));
  await screen.findByLabelText("Località / città");
  fireEvent.change(screen.getByLabelText("Località / città"), { target: { value: "Roma" } });
  fireEvent.click(within(navigation).getByRole("button", { name: "Utenti e giri" }));
  const exitDialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  expect(screen.getByRole("heading", { name: "Modifica dati club" })).toBeInTheDocument();
  fireEvent.click(within(exitDialog).getByRole("button", { name: "Salva bozza" }));
  await screen.findByRole("tab", { name: "Utenti" });
  expect(club.city).toBeNull();

  fireEvent.click(within(navigation).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(screen.getByText("Club fixture", { selector: "strong" }));
  await screen.findByText("Bozza in corso");
  fireEvent.click(screen.getByRole("button", { name: "Modifica dati" }));
  await waitFor(() => expect(screen.getByLabelText("Località / città")).toHaveValue("Roma"));
  fireEvent.click(screen.getByRole("button", { name: "Pubblica", exact: true }));
  const publishDialog = await screen.findByRole("dialog", { name: "Conferma pubblicazione" });
  fireEvent.click(within(publishDialog).getByRole("button", { name: "Conferma pubblicazione" }));
  await screen.findByRole("heading", { name: "Club fixture" });
  expect(screen.getByText("Roma", { selector: "p" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Modifica dati" }));
  await screen.findByLabelText("Nome visualizzato");
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const abandonDialog = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  fireEvent.click(within(abandonDialog).getByRole("button", { name: "Conferma abbandono" }));
  await screen.findByRole("heading", { name: "Club fixture" });
  await waitFor(() => expect(screen.queryByText("Bozza in corso")).not.toBeInTheDocument());
});
