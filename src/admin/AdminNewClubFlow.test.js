import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";

jest.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { from: jest.fn(), rpc: jest.fn() }
}));

const ownerId = "admin-fixture";
function setup() {
  let drafts = [];
  const club = {
    id: "published-club", name: "Club pubblicato", city: "Roma", playable: true, is_active: true,
    data_status: "ready", source_type: "stablr", source_payload: {},
    fig_club_id: null, fig_match_status: null, created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z", course_routes: [], route_combinations: []
  };
  supabase.from.mockImplementation((table) => {
    const filters = [];
    const rows = () => drafts.filter((row) => filters.every(([field, value]) => row[field] === value));
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn((field, value) => { filters.push([field, value]);return query; }),
      is: jest.fn((field, value) => { filters.push([field, value]);return query; }),
      in: jest.fn(() => query),
      order: jest.fn(() => Promise.resolve({ data: table === "clubs" ? [club] : table === "admin_catalog_drafts" ? rows() : [], error: null })),
      single: jest.fn(() => Promise.resolve({ data: rows()[0] || null, error: null }))
    };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (name === "admin_catalog_create_draft") {
      const created = {
        draft_id: `draft-${drafts.length + 1}`, entity_type: params.p_entity_type,
        live_entity_id: params.p_live_entity_id, parent_draft_id: params.p_parent_draft_id,
        base_version_id: params.p_base_version_id, base_snapshot: null,
        schema_version: params.p_schema_version, revision: 1, snapshot: params.p_snapshot,
        created_by: ownerId, workflow_status: "draft"
      };
      drafts = [...drafts, created];
      return { data: created, error: null };
    }
    if (["admin_catalog_save_draft", "admin_catalog_archive_draft"].includes(name)) {
      const current = drafts.find((row) => row.draft_id === params.p_draft_id);
      if (!current || current.revision !== params.p_expected_revision) return { data: null, error: { code: "40001" } };
      const saved = { ...current, revision: current.revision + 1,
        ...(name === "admin_catalog_archive_draft" ? { workflow_status: "archived" } : { snapshot: params.p_snapshot }) };
      drafts = drafts.map((row) => row.draft_id === current.draft_id ? saved : row);
      return { data: saved, error: null };
    }
    throw new Error(`Unexpected test RPC ${name}`);
  });
  return { club, getDrafts: () => drafts };
}

test("catalog CTA saves, resumes after remount, and abandons a draft without touching the published catalog", async () => {
  const { club, getDrafts } = setup();
  const liveBefore = JSON.stringify(club);
  let view = render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  let nav = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(nav).getByRole("button", { name: "Club e percorsi" }));
  await screen.findByText("Club pubblicato", { selector: "strong" });
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Nuovo Club privato" } });
  fireEvent.change(screen.getByLabelText("Località / città"), { target: { value: "Milano" } });
  fireEvent.click(within(nav).getByRole("button", { name: "Club e percorsi" }));
  const dialog = await screen.findByRole("dialog", { name: "Modifiche non salvate" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Salva bozza" }));
  const draftList = await screen.findByRole("region", { name: "Bozze nuovi club" });
  expect(within(draftList).getByText("Nuovo Club privato")).toBeInTheDocument();
  const publishedList = screen.getByRole("region", { name: "Club e percorsi" });
  expect(within(publishedList).getByText("Club pubblicato")).toBeInTheDocument();
  expect(within(publishedList).queryByText("Nuovo Club privato")).not.toBeInTheDocument();
  expect(getDrafts()).toHaveLength(1);

  view.unmount();
  view = render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  nav = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(nav).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Nuovo Club privato.*Riprendi bozza/ }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Nuovo Club privato"));
  expect(screen.getByLabelText("Località / città")).toHaveValue("Milano");
  expect(supabase.rpc.mock.calls.filter(([name]) => name === "admin_catalog_create_draft")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Abbandona bozza" }));
  const abandon = await screen.findByRole("dialog", { name: "Abbandona bozza" });
  fireEvent.click(within(abandon).getByRole("button", { name: "Conferma abbandono" }));
  await screen.findByRole("heading", { name: "Club e percorsi" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Bozze nuovi club" })).not.toBeInTheDocument());
  expect(getDrafts()).toHaveLength(1);
  expect(getDrafts()[0].workflow_status).toBe("archived");
  expect(JSON.stringify(club)).toBe(liveBefore);
  expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
    "admin_catalog_create_draft", "admin_catalog_save_draft", "admin_catalog_archive_draft"
  ]));
  expect(supabase.rpc.mock.calls.map(([name]) => name).filter((name) => name.includes("publish"))).toEqual([]);
  view.unmount();
});

test("Overview CTA opens the same private editor and a saved empty draft remains resumable", async () => {
  const { getDrafts } = setup();
  render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByRole("heading", { name: "Nuovo club" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Percorso di navigazione" })).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Nuovo club senza nome.*Riprendi bozza/ }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue(""));
  expect(getDrafts()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled();
});
