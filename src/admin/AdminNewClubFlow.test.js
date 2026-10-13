import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { supabase } from "../lib/supabase";
import { AdminShell } from "./AdminApp";

jest.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { from: jest.fn(), rpc: jest.fn() }
}));

const ownerId = "admin-fixture";
const fig = { id: "fig-fixture", name: "Club FIG", city: "Roma", source_system: "fig", source_external_id: "fig-club-fixture" };
function setup({ linked = false, liveVisible = true, linkKind = "fk" } = {}) {
  let drafts = [];
  const club = {
    id: "published-club", name: "Club pubblicato", city: "Roma", playable: true, is_active: true,
    data_status: "ready", source_type: "stablr", source_payload: linked && linkKind === "payload" ? { figClubCode: fig.source_external_id } : {},
    source_system: linked && linkKind === "external" ? "fig" : null,
    source_external_id: linked && linkKind === "external" ? fig.source_external_id : null,
    fig_club_id: linked && linkKind === "fk" ? fig.id : null, fig_match_status: linked ? "matched" : null, created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z", course_routes: [], route_combinations: []
  };
  supabase.from.mockImplementation((table) => {
    const filters = [];
    const included = [];
    const fieldValue = (row, field) => field.includes("->>") ? row.source_payload?.[field.split("->>")[1]] : row[field];
    let pattern = null, containment = null;
    const rows = () => (table === "clubs" ? [club] : table === "fig_clubs" ? [fig] : table === "admin_catalog_drafts" ? drafts : [])
      .filter((row) => filters.every(([field, value]) => field === "is_active" && !liveVisible ? false : row[field] === value))
      .filter((row) => included.every(([field, values]) => values.includes(fieldValue(row, field))))
      .filter((row) => !pattern || String(row[pattern[0]] || "").toLowerCase().includes(pattern[1].slice(1, -1).toLowerCase()))
      .filter((row) => !containment || row.snapshot?.fig_source?.id === containment.fig_source.id)
      .map((row) => table === "clubs" ? { ...row, fig_payload_code: row.source_payload?.figClubCode ?? null, fig_payload_legacy_code: row.source_payload?.fig_club_code ?? null } : row);
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn((field, value) => { filters.push([field, value]);return query; }),
      is: jest.fn((field, value) => { filters.push([field, value]);return query; }),
      in: jest.fn((field, values) => { included.push([field, values]);return query; }),
      ilike: jest.fn((field, value) => { pattern = [field, value];return query; }),
      contains: jest.fn((field, value) => { containment = value;return query; }),
      order: jest.fn(() => query), limit: jest.fn(() => query),
      then: (resolve) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      single: jest.fn(() => Promise.resolve({ data: rows()[0] || null, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: rows()[0] || null, error: null }))
    };
    return query;
  });
  supabase.rpc.mockImplementation(async (name, params) => {
    if (name === "admin_user_directory") return { data: [], error: null };
    if (name === "admin_club_get_draft") return { data: null, error: null };
    if (name === "admin_new_club_courses") return { data: drafts.filter((row) => row.parent_draft_id === params.p_club_draft_id && row.workflow_status === "draft"), error: null };
    if (name === "admin_new_club_course_save") {
      const current = params.p_draft_id ? drafts.find((row) => row.draft_id === params.p_draft_id) : null;
      if (params.p_draft_id && (!current || current.revision !== params.p_expected_revision)) return { data: null, error: { code: "40001" } };
      const saved = current ? { ...current, revision: current.revision + 1, snapshot: params.p_snapshot } : {
        draft_id: `draft-${drafts.length + 1}`, entity_type: "route", live_entity_id: null,
        parent_draft_id: params.p_club_draft_id, base_version_id: null, base_snapshot: null,
        schema_version: 1, revision: 1, snapshot: params.p_snapshot, created_by: ownerId, workflow_status: "draft"
      };
      drafts = current ? drafts.map((row) => row.draft_id === current.draft_id ? saved : row) : [...drafts, saved];
      return { data: saved, error: null };
    }
    if (name === "admin_new_club_course_archive") {
      const child = drafts.find((row) => row.draft_id === params.p_draft_id && row.parent_draft_id === params.p_club_draft_id);
      if (!child || child.revision !== params.p_expected_revision) return { data: null, error: { code: "40001" } };
      const archived = { ...child, revision: child.revision + 1, workflow_status: "archived" };
      drafts = drafts.map((row) => row.draft_id === child.draft_id ? archived : row);
      return { data: archived, error: null };
    }
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
  fireEvent.click(screen.getByRole("button", { name: /Crea manualmente/ }));
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

test("FIG confirmation creates a private reduced draft, editable values save and resume without changing source or live", async () => {
  const { club, getDrafts } = setup();
  const liveBefore = JSON.stringify(club), sourceBefore = JSON.stringify(fig);
  render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  fireEvent.click(screen.getByRole("button", { name: /Crea da FIG/ }));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: "Roma" } });
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Club FIG/ }));
  expect(getDrafts()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Crea bozza da FIG" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Conferma creazione bozza" }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue(fig.name));
  expect(screen.getByLabelText("Codice / riferimento FIG (facoltativo)")).toHaveValue(fig.source_external_id);
  fireEvent.change(screen.getByLabelText("Nome visualizzato"), { target: { value: "Club FIG curato" } });
  fireEvent.change(screen.getByLabelText("Località / città"), { target: { value: "Milano" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));
  await screen.findByText("Bozza salvata. Il nuovo club non è ancora pubblicabile.");
  const nav = screen.getByRole("navigation", { name: "Navigazione amministrazione" });
  fireEvent.click(within(nav).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Club FIG curato.*Riprendi bozza/ }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue("Club FIG curato"));
  expect(screen.getByLabelText("Località / città")).toHaveValue("Milano");
  expect(screen.getByRole("region", { name: "Fonte FIG selezionata" })).toHaveTextContent(fig.name);
  expect(getDrafts()).toHaveLength(1);
  expect(getDrafts()[0].live_entity_id).toBeNull();
  expect(getDrafts()[0].snapshot.fig_source).toEqual(fig);
  expect(getDrafts()[0].snapshot.fig_club_id).toBeUndefined();
  expect(JSON.stringify(club)).toBe(liveBefore);
  expect(JSON.stringify(fig)).toBe(sourceBefore);
  expect(supabase.rpc.mock.calls.filter(([name]) => name.includes("publish"))).toHaveLength(0);
});

