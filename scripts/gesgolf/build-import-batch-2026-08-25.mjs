import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const PROTECTED_CLUB_NAMES = new Set(["mare di roma", "parco de' medici", "parco de’ medici", "parco de medici"]);

const MONTELUPO_PHYSICAL_HOLE_SEQUENCES = {
  bianco: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 3, 5, 6, 14],
  rosso: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 1, 2, 3, 5, 6],
  blu: [1, 2, 3, 4, 5, 6, 9, 12, 14, 1, 2, 3, 4, 5, 6, 9, 12, 14]
};

const CAMPODOGLIO_TEE_SPECIFIC_BASE_HOLES = [
  { physical_hole_number: 1, par: 4, white_yellow_hcp: [4, 4], blue_red_hcp: [5, 6], distances_m: { bianco: [394], giallo: [369], blu: [341], rosso: [334] } },
  { physical_hole_number: 2, par: 4, white_yellow_hcp: [13, 14], blue_red_hcp: [17, 18], distances_m: { bianco: [355], giallo: [339], blu: [309], rosso: [296] } },
  { physical_hole_number: 3, par: 5, white_yellow_hcp: [7, 8], blue_red_hcp: [9, 10], distances_m: { bianco: [472], giallo: [445], blu: [410], rosso: [384] } },
  { physical_hole_number: 4, par: 4, white_yellow_hcp: [1, 2], blue_red_hcp: [3, 4], distances_m: { bianco: [388], giallo: [367], blu: [339], rosso: [317] } },
  { physical_hole_number: 5, par: 3, white_yellow_hcp: [11, 12], blue_red_hcp: [13, 14], distances_m: { bianco: [174], giallo: [164], blu: [145], rosso: [127] } },
  { physical_hole_number: 6, par: 4, white_yellow_hcp: [17, 18], blue_red_hcp: [15, 16], distances_m: { bianco: [288], giallo: [272], blu: [250], rosso: [236] } },
  { physical_hole_number: 7, par: 4, white_yellow_hcp: [5, 6], blue_red_hcp: [7, 8], distances_m: { bianco: [350], giallo: [338], blu: [309], rosso: [290] } },
  { physical_hole_number: 8, par: 3, white_yellow_hcp: [9, 10], blue_red_hcp: [11, 12], distances_m: { bianco: [145], giallo: [138], blu: [130], rosso: [123] } }
];

function campodoglioHoleNineForVariant(parVariant) {
  if (parVariant === 70) {
    return {
      physical_hole_number: 9,
      par: 4,
      white_yellow_hcp: [1, 2],
      blue_red_hcp: [1, 2],
      distances_m: { bianco: [430], giallo: [394], blu: [367], rosso: [315] }
    };
  }

  return {
    physical_hole_number: 9,
    par: 5,
    white_yellow_hcp: [17, 18],
    blue_red_hcp: [17, 18],
    distances_m: { bianco: [446], giallo: [430], blu: [394], rosso: [367] }
  };
}

function buildCampodoglioTeeSpecificHoleMatrix(parVariant = 72) {
  const sourceLinks = [
    "https://www.campodoglio.it/percorso-golf-club/",
    "https://www.campodoglio.it/percorso-golf-club/buca-1/",
    "https://www.campodoglio.it/percorso-golf-club/buca-2/",
    "https://www.campodoglio.it/percorso-golf-club/buca-3-12/",
    "https://www.campodoglio.it/percorso-golf-club/buca-4-13/",
    "https://www.campodoglio.it/percorso-golf-club/buca-5-14/",
    "https://www.campodoglio.it/percorso-golf-club/buca-6-15/",
    "https://www.campodoglio.it/percorso-golf-club/buca-7-16/",
    "https://www.campodoglio.it/percorso-golf-club/buca-8-17/",
    "https://www.campodoglio.it/percorso-golf-club/buca-9-18/"
  ];
  const holes = [...CAMPODOGLIO_TEE_SPECIFIC_BASE_HOLES, campodoglioHoleNineForVariant(parVariant)];
  const teeConfigs = {
    bianco: { label: "Bianco", hcpKey: "white_yellow_hcp" },
    giallo: { label: "Giallo", hcpKey: "white_yellow_hcp" },
    blu: { label: "Blu", hcpKey: "blue_red_hcp" },
    rosso: { label: "Rosso", hcpKey: "blue_red_hcp" }
  };

  return {
    model: "physical_9_dual_round_hcp_by_tee",
    source: "official_club_site",
    evidence_status: "verified",
    par_variant: parVariant,
    physical_hole_count: 9,
    source_links: sourceLinks,
    note:
      "Campodoglio official site exposes Buca 1/10 through 9/18 with tee-specific HCP pairs. Stablr uses the first value for the first loop and the second value for the second loop.",
    tees: Object.fromEntries(
      Object.entries(teeConfigs).map(([teeKey, teeConfig]) => [
        teeKey,
        {
          label: teeConfig.label,
          holes: holes.map((hole) => ({
            physical_hole_number: hole.physical_hole_number,
            par: hole.par,
            stroke_indexes: hole[teeConfig.hcpKey],
            distances_m: hole.distances_m[teeKey]
          }))
        }
      ])
    )
  };
}

