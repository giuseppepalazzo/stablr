import { getTeeOptionsForHolesCount, getSelectedTeeForHolesCount, hasTeeRatings, numericTeeRating } from "./tee-selection";

// Actual normalized loadCourses shape: same physical nine, independent 9/18 ratings.
const nine = { id: "mare-nine", teeName: "Giallo", teeColor: "giallo", gender: null, holesCount: 9, courseRating: 34.8, slopeRating: 125, parTotal: 35 };
const eighteen = { ...nine, id: "mare-eighteen", holesCount: 18, courseRating: 69.6, slopeRating: 126, parTotal: 70 };
test("Mare 9×2 selects only the exact played scope, even when a previous opposite-scope ID is cached", () => {
  expect(getTeeOptionsForHolesCount([nine, eighteen], 9)).toEqual([nine]);
  expect(getTeeOptionsForHolesCount([nine, eighteen], "18")).toEqual([eighteen]);
  expect(getSelectedTeeForHolesCount([nine, eighteen], 18, nine.id)).toBe(eighteen);
  expect(getSelectedTeeForHolesCount([nine, eighteen], 9, eighteen.id)).toBe(nine);
});
test("missing, deactivated or unknown scope never falls back, invents an eighteen rating or mutates records", () => {
  const originals = JSON.stringify([nine, eighteen]);
  expect(getTeeOptionsForHolesCount([nine], 18)).toEqual([]);
  expect(getSelectedTeeForHolesCount([nine], 18, nine.id)).toBeNull();
  expect(getSelectedTeeForHolesCount([eighteen], 9, eighteen.id)).toBeNull();
  expect(getSelectedTeeForHolesCount([nine, { ...eighteen, is_active: false }], 18)).toBeNull();
  for (const scope of [null, undefined, 0, 27, "invalid"]) expect(getTeeOptionsForHolesCount([nine, eighteen], scope)).toEqual([]);
  expect(getTeeOptionsForHolesCount([{ ...nine, holesCount: null }], 9)).toEqual([]);
  expect(JSON.stringify([nine, eighteen])).toBe(originals);
});
test("same-scope selection preserves explicit ratings, categories, estimates, Par and payload identity", () => {
  const differentCategory = { ...eighteen, id: "women-eighteen", gender: "women", courseRating: 73.1, estimated: true };
  expect(getSelectedTeeForHolesCount([nine, eighteen, differentCategory], 18, differentCategory.id)).toBe(differentCategory);
  expect(getTeeOptionsForHolesCount([eighteen], 18)[0].courseRating).toBe(69.6);
});
test("absent/malformed CR or Slope are not zero or estimated; existing finite CR domain and Slope domain remain", () => {
  for (const value of [null, undefined, "", " ", Infinity, "invalid", true, {}]) expect(numericTeeRating(value)).toBeNull();
  for (const value of [0, -1, 34.8, "34.800"]) expect(numericTeeRating(value)).toBe(Number(value));
  for (const changes of [{ courseRating: null }, { slopeRating: null }, { slopeRating: 54 }, { slopeRating: 156 }, { slopeRating: 125.5 }]) expect(hasTeeRatings({ ...nine, ...changes })).toBe(false);
  expect(hasTeeRatings(nine)).toBe(true); expect(hasTeeRatings(eighteen)).toBe(true);
});