test.each([[true, "fk"], [false, "fk"], [true, "external"], [true, "payload"]])("already linked FIG Club opens the existing summary without creating a draft (active catalog: %s, link: %s)", async (liveVisible, linkKind) => {
  const { getDrafts } = setup({ linked: true, liveVisible, linkKind });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  fireEvent.click(screen.getByRole("button", { name: /Crea da FIG/ }));
  fireEvent.change(screen.getByLabelText("Cerca per nome, città o codice FIG"), { target: { value: fig.source_external_id } });
  fireEvent.click(screen.getByRole("button", { name: "Cerca FIG" }));
  await screen.findByText("Già presente in STABLR");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Crea bozza da FIG" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Apri club esistente/ }));
  await screen.findByRole("heading", { name: "Club pubblicato" });
  expect(getDrafts()).toHaveLength(0);
  expect(supabase.rpc.mock.calls.filter(([name]) => name === "admin_catalog_create_draft")).toHaveLength(0);
  logged.mockRestore();
});

test("manual exact FIG reference blocks saving a second linked draft and supports guarded navigation to the existing Club", async () => {
  const { getDrafts } = setup({ linked: true });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  fireEvent.click(screen.getByRole("button", { name: /Crea manualmente/ }));
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Club manuale" } });
  fireEvent.change(screen.getByLabelText("Codice / riferimento FIG (facoltativo)"), { target: { value: fig.source_external_id } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("già collegato");
  expect(supabase.rpc.mock.calls.filter(([name]) => name === "admin_catalog_save_draft")).toHaveLength(0);
  expect(getDrafts()[0].snapshot).toEqual({ name: "", city: null });
  fireEvent.click(screen.getByRole("button", { name: /Apri club esistente/ }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Modifiche non salvate" })).getByRole("button", { name: "Scarta" }));
  await screen.findByRole("heading", { name: "Club pubblicato" });
  logged.mockRestore();
});

test("Overview CTA opens the same private editor and a saved empty draft remains resumable", async () => {
  const { getDrafts } = setup();
  render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));
  fireEvent.click(screen.getByRole("button", { name: /Crea manualmente/ }));
  await screen.findByLabelText("Nome visualizzato");
  expect(screen.getByRole("heading", { name: "Nuovo club" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Percorso di navigazione" })).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Nuovo club senza nome.*Riprendi bozza/ }));
  await waitFor(() => expect(screen.getByLabelText("Nome visualizzato")).toHaveValue(""));
  expect(getDrafts()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled();
});

test("Admin shell persists child courses under the new Club, resumes after remount and archives only the child", async () => {
  const { club, getDrafts } = setup(), liveBefore = JSON.stringify(club);
  let view = render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nuovo club" }));fireEvent.click(screen.getByRole("button", { name: /Crea manualmente/ }));
  fireEvent.change(await screen.findByLabelText("Nome visualizzato"), { target: { value: "Club con Percorsi" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza" }));await screen.findByText("Bozza salvata. Il nuovo club non è ancora pubblicabile.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Aggiungi percorso" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Aggiungi percorso" }));
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Nove privato" } });
  fireEvent.change(screen.getByLabelText("Struttura percorso"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza percorso" }));await screen.findByText("Nove privato");
  const parent = getDrafts().find((row) => row.entity_type === "club"), child = getDrafts().find((row) => row.entity_type === "route");
  expect(child.parent_draft_id).toBe(parent.draft_id);expect(child.live_entity_id).toBeNull();
  view.unmount();view = render(<AdminShell adminUserId={ownerId} onSignOut={jest.fn()} />);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Navigazione amministrazione" })).getByRole("button", { name: "Club e percorsi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Club con Percorsi.*Riprendi bozza/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Modifica percorso Nove privato" }));
  fireEvent.change(screen.getByLabelText("Nome percorso"), { target: { value: "Nove rinominato" } });
  fireEvent.change(screen.getByLabelText("Ordine percorso"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva bozza percorso" }));await screen.findByText("Nove rinominato");
  expect(getDrafts().find((row) => row.draft_id === child.draft_id).snapshot).toEqual({ name: "Nove rinominato", holes_count: 9, display_order: 7 });
  fireEvent.click(screen.getByRole("button", { name: "Abbandona percorso Nove rinominato" }));
  fireEvent.click(screen.getByRole("button", { name: "Conferma abbandono percorso" }));
  await waitFor(() => expect(screen.queryByText("Nove rinominato")).not.toBeInTheDocument());
  expect(getDrafts().find((row) => row.draft_id === child.draft_id).workflow_status).toBe("archived");
  expect(getDrafts().find((row) => row.draft_id === parent.draft_id).workflow_status).toBe("draft");
  expect(JSON.stringify(club)).toBe(liveBefore);expect(supabase.rpc.mock.calls.some(([name]) => name.includes("publish"))).toBe(false);
  view.unmount();
});
