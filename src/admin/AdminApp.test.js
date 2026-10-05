import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AdminShell,
  Advanced,
  buildAdminRounds,
  buildReviewItems,
  filterCatalogClubs,
  filterAdminUsers,
  filterReviewItems,
  getClubFilter,
  ReviewDetail,
  Reviews,
  sortAdminUsers,
  UsersAndRounds
} from "./AdminApp";

test("renders the operational overview and the catalog filter controls", () => {
  render(<AdminShell onSignOut={jest.fn()} />);

  expect(screen.getAllByText("Da revisionare")).toHaveLength(1);
  expect(screen.getAllByText("Vedi tutto")).toHaveLength(4);

  fireEvent.click(screen.getByRole("button", { name: "Club e percorsi" }));
  expect(screen.getByPlaceholderText("Cerca club, FIG ID, città o percorso")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dati incompleti" }));
  expect(screen.getByText("Catalogo non disponibile.")).toBeInTheDocument();
});

test("keeps non-playable review clubs out of the review filter and searches route names", () => {
  const villaGiusti = {
    name: "Villa Giusti",
    city: "Padova",
    courses: "0 percorsi · 0 route",
    courseNames: [],
    figCode: "fig-villa-giusti",
    filter: getClubFilter({ playable: false, data_status: "needs_review" })
  };
  const playableReview = {
    name: "Club Test",
    city: "Roma",
    courses: "1 percorso · 1 route",
    courseNames: ["Percorso Laghi"],
    figCode: "",
    filter: getClubFilter({ playable: true, data_status: "needs_review" })
  };

  expect(villaGiusti.filter).toBe("Dati incompleti");
  expect(playableReview.filter).toBe("In revisione");
  expect(filterCatalogClubs([villaGiusti, playableReview], "laghi", "Tutti")).toEqual([playableReview]);
  expect(filterCatalogClubs([villaGiusti, playableReview], "", "In revisione")).toEqual([playableReview]);
  expect(filterCatalogClubs([villaGiusti, playableReview], "", "Dati incompleti")).toEqual([villaGiusti]);
});

const reviewFixtures = {
  clubs: [{
    id: "club-1", name: "Villa Giusti", dataStatus: "needs_review", playable: false,
    sourceType: "fig_import", figCode: "fig-club-villa-giusti", figChangePending: false,
    updatedAt: "2026-09-22T12:00:00Z", createdAt: "2026-09-21T12:00:00Z",
    courses: "0 percorsi · 0 route", routes: [], figMatchStatus: "matched", hasFigLink: true
  }, {
    id: "club-2", name: "Acaya", dataStatus: "needs_review", playable: true,
    sourceType: "fig_import", figCode: "fig-club-acaya", figChangePending: false,
    updatedAt: "2026-09-25T12:00:00Z", createdAt: "2026-09-20T12:00:00Z",
    courses: "1 percorso · 1 route", routes: [], figMatchStatus: "matched", hasFigLink: true
  }],
  requests: [{ id: "request-1", club_name: "Nuovo Club", status: "requested", created_at: "2026-09-26T12:00:00Z" }],
  reports: [{ id: "report-1", message: "Par da controllare", created_at: "2026-09-24T12:00:00Z", clubs: { name: "Club Segnalato" } }],
  scorecards: [{ id: "scorecard-1", source_type: "community", notes: "SI incompleto", updated_at: "2026-09-23T12:00:00Z", clubs: { name: "Club Scorecard" } }]
};

test("orders and filters review fixtures by real queue priority", () => {
  const items = buildReviewItems(reviewFixtures);
  expect(items.map((item) => item.type)).toEqual(["Segnalazioni", "Richieste", "Scorecard", "Dati incompleti", "Import FIG"]);
  expect(filterReviewItems(items, "Dati incompleti").map((item) => item.title)).toEqual(["Villa Giusti"]);
});

test("renders a review list, its filter, detail, and empty state", () => {
  const items = buildReviewItems(reviewFixtures);
  const onOpenItem = jest.fn();
  const { rerender } = render(<Reviews items={items} loading={false} onOpenItem={onOpenItem} />);
  expect(screen.getByText("Club Segnalato")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Scorecard" }));
  expect(screen.getByText("Club Scorecard")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Club Scorecard"));
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ type: "Scorecard" }));

  rerender(<ReviewDetail item={items[3]} onBack={jest.fn()} />);
  expect(screen.getByRole("heading", { name: "Villa Giusti" })).toBeInTheDocument();
  expect(screen.getByText("Club non giocabile: dati pubblicati mancanti")).toBeInTheDocument();

  rerender(<Reviews items={[]} loading={false} onOpenItem={jest.fn()} />);
  expect(screen.getByText("Nessun elemento per questo filtro.")).toBeInTheDocument();
});

