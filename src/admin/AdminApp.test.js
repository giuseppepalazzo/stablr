import { fireEvent, render, screen } from "@testing-library/react";
import { AdminShell } from "./AdminApp";

test("renders the operational overview and the catalog filter controls", () => {
  render(<AdminShell onSignOut={jest.fn()} />);

  expect(screen.getAllByText("Da revisionare")).toHaveLength(1);
  expect(screen.getAllByText("Vedi tutto")).toHaveLength(4);

  fireEvent.click(screen.getByRole("button", { name: "Club e percorsi" }));
  expect(screen.getByPlaceholderText("Cerca club, FIG ID, città o percorso")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dati incompleti" }));
  expect(screen.getByText("Catalogo non disponibile.")).toBeInTheDocument();
});
