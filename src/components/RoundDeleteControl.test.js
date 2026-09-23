import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RoundDeleteControl } from "./RoundDeleteControl";

const colors = {
  overlay: "rgba(0, 0, 0, 0.5)",
  card: "#123b2f",
  cardSecondary: "#0d3026",
  border: "#255445",
  borderStrong: "#3b6b5a",
  text: "#f4f6f1",
  subtext: "#b7c9c0"
};

describe("RoundDeleteControl", () => {
  test("does not delete on the first tap and deletes only after explicit confirmation", async () => {
    let resolveDeletion;
    const onConfirm = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveDeletion = resolve;
        })
    );
    render(
      <RoundDeleteControl
        roundName="Giro_23/09/2026"
        onConfirm={onConfirm}
        colors={colors}
        appFont="sans-serif"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("round-delete-backdrop"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const confirmation = screen.getByRole("dialog");
    const deleteButton = within(confirmation).getByRole("button", { name: "Elimina" });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDeletion();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("cancels without deleting", () => {
    const onConfirm = jest.fn();
    render(
      <RoundDeleteControl
        roundName="Giro_23/09/2026"
        onConfirm={onConfirm}
        colors={colors}
        appFont="sans-serif"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
