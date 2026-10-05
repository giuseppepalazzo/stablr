import { fireEvent, render, screen } from "@testing-library/react";
import { AdminShell, filterCatalogClubs, getClubFilter } from "./AdminApp";

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
