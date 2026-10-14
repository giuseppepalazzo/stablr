import { render, screen } from "@testing-library/react";
import TeeScopeNotice from "./TeeScopeNotice";
import { getTeeOptionsForHolesCount, getSelectedTeeForHolesCount } from "../lib/tee-selection";
test("no 18 tee: clear unavailable message, never a nine-hole CR/Slope", () => {
  const tees = [{ id: "nine", holesCount: 9, courseRating: 34.8, slopeRating: 125 }];
  render(<TeeScopeNotice holesCount={18} options={getTeeOptionsForHolesCount(tees, 18)} selectedTee={getSelectedTeeForHolesCount(tees, 18, "nine")} />);
  expect(screen.getByRole("status")).toHaveTextContent("Nessun tee disponibile per 18 buche");
  expect(screen.getByRole("status")).toHaveTextContent("CR/Slope di altri ambiti non vengono utilizzati");
  expect(screen.queryByText(/34.8|125/)).not.toBeInTheDocument();
});
test("same-scope incomplete ratings remain visibly missing, not invented; complete ratings need no notice", () => {
  const tee = { id: "nine", holesCount: 9, courseRating: null, slopeRating: null };
  const view = render(<TeeScopeNotice holesCount={9} options={[tee]} selectedTee={tee} />);
  expect(screen.getByRole("status")).toHaveTextContent("CR/Slope non disponibili");
  view.rerender(<TeeScopeNotice holesCount={9} options={[tee]} selectedTee={{ ...tee, courseRating: 34.8, slopeRating: 125 }} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