test("opens review requests with the requested filter", () => {
  const items = buildReviewItems(reviewFixtures);
  render(<Reviews initialFilter="Richieste" items={items} loading={false} onOpenItem={jest.fn()} />);
  expect(screen.getByText("Nuovo Club")).toBeInTheDocument();
  expect(screen.queryByText("Club Segnalato")).not.toBeInTheDocument();
});

const usersFixtures = [
  { user_id: "user-1", player_name: "Anna Rossi", email: "anna@example.com", role: "user", joined_at: "2026-09-01T10:00:00Z", last_login_at: "2026-09-20T10:00:00Z", last_seen_at: "2026-09-21T10:00:00Z", round_count: 1, last_round_at: "2026-09-22T10:00:00Z" },
  { user_id: "user-2", player_name: "Admin Test", email: "admin@example.com", role: "admin", joined_at: "2026-09-02T10:00:00Z", last_login_at: null, last_seen_at: null, round_count: 0, last_round_at: null }
];

const roundsFixtures = buildAdminRounds([{
  id: "round-1", user_id: "user-1", round_type: "single_18", created_at: "2026-09-22T10:00:00Z",
  gross_total: 88, net_total: 70, stableford_net_total: 36, selected_routes: [{ route_name: "Percorso Blu" }],
  clubs: { name: "Club Test" }, route_combinations: null,
  round_holes: [{ id: "hole-1", round_hole_number: 1, par: 4, stroke_index: 5, strokes: 5, stableford_points: 2 }]
}], usersFixtures);

test("filters users and renders copy controls plus the read-only rounds detail", async () => {
  expect(filterAdminUsers(usersFixtures, "anna", "Tutti", "Tutti")).toEqual([usersFixtures[0]]);
  expect(filterAdminUsers(usersFixtures, "", "Admin", "Senza giri")).toEqual([usersFixtures[1]]);
  expect(sortAdminUsers(usersFixtures, "Ultima attività app (più recente)").map((user) => user.user_id)).toEqual(["user-1", "user-2"]);
  expect(sortAdminUsers(usersFixtures, "Più giri").map((user) => user.user_id)).toEqual(["user-1", "user-2"]);

  render(<UsersAndRounds loading={false} rounds={roundsFixtures} users={usersFixtures} />);
  expect(screen.getByText("Anna Rossi")).toBeInTheDocument();
  expect(screen.getByLabelText("Ordina per")).toHaveValue("Ultima attività app (più recente)");
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  fireEvent.click(screen.getByLabelText("Seleziona tutti i risultati filtrati"));
  fireEvent.click(screen.getByRole("button", { name: "Copia 2 email selezionate" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("anna@example.com,admin@example.com"));
  fireEvent.click(screen.getByRole("tab", { name: "Giri" }));
  expect(screen.getByText("Club Test")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Club Test"));
  expect(screen.getByText("Buche")).toBeInTheDocument();
  expect(screen.getByText("Colpi 5 · STABLR 2")).toBeInTheDocument();
});

test("shows a retryable directory error instead of an empty users list", () => {
  const onRetryUsers = jest.fn();
  render(<UsersAndRounds loading={false} onRetryUsers={onRetryUsers} rounds={[]} users={[]} usersError="RPC failed" />);

  expect(screen.getByRole("alert")).toHaveTextContent("Impossibile caricare la directory utenti");
  fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
  expect(onRetryUsers).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Nessun utente corrisponde ai filtri selezionati.")).not.toBeInTheDocument();
});

test("renders advanced read-only areas and their explicit empty states", () => {
  render(<Advanced clubs={[]} loading={false} />);
  expect(screen.getByRole("button", { name: /Verifica FIG/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Cronologia completa/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Cronologia completa/ }));
  expect(screen.getByText("Nessuna cronologia di pubblicazione disponibile")).toBeInTheDocument();
});

test("filters source matching and presents unmatched records as da collegare", () => {
  const clubs = [
    { id: "club-matched", name: "Collegato", sourceType: "gesgolf", hasFigLink: true, figMatchStatus: "matched", sourcePayload: {} },
    { id: "club-unmatched", name: "Da collegare", sourceType: "gesgolf", hasFigLink: false, figMatchStatus: "unmatched", sourcePayload: {} }
  ];
  render(<Advanced clubs={clubs} loading={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Fonti e matching/ }));
  expect(screen.getAllByText("Da collegare", { selector: "strong" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Da collegare" }));
  expect(screen.getAllByText("Da collegare", { selector: "strong" })).toHaveLength(2);
  expect(screen.queryByText("Collegato", { selector: "strong" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Avanzata" }));
  expect(screen.getByRole("button", { name: /Verifica FIG/ })).toBeInTheDocument();
});