const CLUBS = [
  {
    name: "Firenze Ugolino",
    gesSlug: "firenze-ugolino",
    circoloId: "15",
    isComplex: false,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: ["https://www.golfugolino.it/percorso/"],
    notes: "Stablr Approved: FIG official catalog + GesGolf UGOLINO hole-by-hole import + official club course/scorecard evidence exposing PAR/HCP for all 18 holes.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "UGOLINO", gesRouteId: 285, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "UGOLINO", gesRouteId: 285, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "UGOLINO", gesRouteId: 285, start: 9, count: 9, displayOrder: 3 }
    ]
  },
  {
    name: "Robinie",
    gesSlug: "robinie",
    circoloId: "182",
    isComplex: false,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://golf.lerobinie.com/golf-course/",
      "https://golf.lerobinie.com/hole/buca-n-1/",
      "https://golf.lerobinie.com/wp-content/uploads/2021/03/Tabella-WHS-18-Buche.pdf",
      "https://golf.lerobinie.com/wp-content/uploads/2021/03/Tabella-WHS-9-Buche.pdf"
    ],
    notes: "Stablr Approved: FIG official catalog + GesGolf ROBINIE hole-by-hole import + official club hole pages exposing PAR/HCP for holes 1-18. The official sequence matches the imported GesGolf/Stablr route.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "ROBINIE", gesRouteId: 421, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "ROBINIE", gesRouteId: 421, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "ROBINIE", gesRouteId: 421, start: 9, count: 9, displayOrder: 3 }
    ]
  },
  {
    name: "Rovedine",
    gesSlug: "rovedine",
    circoloId: "57",
    isComplex: true,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    clubCardSubtitle: "2 percorsi",
    officialCourseLinks: [
      "https://www.rovedine.com/club/percorso-campionato/",
      "https://www.rovedine.com/wp-content/uploads/2016/03/Buca-1-rovedine-golf-milano.jpg",
      "https://www.rovedine.com/club/percorso-executive/"
    ],
    notes: "Stablr Approved: FIG official catalog + GesGolf ROVEDINE hole-by-hole import + official Rovedine Campionato visual hole cards exposing PAR/HCP for all 18 holes. The official Campionato sequence matches the imported route. The official site also exposes an Executive Pitch & Putt 9-hole Par 27 course with official PAR/HCP cards; it is published as a club-official non-FIG/WHS route without invented CR/Slope values.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "ROVEDINE", gesRouteId: 281, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "ROVEDINE", gesRouteId: 281, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "ROVEDINE", gesRouteId: 281, start: 9, count: 9, displayOrder: 3 },
      {
        type: "official_site_pitch_and_putt",
        name: "Executive Pitch & Putt",
        displayOrder: 4,
        holesCount: 9,
        totalPar: 27,
        externalKey: "official-site-rovedine-executive-pitch-and-putt-9",
        officialCourseLink: "https://www.rovedine.com/club/percorso-executive/",
        holes: [
          { physical_hole_number: 1, par: 3, stroke_index: 4, display_label: "1" },
          { physical_hole_number: 2, par: 3, stroke_index: 8, display_label: "2" },
          { physical_hole_number: 3, par: 3, stroke_index: 2, display_label: "3" },
          { physical_hole_number: 4, par: 3, stroke_index: 6, display_label: "4" },
          { physical_hole_number: 5, par: 3, stroke_index: 1, display_label: "5" },
          { physical_hole_number: 6, par: 3, stroke_index: 3, display_label: "6" },
          { physical_hole_number: 7, par: 3, stroke_index: 5, display_label: "7" },
          { physical_hole_number: 8, par: 3, stroke_index: 7, display_label: "8" },
          { physical_hole_number: 9, par: 3, stroke_index: 9, display_label: "9" }
        ],
        tees: [
          {
            tee_name: "Giallo",
            tee_color: "giallo",
            gender: "men",
            course_rating: null,
            slope_rating: null,
            par_total: 27,
            is_active: true,
            source_system: "official_club_site",
            source_external_id: "official-site-rovedine-executive-yellow",
            source_payload: {
              official_catalog: "club_site",
              whs_rating_status: "not_fig_rated_in_local_catalog",
              distances_m: [92, 81, 110, 89, 132, 102, null, null, null]
            }
          },
          {
            tee_name: "Rosso",
            tee_color: "rosso",
            gender: "women",
            course_rating: null,
            slope_rating: null,
            par_total: 27,
            is_active: true,
            source_system: "official_club_site",
            source_external_id: "official-site-rovedine-executive-red",
            source_payload: {
              official_catalog: "club_site",
              whs_rating_status: "not_fig_rated_in_local_catalog",
              distances_m: [86, 75, 100, 75, 120, 90, null, null, null]
            }
          }
        ]
      }
    ]
  },
  {
    name: "San Valentino",
    gesSlug: "san-valentino",
    circoloId: "789",
    isComplex: false,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://www.sanvalentino.it/il-golf/",
      "https://www.sanvalentino.it/wp-content/uploads/paginailgolfbuca1fronteok-640w.webp",
      "https://www.sanvalentino.it/wp-content/uploads/paginailgolfbuca10fronteok-640w.webp",
      "https://www.sanvalentino.it/wp-content/uploads/par72paginailgolf.pdf",
      "https://www.sanvalentino.it/wp-content/uploads/par69paginailgolf.pdf"
    ],
    notes: "Stablr Approved: FIG official catalog + official San Valentino course page/images. The official club page states two 18-hole courses (Par 72 and Par 69 winter) and exposes complete visual PAR/HCP cards for Championship Course Par 72. The Par 72 visual sequence is used as authoritative Evidence; hole 10 is kept as official HCP 7 even if this duplicates hole 6.",
    routes: [
      {
        figCourse: "Par 72",
        name: "18 Buche",
        gesRoute: "PAR 72",
        gesRouteId: 2425,
        start: 0,
        count: 18,
        displayOrder: 1,
        defaultForHoles: 18,
        holeByHoleSource: "official_club_site_images",
        officialHoleEvidenceLink: "https://www.sanvalentino.it/il-golf/",
        holesOverride: [
          [1, 4, 3],
          [2, 5, 9],
          [3, 3, 14],
          [4, 4, 15],
          [5, 4, 1],
          [6, 4, 7],
          [7, 4, 10],
          [8, 3, 8],
          [9, 5, 4],
          [10, 4, 7],
          [11, 4, 2],
          [12, 3, 16],
          [13, 4, 18],
          [14, 4, 11],
          [15, 5, 12],
          [16, 3, 17],
          [17, 4, 5],
          [18, 5, 13]
        ]
      },
      {
        figCourse: "1&#176; Nove P.72",
        name: "Prime Nove",
        gesRoute: "PAR 72",
        gesRouteId: 2425,
        start: 0,
        count: 9,
        displayOrder: 2,
        defaultForHoles: 9,
        holeByHoleSource: "official_club_site_images",
        officialHoleEvidenceLink: "https://www.sanvalentino.it/il-golf/",
        holesOverride: [
          [1, 4, 3],
          [2, 5, 9],
          [3, 3, 14],
          [4, 4, 15],
          [5, 4, 1],
          [6, 4, 7],
          [7, 4, 10],
          [8, 3, 8],
          [9, 5, 4]
        ]
      },
      {
        figCourse: "2&#176; Nove P.72",
        name: "Seconde Nove",
        gesRoute: "PAR 72",
        gesRouteId: 2425,
        start: 9,
        count: 9,
        displayOrder: 3,
        holeByHoleSource: "official_club_site_images",
        officialHoleEvidenceLink: "https://www.sanvalentino.it/il-golf/",
        holesOverride: [
          [1, 4, 7],
          [2, 4, 2],
          [3, 3, 16],
          [4, 4, 18],
          [5, 4, 11],
          [6, 5, 12],
          [7, 3, 17],
          [8, 4, 5],
          [9, 5, 13]
        ]
      },
      { figCourse: "18 Buche", name: "Old Course Par 69", gesRoute: "PAR 69", gesRouteId: 2424, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "Prime Nove", name: "9 Buche Par 33", gesRoute: "PRIME 9", gesRouteId: 2426, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Seconde Nove", name: "9 Buche Par 36", gesRoute: "SECONDE9", gesRouteId: 2427, start: 0, count: 9, displayOrder: 6 }
    ]
  },
  {
    name: "St. Anna",
    gesSlug: "st-anna",
    circoloId: "310",
    isComplex: true,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://www.santannagolf.com/percorsi/",
      "https://www.santannagolf.com/percorsi/percorso-mare/",
      "https://www.santannagolf.com/percorsi/percorso-monti/",
      "https://www.santannagolf.com/wp-content/uploads/1MARE-718x1024.jpg",
      "https://www.santannagolf.com/wp-content/uploads/1MONTI-718x1024.jpg"
    ],
    notes: "Stablr Approved: FIG official catalog + GesGolf St. Anna hole-by-hole import + official Sant'Anna course pages and visual hole cards for Mare and Monti. Official site confirms 18 holes split into two 9-hole courses, Mare and Monti, Par 71 overall; official visual PAR/HCP cards match the imported GesGolf/Stablr sequence.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "18 Buche", gesRouteId: 2022, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Monti", name: "Monti", gesRoute: "Monti", gesRouteId: 2023, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Mare", name: "Mare", gesRoute: "Mare", gesRouteId: 2024, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "Monti 2 volte", name: "Monti 2 volte", gesRoute: "2 Volte Monti", gesRouteId: 434, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "Mare 2 volte", name: "Mare 2 volte", gesRoute: "2 Volte Mare", gesRouteId: 2021, start: 0, count: 18, displayOrder: 5 }
    ]
  },
  {
    name: "Campodoglio",
    gesSlug: "campodoglio",
    circoloId: "701",
    isComplex: false,
    physicalHoleCount: 9,
    dataStatus: "needs_review",
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://www.campodoglio.it/percorso-golf-club/",
      "https://www.campodoglio.it/percorso-golf-club/buca-1/",
      "https://www.campodoglio.it/percorso-golf-club/buca-2/",
      "https://www.campodoglio.it/percorso-golf-club/buca-3-12/",
      "https://www.campodoglio.it/percorso-golf-club/buca-4-13/",
      "https://www.campodoglio.it/percorso-golf-club/buca-5-14/",
      "https://www.campodoglio.it/percorso-golf-club/buca-6-15/",
      "https://www.campodoglio.it/percorso-golf-club/buca-7-16/",
      "https://www.campodoglio.it/percorso-golf-club/buca-8-17/",
      "https://www.campodoglio.it/percorso-golf-club/buca-9-18/"
    ],
    notes: "FIG official catalog + GesGolf Campodoglio 2024 import + official Campodoglio course pages. The official site describes a physical 9-hole Par 36 course and exposes Buca 1/10 through 9/18 tables with tee-specific HCP pairs for Par 72 and Par 70 variants, but the site evidence currently shows Bianco/Giallo/Blu/Rosso while FIG also exposes Verde/Arancio tee ratings. Stablr keeps Campodoglio playable in review, exposes only 9 Buche, 18 Buche Par 72 and 18 Buche Par 70, uses the official tee-specific HCP matrix for the site-documented tees, and will send a club-specific confirmation email asking whether to follow only site-listed tees or also support FIG Verde/Arancio and how to treat tee-dynamic HCP.",
    routes: [
      { figCourse: "9 Buche Old 2024", name: "9 Buche", gesRoute: "9 Buche Old 24", gesRouteId: 2843, start: 0, count: 9, displayOrder: 1, defaultForHoles: 9, officialTeeNames: ["Bianco", "Giallo", "Blu", "Rosso"], teeSpecificHoleMatrix: buildCampodoglioTeeSpecificHoleMatrix(72) },
      { figCourse: "18 Buche Old 2024", name: "18 Buche Par 72", gesRoute: "18 Buche Old 24", gesRouteId: 2844, start: 0, count: 18, displayOrder: 2, defaultForHoles: 18, officialTeeNames: ["Bianco", "Giallo", "Blu", "Rosso"], teeSpecificHoleMatrix: buildCampodoglioTeeSpecificHoleMatrix(72) },
      { figCourse: "18 Buche New 2024", name: "18 Buche Par 70", gesRoute: "18 Buche New 24", gesRouteId: 2846, start: 0, count: 18, displayOrder: 3, officialTeeNames: ["Bianco", "Giallo", "Blu", "Rosso"], teeSpecificHoleMatrix: buildCampodoglioTeeSpecificHoleMatrix(70) },
      { figCourse: "9 Buche New 2024", name: "9 Buche New 2024", gesRoute: "9 Buche New 24", gesRouteId: 2845, start: 0, count: 9, displayOrder: 90, isActive: false },
      { figCourse: "18 Buche Easy 2024", name: "18 Buche Easy 2024", gesRoute: "18 Buche Easy", gesRouteId: 2854, start: 0, count: 18, displayOrder: 91, isActive: false },
      { figCourse: "9 Buche Easy 2024", name: "9 Buche Easy 2024", gesRoute: "9 Buche Easy", gesRouteId: 2853, start: 0, count: 9, displayOrder: 92, isActive: false },
      { figCourse: "18 Buche Mixed 2024", name: "18 Buche Mixed 2024", gesRoute: "18 Buche Mixed", gesRouteId: 2856, start: 0, count: 18, displayOrder: 93, isActive: false },
      { figCourse: "9 Buche Mixed 2024", name: "9 Buche Mixed 2024", gesRoute: "9 Buche Mixed", gesRouteId: 2855, start: 0, count: 9, displayOrder: 94, isActive: false }
    ]
  },
  {
    name: "Castelfalfi",
    gesSlug: "castelfalfi",
    circoloId: "678",
    isComplex: true,
    physicalHoleCount: 27,
    notes: "FIG official catalog + GesGolf Mountain/Lake hole-by-hole import. Course variants are preserved as FIG routes; certification waits for third-level official Evidence.",
    routes: [
      { figCourse: "Mountain 18 Buche", name: "Mountain 18 Buche", gesRoute: "MOUNTAIN", gesRouteId: 1823, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove Mountain", name: "Prime Nove Mountain", gesRoute: "MOUNTAIN", gesRouteId: 1823, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove Mountain", name: "Seconde Nove Mountain", gesRoute: "MOUNTAIN", gesRouteId: 1823, start: 9, count: 9, displayOrder: 3 },
      { figCourse: "LAKE 9 Buche", name: "Lake 9 Buche", gesRoute: "LAKE COURSE", gesRouteId: 1826, start: 0, count: 9, displayOrder: 4 },
      { figCourse: "LAKE 18 Buche", name: "Lake 18 Buche", gesRoute: "LAKE + LAKE", gesRouteId: 2087, start: 0, count: 18, displayOrder: 5 },
      { figCourse: "LAKE + Mountain Prime Nove", name: "Lake + Mountain Prime Nove", gesRoute: "LAKE+MOUNTAINPN", gesRouteId: 1828, start: 0, count: 18, displayOrder: 6 },
      { figCourse: "LAKE + Mountain Seconde Nove", name: "Lake + Mountain Seconde Nove", gesRoute: "LAKE+MOUNTAIN S", gesRouteId: 1827, start: 0, count: 18, displayOrder: 7 }
    ]
  },
  {
    name: "Montelupo",
    gesSlug: "montelupo",
    circoloId: "638",
    isComplex: true,
    physicalHoleCount: 14,
    clubCardSubtitle: "3 percorsi",
    officialCourseLinks: [
      "https://www.golfmontelupo.it/",
      "https://www.golfmontelupo.it/PERCORSO.htm",
      "https://www.golfmontelupo.it/foto/grandi/mlupopercorso1-1-1.jpg"
    ],
    notes: "FIG official catalog + GesGolf Montelupo color-route hole-by-hole import, simplified against official club site/map. Official site states the course currently has 14 physical holes; the official course map exposes three 18-hole routings: Bianco Par 68, Rosso Par 68 and Blu Par 70. Stablr exposes these three 18-hole routes plus the FIG-rated Blu 9 buche route, preserving the official physical-hole sequence in route payload for UX display. Derived Bianco/Rosso 9-hole segments and the Giallo/Verde technical variants are hidden because they do not have separate FIG/WHS ratings. Keep orange until official third-level Evidence confirms HCP/SI buca-per-buca.",
    routes: [
      { figCourse: "bianco 2020", name: "Bianco", gesRoute: "Bianco", gesRouteId: 2447, start: 0, count: 18, displayOrder: 1, physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.bianco },
      { figCourse: "bianco 2020", name: "Bianco 9 buche", gesRoute: "Bianco", gesRouteId: 2447, start: 0, count: 9, displayOrder: 90, externalKey: "fig-course-montelupo-bianco-2020-stablr-9-buche", physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.bianco.slice(0, 9), includeFigTees: false, isActive: false },
      { figCourse: "rosso 2020", name: "Rosso", gesRoute: "PERCORSO ROSSO", gesRouteId: 2225, start: 0, count: 18, displayOrder: 3, physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.rosso },
      { figCourse: "rosso 2020", name: "Rosso 9 buche", gesRoute: "PERCORSO ROSSO", gesRouteId: 2225, start: 0, count: 9, displayOrder: 91, externalKey: "fig-course-montelupo-rosso-2020-stablr-9-buche", physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.rosso.slice(0, 9), includeFigTees: false, isActive: false },
      { figCourse: "blu 2020", name: "Blu", gesRoute: "Blu", gesRouteId: 2229, start: 0, count: 18, displayOrder: 5, defaultForHoles: 18, physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.blu },
      { figCourse: "blu 2020 9 buche", name: "Blu 9 buche", gesRoute: "Blu 9 buche", gesRouteId: 2226, start: 0, count: 9, displayOrder: 6, physicalHoleSequence: MONTELUPO_PHYSICAL_HOLE_SEQUENCES.blu.slice(0, 9) },
      { figCourse: "verde 2020", name: "Verde", gesRoute: "Verde", gesRouteId: 2227, start: 0, count: 18, displayOrder: 91, isActive: false },
      { figCourse: "giallo 2020", name: "Giallo", gesRoute: "Giallo", gesRouteId: 2228, start: 0, count: 18, displayOrder: 92, isActive: false }
    ]
  },
  {
    name: "Asiago",
    gesSlug: "asiago",
    circoloId: "3",
    isComplex: false,
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 18 buche 2025 hole-by-hole import. Older/provisional/winter variants are intentionally excluded from the initial UX until official Evidence is reviewed.",
    routes: [
      { figCourse: "18 Buche 2025", name: "18 Buche", gesRoute: "18 buche 2025", gesRouteId: 2943, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove 2025", name: "Prime Nove", gesRoute: "18 buche 2025", gesRouteId: 2943, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove 2025", name: "Seconde Nove", gesRoute: "18 buche 2025", gesRouteId: 2943, start: 9, count: 9, displayOrder: 3 }
    ]
  },
  {
    name: "Folgaria",
    gesSlug: "folgaria",
    circoloId: "79",
    isComplex: true,
    physicalHoleCount: 18,
    officialCourseLinks: ["https://www.golfclubfolgaria.it/ita/percorso.php"],
    notes: "FIG official catalog + GesGolf 2026 hole-by-hole import. Official site includes a course page, linked handicap table area and per-hole visual sections; Costa/Sommo and par-71/par-72 variants remain in review pending full visual/PDF evidence extraction.",
    routes: [
      { figCourse: "18 Buche 2026 - Par 72", name: "18 Buche 2026 Par 72", gesRoute: "18b 2026 p72", gesRouteId: 3026, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "18 Buche 2026 - Par 71", name: "18 Buche 2026 Par 71", gesRoute: "18b 2026 p71", gesRouteId: 3029, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "Prime Nove 2026", name: "Prime Nove 2026", gesRoute: "Front 9 2026", gesRouteId: 3027, start: 0, count: 9, displayOrder: 3, defaultForHoles: 9 },
      { figCourse: "Seconde Nove 2026 - Par 37", name: "Seconde Nove 2026 Par 37", gesRoute: "Back 9 2026 p37", gesRouteId: 3028, start: 0, count: 9, displayOrder: 4 },
      { figCourse: "Seconde Nove 2026 - Par 36", name: "Seconde Nove 2026 Par 36", gesRoute: "Back 9 2026 p36", gesRouteId: 3030, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "9 Buche Costa 2026", name: "9 Buche Costa 2026", gesRoute: "9b Costa 2026", gesRouteId: 3031, start: 0, count: 9, displayOrder: 6 },
      { figCourse: "9 Buche Sommo 2026", name: "9 Buche Sommo 2026", gesRoute: "9b Sommo 2026", gesRouteId: 3032, start: 0, count: 9, displayOrder: 7 }
    ]
  },
  {
    name: "Bogogno",
    gesSlug: "bogogno",
    circoloId: "659",
    isComplex: true,
    physicalHoleCount: 36,
    notes: "FIG official catalog + GesGolf Conte/Bonora hole-by-hole import. Certification waits for third-level official Evidence.",
    routes: [
      { figCourse: "del Conte", name: "del Conte", gesRoute: "CONTE", gesRouteId: 1744, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "1&#176; Nove - Conte", name: "1° Nove Conte", gesRoute: "DEL CONTE 1-9", gesRouteId: 1746, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "2&#176; Nove - Conte", name: "2° Nove Conte", gesRoute: "DEL CONTE 10-18", gesRouteId: 1747, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "Bonora", name: "Bonora", gesRoute: "BONORA", gesRouteId: 1745, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "Prime Nove - Bonora", name: "Prime Nove Bonora", gesRoute: "BONORA 1-9", gesRouteId: 1961, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Seconde Nove - Bonora", name: "Seconde Nove Bonora", gesRoute: "BONORA 10-18", gesRouteId: 1962, start: 0, count: 9, displayOrder: 6 }
    ]
  },
  {
    name: "Asolo",
    gesSlug: "asolo",
    circoloId: "219",
    isComplex: true,
    physicalHoleCount: 27,
    notes: "FIG official catalog + GesGolf Asolo color-route hole-by-hole import. Provisional par-70/71 variants stay orange pending official third-level Evidence.",
    routes: [
      { figCourse: "Giallo-Verde", name: "Giallo-Verde", gesRoute: "ASOLO 1 G/V", gesRouteId: 1550, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Rosso-Giallo", name: "Rosso-Giallo", gesRoute: "ASOLO 2 R/G", gesRouteId: 318, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "Rosso-Verde", name: "Rosso-Verde", gesRoute: "ASOLO 3 R/V", gesRouteId: 319, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "Percorso Giallo 9 buche", name: "Giallo 9 buche", gesRoute: "GIALLO 9 BUCHE", gesRouteId: 1687, start: 0, count: 9, displayOrder: 4, defaultForHoles: 9 },
      { figCourse: "Percorso Rosso 9 buche", name: "Rosso 9 buche", gesRoute: "ROSSO 9 BUCHE", gesRouteId: 1684, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Percorso Verde 9 buche", name: "Verde 9 buche", gesRoute: "VERDE 9 BUCHE", gesRouteId: 1688, start: 0, count: 9, displayOrder: 6 }
    ]
  },
  {
    name: "Colline Gavi",
    gesSlug: "colline-gavi",
    circoloId: "732",
    isComplex: true,
    physicalHoleCount: 27,
    notes: "FIG official catalog + GesGolf Colline del Gavi hole-by-hole import. Rosso single 9 is not exposed in this batch because no safe GesGolf base-9 route is available.",
    routes: [
      { figCourse: "GIALLO BLU", name: "Giallo-Blu", gesRoute: "GIALLO-BLU", gesRouteId: 1978, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "GIALLO", name: "Giallo", gesRoute: "GIALLO", gesRouteId: 2279, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "BLU", name: "Blu", gesRoute: "BLU", gesRouteId: 2280, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "GIALLO ROSSO", name: "Giallo-Rosso", gesRoute: "GIALLO ROSSO", gesRouteId: 2363, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "ROSSO BLU", name: "Rosso-Blu", gesRoute: "ROSSO BLU", gesRouteId: 2615, start: 0, count: 18, displayOrder: 5 }
    ]
  },
  {
    name: "Monticello",
    gesSlug: "monticello",
    circoloId: "27",
    isComplex: true,
    physicalHoleCount: 36,
    notes: "FIG official catalog + GesGolf Monticello Blu/Rosso hole-by-hole import. Family/provisional routes are excluded from the initial import unless mapped by safe GesGolf route.",
    routes: [
      { figCourse: "Blu", name: "Blu", gesRoute: "Blu", gesRouteId: 59, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove Blu", name: "Prime Nove Blu", gesRoute: "1&#176; Nove Blu", gesRouteId: 1553, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Sec. Nove Blu", name: "Seconde Nove Blu", gesRoute: "2&#176; Nove Blu", gesRouteId: 2546, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "Rosso", name: "Rosso", gesRoute: "Rosso", gesRouteId: 58, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "Prime Nove Rosso", name: "Prime Nove Rosso", gesRoute: "1&#176; Nove Rosso", gesRouteId: 1725, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Sec.Nove Rosso", name: "Seconde Nove Rosso", gesRoute: "2&#176; Nove Rosso", gesRouteId: 1967, start: 0, count: 9, displayOrder: 6 },
      { figCourse: "Rosso1+Blu1", name: "Rosso1+Blu1", gesRoute: "1&#176; Rosse 1&#176; Blu", gesRouteId: 60, start: 0, count: 18, displayOrder: 7 },
      { figCourse: "Rosso1+Blu2", name: "Rosso1+Blu2", gesRoute: "1&#176; Rosse 2&#176; Blu", gesRouteId: 61, start: 0, count: 18, displayOrder: 8 },
      { figCourse: "Rosso2+Blu1", name: "Rosso2+Blu1", gesRoute: "2&#176; Rosse 1&#176; Blu", gesRouteId: 62, start: 0, count: 18, displayOrder: 9 },
      { figCourse: "Rosso2+Blu2", name: "Rosso2+Blu2", gesRoute: "2&#176; Rosse 2&#176; Blu", gesRouteId: 63, start: 0, count: 18, displayOrder: 10 }
    ]
  },
  {
    name: "Royal Park Roveri",
    gesSlug: "royal-park-roveri",
    circoloId: "384",
    isComplex: true,
    physicalHoleCount: 36,
    notes: "FIG official catalog + GesGolf Royal Park Roveri course import. Trent Jones/Allianz naming requires third-level review before certification.",
    routes: [
      { figCourse: "Trent Jones", name: "Trent Jones", gesRoute: "Allianz Course", gesRouteId: 424, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Hurdzan Fry", name: "Hurdzan Fry", gesRoute: "Allianz Bank", gesRouteId: 428, start: 0, count: 18, displayOrder: 2 }
    ]
  },
  {
    name: "Torino",
    gesSlug: "torino",
    circoloId: "42",
    isComplex: true,
    physicalHoleCount: 36,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://www.circologolftorino.it/en/blue-course/",
      "https://www.circologolftorino.it/en/yellow-course/"
    ],
    notes: "Stablr Approved: FIG official catalog + GesGolf Torino La Mandria Blu/Giallo hole-by-hole import + official club course pages exposing PAR/HCP buca-per-buca. Historical Roveri-named GesGolf route is not exposed.",
    routes: [
      { figCourse: "Blu", name: "Blu", gesRoute: "BLU/BLUE", gesRouteId: 253, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Giallo", name: "Giallo", gesRoute: "GIALLO/YELLOW", gesRouteId: 261, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "1&#176; Nove Giallo", name: "1° Nove Giallo", gesRoute: "GIALLO 1", gesRouteId: 1906, start: 0, count: 9, displayOrder: 3, defaultForHoles: 9 },
      { figCourse: "2&#176; Nove Giallo", name: "2° Nove Giallo", gesRoute: "GIALLO 2", gesRouteId: 1907, start: 0, count: 9, displayOrder: 4 },
      { figCourse: "Blu1-Giallo1", name: "Blu1-Giallo1", gesRoute: "BLU1-GIALLO1", gesRouteId: 255, start: 0, count: 18, displayOrder: 5 },
      { figCourse: "Blu1-Giallo2", name: "Blu1-Giallo2", gesRoute: "BLU1-GIALLO2", gesRouteId: 262, start: 0, count: 18, displayOrder: 6 },
      { figCourse: "Blu2-Giallo2", name: "Blu2-Giallo2", gesRoute: "BLU2-GIALLO2", gesRouteId: 263, start: 0, count: 18, displayOrder: 7 }
    ]
  },
  {
    name: "Tolcinasco",
    gesSlug: "tolcinasco",
    circoloId: "829",
    isComplex: true,
    physicalHoleCount: 27,
    notes: "FIG official catalog + GesGolf Tolcinasco color-route hole-by-hole import. Executive route is not exposed in this batch because GesGolf normalized data does not include it.",
    routes: [
      { figCourse: "Blu-Giallo", name: "Blu-Giallo", gesRoute: "Blu/Gial", gesRouteId: 2768, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Giallo-Rosso", name: "Giallo-Rosso", gesRoute: "Gial/Ros", gesRouteId: 2765, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "Rosso-Blu", name: "Rosso-Blu", gesRoute: "Ross-Blu", gesRouteId: 2763, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "Prime Nove (Giallo)", name: "Giallo 9", gesRoute: "GIALLO 9", gesRouteId: 2770, start: 0, count: 9, displayOrder: 4, defaultForHoles: 9 },
      { figCourse: "Seconde Nove (Blu)", name: "Blu 9", gesRoute: "BLU 9", gesRouteId: 2771, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Terze Nove (Rosso)", name: "Rosso 9", gesRoute: "ROSSO 9", gesRouteId: 2772, start: 0, count: 9, displayOrder: 6 }
    ]
  },
  {
    name: "Villa Condulmer",
    gesSlug: "villa-condulmer",
    circoloId: "49",
    isComplex: true,
    physicalHoleCount: 27,
    officialCourseLinks: ["https://www.golfvillacondulmer.com/percorso/"],
    notes: "FIG official catalog + GesGolf Villa Condulmer hole-by-hole import. The official course page exposes PAR/HCP buca-per-buca, but at least one HCP value requires manual review before certification; Executive and mixed variants are preserved in review state where safe GesGolf routes exist.",
    routes: [
      { figCourse: "18 Buche (Giallo/Blu)", name: "18 Buche Giallo/Blu", gesRoute: "Giallo/Blu 2026", gesRouteId: 3042, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove (Giallo)", name: "Giallo 9", gesRoute: "Giallo 2026", gesRouteId: 3043, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove (Blu)", name: "Blu 9", gesRoute: "Blu 2026", gesRouteId: 3044, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "18 Buche Executive (Verde)", name: "Executive Verde 18", gesRoute: "Verde/Verde", gesRouteId: 2417, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "9 buche Executive (Verde)", name: "Executive Verde 9", gesRoute: "Percorso Verde", gesRouteId: 1908, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "Giallo/Verde", name: "Giallo/Verde", gesRoute: "Giallo/Verde", gesRouteId: 1909, start: 0, count: 18, displayOrder: 6 },
      { figCourse: "Blu/Verde", name: "Blu/Verde", gesRoute: "Bl&#249;/Verde", gesRouteId: 1910, start: 0, count: 18, displayOrder: 7 }
    ]
  },
  {
    name: "San Vigilio",
    gesSlug: "san-vigilio",
    circoloId: "441",
    isComplex: true,
    physicalHoleCount: 36,
    notes: "FIG official catalog + GesGolf San Vigilio hole-by-hole import. FIG Benaco/Solferino/San Martino/Pozzolengo names are preserved while source naming remains under review.",
    routes: [
      { figCourse: "Benaco-Solferino", name: "Benaco-Solferino", gesRoute: "ROS+GIA", gesRouteId: 692, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Solferino-San Martino", name: "Solferino-San Martino", gesRoute: "GIA+BIAN", gesRouteId: 694, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "Benaco-San Martino", name: "Benaco-San Martino", gesRoute: "ROS+BIAN", gesRouteId: 693, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "Pozzolengo", name: "Pozzolengo", gesRoute: "BLU", gesRouteId: 2946, start: 0, count: 9, displayOrder: 4, defaultForHoles: 9 },
      { figCourse: "Pozzolengo-Benaco", name: "Pozzolengo-Benaco", gesRoute: "BLU - ROS", gesRouteId: 2948, start: 0, count: 18, displayOrder: 5 },
      { figCourse: "Pozzolengo-Solferino", name: "Pozzolengo-Solferino", gesRoute: "BLU - GIA", gesRouteId: 2945, start: 0, count: 18, displayOrder: 6 },
      { figCourse: "Pozzolengo-San Martino", name: "Pozzolengo-San Martino", gesRoute: "BLU - BIA", gesRouteId: 2947, start: 0, count: 18, displayOrder: 7 }
    ]
  },
  {
    name: "Castelconturbia",
    gesSlug: "castelconturbia",
    circoloId: "68",
    isComplex: true,
    physicalHoleCount: 27,
    notes: "FIG official catalog + GesGolf Castelconturbia color-route hole-by-hole import. Single Azzurro/Rosso 9-hole routes remain excluded because GesGolf marks them as warning/non-standard.",
    routes: [
      { figCourse: "Azzurro-Giallo", name: "Azzurro-Giallo", gesRoute: "Azz+Gial", gesRouteId: 423, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Azzurro-Rosso", name: "Azzurro-Rosso", gesRoute: "Azz+Ros", gesRouteId: 223, start: 0, count: 18, displayOrder: 2 },
      { figCourse: "Giallo-Rosso", name: "Giallo-Rosso", gesRoute: "Gial+Ros", gesRouteId: 224, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "9 buche Giallo", name: "Giallo 9 buche", gesRoute: "GIALLO", gesRouteId: 1832, start: 0, count: 9, displayOrder: 4, defaultForHoles: 9 }
    ]
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeClubName(name) {
  return String(name).trim().toLowerCase();
}

function assertNotProtected(name) {
  assert(!PROTECTED_CLUB_NAMES.has(normalizeClubName(name)), `Club protetto nel batch automatico: ${name}`);
}

function teePayload(figCourse, routeSpec = {}) {
  const allowedTeeNames = Array.isArray(routeSpec.officialTeeNames)
    ? new Set(routeSpec.officialTeeNames.map((name) => String(name).trim().toLowerCase()))
    : null;

  return (figCourse.tees || [])
    .filter((tee) => {
      if (!allowedTeeNames) return true;
      return allowedTeeNames.has(String(tee.tee_name || "").trim().toLowerCase());
    })
    .map((tee) => ({
      tee_name: tee.tee_name,
      tee_color: tee.tee_color || null,
      gender: tee.gender || null,
      course_rating: tee.course_rating ?? null,
      slope_rating: tee.slope_rating ?? null,
      par_total: tee.par_total ?? figCourse.total_par ?? null,
      is_active: tee.is_active ?? true,
      source_system: "fig",
      source_external_id: tee.source_external_id,
      source_payload: { ...(tee.source_payload || {}), official_catalog: "fig" }
    }));
}

function findFigCourse(figClub, name) {
  const course = (figClub.playable_courses || []).find((candidate) => candidate.name === name);
  assert(course, `Percorso FIG non trovato per ${figClub.name}: ${name}`);
  return course;
}

function findGesRoute(gesNormalized, routeSpec, clubName) {
  const route = (gesNormalized.playable_courses || []).find(
    (candidate) =>
      candidate.name === routeSpec.gesRoute &&
      Number(candidate.percorso_id) === Number(routeSpec.gesRouteId)
  );
  assert(route, `Route GesGolf non trovata: ${clubName} / ${routeSpec.gesRoute}#${routeSpec.gesRouteId}`);
  assert(route.status === "safe", `Route GesGolf non safe: ${clubName} / ${route.name} / ${route.status}`);
  assert(Array.isArray(route.holes), `Route GesGolf senza buche: ${clubName} / ${route.name}`);
  assert(route.holes.length >= routeSpec.start + routeSpec.count, `${clubName}: route GesGolf troppo corta per ${routeSpec.gesRoute}`);
  return route;
}

function routeHolesFromGesHoles(gesHoles, startIndex, count) {
  return gesHoles.slice(startIndex, startIndex + count).map((hole, index) => ({
    physical_hole_number: index + 1,
    par: hole.par,
    stroke_index: hole.hcp,
    display_label: String(index + 1)
  }));
}

function routeHolesFromManualEvidence(holes) {
  return holes.map(([physicalHoleNumber, par, strokeIndex]) => ({
    physical_hole_number: physicalHoleNumber,
    par,
    stroke_index: strokeIndex,
    display_label: String(physicalHoleNumber)
  }));
}

function buildRoute({ figCourse, gesRoute, gesSource, routeSpec, config }) {
  const routeExternalKey = routeSpec.externalKey || figCourse.source_external_id;
  const holes = routeSpec.holesOverride
    ? routeHolesFromManualEvidence(routeSpec.holesOverride)
    : routeHolesFromGesHoles(gesRoute.holes, routeSpec.start, routeSpec.count);
  const routeHolesCount = Number(routeSpec.holesCount || holes.length || figCourse.holes_count);
  const routeTotalPar = Number(
    routeSpec.totalPar ?? holes.reduce((sum, hole) => sum + Number(hole.par || 0), 0) ?? figCourse.total_par
  );
  const isDerivedRoute = routeExternalKey !== figCourse.source_external_id;

  return {
    external_key: routeExternalKey,
    name: routeSpec.name,
    holes_count: routeHolesCount,
    total_par: routeTotalPar,
    display_order: routeSpec.displayOrder,
    is_active: routeSpec.isActive ?? figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: routeExternalKey,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: routeSpec.holeByHoleSource || "gesgolf",
      ...(routeSpec.officialHoleEvidenceLink
        ? {
            official_hole_evidence_link: routeSpec.officialHoleEvidenceLink,
            hole_data_override:
              "Official club visual Evidence is used for PAR/HCP because it is more authoritative than the current GesGolf route sequence."
          }
        : {}),
      ...(routeSpec.name !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: routeSpec.name
          }
        : {}),
      ...(routeSpec.teeSpecificHoleMatrix
        ? {
            tee_specific_hole_matrix: routeSpec.teeSpecificHoleMatrix,
            hole_data_override:
              "Official club Evidence provides tee-specific HCP pairs; frontend should use this matrix after tee selection instead of the static GesGolf stroke_index values."
          }
        : {}),
      ...(routeSpec.physicalHoleSequence
        ? {
            physical_hole_sequence: routeSpec.physicalHoleSequence,
            physical_hole_sequence_source: "official_club_course_map",
            physical_hole_sequence_note:
              "Official club map defines the physical hole played at each round position; frontend should use this sequence for the flag/physical-hole label."
          }
        : {}),
      ...(routeSpec.includeFigTees === false
        ? {
            whs_rating_status: "not_available_for_derived_route",
            tee_data_note:
              "No separate FIG/WHS rating is available for this derived route; CR/Slope values from the full route are not inferred."
          }
        : {}),
      round_variant: {
        holes_count: routeHolesCount,
        default_for_holes: routeSpec.defaultForHoles ?? null,
        default_source: "fig_gesgolf_manual_batch",
        note: config.isComplex
          ? "Complex club: expose only explicitly mapped FIG/GesGolf playable routes; unresolved variants stay out of UX."
          : "Simple physical 18-hole club: expose Stablr-playable 18 Buche, Prime Nove and Seconde Nove routes."
      },
      gesgolf: {
        circolo_id: gesSource.circoloId,
        gesgolf_club: gesSource.gesClub,
        route_name: gesRoute.name,
        playable_kind: gesRoute.playable_kind,
        percorso_id: gesRoute.percorso_id,
        ...(routeSpec.start || routeSpec.count !== gesRoute.holes.length
          ? { derived_segment: [routeSpec.start, routeSpec.start + routeSpec.count] }
          : {})
      }
    },
    holes,
    tees: routeSpec.includeFigTees === false && isDerivedRoute ? [] : teePayload(figCourse, routeSpec)
  };
}

function buildOfficialSiteRoute({ routeSpec, config }) {
  return {
    external_key: routeSpec.externalKey,
    name: routeSpec.name,
    holes_count: routeSpec.holesCount,
    total_par: routeSpec.totalPar,
    display_order: routeSpec.displayOrder,
    is_active: true,
    source_system: "official_club_site",
    source_external_id: routeSpec.externalKey,
    source_payload: {
      kind: "route",
      official_catalog: "club_site",
      hole_by_hole_source: "official_club_site",
      route_family: "pitch_and_putt",
      whs_rating_status: "not_fig_rated_in_local_catalog",
      official_course_link: routeSpec.officialCourseLink,
      round_variant: {
        holes_count: routeSpec.holesCount,
        default_for_holes: routeSpec.defaultForHoles ?? null,
        default_source: "club_official_site",
        note: "Club-official Executive/Pitch & Putt route. Published as playable route without invented FIG/WHS CR/Slope values."
      },
      product_rule:
        "Pitch & Putt/Executive courses can be published when the club site exposes official PAR/HCP hole cards; WHS/FIG rating must remain explicit and must not be inferred."
    },
    holes: routeSpec.holes,
    tees: routeSpec.tees
  };
}

async function main() {
  const figCatalog = await readJson(FIG_CATALOG_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputs = [];

  for (const config of CLUBS) {
    assertNotProtected(config.name);
    const figClub = (figCatalog.clubs || []).find((club) => club.name === config.name);
    assert(figClub, `Club FIG non trovato: ${config.name}`);
    assertNotProtected(figClub.name);

    const gesPath = path.join(GESGOLF_NORMALIZED_DIR, config.gesSlug, `circolo-${config.circoloId}.json`);
    const gesNormalized = await readJson(gesPath);
    const gesSource = {
      circoloId: config.circoloId,
      gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
    };

    const routes = config.routes.map((routeSpec) => {
      if (routeSpec.type === "official_site_pitch_and_putt") {
        return buildOfficialSiteRoute({ routeSpec, config });
      }

      const figCourse = findFigCourse(figClub, routeSpec.figCourse);
      const gesRoute = findGesRoute(gesNormalized, routeSpec, config.name);
      return buildRoute({ figCourse, gesRoute, gesSource, routeSpec, config });
    });

    const payload = {
      schema_version: "1.0",
      source: {
        system: "gesgolf",
        scraped_at: gesNormalized.source?.scraped_at || new Date().toISOString(),
        club_external_id: figClub.source_external_id,
        notes: `Official FIG catalog + GesGolf controlled batch import for ${config.name}`
      },
      club: {
        name: figClub.name,
        name_normalized: figClub.name_normalized,
        city: figClub.city || null,
        country: figClub.country || "Italia",
        data_status: config.dataStatus || "needs_review",
        source_type: "fig_import",
        is_complex: config.isComplex,
        playable: true,
        is_active: figClub.is_active ?? true,
        source_system: "fig",
        source_external_id: figClub.source_external_id,
        source_payload: {
          ...(figClub.source_payload || {}),
          official_catalog: "fig",
          hole_by_hole_source: "gesgolf",
          verification_status: config.dataStatus === "verified" ? "verified" : "playable_review",
          ...(config.approved ? { stablr_approved: true } : {}),
          verification_notes: config.notes,
          ...(config.officialCourseLinks ? { official_course_links: config.officialCourseLinks } : {}),
          website_evidence_status: config.websiteEvidenceStatus || "deep_review_pending",
          ...(config.clubCardSubtitle ? { club_card_subtitle: config.clubCardSubtitle } : {}),
          physical_hole_count: config.physicalHoleCount,
          import_profile: config.isComplex ? "complex_fig_routes_explicit_mapping" : "physical_18_simple_or_trimmed",
          product_rule:
            "Expose only explicitly mapped Stablr-playable routes for this controlled batch; noisy, duplicate, provisional or unconfirmed variants stay out of UX.",
          gesgolf: gesSource
        }
      },
      routes,
      route_combinations: []
    };

    validateNormalizedPayload(payload);
    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({ club: config.name, status: payload.club.data_status, routes: routes.length, output: outputPath });
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
