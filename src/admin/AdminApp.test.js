import { fireEvent, render, screen } from "@testing-library/react";
import {
  AdminShell,
  buildReviewItems,
  filterCatalogClubs,
  filterReviewItems,
  getClubFilter,
  ReviewDetail,
  Reviews
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
