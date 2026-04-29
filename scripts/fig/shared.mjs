import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, "..", "..");

export async function loadNormalizedJson(filePath) {
  const absolutePath = path.resolve(projectRoot, filePath);
  const contents = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    data: JSON.parse(contents)
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function validateNormalizedPayload(payload) {
  assert(payload && typeof payload === "object", "Payload mancante o non valido.");
  assert(payload.schema_version === "1.0", "schema_version deve essere '1.0'.");
  assert(payload.club && typeof payload.club === "object", "club mancante.");
  assert(typeof payload.club.name === "string" && payload.club.name.trim() !== "", "club.name mancante.");
  assert(
    typeof payload.club.name_normalized === "string" && payload.club.name_normalized.trim() !== "",
    "club.name_normalized mancante."
  );
  assert(Array.isArray(payload.routes), "routes deve essere un array.");
  assert(Array.isArray(payload.route_combinations), "route_combinations deve essere un array.");

  const routeKeys = new Set();

  payload.routes.forEach((route, routeIndex) => {
    const prefix = `routes[${routeIndex}]`;
    assert(route && typeof route === "object", `${prefix} non valido.`);
    assert(typeof route.external_key === "string" && route.external_key.trim() !== "", `${prefix}.external_key mancante.`);
    assert(!routeKeys.has(route.external_key), `${prefix}.external_key duplicato: ${route.external_key}`);
    routeKeys.add(route.external_key);
    assert(typeof route.name === "string" && route.name.trim() !== "", `${prefix}.name mancante.`);
    assert(route.holes_count === 9 || route.holes_count === 18, `${prefix}.holes_count deve essere 9 o 18.`);
    assert(Array.isArray(route.holes), `${prefix}.holes deve essere un array.`);
    assert(Array.isArray(route.tees || []), `${prefix}.tees deve essere un array se presente.`);

    const seenPhysicalHoles = new Set();
    route.holes.forEach((hole, holeIndex) => {
      const holePrefix = `${prefix}.holes[${holeIndex}]`;
      assert(
        Number.isInteger(hole.physical_hole_number) && hole.physical_hole_number >= 1 && hole.physical_hole_number <= 18,
        `${holePrefix}.physical_hole_number non valido.`
      );
      assert(!seenPhysicalHoles.has(hole.physical_hole_number), `${holePrefix}.physical_hole_number duplicato.`);
      seenPhysicalHoles.add(hole.physical_hole_number);
      assert(Number.isInteger(hole.par) && hole.par >= 3 && hole.par <= 6, `${holePrefix}.par non valido.`);
      if (hole.stroke_index !== undefined && hole.stroke_index !== null) {
        assert(
          Number.isInteger(hole.stroke_index) && hole.stroke_index >= 1 && hole.stroke_index <= 18,
          `${holePrefix}.stroke_index non valido.`
        );
      }
    });
  });

  payload.route_combinations.forEach((combination, combinationIndex) => {
    const prefix = `route_combinations[${combinationIndex}]`;
    assert(combination && typeof combination === "object", `${prefix} non valido.`);
    assert(
      typeof combination.external_key === "string" && combination.external_key.trim() !== "",
      `${prefix}.external_key mancante.`
    );
    assert(
      routeKeys.has(combination.front_route_external_key),
      `${prefix}.front_route_external_key non trovato tra i percorsi.`
    );
    assert(
      routeKeys.has(combination.back_route_external_key),
      `${prefix}.back_route_external_key non trovato tra i percorsi.`
    );
    assert(
      combination.front_route_external_key !== combination.back_route_external_key,
      `${prefix} usa lo stesso percorso davanti e dietro.`
    );
    assert(Array.isArray(combination.holes), `${prefix}.holes deve essere un array.`);
    assert(Array.isArray(combination.tees || []), `${prefix}.tees deve essere un array se presente.`);

    const seenRoundHoles = new Set();
    combination.holes.forEach((hole, holeIndex) => {
      const holePrefix = `${prefix}.holes[${holeIndex}]`;
      assert(
        Number.isInteger(hole.round_hole_number) && hole.round_hole_number >= 1 && hole.round_hole_number <= 18,
        `${holePrefix}.round_hole_number non valido.`
      );
      assert(!seenRoundHoles.has(hole.round_hole_number), `${holePrefix}.round_hole_number duplicato.`);
      seenRoundHoles.add(hole.round_hole_number);
      assert(routeKeys.has(hole.route_external_key), `${holePrefix}.route_external_key non trovato.`);
      assert(hole.route_position === 1 || hole.route_position === 2, `${holePrefix}.route_position deve essere 1 o 2.`);
      assert(
        Number.isInteger(hole.physical_hole_number) && hole.physical_hole_number >= 1 && hole.physical_hole_number <= 18,
        `${holePrefix}.physical_hole_number non valido.`
      );
      assert(Number.isInteger(hole.par) && hole.par >= 3 && hole.par <= 6, `${holePrefix}.par non valido.`);
      assert(
        Number.isInteger(hole.stroke_index) && hole.stroke_index >= 1 && hole.stroke_index <= 18,
        `${holePrefix}.stroke_index non valido.`
      );
      if (hole.source_stroke_index !== undefined && hole.source_stroke_index !== null) {
        assert(
          Number.isInteger(hole.source_stroke_index) &&
            hole.source_stroke_index >= 1 &&
            hole.source_stroke_index <= 18,
          `${holePrefix}.source_stroke_index non valido.`
        );
      }
    });
  });

  return true;
}

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variabile ambiente mancante: ${name}`);
  }
  return value;
}

export function summarizePayload(payload) {
  return {
    club: payload.club.name,
    routes: payload.routes.length,
    routeCombinations: payload.route_combinations.length
  };
}
