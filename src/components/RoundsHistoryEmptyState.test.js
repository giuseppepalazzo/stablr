import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RoundDeleteControl } from "./RoundDeleteControl";
import { RoundsHistoryEmptyState } from "./RoundsHistoryEmptyState";

const colors = {
  overlay: "rgba(0, 0, 0, 0.5)",
  card: "#123b2f",
  cardSecondary: "#0d3026",
  border: "#255445",
  borderStrong: "#3b6b5a",
  text: "#f4f6f1",
  subtext: "#b7c9c0"
};

function HistoryHarness({ initialRounds = [{ id: "round-a", savedName: "Giro Mare di Roma" }] }) {
  const [view, setView] = useState("history");
  const [rounds, setRounds] = useState(initialRounds);
  const [selectedRound, setSelectedRound] = useState(null);

  if (view !== "history") return <div data-testid="home-view">Home</div>;

  return (
    <section data-testid="history-view">
      <h2>I tuoi giri</h2>
      {selectedRound ? <div data-testid="round-detail">Dettaglio {selectedRound.savedName}</div> : null}
      {rounds.length === 0 ? (
        <RoundsHistoryEmptyState colors={colors} appFont="sans-serif" />
      ) : (
        rounds.map((round) => (
          <div
            key={round.id}
            data-testid={`round-card-${round.id}`}
            onClick={() => setSelectedRound(round)}
          >
            <span>{round.savedName}</span>
            <RoundDeleteControl
              roundName={round.savedName}
              onConfirm={async () => setRounds((current) => current.filter((item) => item.id !== round.id))}
              colors={colors}
              appFont="sans-serif"
            />
          </div>
        ))
      )}
      <button type="button" onClick={() => setView("home")}>Chiudi</button>
    </section>
  );
}

test("does not open a history card when delete interactions are cancelled or dismissed", () => {
  render(<HistoryHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
  expect(screen.queryByTestId("round-detail")).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));

  expect(screen.getByTestId("history-view")).toBeInTheDocument();
  expect(screen.queryByTestId("round-detail")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
  fireEvent.pointerDown(screen.getByTestId("round-delete-backdrop"), { pointerType: "touch" });
  fireEvent.click(screen.getByTestId("round-delete-backdrop"));

  expect(screen.getByTestId("history-view")).toBeInTheDocument();
  expect(screen.queryByTestId("round-detail")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("round-card-round-a"));
  expect(screen.getByTestId("round-detail")).toHaveTextContent("Dettaglio Giro Mare di Roma");
});

test("keeps I tuoi giri open and updates the list after deleting one of several rounds", async () => {
  render(<HistoryHarness initialRounds={[
    { id: "round-a", savedName: "Mare di Roma" },
    { id: "round-b", savedName: "Marco Simone" }
  ]} />);

  fireEvent.click(within(screen.getByTestId("round-card-round-b")).getByRole("button", { name: "Elimina" }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
  });

  await waitFor(() => expect(screen.getByTestId("history-view")).toBeInTheDocument());
  expect(screen.getByTestId("round-card-round-a")).toBeInTheDocument();
  expect(screen.queryByTestId("round-card-round-b")).not.toBeInTheDocument();
  expect(screen.queryByTestId("round-detail")).not.toBeInTheDocument();
});

test("keeps I tuoi giri open and shows the empty state after deleting the last round", async () => {
  render(<HistoryHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
  });

  await waitFor(() => expect(screen.getByTestId("history-view")).toBeInTheDocument());
  expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
  expect(screen.getByText("Nessun giro salvato")).toBeInTheDocument();
  expect(screen.getByText("I tuoi giri completati appariranno qui.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Chiudi" })).toBeInTheDocument();
});

test("shows the empty state initially and closes only when Chiudi is pressed", () => {
  render(<HistoryHarness initialRounds={[]} />);

  expect(screen.getByText("Nessun giro salvato")).toBeInTheDocument();
  expect(screen.getByText("I tuoi giri completati appariranno qui.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
  expect(screen.getByTestId("home-view")).toBeInTheDocument();
});
