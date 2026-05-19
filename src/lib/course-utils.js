export function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeCourseName(name) {
  return normalizeWhitespace(name)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeHolesForStructure(holes) {
  return (Array.isArray(holes) ? holes : []).map((hole, index) => ({
    hole: Number(hole?.hole || index + 1),
    par: Number(hole?.par || 0),
    strokeIndex:
      hole?.strokeIndex === "" ||
      hole?.strokeIndex === null ||
      typeof hole?.strokeIndex === "undefined"
        ? null
        : Number(hole.strokeIndex)
  }));
}

export function buildCourseStructurePayload(courseLike) {
  const holes = sanitizeHolesForStructure(courseLike?.holes || courseLike?.holes_json);

  return {
    holesCount: Number(courseLike?.holesCount || courseLike?.holes_count || holes.length || 0),
    totalPar:
      Number(courseLike?.totalPar || courseLike?.total_par || 0) ||
      holes.reduce((sum, hole) => sum + Number(hole.par || 0), 0),
    holes
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function createSimpleHash(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv_${(hash >>> 0).toString(16)}`;
}

export function createCourseStructureHash(courseLike) {
  return createSimpleHash(stableStringify(buildCourseStructurePayload(courseLike)));
}
