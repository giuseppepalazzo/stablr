import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./shared.mjs";

const routeSources = {
  bianco: {
    name: "Bianco",
    external_key: "bianco-9",
    display_order: 1,
    total_par: 35,
    pars: [4, 3, 5, 3, 4, 4, 3, 5, 4],
    base_stroke_indexes: [3, 7, 9, 17, 5, 13, 11, 15, 1],
    official_front_stroke_indexes: [3, 7, 5, 15, 13, 11, 9, 17, 1],
    official_back_stroke_indexes: [4, 8, 6, 16, 14, 12, 10, 18, 2],
    tees: [
      ["Giallo", "yellow", "men", 34.7, 132, 35],
      ["Verde", "green", "men", 33.4, 129, 35],
      ["Rosso", "red", "women", 35.6, 123, 35],
      ["Arancio", "orange", "women", 34.1, 120, 35]
    ]
  },
  blu: {
    name: "Blu",
    external_key: "blu-9",
    display_order: 2,
    total_par: 37,
    pars: [4, 5, 3, 4, 5, 3, 4, 4, 5],
    base_stroke_indexes: [2, 18, 16, 4, 14, 6, 8, 10, 12],
    official_front_stroke_indexes: [9, 17, 15, 1, 13, 5, 7, 3, 11],
    official_back_stroke_indexes: [10, 18, 16, 2, 14, 6, 8, 4, 12],
    tees: [
      ["Giallo", "yellow", "men", 36.4, 140, 37],
      ["Verde", "green", "men", 34.8, 136, 37],
      ["Rosso", "red", "women", 37.1, 138, 37],
      ["Arancio", "orange", "women", 35.5, 135, 37]
    ]
  },
  rosso: {
    name: "Rosso",
    external_key: "rosso-9",
    display_order: 3,
    total_par: 35,
    pars: [4, 3, 4, 4, 3, 5, 4, 4, 4],
    base_stroke_indexes: [7, 15, 17, 1, 11, 13, 9, 5, 3],
    official_front_stroke_indexes: [7, 15, 17, 1, 11, 13, 9, 5, 3],
    official_back_stroke_indexes: [8, 16, 18, 2, 12, 14, 10, 6, 4],
    tees: [
      ["Giallo", "yellow", "men", 34.2, 124, 35],
      ["Verde", "green", "men", 32.9, 118, 35],
      ["Rosso", "red", "women", 35.3, 122, 35],
      ["Arancio", "orange", "women", 33.9, 116, 35]
    ]
  }
};

const repeatedRoutes = [
  {
    source_key: "bianco",
    external_key: "bianco-repeat-18",
    name: "9 Buche Bianco 2 Volte",
    display_order: 4,
    tees: [
      ["Giallo", "yellow", "men", 69.4, 132, 70],
      ["Verde", "green", "men", 66.8, 129, 70],
      ["Rosso", "red", "women", 71.2, 123, 70],
      ["Arancio", "orange", "women", 68.2, 120, 70]
    ]
  },
  {
    source_key: "blu",
    external_key: "blu-repeat-18",
    name: "9 Buche Blu 2 Volte",
    display_order: 5,
    tees: [
      ["Giallo", "yellow", "men", 72.8, 140, 74],
      ["Verde", "green", "men", 69.6, 136, 74],
      ["Rosso", "red", "women", 74.2, 138, 74],
      ["Arancio", "orange", "women", 71.0, 135, 74]
    ]
  },
  {
    source_key: "rosso",
    external_key: "rosso-repeat-18",
    name: "Est (Rosso x 2)",
    display_order: 6,
    tees: [
      ["Giallo", "yellow", "men", 68.4, 124, 70],
      ["Verde", "green", "men", 65.8, 118, 70],
      ["Rosso", "red", "women", 70.6, 122, 70],
      ["Arancio", "orange", "women", 67.7, 116, 70]
    ]
  }
];

const officialCombinations = [
  {
    external_key: "championship-bianco-blu",
    name: "Championship Bianco/Blu",
    front: "bianco",
    back: "blu",
    tees: [
      ["Bianco", "white", "men", 73.0, 136, 72],
      ["Giallo", "yellow", "men", 71.1, 136, 72],
      ["Verde", "green", "men", 68.2, 129, 72],
      ["Blu", "blue", "women", 74.7, 137, 72],
      ["Rosso", "red", "women", 72.7, 130, 72],
      ["Arancio", "orange", "women", 69.6, 123, 72]
    ]
  },
  {
    external_key: "championship-inverse-blu-bianco",
    name: "Blu/Bianco (Champ. Invertito)",
    front: "blu",
    back: "bianco",
    tees: [
      ["Bianco", "white", "men", 73.0, 136, 72],
      ["Giallo", "yellow", "men", 71.1, 136, 72],
      ["Verde", "green", "men", 68.2, 129, 72],
      ["Blu", "blue", "women", 74.7, 137, 72],
      ["Rosso", "red", "women", 72.7, 130, 72],
      ["Arancio", "orange", "women", 69.6, 123, 72]
    ]
  },
  {
    external_key: "king-blu-rosso",
    name: "King Blu/Rosso",
    front: "blu",
    back: "rosso",
    tees: [
      ["Giallo", "yellow", "men", 70.6, 132, 72],
      ["Verde", "green", "men", 67.7, 127, 72],
      ["Rosso", "red", "women", 72.4, 130, 72],
      ["Arancio", "orange", "women", 69.4, 125, 72]
    ]
  },
  {
    external_key: "queen-bianco-rosso",
    name: "Queen Bianco/Rosso",
    front: "bianco",
    back: "rosso",
    tees: [
      ["Giallo", "yellow", "men", 68.9, 128, 70],
      ["Verde", "green", "men", 66.3, 124, 70],
      ["Rosso", "red", "women", 70.9, 123, 70],
      ["Arancio", "orange", "women", 68.0, 118, 70]
    ]
  }
];

