import {
  clearRoundDraft,
  getDraftCompletedHoles,
  loadRoundDraft,
  saveRoundDraft
} from "./round-draft";

const userId = "user-a";
const baseDraft = {
  state: "setup",
  courseSnapshot: { id: "club-a", name: "Club prova" },
  roundSetup: { totalCompetitionHoles: 9, selectedRouteId: "route-a" }
};

beforeEach(() => localStorage.clear());

test("saves and restores a setup draft for its user", () => {
  saveRoundDraft(userId, baseDraft);

  expect(loadRoundDraft(userId)).toMatchObject({
    version: 1,
    userId,
    state: "setup",
    courseSnapshot: { name: "Club prova" },
    roundSetup: { totalCompetitionHoles: 9 }
  });
  expect(loadRoundDraft("another-user")).toBeNull();
});

test("restores a playing draft with scores and completed holes", () => {
  saveRoundDraft(userId, {
    ...baseDraft,
    state: "playing",
    competitionHoles: [{ competitionHoleNumber: 1, par: 4 }],
    roundScores: [5],
    manualReceivedShots: { 0: 1 },
    completedHoleIndexes: [0, 0]
  });

  const draft = loadRoundDraft(userId);
  expect(draft.roundScores).toEqual([5]);
  expect(draft.manualReceivedShots).toEqual({ 0: 1 });
  expect(getDraftCompletedHoles(draft)).toBe(1);
});

test("clears a draft only when explicitly requested", () => {
  saveRoundDraft(userId, baseDraft);
  expect(clearRoundDraft(userId)).toBe(true);
  expect(loadRoundDraft(userId)).toBeNull();
});
