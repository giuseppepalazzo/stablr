// Selection only: never estimate/convert ratings or infer a tee from its name.
// Live NULL scope has already been resolved from the parent by loadCourses.
export function getTeeOptionsForHolesCount(tees, holesCount) {
  const scope = Number(holesCount);
  if (![9, 18].includes(scope)) return [];
  return (Array.isArray(tees) ? tees : []).filter(tee =>
    tee && tee.is_active !== false && tee.isActive !== false && Number(tee.holesCount) === scope
  );
}

export function getSelectedTeeForHolesCount(tees, holesCount, selectedId) {
  const options = getTeeOptionsForHolesCount(tees, holesCount);
  return options.find(tee => tee.id === selectedId) || options[0] || null;
}

export function numericTeeRating(value) {
  if (value == null || typeof value === "boolean" || typeof value === "object" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasTeeRatings(tee) {
  const cr = numericTeeRating(tee?.courseRating), slope = numericTeeRating(tee?.slopeRating);
  return cr !== null && slope !== null && Number.isInteger(slope) && slope >= 55 && slope <= 155;
}
