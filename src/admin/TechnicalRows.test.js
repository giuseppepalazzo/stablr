import { fireEvent, render, screen, within } from "@testing-library/react";
import TechnicalRows, { TechnicalDisclosure, TechnicalExpansion, ExpandAllTechnicalRows } from "./TechnicalRows";

const rows = (count, prefix = "Riga") => Array.from({ length: count }, (_, index) => <div role="row" key={index}>{prefix} {index + 1}</div>);
function Page({ extra = false }) {
  return <TechnicalExpansion><ExpandAllTechnicalRows />
    <div role="table" aria-label="Buche"><TechnicalRows label="Buche">{rows(9)}</TechnicalRows></div>
    <div role="table" aria-label="Audit"><TechnicalRows label="Audit">{rows(8, "Evento")}</TechnicalRows></div>
    {extra && <section role="dialog" aria-label="Conferma"><TechnicalRows label="Tee">{rows(7, "Tee")}</TechnicalRows><button>Conferma</button></section>}
    <button>Salva bozza</button><p role="alert">Blocco operativo visibile</p>
  </TechnicalExpansion>;
}

test("six rows initially, local expansion preserves all content/order and leaves other lists/actions visible", () => {
  render(<Page />);
  const holes = screen.getByRole("table", { name: "Buche" }), audit = screen.getByRole("table", { name: "Audit" });
  expect(within(holes).getAllByRole("row")).toHaveLength(6);
  fireEvent.click(within(holes).getByRole("button", { name: "Mostra tutto · Buche" }));
  expect(within(holes).getAllByRole("row").map((row) => row.textContent)).toEqual(Array.from({ length: 9 }, (_, i) => `Riga ${i + 1}`));
  expect(within(audit).getAllByRole("row")).toHaveLength(6);
  fireEvent.click(within(holes).getByRole("button", { name: "Riduci · Buche" }));
  expect(within(holes).getAllByRole("row")).toHaveLength(6);
  expect(screen.getByRole("alert")).toBeVisible(); expect(screen.getByRole("button", { name: "Salva bozza" })).toBeVisible();
});

test("global commands override local choices and apply to later-mounted modal collections", () => {
  const view = render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Mostra tutto · Buche" }));
  fireEvent.click(screen.getByRole("button", { name: "Espandi tutte" }));
  expect(within(screen.getByRole("table", { name: "Audit" })).getAllByRole("row")).toHaveLength(8);
  view.rerender(<Page extra />);
  expect(within(screen.getByRole("dialog")).getAllByRole("row")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Riduci · Audit" }));
  fireEvent.click(screen.getByRole("button", { name: "Riduci tutte" }));
  expect(within(screen.getByRole("table", { name: "Buche" })).getAllByRole("row")).toHaveLength(6);
  expect(within(screen.getByRole("dialog")).getAllByRole("row")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Conferma" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Espandi tutte" }));
  expect(within(screen.getByRole("table", { name: "Audit" })).getAllByRole("row")).toHaveLength(8);
});

test.each([0, 1, 6])("collections of %s rows do not add a redundant control", (count) => {
  render(<div role="table"><TechnicalRows label="Breve">{rows(count)}</TechnicalRows></div>);
  expect(screen.queryAllByRole("row")).toHaveLength(count);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("global expansion opens grouped technical sections without opening raw-reference disclosures", () => {
  render(<TechnicalExpansion><ExpandAllTechnicalRows /><TechnicalDisclosure summary="Buche e configurazioni"><TechnicalRows label="Buche">{rows(9)}</TechnicalRows><details><summary>Riferimenti tecnici</summary>Identità interna</details></TechnicalDisclosure></TechnicalExpansion>);
  const section = screen.getByText("Buche e configurazioni").closest("details");
  expect(section).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Espandi tutte" }));
  expect(section).toHaveAttribute("open"); expect(screen.getByText("Riga 9")).toBeVisible();
  expect(screen.getByText("Riferimenti tecnici").closest("details")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Riduci tutte" }));
  expect(section).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Buche e configurazioni"));
  expect(section).toHaveAttribute("open"); expect(screen.queryByText("Riga 9")).not.toBeInTheDocument();
});
