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

function HistoryHarness() {
  const [view, setView] = useState("history");
  const [rounds, setRounds] = useState([{ id: "round-a", savedName: "Giro_23/09/2026" }]);

  if (view !== "history") return <div data-testid="home-view">Home</div>;

  return (
    <section data-testid="history-view">
      <h2>I tuoi giri</h2>
      {rounds.length === 0 ? (
        <RoundsHistoryEmptyState colors={colors} appFont="sans-serif" />
      ) : (
        <RoundDeleteControl
          roundName={rounds[0].savedName}
          onConfirm={async () => setRounds([])}
          colors={colors}
          appFont="sans-serif"
        />
      )}
      <button type="button" onClick={() => setView("home")}>Chiudi</button>
    </section>
  );
}

test("keeps I tuoi giri open and shows the empty state after deleting the last round", async () => {
  render(<HistoryHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Elimina" }));
  });

  await waitFor(() => expect(screen.getByTestId("history-view")).toBeInTheDocument());
  expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
  expect(screen.getByText("Nessun giro salvato")).toBeInTheDocument();
  expect(screen.getByText("I tuoi giri completati appariranno qui.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Chiudi" })).toBeInTheDocument();
});
