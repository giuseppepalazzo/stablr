import { fireEvent, render, screen, within } from "@testing-library/react";
import { RoundHistoryCard, RoundHistoryDetail } from "./RoundsHistory";

const colors = {
  overlay: "rgba(0,0,0,.5)",
  card: "#123b2f",
  cardSecondary: "#0d3026",
  border: "#255445",
  borderStrong: "#3b6b5a",
  text: "#f4f6f1",
  subtext: "#b7c9c0",
  pillBg: "#102a22",
  pillBorder: "#29483e",
  greenDark: "#0b211a",
  greenBorder: "#315b4d",
  success: "#9fc9b5"
};

const teeColors = () => ({ label: "Giallo", dotColor: "#f4c400", borderColor: "#856f00" });
const stableford = (par, strokes, shots) => Math.max(0, 2 + Number(par) - (Number(strokes) - Number(shots)));
const closeButtonStyle = {};

function buildRound(holeCount = 18) {
  return {
    id: "marco-simone-round",
    displayTitle: "Marco Simone",
    displayMetadata: "18 Buche · 23/09/2026",
    courseName: "Marco Simone",
    routeName: holeCount === 18 ? "18 Buche" : "Prime nove",
    formattedDate: "23/09/2026",
    handicapIndex: 36.7,
    playingHandicap: 42,
    totalPar: holeCount === 18 ? 72 : 36,
    grossTotal: holeCount === 18 ? 100 : 50,
    netTotal: holeCount === 18 ? 58 : 29,
    stablefordGrossTotal: holeCount === 18 ? 8 : 4,
    stablefordNetTotal: holeCount === 18 ? 50 : 25,
    tee: {
      label: "Giallo",
      color: "yellow",
      courseRating: 72.1,
      slopeRating: 129,
      par: 72
    },
    scores: Array.from({ length: holeCount }, (_, index) => (index < 10 ? 6 : 5)),
    receivedShots: Array.from({ length: holeCount }, (_, index) => (index < 6 ? 3 : 2))
  };
}

function buildHoles(holeCount = 18) {
  return Array.from({ length: holeCount }, (_, index) => ({
    competitionHoleNumber: index + 1,
    par: 4,
    strokeIndex: index + 1,
    stablefordNet: index < 14 ? 3 : 2
  }));
}

test("shows the four complete metric names and the requested card naming", () => {
  const onOpen = jest.fn();
  render(
    <RoundHistoryCard
      round={buildRound()}
      onOpen={onOpen}
      onDelete={jest.fn()}
      colors={colors}
      appFont="sans-serif"
    />
  );

  expect(screen.getByText("Marco Simone")).toBeInTheDocument();
  expect(screen.getByText("18 Buche · 23/09/2026")).toBeInTheDocument();
  expect(screen.getByText("Lordo")).toBeInTheDocument();
  expect(screen.getByText("Netto")).toBeInTheDocument();
  expect(screen.getByText("STABLR Lordo")).toBeInTheDocument();
  expect(screen.getByText("STABLR Netto")).toBeInTheDocument();
  expect(screen.queryByText("Stableford")).not.toBeInTheDocument();
  const metricCards = document.querySelectorAll(".round-history-metric");
  expect(metricCards[2]).toHaveStyle({ backgroundColor: colors.pillBg });
  expect(metricCards[3]).toHaveStyle({ backgroundColor: colors.greenDark });

  fireEvent.click(screen.getByText("Marco Simone"));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("renders the validated Marco Simone metrics, tee data and complete 18-hole scorecards", () => {
  render(
    <RoundHistoryDetail
      round={buildRound()}
      holes={buildHoles()}
      onClose={jest.fn()}
      colors={colors}
      appFont="sans-serif"
      getReceivedShots={(round, hole, index) => round.receivedShots[index]}
      getStablefordPoints={stableford}
      getTeeColor={teeColors}
      closeButtonStyle={closeButtonStyle}
    />
  );

  expect(screen.getByText("HCP 36,7")).toBeInTheDocument();
  expect(screen.getByText("PH 42")).toBeInTheDocument();
  expect(screen.getByText("CR 72,1")).toBeInTheDocument();
  expect(screen.getByText("Slope 129")).toBeInTheDocument();
  expect(screen.getByText("Ruota il telefono per la scorecard completa")).toBeInTheDocument();

  const metrics = screen.getAllByText("STABLR Netto")[0].closest(".round-history-metrics");
  expect(metrics).toHaveTextContent("Lordo100");
  expect(metrics).toHaveTextContent("Netto58");
  expect(metrics).toHaveTextContent("STABLR Lordo8");
  expect(metrics).toHaveTextContent("STABLR Netto50");

  const portrait = screen.getByRole("table", { name: "Scorecard verticale" });
  expect(within(portrait).getByText("SI")).toBeInTheDocument();
  expect(within(portrait).getAllByRole("row")).toHaveLength(19);

  const landscape = screen.getByRole("table", { name: "Scorecard orizzontale" });
  expect(within(landscape).getByText("OUT")).toBeInTheDocument();
  expect(within(landscape).getByText("IN")).toBeInTheDocument();
  expect(within(landscape).getByText("TOT")).toBeInTheDocument();
  expect(within(landscape).getByText("50")).toBeInTheDocument();
});

test("renders a 9-hole scorecard without an IN section", () => {
  render(
    <RoundHistoryDetail
      round={buildRound(9)}
      holes={buildHoles(9)}
      onClose={jest.fn()}
      colors={colors}
      appFont="sans-serif"
      getReceivedShots={(round, hole, index) => round.receivedShots[index]}
      getStablefordPoints={stableford}
      getTeeColor={teeColors}
      closeButtonStyle={closeButtonStyle}
    />
  );

  const landscape = screen.getByRole("table", { name: "Scorecard orizzontale" });
  expect(within(landscape).getByText("OUT")).toBeInTheDocument();
  expect(within(landscape).queryByText("IN")).not.toBeInTheDocument();
  expect(within(landscape).getByText("TOT")).toBeInTheDocument();
});