function makeTee(sourceExternalId, [tee_name, tee_color, gender, course_rating, slope_rating, par_total], kind) {
  return {
    tee_name,
    tee_color,
    gender,
    course_rating,
    slope_rating,
    par_total,
    is_active: true,
    source_system: "fig",
    source_external_id: sourceExternalId,
    source_payload: { kind }
  };
}

function buildRankMap(strokeIndexes) {
  const sorted = [...strokeIndexes].sort((a, b) => a - b);
  const rankMap = new Map();
  sorted.forEach((value, index) => {
    rankMap.set(value, index + 1);
  });
  return rankMap;
}

function buildNineRoute(routeKey, route) {
  return {
    external_key: route.external_key,
    name: route.name,
    holes_count: 9,
    total_par: route.total_par,
    display_order: route.display_order,
    is_active: true,
    source_system: "fig",
    source_external_id: `fig-route-${routeKey}-9`,
    source_payload: { kind: "route", family: "base" },
    holes: route.pars.map((par, index) => ({
      physical_hole_number: index + 1,
      par,
      stroke_index: route.base_stroke_indexes[index],
      display_label: String(index + 1)
    })),
    tees: route.tees.map((tee) =>
      makeTee(`fig-tee-${routeKey}-${tee[1]}`, tee, "route_tee")
    )
  };
}

function buildRepeatedRoute(definition) {
  const source = routeSources[definition.source_key];

  const holes = [
    ...source.pars.map((par, index) => ({
      physical_hole_number: index + 1,
      par,
      stroke_index: source.official_front_stroke_indexes[index],
      display_label: String(index + 1)
    })),
    ...source.pars.map((par, index) => ({
      physical_hole_number: index + 10,
      par,
      stroke_index: source.official_back_stroke_indexes[index],
      display_label: String(index + 10)
    }))
  ];

  return {
    external_key: definition.external_key,
    name: definition.name,
    holes_count: 18,
    total_par: source.total_par * 2,
    display_order: definition.display_order,
    is_active: true,
    source_system: "fig",
    source_external_id: `fig-route-${definition.external_key}`,
    source_payload: { kind: "route", family: "repeat" },
    holes,
    tees: definition.tees.map((tee) =>
      makeTee(`fig-tee-${definition.external_key}-${tee[1]}`, tee, "route_tee")
    )
  };
}

function buildCombination(definition) {
  const front = routeSources[definition.front];
  const back = routeSources[definition.back];

  const holes = [
    ...front.pars.map((par, index) => ({
      round_hole_number: index + 1,
      route_external_key: front.external_key,
      route_position: 1,
      physical_hole_number: index + 1,
      par,
      stroke_index: front.official_front_stroke_indexes[index],
      source_stroke_index: front.official_front_stroke_indexes[index],
      display_label: `${front.name} ${index + 1}`
    })),
    ...back.pars.map((par, index) => ({
      round_hole_number: index + 10,
      route_external_key: back.external_key,
      route_position: 2,
      physical_hole_number: index + 1,
      par,
      stroke_index: back.official_back_stroke_indexes[index],
      source_stroke_index: back.official_back_stroke_indexes[index],
      display_label: `${back.name} ${index + 1}`
    }))
  ];

  return {
    external_key: definition.external_key,
    name: definition.name,
    front_route_external_key: front.external_key,
    back_route_external_key: back.external_key,
    holes_count: 18,
    total_par: front.total_par + back.total_par,
    is_active: true,
    source_system: "fig",
    source_external_id: `fig-combination-${definition.external_key}`,
    source_payload: { kind: "combination" },
    holes,
    tees: definition.tees.map((tee) =>
      makeTee(`fig-combination-tee-${definition.external_key}-${tee[1]}`, tee, "combination_tee")
    )
  };
}

const payload = {
  schema_version: "1.0",
  source: {
    system: "fig",
    scraped_at: "2026-05-04T16:00:00Z",
    club_external_id: "fig-parco-medici",
    notes: "Curated normalized payload for Parco De' Medici with all primary routes and official playable combinations"
  },
  club: {
    name: "Parco De' Medici",
    name_normalized: "parco de medici",
    city: "Roma",
    country: "Italia",
    source_system: "fig",
    source_external_id: "fig-parco-medici",
    source_payload: {
      kind: "club",
      curated: true
    }
  },
  routes: [
    buildNineRoute("bianco", routeSources.bianco),
    buildNineRoute("blu", routeSources.blu),
    buildNineRoute("rosso", routeSources.rosso),
    ...repeatedRoutes.map(buildRepeatedRoute)
  ],
  route_combinations: officialCombinations.map(buildCombination)
};

const targets = [
  "supabase/fig-whs-normalized-example.json",
  "data/fig/normalized/parco-de-medici-example.json"
];

await Promise.all(
  targets.map(async (relativePath) => {
    const absolutePath = path.resolve(projectRoot, relativePath);
    await fs.writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  })
);

console.log("Parco De' Medici normalized payload aggiornato.");
