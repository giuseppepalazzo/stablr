import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const PROTECTED_CLUB_NAMES = new Set(["mare di roma", "parco de' medici", "parco de’ medici", "parco de medici"]);

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
    isComplex: false,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    websiteEvidenceStatus: "verified",
    officialCourseLinks: [
      "https://www.rovedine.com/club/percorso-campionato/",
      "https://www.rovedine.com/wp-content/uploads/2016/03/Buca-1-rovedine-golf-milano.jpg",
      "https://www.rovedine.com/club/percorso-executive/"
    ],
    notes: "Stablr Approved: FIG official catalog + GesGolf ROVEDINE hole-by-hole import + official Rovedine Campionato visual hole cards exposing PAR/HCP for all 18 holes. The official Campionato sequence matches the imported route. The official site also exposes a 9-hole Executive course, but it is not published in Stablr because no matching FIG playable course is available in the current catalog.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "ROVEDINE", gesRouteId: 281, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "ROVEDINE", gesRouteId: 281, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "ROVEDINE", gesRouteId: 281, start: 9, count: 9, displayOrder: 3 }
    ]
  },
  {
    name: "San Valentino",
    gesSlug: "san-valentino",
    circoloId: "789",
    isComplex: false,
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf PAR 69/PAR 72 hole-by-hole import. Multiple official FIG variants are preserved but remain orange until third-level official Evidence certifies the current setup.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "PAR 69", gesRouteId: 2424, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "PRIME 9", gesRouteId: 2426, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "SECONDE9", gesRouteId: 2427, start: 0, count: 9, displayOrder: 3 },
      { figCourse: "Par 72", name: "Par 72", gesRoute: "PAR 72", gesRouteId: 2425, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "1&#176; Nove P.72", name: "Prime Nove Par 72", gesRoute: "PRIME9", gesRouteId: 2428, start: 0, count: 9, displayOrder: 5 },
      { figCourse: "2&#176; Nove P.72", name: "Seconde Nove Par 72", gesRoute: "PAR 72", gesRouteId: 2425, start: 9, count: 9, displayOrder: 6 }
    ]
  },
  {
    name: "St. Anna",
    gesSlug: "st-anna",
    circoloId: "310",
    isComplex: true,
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf St. Anna hole-by-hole import. Monti/Mare official variants are preserved; certification waits for third-level official Evidence.",
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
    isComplex: true,
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 2024 Old/New/Easy/Mixed hole-by-hole import. Current batch publishes playable review routes only.",
    routes: [
      { figCourse: "18 Buche Old 2024", name: "18 Buche Old 2024", gesRoute: "18 Buche Old 24", gesRouteId: 2844, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "9 Buche Old 2024", name: "9 Buche Old 2024", gesRoute: "9 Buche Old 24", gesRouteId: 2843, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "18 Buche New 2024", name: "18 Buche New 2024", gesRoute: "18 Buche New 24", gesRouteId: 2846, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "9 Buche New 2024", name: "9 Buche New 2024", gesRoute: "9 Buche New 24", gesRouteId: 2845, start: 0, count: 9, displayOrder: 4 },
      { figCourse: "18 Buche Easy 2024", name: "18 Buche Easy 2024", gesRoute: "18 Buche Easy", gesRouteId: 2854, start: 0, count: 18, displayOrder: 5 },
      { figCourse: "9 Buche Easy 2024", name: "9 Buche Easy 2024", gesRoute: "9 Buche Easy", gesRouteId: 2853, start: 0, count: 9, displayOrder: 6 },
      { figCourse: "18 Buche Mixed 2024", name: "18 Buche Mixed 2024", gesRoute: "18 Buche Mixed", gesRouteId: 2856, start: 0, count: 18, displayOrder: 7 },
      { figCourse: "9 Buche Mixed 2024", name: "9 Buche Mixed 2024", gesRoute: "9 Buche Mixed", gesRouteId: 2855, start: 0, count: 9, displayOrder: 8 }
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
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf Montelupo color-route hole-by-hole import. Certification waits for official third-level Evidence.",
    routes: [
      { figCourse: "blu 2020", name: "Blu", gesRoute: "Blu", gesRouteId: 2229, start: 0, count: 18, displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "blu 2020 9 buche", name: "Blu 9 buche", gesRoute: "Blu 9 buche", gesRouteId: 2226, start: 0, count: 9, displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "verde 2020", name: "Verde", gesRoute: "Verde", gesRouteId: 2227, start: 0, count: 18, displayOrder: 3 },
      { figCourse: "giallo 2020", name: "Giallo", gesRoute: "Giallo", gesRouteId: 2228, start: 0, count: 18, displayOrder: 4 },
      { figCourse: "bianco 2020", name: "Bianco", gesRoute: "Bianco", gesRouteId: 2447, start: 0, count: 18, displayOrder: 5 },
      { figCourse: "rosso 2020", name: "Rosso", gesRoute: "PERCORSO ROSSO", gesRouteId: 2225, start: 0, count: 18, displayOrder: 6 }
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

function teePayload(figCourse) {
  return (figCourse.tees || []).map((tee) => ({
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

function buildRoute({ figCourse, gesRoute, gesSource, routeSpec, config }) {
  return {
    external_key: figCourse.source_external_id,
    name: routeSpec.name,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: routeSpec.displayOrder,
    is_active: figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: "gesgolf",
      ...(routeSpec.name !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: routeSpec.name
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
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
    holes: routeHolesFromGesHoles(gesRoute.holes, routeSpec.start, routeSpec.count),
    tees: teePayload(figCourse)
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
