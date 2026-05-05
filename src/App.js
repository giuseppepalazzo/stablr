import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import {
  buildCourseStructurePayload,
  normalizeCourseName,
  normalizeWhitespace
} from "./lib/course-utils";

const appFont =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const THEME_STORAGE_KEY = "golf-score-app-theme-v1";
const LAST_LOGIN_EMAIL_STORAGE_KEY = "stablr:lastLoginEmail";
const MAX_SAVED_ROUNDS = 100;
const SCREEN_HORIZONTAL_PADDING = "16px";
const CARD_ROW_HORIZONTAL_PADDING = "12px";
const CARD_CONTAINER_HORIZONTAL_PADDING = "14px";
const HEADER_HORIZONTAL_INSET = "26px";
const HOME_SECTION_INSET = "0px";
const HEADER_CIRCLE_SIZE = "44px";
const HEADER_CIRCLE_RADIUS = "22px";
const CARD_FAVORITE_SIZE = "40px";
const CARD_FAVORITE_RADIUS = "20px";
const SHEET_CLOSE_DURATION = 220;

const stepperButtonStyle = {
  width: "44px",
  height: "44px",
  borderRadius: "12px",
  border: "1px solid #333",
  backgroundColor: "#1a1a1a",
  color: "white",
  fontSize: "22px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: appFont
};

function formatDateItalian(dateLike) {
  const date = new Date(dateLike);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function sanitizeRoundName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function receivedShotsToSymbols(value) {
  if (value === 0) return "—";
  if (value === 1) return "*";
  if (value === 2) return "**";
  if (value === 3) return "***";
  return "—";
}

function createInitialRoundSetup() {
  return {
    competitionName: "",
    totalCompetitionHoles: null,
    startHole: 1,
    selectedRouteId: null,
    secondaryRouteId: null,
    selectedCombinationId: null,
    selectedRouteTeeId: null,
    selectedCombinationTeeId: null
  };
}

function getClubStatusMeta(club) {
  const normalizedStatus = String(club?.dataStatus || "").trim().toLowerCase();
  const normalizedSourceType = String(club?.sourceType || "").trim().toLowerCase();
  const curatedByStablr =
    normalizedSourceType === "stablr" ||
    normalizedStatus === "verified" ||
    Boolean(club?.sourcePayload?.curated);

  if (curatedByStablr) {
    return {
      label: "Verificato",
      description: "Verificato: Dati verificati da Stablr",
      icon: "verified",
      accent: "verified"
    };
  }

  if (normalizedStatus === "needs_review") {
    return {
      label: "In arrivo",
      description: "In arrivo: In revisione",
      icon: "review",
      accent: "review"
    };
  }

  return {
    label: "Community",
    description: "Community: Aggiunto da un utente",
    icon: "community",
    accent: "community"
  };
}

function getFriendlyAuthErrorMessage(message) {
  const normalizedMessage = String(message || "").toLowerCase();

  if (normalizedMessage.includes("rate limit")) {
    return "Hai richiesto troppi codici in poco tempo. Attendi un attimo e riprova.";
  }

  if (normalizedMessage.includes("email address not authorized")) {
    return "Questa email non e' ancora abilitata. Per la beta conviene configurare un SMTP personalizzato in Supabase.";
  }

  if (normalizedMessage.includes("expired") || normalizedMessage.includes("invalid")) {
    return "Codice non valido o scaduto";
  }

  return message || "Si e' verificato un problema. Riprova.";
}

function getTeeDisplayName(tee) {
  if (!tee) return "";
  const rawName = String(tee.teeName || tee.name || "").trim();

  if (rawName) {
    const teeColorInfo = getTeeColor(rawName);
    if (teeColorInfo?.label) return teeColorInfo.label;
    return rawName;
  }

  return getTeeColor(tee.teeColor || "").label || "Tee";
}

function getTeeSortOrder(tee) {
  const normalized = String(
    tee?.teeName || tee?.name || tee?.teeColor || ""
  )
    .trim()
    .toLowerCase();

  const teeOrder = [
    ["bianco", "white"],
    ["giallo", "yellow"],
    ["verde", "green"],
    ["blu", "blue"],
    ["arancio", "orange"],
    ["rosso", "red"]
  ];

  const matchedIndex = teeOrder.findIndex((aliases) =>
    aliases.some((alias) => normalized.includes(alias))
  );

  return matchedIndex === -1 ? 99 : matchedIndex;
}

function getDefaultTeeId(tees) {
  const teeList = Array.isArray(tees) ? tees : [];
  if (!teeList.length) return null;

  const preferredYellow = teeList.find((tee) => {
    const normalized = String(tee?.teeName || tee?.name || tee?.teeColor || "")
      .trim()
      .toLowerCase();
    return normalized.includes("giallo") || normalized.includes("yellow");
  });

  return preferredYellow?.id || teeList[0]?.id || null;
}

const COLOR_INFO_BY_KEY = {
  nero: { label: "Nero", dotColor: "#2C2C2C" },
  bianco: { label: "Bianco", dotColor: "#F1F1F1", borderColor: "#CFCFCF" },
  giallo: { label: "Giallo", dotColor: "#EAB308" },
  verde: { label: "Verde", dotColor: "#16A34A" },
  blu: { label: "Blu", dotColor: "#2563EB" },
  rosso: { label: "Rosso", dotColor: "#DC2626" },
  arancio: { label: "Arancio", dotColor: "#F97316" }
};

const COLOR_ALIASES = {
  black: "nero",
  nero: "nero",
  white: "bianco",
  bianco: "bianco",
  yellow: "giallo",
  giallo: "giallo",
  green: "verde",
  verde: "verde",
  blue: "blu",
  blu: "blu",
  red: "rosso",
  rosso: "rosso",
  orange: "arancio",
  arancio: "arancio"
};

function findColorKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) return null;
  if (COLOR_ALIASES[normalized]) return COLOR_ALIASES[normalized];

  const tokens = normalized.split(/[^a-zA-ZÀ-ÿ]+/).filter(Boolean);
  return tokens.map((token) => COLOR_ALIASES[token]).find(Boolean) || null;
}

function getTeeColor(teeName) {
  const colorKey = findColorKey(teeName);
  if (!colorKey) {
    return {
      label: typeof teeName === "string" && teeName.trim() ? teeName.trim() : "Tee",
      dotColor: "#9CA3AF",
      borderColor: null
    };
  }

  return COLOR_INFO_BY_KEY[colorKey];
}

function getRouteColor(routeName) {
  const colorKey = findColorKey(routeName);
  return colorKey ? COLOR_INFO_BY_KEY[colorKey] : null;
}

function rotateCompetitionSequence(sequence, startHole) {
  const normalizedStartHole = Number(startHole || 1);
  const holes = Array.isArray(sequence) ? sequence : [];

  if (!holes.length || normalizedStartHole <= 1) return holes;

  const startIndex = holes.findIndex(
    (hole) => Number(hole.competitionHoleNumber) === normalizedStartHole
  );

  if (startIndex <= 0) return holes;

  return [...holes.slice(startIndex), ...holes.slice(0, startIndex)];
}

function calculatePlayingHandicap(handicapIndex, courseRating, slopeRating, parTotal) {
  const numericHandicapIndex = Number(handicapIndex);
  const numericCourseRating = Number(courseRating);
  const numericSlopeRating = Number(slopeRating);
  const numericParTotal = Number(parTotal);

  if (
    !Number.isFinite(numericHandicapIndex) ||
    !Number.isFinite(numericCourseRating) ||
    !Number.isFinite(numericSlopeRating) ||
    !Number.isFinite(numericParTotal)
  ) {
    return null;
  }

  return Math.round((numericHandicapIndex * numericSlopeRating) / 113 + (numericCourseRating - numericParTotal));
}

function App() {
  const [showDialog, setShowDialog] = useState(false);
  const [dialogStep, setDialogStep] = useState(1);

  const [courseName, setCourseName] = useState("");
  const [clubCreationMode, setClubCreationMode] = useState(null);
  const [routeCount, setRouteCount] = useState(null);
  const [routeDrafts, setRouteDrafts] = useState([]);
  const [routeName, setRouteName] = useState("");
  const [currentRouteIndex, setCurrentRouteIndex] = useState(0);
  const [holesCount, setHolesCount] = useState(null);

  const [holesData, setHolesData] = useState([]);
  const [currentHoleIndex, setCurrentHoleIndex] = useState(0);

  const [showStrokeInfo, setShowStrokeInfo] = useState(false);
  const [selectedStepper, setSelectedStepper] = useState("par");

  const [openedCourse, setOpenedCourse] = useState(null);
  const [showRoundSetup, setShowRoundSetup] = useState(false);
  const [roundSetup, setRoundSetup] = useState(createInitialRoundSetup);
  const [showManualCombinationBuilder, setShowManualCombinationBuilder] = useState(false);
  const [showOfficialCombinationOptions, setShowOfficialCombinationOptions] = useState(false);
  const [showRouteOptions, setShowRouteOptions] = useState(false);
  const [showOtherEighteenRouteOptions, setShowOtherEighteenRouteOptions] = useState(false);
  const [showTeeOptions, setShowTeeOptions] = useState(false);
  const [startHolePage, setStartHolePage] = useState(0);
  const startHoleSwipeRef = useRef({ x: null, y: null });

  const [roundScores, setRoundScores] = useState([]);
  const [savedRounds, setSavedRounds] = useState([]);
  const [showRoundsHistory, setShowRoundsHistory] = useState(false);
  const [roundAlreadySaved, setRoundAlreadySaved] = useState(false);

  const [manualReceivedShots, setManualReceivedShots] = useState({});

  const [playerNameDraft, setPlayerNameDraft] = useState("");
  const [hcpDraft, setHcpDraft] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCourseCardId, setActiveCourseCardId] = useState(null);
  const [searchEmptyHintPulse, setSearchEmptyHintPulse] = useState(false);
  const [hcpHighlightActive, setHcpHighlightActive] = useState(false);
  const [estimatedHcpHighlightActive, setEstimatedHcpHighlightActive] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [sheetTouchStartY, setSheetTouchStartY] = useState(null);
  const [selectedHistoryRound, setSelectedHistoryRound] = useState(null);
  const [historyRoundDetailTouchStartY, setHistoryRoundDetailTouchStartY] = useState(null);
  const [showPrivacyScreen, setShowPrivacyScreen] = useState(false);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authStep, setAuthStep] = useState("request");
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const [authForm, setAuthForm] = useState({
    email: ""
  });
  const [onboardingForm, setOnboardingForm] = useState({
    playerName: "",
    hcp: ""
  });
  const [otpCode, setOtpCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [courseSaveError, setCourseSaveError] = useState("");
  const [courseSaveLoading, setCourseSaveLoading] = useState(false);
  const [clubRequestSubmitting, setClubRequestSubmitting] = useState(false);
  const [clubRequestFeedback, setClubRequestFeedback] = useState("");
  const [courseReportTarget, setCourseReportTarget] = useState(null);
  const [courseReportMessage, setCourseReportMessage] = useState("");
  const [courseReportSubmitting, setCourseReportSubmitting] = useState(false);
  const [courseReportFeedback, setCourseReportFeedback] = useState("");
  const [favoriteCourseIds, setFavoriteCourseIds] = useState([]);
  const previousHcpRef = useRef(null);
  const previousEstimatedHcpRef = useRef(null);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved || "light";
    } catch (error) {
      return "light";
    }
  });

  const [userProfile, setUserProfile] = useState({
    playerName: "",
    hcp: 36,
    role: "user"
  });

  const [savedCourses, setSavedCourses] = useState([]);

  const isLight = theme === "light";

  const colors = useMemo(
    () => ({
      bg: isLight ? "#f5f5f3" : "#000000",
      text: isLight ? "#111111" : "#ffffff",
      subtext: isLight ? "#6b6b6b" : "#8c8c8c",
      card: isLight ? "#ffffff" : "#111111",
      cardSecondary: isLight ? "#f0f0ed" : "#171717",
      border: isLight ? "#e3e3dd" : "#222222",
      borderStrong: isLight ? "#d0d0c8" : "#333333",
      inputBg: isLight ? "#f4f4f1" : "#1a1a1a",
      inputBorder: isLight ? "#dddd d6".replace(" ", "") : "#333333",
      pillBg: isLight ? "#f2f2ee" : "#171717",
      pillBorder: isLight ? "#d7d7cf" : "#2b2b2b",
      green: "#2ecc71",
      greenDark: isLight ? "#eef9f2" : "#16261c",
      greenBorder: isLight ? "#b8e7c8" : "#244233",
      greenManualBg: isLight ? "#e6f8ec" : "#1b3022",
      greenManualBorder: isLight ? "#7cdb9f" : "#52d88b",
      overlay: isLight ? "rgba(245, 245, 243, 0.60)" : "rgba(0, 0, 0, 0.46)"
    }),
    [isLight]
  );

  const themedStepperButtonStyle = useMemo(
    () => ({
      ...stepperButtonStyle,
      border: `1px solid ${colors.borderStrong}`,
      backgroundColor: colors.inputBg,
      color: colors.text
    }),
    [colors]
  );

  const modalCloseButtonStyle = useMemo(
    () => ({
      marginTop: "12px",
      width: "100%",
      padding: "13px",
      backgroundColor: colors.cardSecondary,
      border: `1px solid ${colors.border}`,
      color: colors.text,
      borderRadius: "12px",
      cursor: "pointer",
      fontFamily: appFont,
      fontSize: "15px"
    }),
    [colors]
  );

  const topSafeAreaBackdrop = (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "calc(env(safe-area-inset-top, 0px) + 20px)",
        backgroundColor: colors.bg,
        pointerEvents: "none",
        zIndex: 6,
        transform: "translateZ(0)",
        willChange: "transform"
      }}
    />
  );

  const stepperValueStyle = useMemo(
    () => ({
      flex: 1,
      height: "44px",
      borderRadius: "12px",
      border: `1px solid ${colors.borderStrong}`,
      backgroundColor: colors.inputBg,
      color: colors.text,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "18px",
      fontWeight: 600,
      fontFamily: appFont
    }),
    [colors]
  );

  const stepperInputStyle = useMemo(
    () => ({
      flex: 1,
      height: "44px",
      borderRadius: "12px",
      border: `1px solid ${colors.borderStrong}`,
      backgroundColor: colors.inputBg,
      color: colors.text,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "18px",
      fontWeight: 600,
      fontFamily: appFont,
      textAlign: "center",
      outline: "none",
      boxSizing: "border-box",
      width: "100%"
    }),
    [colors]
  );

  const hasActiveOverlay =
    showDialog ||
    Boolean(activeSheet) ||
    sheetClosing ||
    Boolean(selectedHistoryRound) ||
    Boolean(courseReportTarget);

  useLayoutEffect(() => {
    const rootElement = document.getElementById("root");
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    const appleStatusBarMeta = document.querySelector(
      'meta[name="apple-mobile-web-app-status-bar-style"]'
    );
    const runtimeColorScheme = isLight ? "light" : "dark";

    document.body.style.margin = "0";
    document.body.style.backgroundColor = colors.bg;
    document.body.style.color = colors.text;
    document.body.style.fontFamily = appFont;
    document.body.style.colorScheme = runtimeColorScheme;
    document.documentElement.style.backgroundColor = colors.bg;
    document.documentElement.style.color = colors.text;
    document.documentElement.style.colorScheme = runtimeColorScheme;
    if (rootElement) {
      rootElement.style.backgroundColor = colors.bg;
      rootElement.style.color = colors.text;
      rootElement.style.colorScheme = runtimeColorScheme;
    }
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", colors.bg);
    }
    if (colorSchemeMeta) {
      colorSchemeMeta.setAttribute("content", runtimeColorScheme);
    }
    if (appleStatusBarMeta) {
      appleStatusBarMeta.setAttribute(
        "content",
        isLight ? "default" : "black-translucent"
      );
    }

    return () => {
      document.body.style.margin = "";
      document.body.style.backgroundColor = "";
      document.body.style.color = "";
      document.body.style.fontFamily = "";
      document.body.style.colorScheme = "";
      document.documentElement.style.backgroundColor = "";
      document.documentElement.style.color = "";
      document.documentElement.style.colorScheme = "";
      if (rootElement) {
        rootElement.style.backgroundColor = "";
        rootElement.style.color = "";
        rootElement.style.colorScheme = "";
      }
    };
  }, [colors.bg, colors.text, isLight]);

  const sessionUserId = session?.user?.id || null;

  useEffect(() => {
    if (!hasActiveOverlay) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousDocumentOverscrollBehavior =
      document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      document.documentElement.style.overscrollBehavior =
        previousDocumentOverscrollBehavior;
    };
  }, [hasActiveOverlay]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem(LAST_LOGIN_EMAIL_STORAGE_KEY) || "";
      if (savedEmail) {
        setAuthForm({
          email: savedEmail
        });
      }
    } catch (error) {}
  }, []);

  useEffect(() => {
    if (otpCooldownSeconds <= 0) return undefined;

    const timeoutId = window.setTimeout(() => {
      setOtpCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [otpCooldownSeconds]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    const loadSession = async () => {
      const {
        data: { session: activeSession }
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(activeSession);
      setAuthLoading(false);
    };

    loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      setSession(activeSession);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadCourses = useCallback(async () => {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("clubs")
      .select("*, course_routes(*, route_holes(*)), route_combinations(*, route_combination_holes(*))")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const { data: routeTeesData, error: routeTeesError } = await supabase
      .from("route_tees")
      .select("*")
      .eq("is_active", true);

    if (routeTeesError) throw routeTeesError;

    const { data: combinationTeesData, error: combinationTeesError } = await supabase
      .from("combination_tees")
      .select("*")
      .eq("is_active", true);

    if (combinationTeesError) throw combinationTeesError;

    const routeTeesByRouteId = new Map();
    (routeTeesData || []).forEach((tee) => {
      const current = routeTeesByRouteId.get(tee.route_id) || [];
      current.push(tee);
      routeTeesByRouteId.set(tee.route_id, current);
    });

    const combinationTeesByCombinationId = new Map();
    (combinationTeesData || []).forEach((tee) => {
      const current = combinationTeesByCombinationId.get(tee.route_combination_id) || [];
      current.push(tee);
      combinationTeesByCombinationId.set(tee.route_combination_id, current);
    });

    const normalizedCourses = (data || []).map((club) => {
      const routes = (Array.isArray(club.course_routes) ? club.course_routes : [])
        .map((route) => {
          const routeHoles = (Array.isArray(route.route_holes) ? route.route_holes : [])
            .map((hole) => ({
              id: hole.id,
              hole: hole.physical_hole_number,
              par: hole.par,
              strokeIndex: hole.stroke_index,
              displayLabel: hole.display_label
            }))
            .sort((left, right) => left.hole - right.hole);

          const computedTotalPar =
            Number(route.total_par || 0) ||
            routeHoles.reduce((sum, hole) => sum + Number(hole.par || 0), 0);

          return {
            id: route.id,
            name: route.name,
            holesCount: route.holes_count,
            totalPar: computedTotalPar,
            holes: routeHoles,
            displayOrder: route.display_order,
            sourcePayload: route.source_payload || null,
            tees: (routeTeesByRouteId.get(route.id) || [])
              .filter((tee) => tee.is_active !== false)
              .map((tee) => ({
                id: tee.id,
                teeName: tee.tee_name,
                teeColor: tee.tee_color,
                gender: tee.gender,
                courseRating: tee.course_rating,
                slopeRating: tee.slope_rating,
                parTotal: tee.par_total
              }))
              .sort((left, right) => {
                const leftOrder = getTeeSortOrder(left);
                const rightOrder = getTeeSortOrder(right);
                if (leftOrder !== rightOrder) return leftOrder - rightOrder;
                return getTeeDisplayName(left).localeCompare(getTeeDisplayName(right), "it");
              })
          };
        })
        .sort((left, right) => {
          const leftOrder = Number.isFinite(left.displayOrder) ? left.displayOrder : 999;
          const rightOrder = Number.isFinite(right.displayOrder) ? right.displayOrder : 999;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return left.name.localeCompare(right.name, "it");
        });

      const primaryRoute = routes.length === 1 ? routes[0] : null;
      const routeCombinations = (Array.isArray(club.route_combinations) ? club.route_combinations : [])
        .map((combination) => {
          const combinationHoles = (
            Array.isArray(combination.route_combination_holes)
              ? combination.route_combination_holes
              : []
          )
            .map((hole) => ({
              id: hole.id,
              roundHoleNumber: hole.round_hole_number,
              routeId: hole.route_id,
              routePosition: hole.route_position,
              physicalHoleNumber: hole.physical_hole_number,
              par: hole.par,
              strokeIndex: hole.stroke_index,
              sourceStrokeIndex: hole.source_stroke_index,
              displayLabel: hole.display_label
            }))
            .sort((left, right) => left.roundHoleNumber - right.roundHoleNumber);

          const frontRoute = routes.find((route) => route.id === combination.front_route_id) || null;
          const backRoute = routes.find((route) => route.id === combination.back_route_id) || null;

          return {
            id: combination.id,
            name: combination.name,
            frontRouteId: combination.front_route_id,
            backRouteId: combination.back_route_id,
            frontRouteName: frontRoute?.name || "Prime nove",
            backRouteName: backRoute?.name || "Seconde nove",
            holesCount: combination.holes_count,
            totalPar:
              Number(combination.total_par || 0) ||
              combinationHoles.reduce((sum, hole) => sum + Number(hole.par || 0), 0),
            holes: combinationHoles,
            tees: (combinationTeesByCombinationId.get(combination.id) || [])
              .filter((tee) => tee.is_active !== false)
              .map((tee) => ({
                id: tee.id,
                teeName: tee.tee_name,
                teeColor: tee.tee_color,
                gender: tee.gender,
                courseRating: tee.course_rating,
                slopeRating: tee.slope_rating,
                parTotal: tee.par_total
              }))
              .sort((left, right) => {
                const leftOrder = getTeeSortOrder(left);
                const rightOrder = getTeeSortOrder(right);
                if (leftOrder !== rightOrder) return leftOrder - rightOrder;
                return getTeeDisplayName(left).localeCompare(getTeeDisplayName(right), "it");
              })
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "it"));

      return {
        id: club.id,
        name: club.name,
        nameNormalized: club.name_normalized,
        dataStatus: club.data_status || "community",
        sourceType: club.source_type || "user",
        isComplex: Boolean(club.is_complex),
        playable: club.playable !== false,
        sourcePayload: club.source_payload || null,
        favorite: false,
        totalPar: primaryRoute?.totalPar || null,
        holesCount: primaryRoute?.holesCount || null,
        holes: primaryRoute?.holes || [],
        createdAt: club.created_at,
        createdBy: club.created_by,
        city: club.city,
        country: club.country,
        routeCount: routes.filter((route) => Number(route.holesCount) === 9).length || routes.length,
        routes,
        routeCombinations,
        primaryRouteId: primaryRoute?.id || null
      };
    });

    setSavedCourses(normalizedCourses);
    return normalizedCourses;
  }, []);

  const loadFavorites = useCallback(async () => {
    if (!supabase || !session?.user) return [];

    const { data, error } = await supabase
      .from("favorite_clubs")
      .select("club_id")
      .eq("user_id", session.user.id);

    if (error) throw error;

    const ids = (data || []).map((item) => item.club_id);
    setFavoriteCourseIds(ids);
    return ids;
  }, [session]);

  const loadRounds = useCallback(async (coursesOverride = []) => {
    if (!supabase || !session?.user) return [];

    const { data, error } = await supabase
      .from("rounds")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const nextRounds = (data || []).map((round) => ({
      id: round.id,
      savedName: round.saved_name,
      competitionName: round.competition_name,
      courseId: round.club_id,
      courseName:
        coursesOverride.find((course) => course.id === round.club_id)?.name || "",
      createdAt: round.created_at,
      formattedDate: round.formatted_date,
      playerHcp: round.player_hcp,
      totalCompetitionHoles: round.total_competition_holes,
      startHole: round.start_hole,
      grossTotal: round.gross_total,
      netTotal: round.net_total,
      stablefordTotal: round.stableford_total,
      estimatedHcpAfterRound: round.estimated_hcp_after_round,
      scores: Array.isArray(round.scores) ? round.scores : round.scores || [],
      manualReceivedShots: round.manual_received_shots || {}
    }));

    setSavedRounds(nextRounds);
    return nextRounds;
  }, [session]);

  const loadProfile = useCallback(async () => {
    if (!supabase || !session?.user) return null;

    setProfileLoading(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      setNeedsOnboarding(true);
      setUserProfile({
        playerName: "",
        hcp: 36,
        role: "user"
      });
      setProfileLoading(false);
      return null;
    }

    setUserProfile({
      playerName: data.player_name || "",
      hcp:
        typeof data.hcp === "number" || typeof data.hcp === "string"
          ? Number(Number(data.hcp).toFixed(1))
          : 36,
      role: data.role || "user"
    });
    setNeedsOnboarding(false);
    setProfileLoading(false);
    return data;
  }, [session]);

  const migrateLocalCoursesIfNeeded = useCallback(async () => {
    return undefined;
  }, []);

  useEffect(() => {
    if (!sessionUserId) {
      setAppReady(false);
      setNeedsOnboarding(false);
      setSavedRounds([]);
      setFavoriteCourseIds([]);
      setUserProfile({
        playerName: "",
        hcp: 36,
        role: "user"
      });
      return;
    }

    let cancelled = false;

    const bootstrapAuthenticatedApp = async () => {
      try {
        const initialCourses = await loadCourses();
        await migrateLocalCoursesIfNeeded();
        const courses = await loadCourses();
        await loadFavorites();
        const profile = await loadProfile();

        if (profile) {
          await loadRounds(courses.length ? courses : initialCourses);
        } else {
          setSavedRounds([]);
        }

        if (!cancelled) {
          setAppReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Authenticated bootstrap failed", error);
          setAuthError(error.message || "Errore nel caricamento dei dati.");
          setAppReady(false);
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    };

    bootstrapAuthenticatedApp();

    return () => {
      cancelled = true;
    };
  }, [sessionUserId, loadCourses, loadFavorites, loadProfile, loadRounds, migrateLocalCoursesIfNeeded]);

  const coursesWithFavorites = useMemo(
    () =>
      savedCourses.map((course) => ({
        ...course,
        favorite: favoriteCourseIds.includes(course.id)
      })),
    [savedCourses, favoriteCourseIds]
  );

  const favorites = coursesWithFavorites.filter((course) => course.favorite);

  const filteredCourses = coursesWithFavorites.filter((course) =>
    course.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );
  const showSearchEmptyState =
    searchQuery.trim() !== "" && filteredCourses.length === 0;

  useEffect(() => {
    if (!showSearchEmptyState) {
      setSearchEmptyHintPulse(false);
      return;
    }

    setSearchEmptyHintPulse(true);
    const timeoutId = window.setTimeout(() => {
      setSearchEmptyHintPulse(false);
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showSearchEmptyState]);

  const currentHole =
    holesData[currentHoleIndex] || { hole: 1, par: 4, strokeIndex: "" };
  const currentRouteDraft =
    routeDrafts[currentRouteIndex] || { name: "Percorso", holesCount: holesCount || 0, holes: holesData };

  const createRouteHoles = useCallback(
    (count) =>
      Array.from({ length: count }, (_, index) => ({
        hole: index + 1,
        par: 4,
        strokeIndex: ""
      })),
    []
  );

  const syncCurrentRouteEditor = useCallback((nextIndex, nextDrafts = routeDrafts) => {
    const nextRoute = nextDrafts[nextIndex];
    setCurrentRouteIndex(nextIndex);
    setRouteName(nextRoute?.name || (routeCount === 1 ? "Percorso" : `Percorso ${nextIndex + 1}`));
    setHolesCount(nextRoute?.holesCount || null);
    setHolesData(Array.isArray(nextRoute?.holes) ? nextRoute.holes : []);
    setCurrentHoleIndex(0);
    setSelectedStepper("par");
    setShowStrokeInfo(false);
  }, [routeCount, routeDrafts]);

  const grossTotal = useMemo(() => {
    return roundScores.reduce((sum, score) => sum + Number(score || 0), 0);
  }, [roundScores]);

  const resetDialogState = () => {
    setDialogStep(1);
    setCourseName("");
    setClubCreationMode(null);
    setRouteCount(null);
    setRouteDrafts([]);
    setRouteName("");
    setCurrentRouteIndex(0);
    setHolesCount(null);
    setHolesData([]);
    setCurrentHoleIndex(0);
    setShowStrokeInfo(false);
    setSelectedStepper("par");
    setCourseSaveError("");
    setCourseSaveLoading(false);
    setClubRequestSubmitting(false);
    setClubRequestFeedback("");
  };

  const openDialog = () => {
    resetDialogState();
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    resetDialogState();
  };

  const openComplexClubRequestDialog = (club) => {
    resetDialogState();
    setCourseName(club.name || "");
    setClubCreationMode("multiple");
    setDialogStep(7);
    setShowDialog(true);
  };

  const goToStepTwo = () => {
    if (courseName.trim() === "") return;
    setDialogStep(2);
  };

  const goBackToStepOne = () => {
    setDialogStep(1);
  };

  const goToIntroStep = () => {
    if (clubCreationMode !== "single") return;

    const nextRouteCount = 1;
    const drafts = Array.from({ length: nextRouteCount }, (_, index) => ({
      name: "Percorso",
      holesCount: null,
      holes: []
    }));

    setRouteCount(nextRouteCount);
    setRouteDrafts(drafts);
    setRouteName(drafts[0].name);
    setCurrentRouteIndex(0);
    setHolesCount(null);
    setHolesData([]);
    setDialogStep(3);
  };

  const saveRouteDetails = () => {
    if (!holesCount) return;

    const cleanRouteName =
      normalizeWhitespace(routeName) ||
      (routeCount === 1 ? "Percorso" : `Percorso ${currentRouteIndex + 1}`);
    const generatedHoles =
      holesData.length === holesCount && currentRouteDraft.holesCount === holesCount
        ? holesData
        : createRouteHoles(holesCount);

    const nextDrafts = routeDrafts.map((route, index) =>
      index === currentRouteIndex
        ? {
            ...route,
            name: cleanRouteName,
            holesCount,
            holes: generatedHoles
          }
        : route
    );

    setRouteDrafts(nextDrafts);

    if (currentRouteIndex < routeCount - 1) {
      syncCurrentRouteEditor(currentRouteIndex + 1, nextDrafts);
      return;
    }

    syncCurrentRouteEditor(0, nextDrafts);
    setDialogStep(4);
  };

  const startMapping = () => {
    setDialogStep(5);
    setSelectedStepper("par");
  };

  const goBackToStepTwoFromIntro = () => {
    setDialogStep(2);
  };

  const goBackToRouteDetails = () => {
    setDialogStep(3);
  };

  const updateCurrentHoleField = (field, value) => {
    const updated = [...holesData];
    updated[currentHoleIndex] = {
      ...updated[currentHoleIndex],
      [field]: value
    };
    setHolesData(updated);
    setRouteDrafts((prev) =>
      prev.map((route, index) =>
        index === currentRouteIndex
          ? {
              ...route,
              holes: updated
            }
          : route
      )
    );
  };

  const adjustPar = (delta) => {
    const currentValue = Number(currentHole.par || 4);
    const nextValue = Math.min(5, Math.max(3, currentValue + delta));
    updateCurrentHoleField("par", nextValue);
  };

  const adjustStrokeIndex = (delta) => {
    const rawValue = currentHole.strokeIndex;
    const isEmpty =
      rawValue === "" || rawValue === null || typeof rawValue === "undefined";
    const currentValue = isEmpty ? 0 : Number(rawValue);

    if (delta < 0) {
      if (isEmpty || currentValue === 0) {
        updateCurrentHoleField("strokeIndex", 18);
        return;
      }

      const nextValue = currentValue === 1 ? 18 : currentValue - 1;
      updateCurrentHoleField("strokeIndex", nextValue);
      return;
    }

    if (delta > 0) {
      if (isEmpty || currentValue === 0) {
        updateCurrentHoleField("strokeIndex", 1);
        return;
      }

      const nextValue = currentValue === 18 ? 1 : currentValue + 1;
      updateCurrentHoleField("strokeIndex", nextValue);
    }
  };

  const handleStrokeInputChange = (value) => {
    if (value === "") {
      updateCurrentHoleField("strokeIndex", "");
      return;
    }

    const numericValue = value.replace(/\D/g, "");
    updateCurrentHoleField("strokeIndex", numericValue);
  };

  const normalizeStrokeInput = () => {
    if (currentHole.strokeIndex === "") return;

    let value = Number(currentHole.strokeIndex);

    if (Number.isNaN(value)) {
      updateCurrentHoleField("strokeIndex", "");
      return;
    }

    if (value < 1) value = 1;
    if (value > 18) value = 18;

    updateCurrentHoleField("strokeIndex", value);
  };

  const currentHoleCompleted =
    currentHole.par !== "" && currentHole.strokeIndex !== "";

  const nextHole = () => {
    if (!currentHoleCompleted) return;

    if (currentHoleIndex < holesData.length - 1) {
      setCurrentHoleIndex((prev) => prev + 1);
      setSelectedStepper("par");
    } else {
      if (currentRouteIndex < routeDrafts.length - 1) {
        syncCurrentRouteEditor(currentRouteIndex + 1);
        setDialogStep(4);
      } else {
        setDialogStep(6);
      }
    }
  };

  const previousHole = () => {
    if (currentHoleIndex > 0) {
      setCurrentHoleIndex((prev) => prev - 1);
      setSelectedStepper("par");
    } else {
      setDialogStep(4);
    }
  };

  const goBackFromSummary = () => {
    const lastRouteIndex = Math.max(routeDrafts.length - 1, 0);
    syncCurrentRouteEditor(lastRouteIndex);
    setCurrentHoleIndex(
      Math.max((routeDrafts[lastRouteIndex]?.holes || []).length - 1, 0)
    );
    setDialogStep(5);
    setSelectedStepper("par");
  };

  const saveCourse = async () => {
    if (!supabase || !session?.user) return;

    const cleanName = normalizeWhitespace(courseName);
    const nameNormalized = normalizeCourseName(cleanName);
    let insertedClubId = null;
    const normalizedRoutes = routeDrafts.map((route, index) => {
      const structurePayload = buildCourseStructurePayload({
        holesCount: route.holesCount,
        holes: route.holes
      });

      return {
        name:
          normalizeWhitespace(route.name) ||
          (routeDrafts.length === 1 ? "Percorso" : `Percorso ${index + 1}`),
        holesCount: structurePayload.holesCount,
        totalPar: structurePayload.totalPar,
        holes: structurePayload.holes,
        displayOrder: index + 1
      };
    });

    setCourseSaveError("");
    setCourseSaveLoading(true);

    try {
      const { data: existingClubs, error: duplicateError } = await supabase
        .from("clubs")
        .select("id,name,name_normalized")
        .eq("name_normalized", nameNormalized)
        .limit(1);

      if (duplicateError) throw duplicateError;

      const duplicateByName = (existingClubs || []).find(
        (course) => course.name_normalized === nameNormalized
      );
      if (duplicateByName) {
        setCourseSaveError("Esiste già un club con questo nome.");
        setCourseSaveLoading(false);
        return;
      }

      const { data: insertedClub, error: insertClubError } = await supabase
        .from("clubs")
        .insert({
          name: cleanName,
          name_normalized: nameNormalized,
          created_by: session.user.id,
          data_status: "community",
          source_type: "user",
          is_complex: false,
          playable: true
        })
        .select("*")
        .single();

      if (insertClubError) {
        if (String(insertClubError.message || "").toLowerCase().includes("name_normalized")) {
          setCourseSaveError("Esiste già un club con questo nome.");
          setCourseSaveLoading(false);
          return;
        }
        throw insertClubError;
      }

      insertedClubId = insertedClub.id;

      for (const route of normalizedRoutes) {
        const { data: insertedRoute, error: insertRouteError } = await supabase
          .from("course_routes")
          .insert({
            club_id: insertedClub.id,
            name: route.name,
            holes_count: route.holesCount,
            total_par: route.totalPar,
            display_order: route.displayOrder
          })
          .select("*")
          .single();

        if (insertRouteError) {
          throw insertRouteError;
        }

        const routeHolesPayload = route.holes.map((hole) => ({
          route_id: insertedRoute.id,
          physical_hole_number: hole.hole,
          par: hole.par,
          stroke_index: hole.strokeIndex || null,
          display_label: `Buca ${hole.hole}`
        }));

        const { error: insertHolesError } = await supabase
          .from("route_holes")
          .insert(routeHolesPayload);

        if (insertHolesError) {
          throw insertHolesError;
        }
      }

      await loadCourses();
      closeDialog();
    } catch (error) {
      const normalizedError = String(error.message || "").toLowerCase();
      if (normalizedError.includes("duplicate key value")) {
        setCourseSaveError("Controlla che ogni percorso abbia un nome e buche valide.");
      } else if (normalizedError.includes("name_normalized")) {
        setCourseSaveError("Esiste già un club con questo nome.");
      } else {
        setCourseSaveError(error.message || "Errore nel salvataggio del club.");
      }

      if (insertedClubId) {
        await supabase.from("clubs").delete().eq("id", insertedClubId);
      }

      if (String(error.message || "").toLowerCase().includes("name_normalized")) {
        setCourseSaveError("Esiste già un club con questo nome.");
      }
    } finally {
      setCourseSaveLoading(false);
    }
  };

  const submitClubRequest = async (clubNameOverride = "") => {
    if (!supabase || !session?.user) return;

    const cleanName = normalizeWhitespace(clubNameOverride || courseName);
    const normalizedName = normalizeCourseName(cleanName);
    if (!cleanName) {
      setClubRequestFeedback("Inserisci il nome del club.");
      return;
    }

    setClubRequestSubmitting(true);
    setClubRequestFeedback("");

    const { data: existingClub, error: existingClubError } = await supabase
      .from("clubs")
      .select("*")
      .eq("name_normalized", normalizedName)
      .limit(1)
      .maybeSingle();

    if (existingClubError) {
      setClubRequestFeedback(existingClubError.message || "Errore nell'invio della richiesta.");
      setClubRequestSubmitting(false);
      return;
    }

    let requestedClubId = existingClub?.id || null;

    if (!existingClub) {
      const { data: insertedClub, error: insertClubError } = await supabase
        .from("clubs")
        .insert({
          name: cleanName,
          name_normalized: normalizedName,
          created_by: session.user.id,
          data_status: "needs_review",
          source_type: "user",
          is_complex: true,
          playable: false
        })
        .select("*")
        .single();

      if (insertClubError) {
        setClubRequestFeedback(insertClubError.message || "Errore nell'invio della richiesta.");
        setClubRequestSubmitting(false);
        return;
      }

      requestedClubId = insertedClub.id;
    } else if (
      existingClub.playable !== false ||
      existingClub.data_status !== "needs_review" ||
      existingClub.is_complex !== true
    ) {
      const { error: updateClubError } = await supabase
        .from("clubs")
        .update({
          data_status: "needs_review",
          source_type: existingClub.source_type || "user",
          is_complex: true,
          playable: false
        })
        .eq("id", existingClub.id);

      if (updateClubError) {
        setClubRequestFeedback(updateClubError.message || "Errore nell'invio della richiesta.");
        setClubRequestSubmitting(false);
        return;
      }
    }

    const existingRequestQuery = requestedClubId
      ? supabase
          .from("club_requests")
          .select("*")
          .eq("club_id", requestedClubId)
          .limit(1)
      : supabase
          .from("club_requests")
          .select("*")
          .eq("club_name", cleanName)
          .limit(1);

    const { data: existingRequest, error: existingRequestError } = await existingRequestQuery.maybeSingle();

    if (existingRequestError) {
      setClubRequestFeedback(existingRequestError.message || "Errore nell'invio della richiesta.");
      setClubRequestSubmitting(false);
      return;
    }

    if (existingRequest) {
      setClubRequestFeedback("Questo club è già in verifica da parte di Stablr.");
      setClubRequestSubmitting(false);
      await loadCourses();
      return;
    }

    const { error } = await supabase.from("club_requests").insert({
      club_name: cleanName,
      club_id: requestedClubId,
      user_id: session.user.id,
      user_email: session.user.email || null,
      status: "requested"
    });

    if (error) {
      setClubRequestFeedback(error.message || "Errore nell'invio della richiesta.");
      setClubRequestSubmitting(false);
      return;
    }

    setClubRequestSubmitting(false);
    setClubRequestFeedback("Richiesta inviata. Ti avviseremo via email quando il club sarà pronto.");
    await loadCourses();
  };

  const toggleFavorite = async (courseId) => {
    if (!supabase || !session?.user) return;

    const isFavorite = favoriteCourseIds.includes(courseId);

    if (isFavorite) {
      await supabase
        .from("favorite_clubs")
        .delete()
        .eq("user_id", session.user.id)
        .eq("club_id", courseId);
      setFavoriteCourseIds((prev) => prev.filter((id) => id !== courseId));
    } else {
      await supabase.from("favorite_clubs").insert({
        user_id: session.user.id,
        club_id: courseId
      });
      setFavoriteCourseIds((prev) => [...prev, courseId]);
    }
  };

  const buildRoundChoiceDefaults = useCallback((course, totalCompetitionHoles) => {
    const routes = Array.isArray(course?.routes) ? course.routes : [];
    const nineHoleRoutes = [...routes]
      .filter(
        (route) => Number(route.holesCount) === 9 && Array.isArray(route.holes) && route.holes.length > 0
      )
      .sort((a, b) => {
        const priority = { "Blu": 0, "Bianco": 1, "Rosso": 2 };
        const aPriority = Object.prototype.hasOwnProperty.call(priority, a.name) ? priority[a.name] : 99;
        const bPriority = Object.prototype.hasOwnProperty.call(priority, b.name) ? priority[b.name] : 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return String(a.name || "").localeCompare(String(b.name || ""), "it");
      });
    const eighteenHoleRoutes = routes.filter(
      (route) => Number(route.holesCount) === 18 && Array.isArray(route.holes) && route.holes.length > 0
    );
    const officialCombinations = Array.isArray(course?.routeCombinations)
      ? course.routeCombinations.filter((combination) => Array.isArray(combination.holes) && combination.holes.length === 18)
      : [];

    if (Number(totalCompetitionHoles) === 9) {
      const preferredRoute = nineHoleRoutes[0] || null;
      return {
        selectedRouteId: preferredRoute?.id || null,
        secondaryRouteId: null,
        selectedCombinationId: null,
        selectedRouteTeeId: getDefaultTeeId(preferredRoute?.tees),
        selectedCombinationTeeId: null,
        startHole: 1
      };
    }

    if (officialCombinations.length > 0) {
      const preferredCombination =
        officialCombinations.find(
          (combination) => {
            const normalizedName = String(combination.name || "").trim().toLowerCase();
            return (
              normalizedName === "championship bianco/blu" ||
              normalizedName.includes("championship bianco/blu")
            );
          }
        ) || officialCombinations[0];
      return {
        selectedRouteId: preferredCombination.frontRouteId,
        secondaryRouteId: preferredCombination.backRouteId,
        selectedCombinationId: preferredCombination.id,
        selectedRouteTeeId: null,
        selectedCombinationTeeId: getDefaultTeeId(preferredCombination.tees),
        startHole: 1
      };
    }

    if (eighteenHoleRoutes.length > 0) {
      const preferredRoute = eighteenHoleRoutes[0];
      return {
        selectedRouteId: preferredRoute.id,
        secondaryRouteId: null,
        selectedCombinationId: null,
        selectedRouteTeeId: getDefaultTeeId(preferredRoute.tees),
        selectedCombinationTeeId: null,
        startHole: 1
      };
    }

    if (nineHoleRoutes.length > 0) {
      const preferredRoute = nineHoleRoutes[0];
      return {
        selectedRouteId: preferredRoute.id,
        secondaryRouteId: nineHoleRoutes[1]?.id || nineHoleRoutes[0].id,
        selectedCombinationId: null,
        selectedRouteTeeId: getDefaultTeeId(preferredRoute.tees),
        selectedCombinationTeeId: null,
        startHole: 1
      };
    }

    return {
      selectedRouteId: null,
      secondaryRouteId: null,
      selectedCombinationId: null,
      selectedRouteTeeId: null,
      selectedCombinationTeeId: null,
      startHole: 1
    };
  }, []);

  const findOfficialCombinationByRoutes = useCallback((course, frontRoute, backRoute) => {
    const routeCombinations = Array.isArray(course?.routeCombinations)
      ? course.routeCombinations
      : [];
    const frontRouteId = frontRoute?.id || null;
    const backRouteId = backRoute?.id || null;
    const frontRouteName = frontRoute?.name || null;
    const backRouteName = backRoute?.name || null;

    return (
      routeCombinations.find(
        (combination) =>
          combination.frontRouteId === frontRouteId && combination.backRouteId === backRouteId
      ) ||
      routeCombinations.find(
        (combination) =>
          combination.frontRouteName === frontRouteName &&
          combination.backRouteName === backRouteName
      ) ||
      routeCombinations.find((combination) => {
        const holes = Array.isArray(combination.holes) ? combination.holes : [];
        const frontHole = holes.find((hole) => Number(hole.routePosition) === 1);
        const backHole = holes.find((hole) => Number(hole.routePosition) === 2);

        return frontHole?.routeId === frontRouteId && backHole?.routeId === backRouteId;
      }) || null
    );
  }, []);

  const prepareRoundSetup = (course) => {
    const hasPlayableRoutes = Array.isArray(course?.routes) && course.routes.some((route) => route.holes?.length);

    if (!hasPlayableRoutes) {
      return;
    }
    const hasOfficialCombinations = Array.isArray(course?.routeCombinations) && course.routeCombinations.length > 0;
    const hasEighteenHoleRoutes = Array.isArray(course?.routes)
      && course.routes.some((route) => Number(route.holesCount) === 18 && route.holes?.length);
    const hasNineHoleRoutes = Array.isArray(course?.routes)
      && course.routes.some((route) => Number(route.holesCount) === 9 && route.holes?.length);
    const defaultCompetitionHoles =
      hasOfficialCombinations || hasEighteenHoleRoutes || hasNineHoleRoutes ? 18 : 9;

    setOpenedCourse(course);
    setShowRoundSetup(true);
    setActiveSheet(null);
    setSheetClosing(false);
    setShowRoundsHistory(false);
    setShowManualCombinationBuilder(false);
    setShowOfficialCombinationOptions(false);
    setShowRouteOptions(false);
    setShowTeeOptions(false);
    setRoundAlreadySaved(false);
    setManualReceivedShots({});
    setRoundSetup({
      ...createInitialRoundSetup(),
      totalCompetitionHoles: defaultCompetitionHoles,
      ...buildRoundChoiceDefaults(course, defaultCompetitionHoles)
    });
    setRoundScores([]);
  };

  useEffect(() => {
    if (!showRoundSetup || !openedCourse || Number(roundSetup.totalCompetitionHoles) !== 18) {
      return;
    }

    const matchingCombination = findOfficialCombinationByRoutes(
      openedCourse,
      openedCourse?.routes?.find((route) => route.id === roundSetup.selectedRouteId) || null,
      openedCourse?.routes?.find((route) => route.id === roundSetup.secondaryRouteId) || null
    );

    if (matchingCombination && roundSetup.selectedCombinationId !== matchingCombination.id) {
      setRoundSetup((prev) => ({
        ...prev,
        selectedCombinationId: matchingCombination.id,
        selectedRouteTeeId: null,
        selectedCombinationTeeId:
          matchingCombination.tees?.find((tee) => tee.id === prev.selectedCombinationTeeId)?.id ||
          matchingCombination.tees?.[0]?.id ||
          null
      }));
      return;
    }

    if (!matchingCombination && roundSetup.selectedCombinationId) {
      setRoundSetup((prev) => ({
        ...prev,
        selectedCombinationId: null,
        selectedCombinationTeeId: null
      }));
    }
  }, [
    showRoundSetup,
    openedCourse,
    roundSetup.totalCompetitionHoles,
    roundSetup.selectedRouteId,
    roundSetup.secondaryRouteId,
    roundSetup.selectedCombinationId,
    roundSetup.selectedCombinationTeeId,
    findOfficialCombinationByRoutes
  ]);

  useEffect(() => {
    if (!showRoundSetup) return;

    const routeId = roundSetup.selectedRouteId;
    const combinationId = roundSetup.selectedCombinationId;

    if (combinationId) {
      const selectedCombination = (openedCourse?.routeCombinations || []).find(
        (combination) => combination.id === combinationId
      );
      const firstTeeId = selectedCombination?.tees?.[0]?.id || null;

      if (firstTeeId && !roundSetup.selectedCombinationTeeId) {
        setRoundSetup((prev) => ({
          ...prev,
          selectedCombinationTeeId: firstTeeId
        }));
      }
      return;
    }

    if (routeId) {
      const selectedRoute = (openedCourse?.routes || []).find((route) => route.id === routeId);
      const firstTeeId = selectedRoute?.tees?.[0]?.id || null;

      if (firstTeeId && !roundSetup.selectedRouteTeeId) {
        setRoundSetup((prev) => ({
          ...prev,
          selectedRouteTeeId: firstTeeId
        }));
      }
    }
  }, [
    showRoundSetup,
    openedCourse,
    roundSetup.selectedRouteId,
    roundSetup.selectedCombinationId,
    roundSetup.selectedRouteTeeId,
    roundSetup.selectedCombinationTeeId
  ]);

  useEffect(() => {
    if (!showRoundSetup) return;
    const nextPage = Math.max(0, Math.floor((Number(roundSetup.startHole || 1) - 1) / 3));
    setStartHolePage(nextPage);
  }, [showRoundSetup, roundSetup.startHole, roundSetup.totalCompetitionHoles]);

  const buildSingleRouteCompetitionSequence = useCallback((route, totalCompetitionHoles, startHole) => {
    const courseHoleCount = Number(route?.holesCount || 0);
    const start = Number(startHole || 1);

    if (!courseHoleCount || !route?.holes || route.holes.length === 0) return [];

    return Array.from({ length: totalCompetitionHoles }, (_, index) => {
      const relativeIndex = (start - 1 + index) % courseHoleCount;
      const baseHole = route.holes[relativeIndex];
      const competitionHoleNumber = index + 1;
      const roundNumber = Math.floor(index / courseHoleCount) + 1;
      const totalRounds = totalCompetitionHoles / courseHoleCount;

      return {
        competitionHoleNumber,
        routeId: route.id,
        routeName: route.name,
        routePosition: totalRounds > 1 ? roundNumber : 1,
        courseHoleNumber: baseHole.hole,
        physicalHoleNumber: baseHole.hole,
        par: baseHole.par,
        strokeIndex: baseHole.strokeIndex,
        sourceStrokeIndex: baseHole.strokeIndex,
        roundNumber,
        totalRounds,
        segmentLabel:
          totalRounds > 1 ? (roundNumber === 1 ? "Prime nove" : "Seconde nove") : route.name
      };
    });
  }, []);

  const getAdaptedCombinedStrokeIndex = useCallback((sourceStrokeIndex, routePosition) => {
    const normalizedIndex = Number(sourceStrokeIndex || 0);
    if (!normalizedIndex) return null;
    return (normalizedIndex - 1) * 2 + (routePosition === 1 ? 1 : 2);
  }, []);

  const usesNineHoleStrokeIndexScale = useCallback((route) => {
    const routeHoles = Array.isArray(route?.holes) ? route.holes : [];
    const strokeIndexes = routeHoles
      .map((hole) => Number(hole.strokeIndex || 0))
      .filter((value) => value > 0);

    if (strokeIndexes.length === 0) return true;

    return Math.max(...strokeIndexes) <= 9;
  }, []);

  const buildManualCombinationSequence = useCallback((frontRoute, backRoute) => {
    const frontHoles = Array.isArray(frontRoute?.holes) ? frontRoute.holes : [];
    const backHoles = Array.isArray(backRoute?.holes) ? backRoute.holes : [];
    const shouldAdaptStrokeIndex =
      usesNineHoleStrokeIndexScale(frontRoute) && usesNineHoleStrokeIndexScale(backRoute);

    if (frontHoles.length === 0 || backHoles.length === 0) return [];

    const frontSequence = frontHoles.map((hole, index) => ({
      competitionHoleNumber: index + 1,
      routeId: frontRoute.id,
      routeName: frontRoute.name,
      routePosition: 1,
      courseHoleNumber: hole.hole,
      physicalHoleNumber: hole.hole,
      par: hole.par,
      strokeIndex: shouldAdaptStrokeIndex
        ? getAdaptedCombinedStrokeIndex(hole.strokeIndex, 1)
        : hole.strokeIndex,
      sourceStrokeIndex: hole.strokeIndex,
      roundNumber: 1,
      totalRounds: 2,
      segmentLabel: "Prime nove"
    }));

    const backSequence = backHoles.map((hole, index) => ({
      competitionHoleNumber: index + 10,
      routeId: backRoute.id,
      routeName: backRoute.name,
      routePosition: 2,
      courseHoleNumber: hole.hole,
      physicalHoleNumber: hole.hole,
      par: hole.par,
      strokeIndex: shouldAdaptStrokeIndex
        ? getAdaptedCombinedStrokeIndex(hole.strokeIndex, 2)
        : hole.strokeIndex,
      sourceStrokeIndex: hole.strokeIndex,
      roundNumber: 2,
      totalRounds: 2,
      segmentLabel: "Seconde nove"
    }));

    return [...frontSequence, ...backSequence];
  }, [getAdaptedCombinedStrokeIndex, usesNineHoleStrokeIndexScale]);

  const buildOfficialCombinationSequence = useCallback((combination, routes) => {
    const routeMap = new Map((Array.isArray(routes) ? routes : []).map((route) => [route.id, route]));

    return (Array.isArray(combination?.holes) ? combination.holes : []).map((hole) => {
      const relatedRoute = routeMap.get(hole.routeId);
      const routePosition = Number(hole.routePosition || 1);

      return {
        competitionHoleNumber: hole.roundHoleNumber,
        routeId: hole.routeId,
        routeName: relatedRoute?.name || `Percorso ${routePosition}`,
        routePosition,
        courseHoleNumber: hole.physicalHoleNumber,
        physicalHoleNumber: hole.physicalHoleNumber,
        par: hole.par,
        strokeIndex: hole.strokeIndex,
        sourceStrokeIndex: hole.sourceStrokeIndex,
        roundNumber: routePosition,
        totalRounds: 2,
        segmentLabel: routePosition === 1 ? "Prime nove" : "Seconde nove",
        displayLabel: hole.displayLabel
      };
    });
  }, []);

  const getCompetitionSequence = useCallback((course, setup) => {
    const routes = Array.isArray(course?.routes) ? course.routes : [];
    const selectedRoute =
      routes.find((route) => route.id === setup.selectedRouteId) || routes[0] || null;
    const secondaryRoute =
      routes.find((route) => route.id === setup.secondaryRouteId) || null;
    const routeCombinations = Array.isArray(course?.routeCombinations)
      ? course.routeCombinations
      : [];
    const officialCombination =
      routeCombinations.find((combination) => combination.id === setup.selectedCombinationId) ||
      findOfficialCombinationByRoutes(course, selectedRoute, secondaryRoute);

    if (Number(setup.totalCompetitionHoles) === 18 && officialCombination) {
      return rotateCompetitionSequence(
        buildOfficialCombinationSequence(officialCombination, routes),
        Number(setup.startHole || 1)
      );
    }

    if (
      Number(setup.totalCompetitionHoles) === 18 &&
      selectedRoute &&
      secondaryRoute &&
      Number(selectedRoute.holesCount) === 9 &&
      Number(secondaryRoute.holesCount) === 9 &&
      selectedRoute.id !== secondaryRoute.id
    ) {
      return rotateCompetitionSequence(
        buildManualCombinationSequence(selectedRoute, secondaryRoute),
        Number(setup.startHole || 1)
      );
    }

    if (!selectedRoute) return [];

    return buildSingleRouteCompetitionSequence(
      selectedRoute,
      Number(setup.totalCompetitionHoles),
      Number(setup.startHole)
    );
  }, [
    buildManualCombinationSequence,
    buildOfficialCombinationSequence,
    buildSingleRouteCompetitionSequence,
    findOfficialCombinationByRoutes
  ]);

  const competitionHoles = useMemo(() => {
    if (!openedCourse) return [];

    return getCompetitionSequence(openedCourse, roundSetup);
  }, [openedCourse, roundSetup, getCompetitionSequence]);

  const roundSetupTotalPar = useMemo(
    () => competitionHoles.reduce((sum, hole) => sum + Number(hole.par || 0), 0),
    [competitionHoles]
  );

  const startRound = () => {
    const startingScores = competitionHoles.map((hole) => Number(hole.par));
    setRoundScores(startingScores);
    setRoundAlreadySaved(false);
    setManualReceivedShots({});
    setShowRoundSetup(false);
  };

  const closeCourse = () => {
    setOpenedCourse(null);
    setShowRoundSetup(false);
    setActiveSheet(null);
    setSheetClosing(false);
    setRoundScores([]);
    setShowRoundsHistory(false);
    setRoundAlreadySaved(false);
    setManualReceivedShots({});
    setRoundSetup(createInitialRoundSetup());
  };

  const getReceivedShots = useCallback((playerHcp, strokeIndex) => {
    const hcp = Math.floor(Number(playerHcp || 0));
    const si = Number(strokeIndex || 0);

    if (hcp <= 0 || si <= 0) return 0;

    return Math.max(0, Math.floor((hcp - si) / 18) + 1);
  }, []);

  const getAutomaticReceivedShots = useCallback(
    (playerHcp, strokeIndex) => {
      return Math.min(3, getReceivedShots(playerHcp, strokeIndex));
    },
    [getReceivedShots]
  );

  const getEffectiveReceivedShots = useCallback(
    (index, playerHcp, strokeIndex) => {
      const manualValue = manualReceivedShots[index];

      if (manualValue !== undefined && manualValue !== null && manualValue !== "") {
        return Number(manualValue);
      }

      return getAutomaticReceivedShots(playerHcp, strokeIndex);
    },
    [manualReceivedShots, getAutomaticReceivedShots]
  );

  const getStablefordPoints = useCallback((par, strokesMade, receivedShots) => {
    const parValue = Number(par || 0);
    const strokes = Number(strokesMade || 0);
    const shots = Number(receivedShots || 0);

    if (!strokes) return 0;

    return Math.max(0, 2 + parValue + shots - strokes);
  }, []);

  const getManualCycleValues = (autoValue) => {
    if (autoValue === 0) return [1, 2, 3];
    if (autoValue === 1) return [2, 3, 0];
    if (autoValue === 2) return [3, 0, 1];
    return [0, 1, 2];
  };

  const cycleReceivedShotsValue = (index, autoValue) => {
    const manualValue = manualReceivedShots[index];
    const cycleValues = getManualCycleValues(autoValue);

    if (manualValue === undefined) {
      setManualReceivedShots((prev) => ({
        ...prev,
        [index]: cycleValues[0]
      }));
      setRoundAlreadySaved(false);
      return;
    }

    if (manualValue === cycleValues[0]) {
      setManualReceivedShots((prev) => ({
        ...prev,
        [index]: cycleValues[1]
      }));
      setRoundAlreadySaved(false);
      return;
    }

    if (manualValue === cycleValues[1]) {
      setManualReceivedShots((prev) => ({
        ...prev,
        [index]: cycleValues[2]
      }));
      setRoundAlreadySaved(false);
      return;
    }

    setManualReceivedShots((prev) => {
      const updated = { ...prev };
      delete updated[index];
      return updated;
    });
    setRoundAlreadySaved(false);
  };

  const stablefordTotal = useMemo(() => {
    if (!competitionHoles.length) return 0;

    return competitionHoles.reduce((sum, hole, index) => {
      const receivedShots = getEffectiveReceivedShots(
        index,
        userProfile.hcp,
        hole.strokeIndex
      );
      const points = getStablefordPoints(
        hole.par,
        roundScores[index],
        receivedShots
      );
      return sum + points;
    }, 0);
  }, [
    competitionHoles,
    roundScores,
    userProfile.hcp,
    getEffectiveReceivedShots,
    getStablefordPoints
  ]);

  const netTotal = useMemo(() => {
    if (!competitionHoles.length) return 0;

    return competitionHoles.reduce((sum, hole, index) => {
      const receivedShots = getEffectiveReceivedShots(
        index,
        userProfile.hcp,
        hole.strokeIndex
      );
      const strokes = Number(roundScores[index] || 0);
      if (!strokes) return sum;
      return sum + (strokes - receivedShots);
    }, 0);
  }, [competitionHoles, roundScores, userProfile.hcp, getEffectiveReceivedShots]);

  const estimatedHcpAfterRound = useMemo(() => {
    if (!competitionHoles.length || stablefordTotal === 0) return userProfile.hcp;

    let delta = 0;

    if (stablefordTotal >= 37) {
      delta = -Math.min(1.8, (stablefordTotal - 36) * 0.1);
    } else if (stablefordTotal <= 30) {
      delta = Math.min(1.2, (31 - stablefordTotal) * 0.05);
    }

    const next = Math.max(0, Number(userProfile.hcp) + delta);
    return Number(next.toFixed(1));
  }, [competitionHoles.length, stablefordTotal, userProfile.hcp]);

  useEffect(() => {
    if (previousHcpRef.current === null) {
      previousHcpRef.current = userProfile.hcp;
      return;
    }

    if (previousHcpRef.current !== userProfile.hcp) {
      setHcpHighlightActive(true);
      const timeoutId = window.setTimeout(() => {
        setHcpHighlightActive(false);
      }, 320);
      previousHcpRef.current = userProfile.hcp;

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [userProfile.hcp]);

  useEffect(() => {
    if (previousEstimatedHcpRef.current === null) {
      previousEstimatedHcpRef.current = estimatedHcpAfterRound;
      return;
    }

    if (previousEstimatedHcpRef.current !== estimatedHcpAfterRound) {
      setEstimatedHcpHighlightActive(true);
      const timeoutId = window.setTimeout(() => {
        setEstimatedHcpHighlightActive(false);
      }, 320);
      previousEstimatedHcpRef.current = estimatedHcpAfterRound;

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [estimatedHcpAfterRound]);

  const updateRoundScore = (index, value) => {
    const updated = [...roundScores];
    updated[index] = value;
    setRoundScores(updated);
    setRoundAlreadySaved(false);
  };

  const getRoundScoreBounds = (index) => {
    const holePar = Number(competitionHoles[index]?.par || 0);
    const min = 1;
    const max = Math.max(min, holePar + 4);

    return { min, max };
  };

  const handleScoreInputChange = (index, value) => {
    if (value === "") {
      updateRoundScore(index, "");
      return;
    }

    const numericValue = value.replace(/\D/g, "");
    updateRoundScore(index, numericValue);
  };

  const normalizeScoreInput = (index) => {
    const rawValue = roundScores[index];
    const { min, max } = getRoundScoreBounds(index);

    if (rawValue === "") {
      updateRoundScore(index, min);
      return;
    }

    let value = Number(rawValue);

    if (Number.isNaN(value)) {
      updateRoundScore(index, min);
      return;
    }

    if (value < min) value = min;
    if (value > max) value = max;

    updateRoundScore(index, value);
  };

  const adjustRoundScore = (index, delta) => {
    const { min, max } = getRoundScoreBounds(index);
    const rawValue = roundScores[index];
    const isEmpty =
      rawValue === "" || rawValue === null || typeof rawValue === "undefined";
    const currentValue = isEmpty ? min : Number(rawValue);

    if (delta < 0) {
      updateRoundScore(index, currentValue <= min ? max : currentValue - 1);
      return;
    }

    if (delta > 0) {
      updateRoundScore(index, currentValue >= max ? min : currentValue + 1);
    }
  };

  const saveRound = async () => {
    if (!supabase || !session?.user || !openedCourse || !competitionHoles.length || roundAlreadySaved) return;

    const formattedDate = formatDateItalian(Date.now());
    const cleanCompetitionName = sanitizeRoundName(roundSetup.competitionName);
    const savedName =
      cleanCompetitionName !== ""
        ? `${cleanCompetitionName}_${formattedDate}`
        : `Giro_${formattedDate}`;

    const { data, error } = await supabase
      .from("rounds")
      .insert({
        user_id: session.user.id,
        course_id: openedCourse.id,
        saved_name: savedName,
        competition_name: cleanCompetitionName || "Giro",
        formatted_date: formattedDate,
        gross_total: grossTotal,
        net_total: netTotal,
        stableford_total: stablefordTotal,
        estimated_hcp_after_round: estimatedHcpAfterRound,
        scores: roundScores,
        manual_received_shots: manualReceivedShots,
        total_competition_holes: roundSetup.totalCompetitionHoles,
        start_hole: roundSetup.startHole,
        player_hcp: userProfile.hcp
      })
      .select("*")
      .single();

    if (error) {
      setAuthError(error.message || "Errore nel salvataggio del giro.");
      return;
    }

    const newRound = {
      id: data.id,
      savedName: data.saved_name,
      competitionName: data.competition_name,
      courseId: data.course_id,
      courseName: openedCourse.name,
      createdAt: data.created_at,
      formattedDate: data.formatted_date,
      playerHcp: data.player_hcp,
      totalCompetitionHoles: data.total_competition_holes,
      startHole: data.start_hole,
      grossTotal: data.gross_total,
      netTotal: data.net_total,
      stablefordTotal: data.stableford_total,
      estimatedHcpAfterRound: data.estimated_hcp_after_round,
      scores: data.scores || [],
      manualReceivedShots: data.manual_received_shots || {}
    };

    setSavedRounds((prev) => [newRound, ...prev].slice(0, MAX_SAVED_ROUNDS));
    setRoundAlreadySaved(true);
    setShowRoundsHistory(true);
  };

  const roundsForOpenedCourse = openedCourse
    ? savedRounds.filter((round) => round.courseId === openedCourse.id)
    : [];

  const openHistoryFromMenu = () => {
    setShowRoundsHistory(false);
    setSheetClosing(false);
    flushSync(() => {
      setActiveSheet("history");
    });
  };

  const closeHistoryRoundDetail = () => {
    setHistoryRoundDetailTouchStartY(null);
    setSelectedHistoryRound(null);
  };

  const openPrivacyScreen = () => {
    closeActiveSheet();
    window.setTimeout(() => {
      setShowPrivacyScreen(true);
    }, 220);
  };

  const openHcpEditor = () => {
    setPlayerNameDraft(String(userProfile.playerName || ""));
    setHcpDraft(String(userProfile.hcp));
    setSheetClosing(false);
    flushSync(() => {
    setActiveSheet("hcp");
  });
  };

  const deleteRound = async (roundId) => {
    if (supabase && session?.user) {
      await supabase.from("rounds").delete().eq("id", roundId).eq("user_id", session.user.id);
    }

    setSavedRounds((prev) => prev.filter((round) => round.id !== roundId));
    setSelectedHistoryRound((prev) => (prev?.id === roundId ? null : prev));
  };

  const getHistoryRoundCompetitionHoles = useCallback(
    (round) => {
      if (!round) return [];

      const relatedCourse = savedCourses.find((course) => course.id === round.courseId);
      if (!relatedCourse) return [];

      return getCompetitionSequence(
        relatedCourse,
        {
          ...createInitialRoundSetup(),
          totalCompetitionHoles: Number(round.totalCompetitionHoles || 18),
          startHole: Number(round.startHole || 1),
          selectedRouteId: relatedCourse.primaryRouteId || relatedCourse.routes?.[0]?.id || null
        }
      );
    },
    [savedCourses, getCompetitionSequence]
  );

  const getHistoryRoundReceivedShots = useCallback(
    (round, hole, index) => {
      if (!round || !hole) return 0;

      const manualValue = round.manualReceivedShots?.[index];
      if (manualValue !== undefined && manualValue !== null && manualValue !== "") {
        return Number(manualValue);
      }

      return getAutomaticReceivedShots(round.playerHcp, hole.strokeIndex);
    },
    [getAutomaticReceivedShots]
  );

  const handleAuthSubmit = async () => {
    if (!supabase) {
      setAuthError("Configurazione Supabase mancante.");
      return;
    }

    if (otpCooldownSeconds > 0) {
      setAuthError(
        `Attendi ${otpCooldownSeconds}s prima di richiedere un nuovo codice.`
      );
      setAuthMessage("");
      return;
    }

    const email = authForm.email.trim();

    if (!email) {
      setAuthError("Inserisci l'email.");
      setAuthMessage("");
      return;
    }

    setAuthError("");
    setAuthMessage("");
    setAuthSubmitting(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    });

    if (error) {
      setAuthError(getFriendlyAuthErrorMessage(error.message));
      setAuthSubmitting(false);
      return;
    }

    try {
      localStorage.setItem(LAST_LOGIN_EMAIL_STORAGE_KEY, email);
    } catch (storageError) {}

    setAuthMessage("Controlla la tua email e inserisci il codice ricevuto.");
    setOtpCode("");
    setAuthStep("verify");
    setOtpCooldownSeconds(60);
    setAuthSubmitting(false);
  };

  const handleVerifyOtp = async () => {
    if (!supabase) {
      setAuthError("Codice non valido o scaduto");
      return;
    }

    const email = authForm.email.trim();
    const token = otpCode.trim();

    if (!token) {
      setAuthError("Inserisci il codice.");
      setAuthMessage("");
      return;
    }

    setAuthError("");
    setAuthMessage("");
    setAuthSubmitting(true);

    const {
      data: { user },
      error
    } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email"
    });

    if (error) {
      setAuthError("Codice non valido o scaduto");
      setAuthSubmitting(false);
      return;
    }

    setAuthMessage("Accesso completato");
    if (user?.email) {
      setAuthForm({
        email: user.email
      });
    }
    setAuthSubmitting(false);
  };

  const handleResendOtp = async () => {
    setAuthError("");
    setAuthMessage("");
    await handleAuthSubmit();
  };

  const handleLogout = async () => {
    if (!supabase) return;
    const emailToKeep = session?.user?.email || authForm.email || "";
    await supabase.auth.signOut();
    setAuthForm({
      email: emailToKeep
    });
    setOnboardingForm({
      playerName: "",
      hcp: ""
    });
    setAuthStep("request");
    setOtpCode("");
    setAuthError("");
    setAuthMessage("");
    setAppReady(false);
    setNeedsOnboarding(false);
    setOtpCooldownSeconds(0);
    setActiveSheet(null);
    setSheetClosing(false);
  };

  const closeHcpEditor = () => {
    closeActiveSheet();
  };

  const saveHcp = async () => {
    const cleanName = playerNameDraft.trim();
    const cleanValue = String(hcpDraft).replace(",", ".").trim();
    const numeric = Number(cleanValue);

    if (!cleanName || Number.isNaN(numeric) || numeric < 0) return;

    if (supabase && session?.user) {
      const nextProfile = {
        player_name: cleanName,
        hcp: Number(numeric.toFixed(1))
      };

      const { error } = await supabase
        .from("profiles")
        .update(nextProfile)
        .eq("id", session.user.id);

      if (error) {
        setAuthError(error.message || "Errore nel salvataggio del profilo.");
        return;
      }

      setUserProfile((prev) => ({
        ...prev,
        playerName: cleanName,
        hcp: Number(numeric.toFixed(1))
      }));

      await supabase.auth.updateUser({
        data: {
          ...(session.user.user_metadata || {}),
          player_name: cleanName,
          full_name: cleanName,
          name: cleanName
        }
      });
    }

    closeHcpEditor();
  };

  const handleOnboardingSubmit = async () => {
    if (!supabase || !session?.user) return;

    const cleanName = onboardingForm.playerName.trim();
    const cleanHcpValue = String(onboardingForm.hcp).replace(",", ".").trim();
    const numericHcp = cleanHcpValue === "" ? null : Number(cleanHcpValue);

    if (!cleanName) {
      setAuthError("Inserisci il nome del giocatore.");
      return;
    }

    if (numericHcp !== null && (Number.isNaN(numericHcp) || numericHcp < 0)) {
      setAuthError("Inserisci un HCP valido.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");

    const nextHcp = numericHcp === null ? 36 : Number(numericHcp.toFixed(1));
    const { error } = await supabase.from("profiles").insert({
      id: session.user.id,
      player_name: cleanName,
      hcp: nextHcp,
      role: "user"
    });

    if (error) {
      setAuthError(error.message || "Errore nel salvataggio del profilo.");
      setAuthSubmitting(false);
      return;
    }

    setUserProfile({
      playerName: cleanName,
      hcp: nextHcp,
      role: "user"
    });

    await supabase.auth.updateUser({
      data: {
        ...(session.user.user_metadata || {}),
        player_name: cleanName,
        full_name: cleanName,
        name: cleanName
      }
    });

    setNeedsOnboarding(false);
    setAppReady(true);
    setAuthSubmitting(false);
  };

  const openCourseReport = (course) => {
    setCourseReportTarget(course);
    setCourseReportMessage("");
    setCourseReportFeedback("");
  };

  const closeCourseReport = () => {
    setCourseReportTarget(null);
    setCourseReportMessage("");
    setCourseReportSubmitting(false);
    setCourseReportFeedback("");
  };

  const submitCourseReport = async () => {
    if (!supabase || !session?.user || !courseReportTarget) return;

    const cleanMessage = normalizeWhitespace(courseReportMessage);
    if (!cleanMessage) {
      setCourseReportFeedback("Inserisci una breve descrizione dell'anomalia.");
      return;
    }

    setCourseReportSubmitting(true);
    setCourseReportFeedback("");

    const { error } = await supabase.from("club_reports").insert({
      club_id: courseReportTarget.id,
      reported_by: session.user.id,
      message: cleanMessage
    });

    if (error) {
      setCourseReportFeedback(error.message || "Errore nell'invio della segnalazione.");
      setCourseReportSubmitting(false);
      return;
    }

    setCourseReportSubmitting(false);
    setCourseReportFeedback("Segnalazione inviata.");
    window.setTimeout(() => {
      closeCourseReport();
    }, 700);
  };

  const closeActiveSheet = () => {
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }

    setSheetClosing(true);
    setSheetTouchStartY(null);

    window.setTimeout(() => {
      setActiveSheet(null);
      setSheetClosing(false);
      setPlayerNameDraft("");
      setHcpDraft("");
    }, SHEET_CLOSE_DURATION);
  };

  const handleSheetTouchStart = (event) => {
    setSheetTouchStartY(event.touches[0]?.clientY ?? null);
  };

  const handleSheetTouchEnd = (event) => {
    if (sheetTouchStartY === null) return;

    const touchEndY = event.changedTouches[0]?.clientY ?? sheetTouchStartY;
    if (touchEndY - sheetTouchStartY > 70) {
      closeActiveSheet();
    } else {
      setSheetTouchStartY(null);
    }
  };

  const handleHistoryRoundDetailTouchStart = (event) => {
    setHistoryRoundDetailTouchStartY(event.touches[0]?.clientY ?? null);
  };

  const handleHistoryRoundDetailTouchEnd = (event) => {
    if (historyRoundDetailTouchStartY === null) return;

    const touchEndY =
      event.changedTouches[0]?.clientY ?? historyRoundDetailTouchStartY;
    if (touchEndY - historyRoundDetailTouchStartY > 70) {
      closeHistoryRoundDetail();
    } else {
      setHistoryRoundDetailTouchStartY(null);
    }
  };

  const sheetModal = activeSheet ? (
    <div
      onClick={closeActiveSheet}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: colors.overlay,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
        boxSizing: "border-box",
        zIndex: 40
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleSheetTouchStart}
        onTouchEnd={handleSheetTouchEnd}
        style={{
          backgroundColor: colors.card,
          padding: "16px",
          borderRadius: "18px",
          width: "100%",
          maxWidth: "382px",
          border: `1px solid ${colors.border}`,
          boxSizing: "border-box",
          fontFamily: appFont,
          transform: sheetClosing
            ? "translateY(18px) scale(0.985)"
            : "translateY(0) scale(1)",
          opacity: sheetClosing ? 0 : 1,
          transition: sheetClosing
            ? `transform ${SHEET_CLOSE_DURATION}ms cubic-bezier(0.4, 0, 1, 1), opacity ${SHEET_CLOSE_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`
            : "none",
          willChange: "transform, opacity",
          touchAction: "pan-y"
        }}
      >
        <div
          style={{
            width: "38px",
            height: "4px",
            borderRadius: "999px",
            backgroundColor: colors.borderStrong,
            opacity: 0.7,
            margin: "0 auto 12px auto"
          }}
        />

        {activeSheet === "menu" && (
          <>
            <div
              style={{
                paddingTop: "2px"
              }}
            >
              <button
                onClick={openHcpEditor}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 0",
                  border: "none",
                  background: "transparent",
                  color: colors.text,
                  fontSize: "15px",
                  cursor: "pointer",
                  fontFamily: appFont
                }}
              >
                Giocatore
              </button>

              <button
                onClick={openHistoryFromMenu}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 0 2px 0",
                  border: "none",
                  background: "transparent",
                  color: colors.text,
                  fontSize: "15px",
                  cursor: "pointer",
                  fontFamily: appFont
                }}
              >
                I tuoi giri
              </button>
            </div>

            <div
              style={{
                paddingTop: "16px",
                paddingBottom: "4px"
              }}
            >
              <div style={{ fontSize: "15px", marginBottom: "8px" }}>Tema</div>

              <div style={{ display: "flex", gap: "8px", marginLeft: "1px" }}>
                <button
                  onClick={() => setTheme("light")}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "10px",
                    border:
                      theme === "light"
                        ? `1px solid ${colors.green}`
                        : `1px solid ${colors.borderStrong}`,
                    backgroundColor:
                      theme === "light" ? colors.greenDark : colors.inputBg,
                    color: colors.text,
                    cursor: "pointer",
                    fontFamily: appFont
                  }}
                >
                  Chiaro
                </button>

                <button
                  onClick={() => setTheme("dark")}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "10px",
                    border:
                      theme === "dark"
                        ? `1px solid ${colors.green}`
                        : `1px solid ${colors.borderStrong}`,
                    backgroundColor:
                      theme === "dark" ? colors.greenDark : colors.inputBg,
                    color: colors.text,
                    cursor: "pointer",
                    fontFamily: appFont
                  }}
                >
                  Scuro
                </button>
              </div>

              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  gap: "8px",
                  marginLeft: "1px"
                }}
              >
                <button
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "10px",
                    border: `1px solid ${colors.green}`,
                    backgroundColor: colors.greenDark,
                    color: colors.text,
                    cursor: "default",
                    fontFamily: appFont
                  }}
                >
                  Italiano
                </button>

                <button
                  disabled
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "10px",
                    border: `1px solid ${colors.borderStrong}`,
                    backgroundColor: colors.inputBg,
                    color: colors.subtext,
                    cursor: "not-allowed",
                    fontFamily: appFont,
                    opacity: 0.8
                  }}
                >
                  English
                </button>
              </div>
            </div>

            <div
              style={{
                paddingTop: "16px",
                paddingBottom: "2px"
              }}
            >
              <button
                onClick={openPrivacyScreen}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: colors.subtext,
                  opacity: 0.78,
                  fontSize: "14px",
                  cursor: "pointer",
                  fontFamily: appFont
                }}
              >
                Privacy Policy
              </button>
            </div>

            <div style={{ paddingTop: "34px" }}>
              <button
                onClick={handleLogout}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 0 2px 0",
                  border: "none",
                  background: "transparent",
                  color: colors.text,
                  fontSize: "15px",
                  cursor: "pointer",
                  fontFamily: appFont
                }}
              >
                Esci
              </button>
            </div>

            <button onClick={closeActiveSheet} style={modalCloseButtonStyle}>
              Chiudi
            </button>
          </>
        )}

        {activeSheet === "hcp" && (
          <>
            <h3
              style={{
                marginTop: 0,
                marginBottom: "8px",
                fontSize: "22px",
                fontWeight: 700
              }}
            >
              Modifica profilo
            </h3>

            <p
              style={{
                color: colors.subtext,
                fontSize: "14px",
                marginTop: 0,
                marginBottom: "14px",
                lineHeight: 1.4
              }}
            >
              Aggiorna il nome e il tuo HCP.
            </p>

            <input
              type="text"
              value={playerNameDraft}
              onChange={(e) => setPlayerNameDraft(e.target.value)}
              placeholder="Il tuo nome"
              style={{
                width: "100%",
                padding: "13px 14px",
                backgroundColor: colors.inputBg,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                boxSizing: "border-box",
                outline: "none",
                fontSize: "16px",
                fontFamily: appFont,
                marginBottom: "12px"
              }}
            />

            <input
              type="text"
              inputMode="decimal"
              value={hcpDraft}
              onChange={(e) => setHcpDraft(e.target.value)}
              placeholder="Es. 36"
              style={{
                width: "100%",
                padding: "13px 14px",
                backgroundColor: colors.inputBg,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                boxSizing: "border-box",
                outline: "none",
                fontSize: "16px",
                fontFamily: appFont
              }}
            />

            <button onClick={saveHcp} style={{
              marginTop: "20px",
              width: "100%",
              padding: "13px",
              backgroundColor: colors.green,
              border: "none",
              color: isLight ? "#08351c" : "black",
              fontWeight: 700,
              borderRadius: "12px",
              cursor: "pointer",
              opacity: 1,
              fontFamily: appFont,
              fontSize: "15px"
            }}>
              Salva
            </button>

            <button onClick={closeActiveSheet} style={modalCloseButtonStyle}>
              Chiudi
            </button>
          </>
        )}

        {activeSheet === "history" && (
          <>
            {savedRounds.length === 0 ? (
              <div
                style={{
                  color: colors.subtext,
                  lineHeight: 1.5,
                  backgroundColor: colors.cardSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "14px",
                  padding: "16px"
                }}
              >
                Nessun giro salvato per ora.
              </div>
            ) : (
              savedRounds.map((round) => (
                <div
                  key={round.id}
                  onClick={() => {
                    setActiveSheet(null);
                    setSelectedHistoryRound(round);
                  }}
                  style={{
                    backgroundColor: colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "16px",
                    padding: "18px",
                    marginBottom: "12px",
                    cursor: "pointer"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "12px"
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 700 }}>
                      {round.savedName}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRound(round.id);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: colors.subtext,
                        cursor: "pointer",
                        fontFamily: appFont,
                        fontSize: "12px",
                        padding: 0
                      }}
                    >
                      Elimina
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: "4px",
                      color: colors.subtext,
                      fontSize: "12px"
                    }}
                  >
                    {round.courseName} • {round.formattedDate}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginTop: "12px"
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.pillBg,
                        border: `1px solid ${colors.pillBorder}`,
                        fontSize: "13px"
                      }}
                    >
                      L {round.grossTotal}
                    </div>
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.pillBg,
                        border: `1px solid ${colors.pillBorder}`,
                        fontSize: "13px"
                      }}
                    >
                      N {round.netTotal}
                    </div>
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.greenDark,
                        border: `1px solid ${colors.greenBorder}`,
                        color: colors.green,
                        fontSize: "13px"
                      }}
                    >
                      S {round.stablefordTotal}
                    </div>
                  </div>
                </div>
              ))
            )}

            <button onClick={closeActiveSheet} style={modalCloseButtonStyle}>
              Chiudi
            </button>
          </>
        )}
      </div>
    </div>
  ) : null;
  const hcpEditorModal = null;
  const globalRoundsHistoryModal = null;

  const historyRoundDetailModal = selectedHistoryRound ? (
    <div
      onClick={closeHistoryRoundDetail}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: colors.overlay,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
        boxSizing: "border-box",
        zIndex: 42
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleHistoryRoundDetailTouchStart}
        onTouchEnd={handleHistoryRoundDetailTouchEnd}
        style={{
          backgroundColor: colors.card,
          padding: "18px",
          borderRadius: "18px",
          width: "100%",
          maxWidth: "390px",
          maxHeight: "85vh",
          overflowY: "auto",
          border: `1px solid ${colors.border}`,
          boxSizing: "border-box",
          fontFamily: appFont
        }}
      >
        <div
          style={{
            width: "38px",
            height: "4px",
            borderRadius: "999px",
            backgroundColor: colors.borderStrong,
            opacity: 0.7,
            margin: "0 auto 12px auto"
          }}
        />

        <div style={{ fontSize: "18px", fontWeight: 700 }}>
          {selectedHistoryRound.savedName}
        </div>
        <div
          style={{
            marginTop: "4px",
            color: colors.subtext,
            fontSize: "13px",
            lineHeight: 1.5
          }}
        >
          {selectedHistoryRound.courseName} • {selectedHistoryRound.formattedDate}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "8px",
            marginTop: "14px"
          }}
        >
          <div
            style={{
              padding: "9px 10px",
              borderRadius: "12px",
              backgroundColor: colors.pillBg,
              border: `1px solid ${colors.pillBorder}`,
              fontSize: "12px",
              textAlign: "center",
              whiteSpace: "nowrap"
            }}
          >
            Lordo {selectedHistoryRound.grossTotal}
          </div>
          <div
            style={{
              padding: "9px 10px",
              borderRadius: "12px",
              backgroundColor: colors.pillBg,
              border: `1px solid ${colors.pillBorder}`,
              fontSize: "12px",
              textAlign: "center",
              whiteSpace: "nowrap"
            }}
          >
            Netto {selectedHistoryRound.netTotal}
          </div>
          <div
            style={{
              padding: "9px 10px",
              borderRadius: "12px",
              backgroundColor: colors.greenDark,
              border: `1px solid ${colors.greenBorder}`,
              color: colors.green,
              fontSize: "12px",
              textAlign: "center",
              whiteSpace: "nowrap"
            }}
          >
            Stableford {selectedHistoryRound.stablefordTotal}
          </div>
        </div>

        <div
          style={{
            marginTop: "16px",
            overflowX: "auto",
            border: `1px solid ${colors.border}`,
            borderRadius: "14px"
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "472px",
              fontSize: "13px"
            }}
          >
            <thead>
              <tr style={{ backgroundColor: colors.cardSecondary, color: colors.subtext }}>
                <th style={{ textAlign: "left", padding: "12px" }}>Buca</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Par</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Colpi</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Netto</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Pt</th>
              </tr>
            </thead>
            <tbody>
              {getHistoryRoundCompetitionHoles(selectedHistoryRound).map((hole, index) => {
                const receivedShots = getHistoryRoundReceivedShots(
                  selectedHistoryRound,
                  hole,
                  index
                );
                const strokes = Number(selectedHistoryRound.scores?.[index] || 0);
                const netScore = strokes ? strokes - receivedShots : "—";
                const points = getStablefordPoints(hole.par, strokes, receivedShots);

                return (
                  <tr
                    key={`${selectedHistoryRound.id}-${hole.competitionHoleNumber}-${index}`}
                    style={{
                      borderTop: `1px solid ${colors.border}`
                    }}
                  >
                    <td style={{ padding: "12px" }}>{hole.competitionHoleNumber}</td>
                    <td style={{ padding: "12px" }}>{hole.par}</td>
                    <td style={{ padding: "12px" }}>{strokes || "—"}</td>
                    <td style={{ padding: "12px" }}>{netScore}</td>
                    <td style={{ padding: "12px", color: colors.green, fontWeight: 600 }}>
                      {points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button onClick={closeHistoryRoundDetail} style={modalCloseButtonStyle}>
          Chiudi
        </button>
      </div>
    </div>
  ) : null;

  const courseReportModal = courseReportTarget ? (
    <div
      onClick={closeCourseReport}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: colors.overlay,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
        boxSizing: "border-box",
        zIndex: 43
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: colors.card,
          padding: "18px",
          borderRadius: "18px",
          width: "100%",
          maxWidth: "390px",
          border: `1px solid ${colors.border}`,
          boxSizing: "border-box",
          fontFamily: appFont
        }}
      >
        <div
          style={{
            fontSize: "20px",
            fontWeight: 700
          }}
        >
          Invia segnalazione
        </div>
        <div
          style={{
            marginTop: "6px",
            color: colors.subtext,
            fontSize: "14px",
            lineHeight: 1.5
          }}
        >
          {courseReportTarget.name}
        </div>

        <textarea
          value={courseReportMessage}
          onChange={(e) => setCourseReportMessage(e.target.value)}
          placeholder="Descrivi brevemente cosa non torna"
          style={{
            width: "100%",
            minHeight: "120px",
            marginTop: "16px",
            padding: "13px 14px",
            backgroundColor: colors.inputBg,
            border: `1px solid ${colors.inputBorder}`,
            borderRadius: "12px",
            color: colors.text,
            boxSizing: "border-box",
            outline: "none",
            fontSize: "15px",
            fontFamily: appFont,
            resize: "vertical"
          }}
        />

        {courseReportFeedback && (
          <div
            style={{
              marginTop: "12px",
              color:
                courseReportFeedback === "Segnalazione inviata."
                  ? colors.green
                  : "#d64545",
              fontSize: "13px",
              lineHeight: 1.5
            }}
          >
            {courseReportFeedback}
          </div>
        )}

        <button
          onClick={submitCourseReport}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "13px",
            backgroundColor: colors.green,
            border: "none",
            color: isLight ? "#08351c" : "black",
            fontWeight: 700,
            borderRadius: "12px",
            cursor: "pointer",
            opacity: 1,
            fontFamily: appFont,
            fontSize: "15px"
          }}
        >
          {courseReportSubmitting ? "Invio in corso..." : "Invia segnalazione"}
        </button>

        <button onClick={closeCourseReport} style={modalCloseButtonStyle}>
          Chiudi
        </button>
      </div>
    </div>
  ) : null;

  const overlayPortal =
    typeof document !== "undefined"
      ? createPortal(
          <>
            {sheetModal}
            {globalRoundsHistoryModal}
            {historyRoundDetailModal}
            {hcpEditorModal}
            {courseReportModal}
          </>,
          document.body
        )
      : null;

  const titleStyle = {
    fontSize: "22px",
    fontWeight: 600,
    letterSpacing: "0.2px",
    marginTop: "28px",
    marginBottom: "14px",
    fontFamily: appFont
  };

  const primaryButtonStyle = (enabled = true) => ({
    marginTop: "20px",
    width: "100%",
    padding: "13px",
    backgroundColor: enabled ? colors.green : isLight ? "#bfd9c9" : "#244233",
    border: "none",
    color: enabled ? (isLight ? "#08351c" : "black") : isLight ? "#496457" : "black",
    fontWeight: 700,
    borderRadius: "12px",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.7,
    fontFamily: appFont,
    fontSize: "15px"
  });

  const secondaryButtonStyle = {
    marginTop: "10px",
    width: "100%",
    padding: "13px",
    backgroundColor: colors.cardSecondary,
    border: `1px solid ${colors.border}`,
    color: colors.text,
    borderRadius: "12px",
    cursor: "pointer",
    fontFamily: appFont,
    fontSize: "15px"
  };

  const subtleButtonStyle = {
    marginTop: "10px",
    width: "100%",
    padding: "13px",
    backgroundColor: colors.cardSecondary,
    border: `1px solid ${colors.borderStrong}`,
    color: colors.subtext,
    borderRadius: "12px",
    cursor: "pointer",
    fontFamily: appFont,
    fontSize: "15px"
  };

  const stepperCardStyle = (active) => ({
    marginBottom: "16px",
    padding: "14px",
    borderRadius: "14px",
    border: active ? `1px solid ${colors.green}` : `1px solid ${colors.border}`,
    backgroundColor: active ? colors.greenDark : colors.card,
    transition: "all 0.2s ease",
    cursor: "pointer"
  });

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box"
        }}
      >
        Caricamento...
      </div>
    );
  }

  if (!hasSupabaseConfig) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "24px",
            padding: "24px",
            boxSizing: "border-box"
          }}
        >
          <div style={{ fontSize: "24px", fontWeight: 700 }}>Configura Supabase</div>
          <div
            style={{
              marginTop: "10px",
              color: colors.subtext,
              lineHeight: 1.5,
              fontSize: "14px"
            }}
          >
            Manca la configurazione `REACT_APP_SUPABASE_URL` e/o
            `REACT_APP_SUPABASE_ANON_KEY` nel file `.env.local`.
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "24px",
            padding: "24px",
            boxSizing: "border-box",
            boxShadow: isLight
              ? "0 18px 36px rgba(17, 24, 39, 0.08)"
              : "0 18px 36px rgba(0, 0, 0, 0.26)"
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 700 }}>
            {authStep === "request" ? "Entra in campo" : "Inserisci il codice"}
          </div>
          <div
            style={{
              marginTop: "8px",
              color: colors.subtext,
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            {authStep === "request"
              ? "La tua partita inizia qui"
              : "Controlla la tua email e inserisci il codice"}
          </div>

          {authStep === "request" ? (
            <>
              <div style={{ marginTop: "14px", marginBottom: "20px" }}>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>Email</div>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={authForm.email}
                  onChange={(e) =>
                    setAuthForm((prev) => ({
                      ...prev,
                      email: e.target.value
                    }))
                  }
                  placeholder="nome@email.com"
                  style={{
                    width: "100%",
                    padding: "13px 14px",
                    backgroundColor: colors.inputBg,
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: "12px",
                    color: colors.text,
                    boxSizing: "border-box",
                    outline: "none",
                    fontSize: "15px",
                    fontFamily: appFont
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div style={{ marginTop: "22px", marginBottom: "20px" }}>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>Codice</div>
                <input
                  type="text"
                  name="otpCode"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="Es. 123456"
                  style={{
                    width: "100%",
                    padding: "13px 14px",
                    backgroundColor: colors.inputBg,
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: "12px",
                    color: colors.text,
                    boxSizing: "border-box",
                    outline: "none",
                    fontSize: "15px",
                    fontFamily: appFont
                  }}
                />
              </div>
            </>
          )}

          {authError && (
            <div
              style={{
                marginTop: "14px",
                color: "#d64545",
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              {authError}
            </div>
          )}

          {authMessage && (
            <div
              style={{
                marginTop: "14px",
                color: colors.green,
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              {authMessage}
            </div>
          )}

          {authStep === "request" ? (
            <button
              onClick={handleAuthSubmit}
              disabled={authSubmitting || otpCooldownSeconds > 0}
              style={primaryButtonStyle(!(authSubmitting || otpCooldownSeconds > 0))}
            >
              {authSubmitting ? "Invio in corso..." : "Inizia il giro"}
            </button>
          ) : (
            <>
              <button onClick={handleVerifyOtp} style={primaryButtonStyle(true)}>
                {authSubmitting ? "Verifica in corso..." : "Entra nel giro"}
              </button>

              <button
                onClick={handleResendOtp}
                disabled={authSubmitting || otpCooldownSeconds > 0}
                style={{
                  ...secondaryButtonStyle,
                  opacity: authSubmitting || otpCooldownSeconds > 0 ? 0.65 : 1,
                  cursor:
                    authSubmitting || otpCooldownSeconds > 0
                      ? "not-allowed"
                      : "pointer"
                }}
              >
                {otpCooldownSeconds > 0
                  ? `Invia di nuovo il codice tra ${otpCooldownSeconds}s`
                  : "Invia di nuovo il codice"}
              </button>
            </>
          )}

          <div
            style={{
              marginTop: "10px",
              color: colors.subtext,
              fontSize: "13px",
              lineHeight: 1.5,
              textAlign: "center"
            }}
          >
            Riceverai un codice di accesso solo la prima volta e poi resterai connesso
          </div>
        </div>
      </div>
    );
  }

  if (session && authError && !appReady && !needsOnboarding && !profileLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "24px",
            padding: "24px",
            boxSizing: "border-box",
            boxShadow: isLight
              ? "0 18px 36px rgba(17, 24, 39, 0.08)"
              : "0 18px 36px rgba(0, 0, 0, 0.26)"
          }}
        >
          <div style={{ fontSize: "24px", fontWeight: 700 }}>C'è un problema nel caricamento</div>
          <div
            style={{
              marginTop: "10px",
              color: "#d64545",
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            {authError}
          </div>

          <button
            onClick={() => window.location.reload()}
            style={primaryButtonStyle(true)}
          >
            Riprova
          </button>

          <button onClick={handleLogout} style={secondaryButtonStyle}>
            Esci
          </button>
        </div>
      </div>
    );
  }

  if (session && (profileLoading || !appReady) && !needsOnboarding) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "24px",
            padding: "24px",
            boxSizing: "border-box",
            boxShadow: isLight
              ? "0 18px 36px rgba(17, 24, 39, 0.08)"
              : "0 18px 36px rgba(0, 0, 0, 0.26)"
          }}
        >
          <div style={{ fontSize: "24px", fontWeight: 700 }}>Prepariamo il profilo</div>
          <div
            style={{
              marginTop: "8px",
              color: colors.subtext,
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            Caricamento in corso...
          </div>

          {authError && (
            <div
              style={{
                marginTop: "12px",
                color: "#d64545",
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              {authError}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (session && needsOnboarding) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: appFont,
          padding: "24px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "24px",
            padding: "24px",
            boxSizing: "border-box",
            boxShadow: isLight
              ? "0 18px 36px rgba(17, 24, 39, 0.08)"
              : "0 18px 36px rgba(0, 0, 0, 0.26)"
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 700 }}>Completa il profilo</div>
          <div
            style={{
              marginTop: "8px",
              color: colors.subtext,
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            Inserisci il nome giocatore e il tuo HCP per iniziare.
          </div>

          <div style={{ marginTop: "22px" }}>
            <div style={{ fontSize: "14px", marginBottom: "8px" }}>Giocatore</div>
            <input
              type="text"
              autoComplete="given-name"
              value={onboardingForm.playerName}
              onChange={(e) =>
                setOnboardingForm((prev) => ({
                  ...prev,
                  playerName: e.target.value
                }))
              }
              placeholder="Il tuo nome sullo scorecard"
              style={{
                width: "100%",
                padding: "13px 14px",
                backgroundColor: colors.inputBg,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                boxSizing: "border-box",
                outline: "none",
                fontSize: "15px",
                fontFamily: appFont
              }}
            />
          </div>

          <div style={{ marginTop: "14px" }}>
            <div style={{ fontSize: "14px", marginBottom: "8px" }}>HCP</div>
            <input
              type="text"
              inputMode="decimal"
              value={onboardingForm.hcp}
              onChange={(e) =>
                setOnboardingForm((prev) => ({
                  ...prev,
                  hcp: e.target.value
                }))
              }
              placeholder="Es. 36"
              style={{
                width: "100%",
                padding: "13px 14px",
                backgroundColor: colors.inputBg,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                boxSizing: "border-box",
                outline: "none",
                fontSize: "15px",
                fontFamily: appFont
              }}
            />
          </div>

          {authError && (
            <div
              style={{
                marginTop: "14px",
                color: "#d64545",
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              {authError}
            </div>
          )}

          <button onClick={handleOnboardingSubmit} style={primaryButtonStyle(true)}>
            {authSubmitting ? "Salvataggio in corso..." : "Continua"}
          </button>
        </div>
      </div>
    );
  }

  const homeHeaderStyle = {
    display: "grid",
    gridTemplateColumns: `${HEADER_CIRCLE_SIZE} 1fr ${HEADER_CIRCLE_SIZE}`,
    alignItems: "center",
    columnGap: "12px",
    paddingLeft: HEADER_HORIZONTAL_INSET,
    paddingRight: HEADER_HORIZONTAL_INSET,
    paddingTop: "10px",
    paddingBottom: "12px",
    marginBottom: "14px"
  };

  const centeredHeaderStyle = {
    display: "grid",
    gridTemplateColumns: `${HEADER_CIRCLE_SIZE} 1fr ${HEADER_CIRCLE_SIZE}`,
    alignItems: "center",
    columnGap: "12px",
    paddingLeft: HEADER_HORIZONTAL_INSET,
    paddingRight: HEADER_HORIZONTAL_INSET,
    paddingTop: "10px",
    paddingBottom: "12px",
    marginBottom: "18px"
  };

  const headerCircleButtonBaseStyle = {
    width: HEADER_CIRCLE_SIZE,
    height: HEADER_CIRCLE_SIZE,
    borderRadius: HEADER_CIRCLE_RADIUS,
    backgroundColor: colors.card,
    color: colors.text,
    cursor: "pointer",
    fontFamily: appFont,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
    boxSizing: "border-box",
    boxShadow: isLight
      ? "0 8px 20px rgba(17, 24, 39, 0.08)"
      : "0 10px 24px rgba(0, 0, 0, 0.34)"
  };

  const headerCircleButtonStyle = ({
    borderColor = colors.borderStrong,
    fontSize = "22px"
  } = {}) => ({
    ...headerCircleButtonBaseStyle,
    border: `2px solid ${borderColor}`,
    fontSize
  });

  const headerButtonSlotBaseStyle = {
    width: HEADER_CIRCLE_SIZE,
    height: HEADER_CIRCLE_SIZE,
    display: "flex",
    alignItems: "center"
  };

  const headerLeftButtonWrapStyle = {
    ...headerButtonSlotBaseStyle,
    justifySelf: "start",
    justifyContent: "flex-start",
    alignSelf: "center"
  };

  const headerRightButtonWrapStyle = {
    ...headerButtonSlotBaseStyle,
    justifySelf: "end",
    justifyContent: "flex-end",
    alignSelf: "center"
  };

  const cardFavoriteIconStyle = (isFav) => ({
    width: CARD_FAVORITE_SIZE,
    height: CARD_FAVORITE_SIZE,
    borderRadius: CARD_FAVORITE_RADIUS,
    border: `2px solid ${isFav ? colors.green : colors.borderStrong}`,
    backgroundColor: colors.card,
    color: colors.text,
    cursor: "pointer",
    fontFamily: appFont,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
    boxSizing: "border-box",
    boxShadow: isLight
      ? "0 4px 12px rgba(17, 24, 39, 0.05)"
      : "0 6px 16px rgba(0, 0, 0, 0.24)"
  });

  const reportActionButtonStyle = {
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    border: `1.5px solid ${colors.greenBorder}`,
    backgroundColor: isLight ? "#F4FFF8" : colors.card,
    color: colors.green,
    cursor: "pointer",
    fontFamily: appFont,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
    boxSizing: "border-box",
    boxShadow: isLight
      ? "0 4px 12px rgba(17, 24, 39, 0.04)"
      : "0 6px 16px rgba(0, 0, 0, 0.18)"
  };

  const renderReportIcon = (size = 18) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 2.5L19 5.3V11.3C19 16.2 15.8 20.7 12 22C8.2 20.7 5 16.2 5 11.3V5.3L12 2.5Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12 2.5L19 5.3V11.3C19 16.2 15.8 20.7 12 22C8.2 20.7 5 16.2 5 11.3V5.3L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.3 11.9L11.1 13.7L14.8 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const headerTitleTextStyle = {
    fontSize: "17px",
    fontWeight: 700,
    letterSpacing: "0.01em",
    color: colors.text,
    textAlign: "center"
  };

  const homeIdentityRowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: "10px",
    minWidth: 0,
    marginLeft: HOME_SECTION_INSET,
    marginRight: HOME_SECTION_INSET,
    marginBottom: "26px"
  };

  const homeHeaderIdentityStyle = {
    minWidth: 0,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "10px",
    justifyContent: "center",
    lineHeight: 1.1
  };

  const homeHcpPillStyle = {
    border: `1px solid ${colors.pillBorder}`,
    backgroundColor: colors.pillBg,
    color: colors.subtext,
    borderRadius: "999px",
    padding: "6px 11px",
    fontSize: "12px",
    fontFamily: appFont,
    cursor: "pointer",
    lineHeight: 1.2,
    whiteSpace: "nowrap"
  };

  const getHcpValueFeedbackStyle = (active, baseColor = colors.text) => ({
    display: "inline-block",
    color: active ? colors.green : baseColor,
    opacity: active ? 0.92 : 1,
    transform: active ? "scale(1.04)" : "scale(1)",
    transition:
      "color 0.28s ease-in-out, opacity 0.28s ease-in-out, transform 0.28s ease-in-out"
  });

  const homeNameButtonStyle = {
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    color: colors.text,
    fontFamily: appFont,
    cursor: "pointer",
    textAlign: "left",
    minWidth: 0
  };

  const cardStyle = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "16px",
    padding: CARD_CONTAINER_HORIZONTAL_PADDING
  };

  const homeSectionCardStyle = {
    ...cardStyle,
    marginLeft: HOME_SECTION_INSET,
    marginRight: HOME_SECTION_INSET
  };

  const homeSectionTitleStyle = {
    ...titleStyle,
    marginTop: "28px",
    marginBottom: "14px",
    marginLeft: HOME_SECTION_INSET,
    marginRight: HOME_SECTION_INSET
  };

  const homeSearchInnerStyle = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    backgroundColor: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: "14px",
    padding: "12px 14px",
    marginLeft: "2px",
    marginRight: "2px"
  };

  const homeSearchEmptyStateStyle = {
    marginTop: "12px",
    padding: "12px 4px 2px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px"
  };

  const homeSearchEmptyTextStyle = {
    color: colors.subtext,
    lineHeight: 1.45,
    minWidth: 0
  };

  const homeSearchEmptyCtaStyle = {
    border: "none",
    background: "transparent",
    color: colors.green,
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: appFont,
    cursor: "pointer",
    padding: 0,
    whiteSpace: "nowrap",
    flexShrink: 0
  };

  const homePrimarySectionCardStyle = {
    ...homeSectionCardStyle,
    paddingTop: "6px",
    paddingBottom: "6px",
    boxShadow: isLight
      ? "0 8px 24px rgba(17, 24, 39, 0.04)"
      : "0 10px 24px rgba(0, 0, 0, 0.16)"
  };

  const scorecardTopCardStyle = {
    padding: "18px",
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "18px",
    boxShadow: isLight
      ? "0 6px 18px rgba(17, 24, 39, 0.04)"
      : "0 8px 20px rgba(0, 0, 0, 0.18)"
  };

  const scorecardSummaryCardStyle = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "16px",
    padding: "18px",
    boxShadow: isLight
      ? "0 4px 14px rgba(17, 24, 39, 0.03)"
      : "0 6px 16px rgba(0, 0, 0, 0.14)"
  };

  const scorecardHoleCardStyle = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "16px",
    padding: "18px",
    marginTop: "14px",
    boxShadow: isLight
      ? "0 5px 16px rgba(17, 24, 39, 0.035)"
      : "0 7px 18px rgba(0, 0, 0, 0.14)"
  };

  const roundSetupTopCardStyle = {
    padding: "20px",
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "20px",
    boxShadow: isLight
      ? "0 6px 18px rgba(17, 24, 39, 0.04)"
      : "0 8px 20px rgba(0, 0, 0, 0.18)"
  };

  const roundSetupInputCardStyle = {
    ...cardStyle,
    padding: "14px",
    borderRadius: "18px",
    boxShadow: isLight
      ? "0 4px 14px rgba(17, 24, 39, 0.03)"
      : "0 6px 16px rgba(0, 0, 0, 0.12)"
  };

  const roundSetupSectionTitleStyle = {
    ...titleStyle,
    marginTop: "18px",
    marginBottom: "10px"
  };

  const roundSetupGridStyle = {
    display: "grid",
    gap: "10px"
  };

  const roundSetupPreviewStyle = {
    marginTop: "16px",
    backgroundColor: colors.card,
    border: `1px solid ${colors.greenBorder}`,
    borderRadius: "16px",
    padding: "16px",
    boxShadow: isLight
      ? "0 4px 14px rgba(17, 24, 39, 0.03)"
      : "0 6px 16px rgba(0, 0, 0, 0.12)"
  };

  const setupCardOptionStyle = (active) => ({
    padding: "18px 16px",
    borderRadius: "14px",
    border: active ? `1px solid ${colors.green}` : `1px solid ${colors.borderStrong}`,
    backgroundColor: active ? colors.greenDark : colors.inputBg,
    cursor: "pointer",
    fontWeight: 600,
    textAlign: "center",
    color: colors.text,
    boxShadow: active
      ? isLight
        ? "0 6px 16px rgba(46, 204, 113, 0.14)"
        : "0 8px 18px rgba(0, 0, 0, 0.2)"
      : "none"
  });

  const renderColorDot = (colorInfo, size = 9) => (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        borderRadius: "999px",
        backgroundColor: colorInfo?.dotColor || colors.borderStrong,
        border: colorInfo?.borderColor ? `1px solid ${colorInfo.borderColor}` : "none",
        display: "inline-block",
        boxSizing: "border-box"
      }}
    />
  );

  const renderRouteLabel = (routeName, { muted = false } = {}) => {
    const colorInfo = getRouteColor(routeName);

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          color: muted ? colors.subtext : colors.text
        }}
      >
        {colorInfo && renderColorDot(colorInfo)}
        <span>{routeName}</span>
      </span>
    );
  };

  const renderRoutePair = (
    frontRouteName,
    backRouteName,
    { muted = false, justify = "center" } = {}
  ) => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: justify,
        columnGap: "10px",
        rowGap: "6px",
        color: muted ? colors.subtext : colors.text
      }}
    >
      {renderRouteLabel(frontRouteName, { muted })}
      <span style={{ color: colors.subtext }}>·</span>
      {renderRouteLabel(backRouteName, { muted })}
    </div>
  );

  const routeNameBlockStyle = {
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    justifyContent: "flex-start",
    textAlign: "left"
  };

  const getClubStatusPillStyle = (accent) => {
    if (accent === "verified") {
      return {
        color: "#16A34A",
        backgroundColor: "#ECFDF5",
        border: "1px solid rgba(22, 163, 74, 0.18)"
      };
    }

    if (accent === "review") {
      return {
        color: "#F59E0B",
        backgroundColor: "#FFFBEB",
        border: "1px solid rgba(245, 158, 11, 0.18)"
      };
    }

    return {
      color: "#60A5FA",
      backgroundColor: "#F5F9FF",
      border: "1px solid rgba(59, 130, 246, 0.18)"
    };
  };

  const renderClubStatusIcon = (icon, color, size = 13) => {
    if (icon === "verified") {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z"
            stroke={color}
            strokeWidth="2"
          />
          <path
            d="m8 12.5 2.5 2.5L16.5 9"
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    if (icon === "review") {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z"
            stroke={color}
            strokeWidth="2"
          />
          <path
            d="M12 7.5V12.5"
            stroke={color}
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <circle cx="12" cy="16.4" r="1.1" fill={color} />
        </svg>
      );
    }

    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M18 20v-1.1c0-1.9-1.1-3.5-2.8-4.3"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 20v-1.4c0-2.5 2-4.6 4.6-4.6h2.8c2.6 0 4.6 2.1 4.6 4.6V20"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="8" r="4" stroke={color} strokeWidth="2" />
        <path
          d="M18 5.8a3.2 3.2 0 0 1 0 6.4"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  };

  const renderCourseRow = (course, { showDivider = true } = {}) => (
    <div
      key={course.id}
      onClick={() => {
        if (!course.playable) {
          openComplexClubRequestDialog(course);
          return;
        }
        prepareRoundSetup(course);
      }}
      onMouseDown={() => setActiveCourseCardId(course.id)}
      onMouseUp={() => setActiveCourseCardId(null)}
      onMouseLeave={() => setActiveCourseCardId(null)}
      onTouchStart={() => setActiveCourseCardId(course.id)}
      onTouchEnd={() => setActiveCourseCardId(null)}
      onTouchCancel={() => setActiveCourseCardId(null)}
      style={{
        padding: `14px ${CARD_ROW_HORIZONTAL_PADDING}`,
        borderBottom: showDivider ? `1px solid ${colors.border}` : "none",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        fontFamily: appFont,
        cursor: "pointer",
        borderRadius: "14px",
        backgroundColor:
          activeCourseCardId === course.id ? colors.cardSecondary : "transparent",
        transform: activeCourseCardId === course.id ? "scale(0.992)" : "scale(1)",
        transition: "background-color 0.18s ease, transform 0.18s ease"
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ fontSize: "16px", fontWeight: 500 }}>{course.name}</div>
          {(() => {
            const statusMeta = getClubStatusMeta(course);
            const pillStyle = getClubStatusPillStyle(statusMeta.accent);

            return (
              <div
                title={statusMeta.description}
                aria-label={statusMeta.description}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "24px",
                  height: "24px",
                  borderRadius: "999px",
                  lineHeight: 1,
                  marginLeft: "2px",
                  verticalAlign: "middle",
                  ...pillStyle
                }}
              >
                {renderClubStatusIcon(statusMeta.icon, pillStyle.color, 13)}
              </div>
            );
          })()}
        </div>
        <div
          style={{
            color: colors.subtext,
            fontSize: "13px",
            marginTop: "3px"
          }}
        >
          {!course.playable
            ? "Club in fase di configurazione"
            : course.routeCount > 1
              ? `${course.routeCount} percorsi`
              : Number.isFinite(Number(course.holesCount)) && Number.isFinite(Number(course.totalPar))
                ? `${course.holesCount} buche • Par ${course.totalPar}`
                : ""}
        </div>

      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(course.id);
          }}
          style={cardFavoriteIconStyle(course.favorite)}
          title="Preferito"
        >
          <span style={{ fontSize: "17px", lineHeight: 1, transform: "translateY(-1px)" }}>
            ⛳️
          </span>
        </div>
      </div>
    </div>
  );

  if (openedCourse && showRoundSetup) {
    const openedCourseRoutes = Array.isArray(openedCourse.routes) ? openedCourse.routes : [];
    const openedCourseRouteCombinations = Array.isArray(openedCourse.routeCombinations)
      ? openedCourse.routeCombinations
      : [];
    const nineHoleRoutes = [...openedCourseRoutes]
      .filter((route) => Number(route.holesCount) === 9)
      .sort((a, b) => {
        const priority = { "Blu": 0, "Bianco": 1, "Rosso": 2 };
        const aPriority = Object.prototype.hasOwnProperty.call(priority, a.name) ? priority[a.name] : 99;
        const bPriority = Object.prototype.hasOwnProperty.call(priority, b.name) ? priority[b.name] : 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return String(a.name || "").localeCompare(String(b.name || ""), "it");
      });
    const eighteenHoleRoutes = [...openedCourseRoutes]
      .filter((route) => Number(route.holesCount) === 18)
      .sort((a, b) => {
        const getRoutePriority = (name) => {
          const normalizedName = String(name || "").toLowerCase();
          if (normalizedName.includes("blu") || normalizedName.includes("blue")) return 0;
          if (normalizedName.includes("bianco") || normalizedName.includes("white")) return 1;
          if (normalizedName.includes("rosso") || normalizedName.includes("red")) return 2;
          return 99;
        };

        const aPriority = getRoutePriority(a.name);
        const bPriority = getRoutePriority(b.name);
        if (aPriority !== bPriority) return aPriority - bPriority;
        return String(a.name || "").localeCompare(String(b.name || ""), "it");
      });
    const canPlayNine = openedCourseRoutes.length > 0;
    const canPlayEighteen =
      openedCourseRouteCombinations.length > 0 ||
      eighteenHoleRoutes.length > 0 ||
      nineHoleRoutes.length > 0;
    const allowedCompetitionOptions = [canPlayNine ? 9 : null, canPlayEighteen ? 18 : null].filter(
      Boolean
    );
    const selectedPrimaryRoute =
      openedCourseRoutes.find((route) => route.id === roundSetup.selectedRouteId) || null;
    const selectedSecondaryRoute =
      openedCourseRoutes.find((route) => route.id === roundSetup.secondaryRouteId) || null;
    const selectedOfficialCombination =
      openedCourseRouteCombinations.find(
        (combination) => combination.id === roundSetup.selectedCombinationId
      ) || null;
    const matchedOfficialCombination =
      selectedOfficialCombination ||
      findOfficialCombinationByRoutes(
        openedCourse,
        selectedPrimaryRoute,
        selectedSecondaryRoute
      );
    const usingOfficialCombination =
      Number(roundSetup.totalCompetitionHoles) === 18 && Boolean(matchedOfficialCombination);
    const usingManualRoutePair =
      Number(roundSetup.totalCompetitionHoles) === 18 &&
      !matchedOfficialCombination &&
      selectedPrimaryRoute &&
      selectedSecondaryRoute &&
      Number(selectedPrimaryRoute.holesCount) === 9 &&
      Number(selectedSecondaryRoute.holesCount) === 9 &&
      selectedPrimaryRoute.id !== selectedSecondaryRoute.id;
    const startHoleRangeCount =
      Number(roundSetup.totalCompetitionHoles) === 18 && (usingOfficialCombination || usingManualRoutePair)
        ? 18
        : Number(selectedPrimaryRoute?.holesCount || 0);
    const allowStartHoleSelection = startHoleRangeCount > 0;
    const allowedStartHoles = allowStartHoleSelection
      ? Array.from({ length: startHoleRangeCount }, (_, index) => index + 1)
      : [1];
    const startHolePages = [];
    for (let index = 0; index < allowedStartHoles.length; index += 3) {
      startHolePages.push(allowedStartHoles.slice(index, index + 3));
    }
    const maxStartHolePage = Math.max(0, startHolePages.length - 1);
    const visibleStartHolePage = Math.min(startHolePage, maxStartHolePage);
    const previewSummary = usingOfficialCombination
      ? `${matchedOfficialCombination.frontRouteName} + ${matchedOfficialCombination.backRouteName}`
      : usingManualRoutePair
        ? `${selectedPrimaryRoute.name} + ${selectedSecondaryRoute.name}`
        : selectedPrimaryRoute
          ? Number(roundSetup.totalCompetitionHoles) === 18 &&
            Number(selectedPrimaryRoute.holesCount) === 9
            ? `${selectedPrimaryRoute.name} ripetuto due volte`
            : selectedPrimaryRoute.name
          : "Seleziona un percorso";
    const canUseRouteTeeSelection =
      Boolean(selectedPrimaryRoute) &&
      (!usingManualRoutePair || selectedPrimaryRoute.id === selectedSecondaryRoute?.id);
    const teeOptions = usingOfficialCombination
      ? matchedOfficialCombination?.tees || []
      : canUseRouteTeeSelection
        ? selectedPrimaryRoute?.tees || []
        : [];
    const selectedTee = usingOfficialCombination
      ? teeOptions.find((tee) => tee.id === roundSetup.selectedCombinationTeeId) || teeOptions[0] || null
      : teeOptions.find((tee) => tee.id === roundSetup.selectedRouteTeeId) || teeOptions[0] || null;
    const selectedTeeParTotal = Number(selectedTee?.parTotal || roundSetupTotalPar || 0);
    const previewPlayingHandicap = selectedTee
      ? calculatePlayingHandicap(
          userProfile.hcp,
          selectedTee.courseRating,
          selectedTee.slopeRating,
          selectedTeeParTotal
        )
      : null;
    const roundedHandicapIndex = Number.isFinite(Number(userProfile.hcp))
      ? Math.round(Number(userProfile.hcp))
      : null;
    const playingHandicapDifference =
      previewPlayingHandicap !== null && roundedHandicapIndex !== null
        ? previewPlayingHandicap - roundedHandicapIndex
        : null;
    const showOfficialCombinationList =
      Number(roundSetup.totalCompetitionHoles) === 18 &&
      openedCourseRouteCombinations.length > 0 &&
      !showManualCombinationBuilder &&
      showOfficialCombinationOptions;
    const showSelectedOfficialCombinationCard =
      Number(roundSetup.totalCompetitionHoles) === 18 &&
      Boolean(matchedOfficialCombination) &&
      !showManualCombinationBuilder &&
      !showOfficialCombinationOptions;
    const showSelectedRouteCard =
      Boolean(selectedPrimaryRoute) &&
      !usingOfficialCombination &&
      !showRouteOptions &&
      (
        Number(roundSetup.totalCompetitionHoles) === 9 ||
        (Number(roundSetup.totalCompetitionHoles) === 18 &&
          !showManualCombinationBuilder &&
          !showOtherEighteenRouteOptions)
      );
    const showSelectedTeeCard = Boolean(selectedTee) && teeOptions.length > 0 && !showTeeOptions;
    const showTeeCardOptions = teeOptions.length > 1 && (!selectedTee || showTeeOptions);
    const canStartRound = Boolean(roundSetup.totalCompetitionHoles) && competitionHoles.length > 0;
    const hasStructuredEighteenOptions =
      openedCourseRouteCombinations.length > 0 || eighteenHoleRoutes.length > 0;
    const showManualBuilderToggle =
      Number(roundSetup.totalCompetitionHoles) === 18 &&
      nineHoleRoutes.length > 1 &&
      hasStructuredEighteenOptions &&
      openedCourseRouteCombinations.length === 0;
    const showManualBuilderDirectly =
      Number(roundSetup.totalCompetitionHoles) === 18 &&
      nineHoleRoutes.length > 0 &&
      !hasStructuredEighteenOptions;
    if (!openedCourse.playable) {
      return (
        <div
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            minHeight: "100vh",
            padding: `20px ${SCREEN_HORIZONTAL_PADDING}`,
            boxSizing: "border-box",
            fontFamily: appFont
          }}
        >
          {topSafeAreaBackdrop}

          <div style={centeredHeaderStyle}>
            <div style={headerLeftButtonWrapStyle}>
              <button
                onClick={closeCourse}
                style={headerCircleButtonStyle()}
                aria-label="Torna indietro"
              >
                <span
                  style={{ fontSize: "21px", lineHeight: 1, transform: "translateX(-1px)" }}
                >
                  ←
                </span>
              </button>
            </div>

            <div style={headerTitleTextStyle}>Imposta il giro</div>

            <div style={headerRightButtonWrapStyle}>
              <button
                onClick={() => {
                  setSheetClosing(false);
                  setActiveSheet("menu");
                }}
                style={headerCircleButtonStyle({ fontSize: "18px" })}
                title="Apri menu"
                aria-label="Apri menu"
              >
                <span
                  style={{ fontSize: "18px", lineHeight: 1, transform: "translateY(-1px)" }}
                >
                  ≡
                </span>
              </button>
            </div>
          </div>

          <div style={roundSetupTopCardStyle}>
            <div style={{ fontSize: "25px", fontWeight: 700, minWidth: 0 }}>{openedCourse.name}</div>
            <div
              style={{
                marginTop: "10px",
                color: colors.subtext,
                fontSize: "14px",
                lineHeight: 1.5
              }}
            >
              Club con {openedCourse.routeCount} {openedCourse.routeCount === 1 ? "percorso" : "percorsi"}
            </div>
          </div>

          <div style={roundSetupPreviewStyle}>
            <div style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>
              Richiedi questo club
            </div>
            <div
              style={{
                color: colors.subtext,
                fontSize: "14px",
                lineHeight: 1.6
              }}
            >
              Questo club ha più percorsi o combinazioni ufficiali.
              <br />
              Per garantirti dati corretti, lo configuriamo noi.
            </div>
            <div
              style={{
                marginTop: "14px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.6
              }}
            >
              Non trovi un club con più percorsi o combinazioni ufficiali? Richiedilo e ti
              avviseremo via email quando sarà pronto.
            </div>
            {clubRequestFeedback && (
              <div
                style={{
                  marginTop: "12px",
                  color: clubRequestFeedback.toLowerCase().includes("errore")
                    ? "#d64545"
                    : colors.green,
                  fontSize: "13px",
                  lineHeight: 1.5
                }}
              >
                {clubRequestFeedback}
              </div>
            )}
            <button
              onClick={() => submitClubRequest(openedCourse.name)}
              disabled={clubRequestSubmitting}
              style={primaryButtonStyle(!clubRequestSubmitting)}
            >
              {clubRequestSubmitting ? "Invio in corso..." : "Richiedi questo club"}
            </button>
          </div>

          {overlayPortal}
        </div>
      );
    }
    return (
      <div
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          minHeight: "100vh",
          padding: `20px ${SCREEN_HORIZONTAL_PADDING}`,
          boxSizing: "border-box",
          fontFamily: appFont
        }}
      >
        {topSafeAreaBackdrop}

        <div style={centeredHeaderStyle}>
          <div style={headerLeftButtonWrapStyle}>
            <button
              onClick={closeCourse}
              style={headerCircleButtonStyle()}
              aria-label="Torna indietro"
            >
              <span
                style={{ fontSize: "21px", lineHeight: 1, transform: "translateX(-1px)" }}
              >
                ←
              </span>
            </button>
          </div>

          <div style={headerTitleTextStyle}>Imposta il giro</div>

          <div style={headerRightButtonWrapStyle}>
            <button
              onClick={() => {
                setSheetClosing(false);
                setActiveSheet("menu");
              }}
              style={headerCircleButtonStyle({ fontSize: "18px" })}
              title="Apri menu"
              aria-label="Apri menu"
            >
              <span
                style={{ fontSize: "18px", lineHeight: 1, transform: "translateY(-1px)" }}
              >
                ≡
              </span>
            </button>
          </div>
        </div>

        <div style={roundSetupTopCardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "12px"
            }}
          >
            <div style={{ fontSize: "25px", fontWeight: 700, minWidth: 0 }}>{openedCourse.name}</div>

            {openedCourse.playable && (
              <button
                onClick={() => openCourseReport(openedCourse)}
                style={{ ...reportActionButtonStyle, flexShrink: 0 }}
                title="Invia segnalazione"
                aria-label={`Invia segnalazione per ${openedCourse.name}`}
              >
                {renderReportIcon(14)}
              </button>
            )}
          </div>

          <div
            style={{
              marginTop: "10px",
              color: colors.subtext,
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            Club in fase di configurazione
          </div>
        </div>

        <h2 style={roundSetupSectionTitleStyle}>Nome del giro</h2>
        <div
          style={{
            ...roundSetupInputCardStyle,
            padding: "10px 12px",
            borderRadius: "16px"
          }}
        >
          <input
            type="text"
            value={roundSetup.competitionName}
            onChange={(e) =>
              setRoundSetup((prev) => ({
                ...prev,
                competitionName: e.target.value
              }))
            }
            placeholder="Es. Stableford sabato, Allenamento"
            style={{
              width: "100%",
              padding: "12px 14px",
              backgroundColor: "transparent",
              border: "none",
              borderRadius: "12px",
              color: colors.text,
              boxSizing: "border-box",
              outline: "none",
              fontSize: "15px",
              fontFamily: appFont
            }}
          />
        </div>

        <h2 style={roundSetupSectionTitleStyle}>Che giro giochi oggi?</h2>
        <div
          style={{
            marginTop: "-4px",
            marginBottom: "12px",
            color: colors.subtext,
            fontSize: "13px",
            lineHeight: 1.5
          }}
        >
          Scegli quante buche vuoi giocare.
        </div>
        <div
          style={{
            ...roundSetupGridStyle,
            gridTemplateColumns: `repeat(${allowedCompetitionOptions.length}, 1fr)`
          }}
        >
          {allowedCompetitionOptions.map((option) => (
            <div
              key={option}
              onClick={() => {
                setShowManualCombinationBuilder(false);
                setShowOfficialCombinationOptions(false);
                setShowRouteOptions(false);
                setShowOtherEighteenRouteOptions(false);
                setShowTeeOptions(false);
                setRoundSetup((prev) => ({
                  ...prev,
                  totalCompetitionHoles: option,
                  ...buildRoundChoiceDefaults(openedCourse, option)
                }));
              }}
              style={setupCardOptionStyle(
                roundSetup.totalCompetitionHoles === option
              )}
            >
              {option}
            </div>
          ))}
        </div>

        {Number(roundSetup.totalCompetitionHoles) === 9 && nineHoleRoutes.length > 0 && (
          <>
            <div
              style={{
                ...roundSetupSectionTitleStyle,
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}
            >
              <button
                onClick={() => setShowRouteOptions((prev) => !prev)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: colors.green,
                  fontSize: "20px",
                  fontWeight: 800,
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: appFont,
                  lineHeight: 1,
                  flexShrink: 0
                }}
                aria-label={showRouteOptions ? "Chiudi percorsi" : "Apri percorsi"}
              >
                {showRouteOptions ? "▴" : "▾"}
              </button>
              <span>Scegli il percorso</span>
            </div>
            {showSelectedRouteCard ? (
              <div style={{ ...roundSetupInputCardStyle, ...setupCardOptionStyle(true), cursor: "default" }}>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    lineHeight: 1.4,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  {getRouteColor(selectedPrimaryRoute.name)
                    ? renderColorDot(getRouteColor(selectedPrimaryRoute.name), 10)
                    : null}
                  <span>
                    {selectedPrimaryRoute.name} · {selectedPrimaryRoute.holesCount} buche · Par{" "}
                    {selectedPrimaryRoute.totalPar}
                  </span>
                </div>
              </div>
            ) : showRouteOptions || !selectedPrimaryRoute ? (
              <div
                style={{
                  ...roundSetupGridStyle,
                  gridTemplateColumns: "1fr"
                }}
              >
                {nineHoleRoutes.map((route) => (
                  <div
                    key={route.id}
                    onClick={() => {
                      setRoundSetup((prev) => ({
                        ...prev,
                        selectedRouteId: route.id,
                        secondaryRouteId: null,
                        selectedCombinationId: null,
                        selectedRouteTeeId: getDefaultTeeId(route.tees),
                        selectedCombinationTeeId: null,
                        startHole: 1
                      }));
                      setShowRouteOptions(false);
                      setShowTeeOptions(false);
                    }}
                    style={setupCardOptionStyle(roundSetup.selectedRouteId === route.id)}
                  >
                    <div style={routeNameBlockStyle}>
                      {getRouteColor(route.name) ? renderColorDot(getRouteColor(route.name)) : null}
                      {route.name}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                      {route.holesCount} buche • Par {route.totalPar}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {Number(roundSetup.totalCompetitionHoles) === 18 && eighteenHoleRoutes.length > 0 && !showManualCombinationBuilder && (
          <>
            {!openedCourseRouteCombinations.length && (
              <h2 style={roundSetupSectionTitleStyle}>Scegli il percorso</h2>
            )}
          </>
        )}

        {Number(roundSetup.totalCompetitionHoles) === 18 &&
          openedCourseRouteCombinations.length > 0 &&
          !showManualCombinationBuilder && (
            <>
              <h2 style={roundSetupSectionTitleStyle}>Scegli il percorso</h2>
              <div
                style={{
                  ...roundSetupSectionTitleStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}
              >
                <button
                  onClick={() => setShowOfficialCombinationOptions((prev) => !prev)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: colors.green,
                    fontSize: "20px",
                    fontWeight: 800,
                    padding: 0,
                    cursor: "pointer",
                    fontFamily: appFont,
                    lineHeight: 1,
                    flexShrink: 0
                  }}
                  aria-label={
                    showOfficialCombinationOptions
                      ? "Chiudi giri ufficiali"
                      : "Apri giri ufficiali"
                  }
                >
                  {showOfficialCombinationOptions ? "▴" : "▾"}
                </button>
                <span>Giri ufficiali</span>
              </div>
              <div
                style={{
                  marginTop: "-4px",
                  marginBottom: "12px",
                  color: colors.subtext,
                  fontSize: "13px",
                  lineHeight: 1.5
                }}
              >
                Se disponibili sono il modo piu' rapido e preciso per iniziare.
              </div>
              {showOfficialCombinationList && (
                <div
                  style={{
                    ...roundSetupGridStyle,
                    gridTemplateColumns: "1fr"
                  }}
                >
                  {openedCourseRouteCombinations.map((combination) => (
                    <div
                      key={combination.id}
                      onClick={() => {
                        setShowManualCombinationBuilder(false);
                        setShowOfficialCombinationOptions(false);
                        setShowRouteOptions(false);
                        setShowOtherEighteenRouteOptions(false);
                        setShowTeeOptions(false);
                        setRoundSetup((prev) => ({
                          ...prev,
                          selectedRouteId: combination.frontRouteId,
                          secondaryRouteId: combination.backRouteId,
                          selectedCombinationId: combination.id,
                          selectedRouteTeeId: null,
                          selectedCombinationTeeId: getDefaultTeeId(combination.tees),
                          startHole: 1
                        }));
                      }}
                      style={setupCardOptionStyle(
                        matchedOfficialCombination?.id === combination.id
                      )}
                    >
                      <div style={{ fontWeight: 700 }}>{combination.name}</div>
                      <div style={{ marginTop: "6px", fontSize: "13px", color: colors.subtext }}>
                        {renderRoutePair(combination.frontRouteName, combination.backRouteName, {
                          muted: true
                        })}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                        {combination.holesCount} buche · Par {combination.totalPar}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showSelectedOfficialCombinationCard && (
                <div style={{ ...roundSetupInputCardStyle, ...setupCardOptionStyle(true), cursor: "default" }}>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 700,
                      lineHeight: 1.4
                    }}
                  >
                    {matchedOfficialCombination.name} · {matchedOfficialCombination.holesCount} buche · Par{" "}
                    {matchedOfficialCombination.totalPar}
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      color: colors.subtext
                    }}
                  >
                    {getRouteColor(matchedOfficialCombination.frontRouteName)
                      ? renderColorDot(getRouteColor(matchedOfficialCombination.frontRouteName), 9)
                      : null}
                    {getRouteColor(matchedOfficialCombination.backRouteName)
                      ? renderColorDot(getRouteColor(matchedOfficialCombination.backRouteName), 9)
                      : null}
                  </div>
                </div>
              )}
            </>
          )}

        {Number(roundSetup.totalCompetitionHoles) === 18 && eighteenHoleRoutes.length > 0 && !showManualCombinationBuilder && (
          <>
            {openedCourseRouteCombinations.length > 0 && (
              <div
                style={{
                  ...roundSetupSectionTitleStyle,
                  marginTop: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}
              >
                <button
                  onClick={() => setShowOtherEighteenRouteOptions((prev) => !prev)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: colors.green,
                    fontSize: "20px",
                    fontWeight: 800,
                    padding: 0,
                    cursor: "pointer",
                    fontFamily: appFont,
                    lineHeight: 1,
                    flexShrink: 0
                  }}
                  aria-label={showOtherEighteenRouteOptions ? "Chiudi altri percorsi" : "Apri altri percorsi"}
                >
                  {showOtherEighteenRouteOptions ? "▴" : "▾"}
                </button>
                <span>Altre opzioni di gioco</span>
              </div>
            )}
            {showSelectedRouteCard ? (
              <div style={{ ...roundSetupInputCardStyle, ...setupCardOptionStyle(true), cursor: "default" }}>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    lineHeight: 1.4,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  {getRouteColor(selectedPrimaryRoute.name)
                    ? renderColorDot(getRouteColor(selectedPrimaryRoute.name), 10)
                    : null}
                  <span>
                    {selectedPrimaryRoute.name} · 18 buche · Par {selectedPrimaryRoute.totalPar}
                  </span>
                </div>
              </div>
            ) : (showOtherEighteenRouteOptions || !openedCourseRouteCombinations.length) ? (
              <div
                style={{
                  ...roundSetupGridStyle,
                  gridTemplateColumns: "1fr"
                }}
              >
                {eighteenHoleRoutes.map((route) => (
                  <div
                    key={route.id}
                    onClick={() => {
                      setShowManualCombinationBuilder(false);
                      setShowOfficialCombinationOptions(false);
                      setShowOtherEighteenRouteOptions(false);
                      setRoundSetup((prev) => ({
                        ...prev,
                        selectedRouteId: route.id,
                        secondaryRouteId: null,
                        selectedCombinationId: null,
                        selectedRouteTeeId: getDefaultTeeId(route.tees),
                        selectedCombinationTeeId: null,
                        startHole: 1
                      }));
                      setShowRouteOptions(false);
                      setShowTeeOptions(false);
                    }}
                    style={setupCardOptionStyle(
                      roundSetup.selectedRouteId === route.id && !roundSetup.selectedCombinationId
                    )}
                  >
                    <div style={routeNameBlockStyle}>
                      {getRouteColor(route.name) ? renderColorDot(getRouteColor(route.name)) : null}
                      {route.name}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                      18 buche • Par {route.totalPar}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {showManualBuilderToggle && (
            <div
              style={{
                marginTop: "14px",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center"
              }}
            >
              <button
                onClick={() => {
                  setShowManualCombinationBuilder((prev) => !prev);
                  if (!showManualCombinationBuilder) {
                    setShowOfficialCombinationOptions(false);
                    setShowRouteOptions(false);
                    setRoundSetup((prev) => ({
                      ...prev,
                      selectedCombinationId: null,
                      selectedCombinationTeeId: null,
                      selectedRouteTeeId: getDefaultTeeId(selectedPrimaryRoute?.tees)
                    }));
                  }
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: colors.green,
                  fontSize: "13px",
                  fontWeight: 700,
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: appFont,
                  whiteSpace: "nowrap"
                }}
              >
                {showManualCombinationBuilder ? "Torna ai percorsi" : "Oppure costruisci manualmente il tuo giro"}
              </button>
            </div>
          )}

        {Number(roundSetup.totalCompetitionHoles) === 18 &&
          nineHoleRoutes.length > 0 &&
          (showManualCombinationBuilder || showManualBuilderDirectly) && (
          <>
            <h2 style={roundSetupSectionTitleStyle}>Prime nove</h2>
            <div
              style={{
                marginTop: "-2px",
                marginBottom: "8px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              Scegli da quale percorso vuoi iniziare.
            </div>
            <div
              style={{
                ...roundSetupGridStyle,
                gridTemplateColumns: "1fr"
              }}
            >
              {nineHoleRoutes.map((route) => (
                <div
                  key={`front-${route.id}`}
                  onClick={() => {
                      setShowManualCombinationBuilder(true);
                      setShowTeeOptions(false);
                      setRoundSetup((prev) => {
                        const matchingCombination = findOfficialCombinationByRoutes(
                          openedCourse,
                          route,
                          openedCourse?.routes?.find((item) => item.id === prev.secondaryRouteId) || null
                        );

                        return {
                          ...prev,
                          selectedRouteId: route.id,
                          selectedCombinationId: matchingCombination?.id || null,
                          selectedRouteTeeId: matchingCombination ? null : route.tees?.[0]?.id || null,
                          selectedCombinationTeeId: matchingCombination?.tees?.[0]?.id || null,
                          startHole: 1
                        };
                      });
                    }}
                  style={setupCardOptionStyle(
                    roundSetup.selectedRouteId === route.id && !roundSetup.selectedCombinationId
                  )}
                >
                  <div style={routeNameBlockStyle}>
                    {getRouteColor(route.name) ? renderColorDot(getRouteColor(route.name)) : null}
                    {route.name}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                    9 buche • Par {route.totalPar}
                  </div>
                </div>
              ))}
            </div>

            <h2 style={roundSetupSectionTitleStyle}>Seconde nove</h2>
            <div
              style={{
                ...roundSetupGridStyle,
                gridTemplateColumns: "1fr"
              }}
            >
              {nineHoleRoutes.map((route) => (
                <div
                  key={`back-${route.id}`}
                  onClick={() => {
                      setShowManualCombinationBuilder(true);
                      setShowTeeOptions(false);
                      setRoundSetup((prev) => {
                        const matchingCombination = findOfficialCombinationByRoutes(
                          openedCourse,
                          openedCourse?.routes?.find((item) => item.id === prev.selectedRouteId) || null,
                          route
                        );

                        return {
                          ...prev,
                          secondaryRouteId: route.id,
                          selectedCombinationId: matchingCombination?.id || null,
                          selectedRouteTeeId: matchingCombination
                            ? null
                            : prev.selectedRouteTeeId,
                          selectedCombinationTeeId: matchingCombination?.tees?.[0]?.id || null,
                          startHole: 1
                        };
                      });
                    }}
                  style={setupCardOptionStyle(
                    roundSetup.secondaryRouteId === route.id && !roundSetup.selectedCombinationId
                  )}
                >
                  <div style={routeNameBlockStyle}>
                    {getRouteColor(route.name) ? renderColorDot(getRouteColor(route.name)) : null}
                    {route.name}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                    9 buche • Par {route.totalPar}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: "12px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              Lo Stroke Index può variare in base alla combinazione dei percorsi.
              Fa fede lo scorecard cartaceo ufficiale della gara.
            </div>
          </>
        )}

        {teeOptions.length > 0 && (
          <>
            <div
              style={{
                ...roundSetupSectionTitleStyle,
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}
            >
              <button
                onClick={() => setShowTeeOptions((prev) => !prev)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: colors.green,
                  fontSize: "20px",
                  fontWeight: 800,
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: appFont,
                  lineHeight: 1,
                  flexShrink: 0
                }}
                aria-label={showTeeOptions ? "Chiudi tee" : "Apri tee"}
              >
                {showTeeOptions ? "▴" : "▾"}
              </button>
              <span>Scegli il tee</span>
            </div>
            <div
              style={{
                marginTop: "-4px",
                marginBottom: "12px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              Useremo i dati FIG/WHS disponibili per calcolare l'handicap di gioco.
            </div>
            {showSelectedTeeCard && (
              <div style={{ ...roundSetupInputCardStyle, ...setupCardOptionStyle(true), cursor: "default" }}>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  {renderColorDot(getTeeColor(getTeeDisplayName(selectedTee)), 10)}
                  {getTeeDisplayName(selectedTee)}
                  <span style={{ color: colors.subtext, fontWeight: 500 }}>·</span>
                  <span style={{ color: colors.subtext, fontWeight: 500 }}>
                    {[
                      Number.isFinite(Number(selectedTee.courseRating))
                        ? `CR ${Number(selectedTee.courseRating).toFixed(1)}`
                        : null,
                      Number.isFinite(Number(selectedTee.slopeRating))
                        ? `Slope ${Number(selectedTee.slopeRating)}`
                        : null
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </div>
            )}

            {showTeeCardOptions && (
              <div
                style={{
                  ...roundSetupGridStyle,
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "10px"
                }}
              >
                {teeOptions.map((tee) => {
                  const isSelected = usingOfficialCombination
                    ? roundSetup.selectedCombinationTeeId === tee.id
                    : roundSetup.selectedRouteTeeId === tee.id;

                  return (
                    <div
                      key={tee.id}
                      onClick={() => {
                        setRoundSetup((prev) => ({
                          ...prev,
                          selectedRouteTeeId: usingOfficialCombination ? prev.selectedRouteTeeId : tee.id,
                          selectedCombinationTeeId: usingOfficialCombination
                            ? tee.id
                            : prev.selectedCombinationTeeId
                        }));
                        setShowTeeOptions(false);
                      }}
                      style={{
                        ...setupCardOptionStyle(isSelected),
                        minHeight: "96px",
                        padding: "14px 12px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          justifyContent: "center"
                        }}
                      >
                        {renderColorDot(getTeeColor(getTeeDisplayName(tee)), 10)}
                        {getTeeDisplayName(tee)}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "13px", color: colors.subtext }}>
                        {[
                          Number.isFinite(Number(tee.courseRating))
                            ? `CR ${Number(tee.courseRating).toFixed(1)}`
                            : null,
                          Number.isFinite(Number(tee.slopeRating))
                            ? `Slope ${Number(tee.slopeRating)}`
                            : null
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </>
        )}

        {allowStartHoleSelection && (
          <>
            <h2 style={roundSetupSectionTitleStyle}>Da dove parti?</h2>
            <div
              style={{
                marginTop: "-4px",
                marginBottom: "12px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.5
              }}
            >
              Se giochi in shotgun scegli da quale buca iniziare.
            </div>
            <div
              style={{ overflow: "hidden" }}
              onTouchStart={(event) => {
                const touch = event.touches[0];
                startHoleSwipeRef.current = { x: touch.clientX, y: touch.clientY };
              }}
              onTouchEnd={(event) => {
                const touch = event.changedTouches[0];
                const startX = startHoleSwipeRef.current.x;
                const startY = startHoleSwipeRef.current.y;

                if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
                  startHoleSwipeRef.current = { x: null, y: null };
                  return;
                }

                const deltaX = touch.clientX - startX;
                const deltaY = touch.clientY - startY;
                const horizontalSwipe = Math.abs(deltaX) > 36 && Math.abs(deltaX) > Math.abs(deltaY);

                if (horizontalSwipe) {
                  if (deltaX < 0) {
                    setStartHolePage((prev) => Math.min(maxStartHolePage, prev + 1));
                  } else {
                    setStartHolePage((prev) => Math.max(0, prev - 1));
                  }
                }

                startHoleSwipeRef.current = { x: null, y: null };
              }}
            >
              <div style={{ overflow: "hidden" }}>
                <div
                  style={{
                    display: "flex",
                    width: `${startHolePages.length * 100}%`,
                    transform: `translateX(-${visibleStartHolePage * (100 / startHolePages.length)}%)`,
                    transition: "transform 0.25s ease"
                  }}
                >
                  {startHolePages.map((page, pageIndex) => (
                    <div
                      key={`start-hole-page-${pageIndex}`}
                      style={{
                        width: `${100 / startHolePages.length}%`,
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: "8px",
                        padding: "0 1px",
                        boxSizing: "border-box"
                      }}
                    >
                      {page.map((holeNumber) => (
                        <div
                          key={holeNumber}
                          onClick={() =>
                            setRoundSetup((prev) => ({
                              ...prev,
                              startHole: holeNumber
                            }))
                          }
                          style={{
                            ...setupCardOptionStyle(roundSetup.startHole === holeNumber),
                            padding: "12px 10px",
                            minHeight: "42px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                        >
                          {holeNumber}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {canStartRound && (
        <div style={roundSetupPreviewStyle}>
          <div style={{ color: colors.subtext, fontSize: "13px" }}>Il tuo giro e' pronto</div>
          {sanitizeRoundName(roundSetup.competitionName) && (
            <div
              style={{
                marginTop: "6px",
                color: colors.green,
                fontSize: "13px",
                fontWeight: 700,
                lineHeight: 1.5
              }}
            >
              {sanitizeRoundName(roundSetup.competitionName)}
            </div>
          )}
          <div style={{ marginTop: "8px", fontSize: "17px", fontWeight: 700 }}>
            {roundSetup.totalCompetitionHoles} buche • {previewSummary}
          </div>
          <div
            style={{
              marginTop: "6px",
              color: colors.green,
              fontSize: "14px",
              fontWeight: 700
            }}
          >
            Par {roundSetupTotalPar}
          </div>
          {selectedTee && (
            <div
              style={{
                marginTop: "6px",
                color: colors.subtext,
                fontSize: "13px",
                lineHeight: 1.5,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>Tee</span>
              {renderColorDot(getTeeColor(getTeeDisplayName(selectedTee)), 11)}
              <span>{getTeeDisplayName(selectedTee)}</span>
              {Number.isFinite(Number(selectedTee.courseRating)) && (
                <span>· CR {Number(selectedTee.courseRating).toFixed(1)}</span>
              )}
              {Number.isFinite(Number(selectedTee.slopeRating)) && (
                <span>· Slope {Number(selectedTee.slopeRating)}</span>
              )}
            </div>
          )}
          <div
            style={{
              marginTop: "10px",
              color: colors.text,
              fontSize: "14px",
              lineHeight: 1.6
            }}
          >
            <div>
              <strong>Handicap Index:</strong> {Number(userProfile.hcp).toFixed(1)}
            </div>
            {previewPlayingHandicap !== null && (
              <div style={{ marginTop: "3px", color: colors.green, fontWeight: 700 }}>
                <strong>Handicap di gioco:</strong> {previewPlayingHandicap}
              </div>
            )}
            {playingHandicapDifference !== null && (
              <div style={{ marginTop: "3px", color: colors.subtext, fontSize: "13px" }}>
                {playingHandicapDifference >= 0 ? "+" : ""}
                {playingHandicapDifference} colpi rispetto al tuo Handicap Index
              </div>
            )}
          </div>
          <div
            style={{
              marginTop: "8px",
              color: colors.subtext,
              fontSize: "13px",
              lineHeight: 1.5
            }}
          >
            {allowStartHoleSelection
              ? `Partenza dalla buca ${roundSetup.startHole}.`
              : `Tutto pronto per iniziare.`}
          </div>
        </div>
        )}

        <div
          style={{
            position: "sticky",
            bottom: 0,
            paddingTop: "14px",
            paddingBottom: "8px",
            background:
              theme === "light"
                ? "linear-gradient(180deg, rgba(245,248,244,0) 0%, rgba(245,248,244,0.92) 22%, rgba(245,248,244,1) 100%)"
                : "linear-gradient(180deg, rgba(11,15,13,0) 0%, rgba(11,15,13,0.92) 22%, rgba(11,15,13,1) 100%)"
          }}
        >
          <button onClick={startRound} style={primaryButtonStyle(canStartRound)} disabled={!canStartRound}>
            Inizia il giro
          </button>
        </div>

        {overlayPortal}
      </div>
    );
  }

  if (openedCourse && !showRoundSetup) {
    return (
      <div
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          minHeight: "100vh",
          padding: `20px ${SCREEN_HORIZONTAL_PADDING}`,
          boxSizing: "border-box",
          fontFamily: appFont
        }}
      >
        {topSafeAreaBackdrop}

        <div style={centeredHeaderStyle}>
          <div style={headerLeftButtonWrapStyle}>
            <button
              onClick={closeCourse}
              style={headerCircleButtonStyle()}
              aria-label="Torna alla home"
            >
              <span
                style={{ fontSize: "21px", lineHeight: 1, transform: "translateX(-1px)" }}
              >
                ←
              </span>
            </button>
          </div>

          <div style={headerTitleTextStyle}>Scorecard</div>

          <div style={headerRightButtonWrapStyle}>
            <button
              onClick={() => {
                setSheetClosing(false);
                setActiveSheet("menu");
              }}
              style={headerCircleButtonStyle({ fontSize: "18px" })}
              title="Apri menu"
              aria-label="Apri menu"
            >
              <span
                style={{ fontSize: "18px", lineHeight: 1, transform: "translateY(-1px)" }}
              >
                ≡
              </span>
            </button>
          </div>
        </div>

        <div style={scorecardTopCardStyle}>
          <div style={{ fontSize: "24px", fontWeight: 700 }}>
  {openedCourse.name}
</div>

{roundSetup.competitionName && (
  <div
    style={{
      marginTop: "6px",
      fontSize: "14px",
      color: colors.green,
      fontWeight: 600
    }}
  >
    {roundSetup.competitionName}
  </div>
)}

          <div
            style={{
              marginTop: "10px",
              color: colors.subtext,
              fontSize: "14px",
              lineHeight: 1.5
            }}
          >
            {roundSetup.totalCompetitionHoles} buche • partenza dalla {roundSetup.startHole}
          </div>

          <div
            style={{
              marginTop: "12px",
              color: colors.subtext,
              fontSize: "13px"
            }}
          >
            {userProfile.playerName} • HCP{" "}
            <span style={getHcpValueFeedbackStyle(hcpHighlightActive, colors.subtext)}>
              {userProfile.hcp}
            </span>
          </div>

        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginTop: "18px"
          }}
        >
          <div style={scorecardSummaryCardStyle}>
            <div style={{ color: colors.subtext, fontSize: "13px" }}>Lordo</div>
            <div style={{ marginTop: "6px", fontSize: "26px", fontWeight: 700 }}>
              {grossTotal}
            </div>
          </div>

          <div style={scorecardSummaryCardStyle}>
            <div style={{ color: colors.subtext, fontSize: "13px" }}>Stableford</div>
            <div
              style={{
                marginTop: "6px",
                fontSize: "26px",
                fontWeight: 700,
                color: colors.green
              }}
            >
              {stablefordTotal}
            </div>
          </div>
        </div>

        <div
          style={{
            ...scorecardSummaryCardStyle,
            marginTop: "12px"
          }}
        >
          <div style={{ color: colors.subtext, fontSize: "13px" }}>
            HCP stimato dopo il giro
          </div>
          <div
            style={{
              marginTop: "6px",
              fontSize: "24px",
              fontWeight: 700,
              color: colors.green
            }}
          >
            <span style={getHcpValueFeedbackStyle(estimatedHcpHighlightActive, colors.green)}>
              {estimatedHcpAfterRound}
            </span>
          </div>
          <div
            style={{
              marginTop: "8px",
              color: colors.subtext,
              fontSize: "12px",
              lineHeight: 1.5
            }}
          >
            Stima indicativa. L’HCP ufficiale viene calcolato con un algoritmo più
            complesso: attendi dopo le 00:00 del giorno successivo alla gara e
            verifica nell’app FIG.
          </div>
        </div>

        {competitionHoles.length > 0 ? (
          competitionHoles.map((hole, index) => {
            const automaticReceivedShots = getAutomaticReceivedShots(
              userProfile.hcp,
              hole.strokeIndex
            );
            const effectiveReceivedShots = getEffectiveReceivedShots(
              index,
              userProfile.hcp,
              hole.strokeIndex
            );
            const isManual = manualReceivedShots[index] !== undefined;
            const stablefordPoints = getStablefordPoints(
              hole.par,
              roundScores[index],
              effectiveReceivedShots
            );

            return (
              <div
                key={`${hole.competitionHoleNumber}-${hole.courseHoleNumber}-${index}`}
                style={scorecardHoleCardStyle}
              >
                <div
                  style={{
                    color: colors.subtext,
                    fontSize: "13px",
                    marginBottom: "8px"
                  }}
                >
                  Giro {hole.roundNumber} di {hole.totalRounds}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "12px"
                  }}
                >
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: 700 }}>
                      Buca {hole.competitionHoleNumber}
                    </div>
                    <div
                      style={{
                        marginTop: "6px",
                        color: colors.subtext,
                        fontSize: "14px"
                      }}
                    >
                      ⛳️ {hole.courseHoleNumber}
                    </div>
                  </div>

                  <div
                    style={{
                      color: colors.green,
                      fontSize: "14px",
                      fontWeight: 700
                    }}
                  >
                    {stablefordPoints} pt
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    marginTop: "14px"
                  }}
                >
                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: "999px",
                      backgroundColor: colors.pillBg,
                      border: `1px solid ${colors.pillBorder}`,
                      color: colors.text,
                      fontSize: "13px"
                    }}
                  >
                    Par {hole.par}
                  </div>

                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: "999px",
                      backgroundColor: colors.pillBg,
                      border: `1px solid ${colors.pillBorder}`,
                      color: colors.text,
                      fontSize: "13px"
                    }}
                  >
                    SI {hole.strokeIndex}
                  </div>

                  <button
                    onClick={() =>
                      cycleReceivedShotsValue(index, automaticReceivedShots)
                    }
                    style={{
                      minWidth: "56px",
                      padding: "8px 12px",
                      borderRadius: "999px",
                      backgroundColor: isManual
                        ? colors.greenManualBg
                        : colors.greenDark,
                      border: isManual
                        ? `1px solid ${colors.greenManualBorder}`
                        : `1px solid ${colors.greenBorder}`,
                      color: colors.green,
                      fontSize: "13px",
                      cursor: "pointer",
                      fontFamily: appFont,
                      fontWeight: 600
                    }}
                  >
                    {receivedShotsToSymbols(effectiveReceivedShots)}
                  </button>
                </div>

                <div style={{ marginTop: "14px" }}>
                  <div
                    style={{
                      color: colors.subtext,
                      fontSize: "13px",
                      marginBottom: "10px"
                    }}
                  >
                    Colpi fatti
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: "10px" }}
                  >
                    <button
                      onClick={() => adjustRoundScore(index, -1)}
                      style={themedStepperButtonStyle}
                    >
                      -
                    </button>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={roundScores[index]}
                      onChange={(e) => handleScoreInputChange(index, e.target.value)}
                      onBlur={() => normalizeScoreInput(index)}
                      placeholder="0"
                      style={stepperInputStyle}
                    />

                    <button
                      onClick={() => adjustRoundScore(index, 1)}
                      style={themedStepperButtonStyle}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div
            style={{
              color: colors.subtext,
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "14px",
              padding: "18px",
              marginTop: "14px"
            }}
          >
            Per questo campo non c’è ancora una mappatura completa.
          </div>
        )}

        <button
          onClick={saveRound}
          disabled={roundAlreadySaved}
          style={primaryButtonStyle(!roundAlreadySaved)}
        >
          {roundAlreadySaved ? "Giro salvato" : "Salva giro"}
        </button>

        {showRoundsHistory && (
          <div style={{ marginTop: "14px" }}>
            <h2 style={{ ...titleStyle, marginTop: "0" }}>Storico</h2>

            {roundsForOpenedCourse.length === 0 ? (
              <div
                style={{
                  color: colors.subtext,
                  backgroundColor: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "14px",
                  padding: "18px"
                }}
              >
                Nessun giro salvato per questo campo.
              </div>
            ) : (
              roundsForOpenedCourse.map((round) => (
                <div
                  key={round.id}
                  style={{
                    backgroundColor: colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "16px",
                    padding: "18px",
                    marginBottom: "12px"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "12px",
                      marginBottom: "6px"
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 700 }}>
                      {round.savedName}
                    </div>
                    <button
                      onClick={() => deleteRound(round.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: colors.subtext,
                        cursor: "pointer",
                        fontFamily: appFont,
                        fontSize: "12px",
                        padding: 0
                      }}
                    >
                      Elimina
                    </button>
                  </div>

                  <div
                    style={{
                      color: colors.subtext,
                      fontSize: "12px"
                    }}
                  >
                    {round.formattedDate}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginTop: "12px"
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.pillBg,
                        border: `1px solid ${colors.pillBorder}`,
                        fontSize: "13px"
                      }}
                    >
                      Lordo {round.grossTotal}
                    </div>

                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.pillBg,
                        border: `1px solid ${colors.pillBorder}`,
                        fontSize: "13px"
                      }}
                    >
                      Netto {round.netTotal}
                    </div>

                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        backgroundColor: colors.greenDark,
                        border: `1px solid ${colors.greenBorder}`,
                        color: colors.green,
                        fontSize: "13px"
                      }}
                    >
                      Stableford {round.stablefordTotal}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: "10px",
                      color: colors.subtext,
                      fontSize: "12px"
                    }}
                  >
                    HCP stimato {round.estimatedHcpAfterRound}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {overlayPortal}

      </div>
    );
  }

  if (showPrivacyScreen) {
    return (
      <div
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          minHeight: "100vh",
          padding: `20px ${SCREEN_HORIZONTAL_PADDING}`,
          boxSizing: "border-box",
          fontFamily: appFont
        }}
      >
        {topSafeAreaBackdrop}

        <div style={centeredHeaderStyle}>
          <div style={headerLeftButtonWrapStyle}>
            <button
              onClick={() => setShowPrivacyScreen(false)}
              style={headerCircleButtonStyle()}
              aria-label="Torna indietro"
            >
              <span
                style={{ fontSize: "21px", lineHeight: 1, transform: "translateX(-1px)" }}
              >
                ←
              </span>
            </button>
          </div>

          <div style={headerTitleTextStyle}>Privacy</div>

          <div style={headerRightButtonWrapStyle}>
            <button
              onClick={() => {
                setSheetClosing(false);
                setActiveSheet("menu");
              }}
              style={headerCircleButtonStyle({ fontSize: "18px" })}
              title="Apri menu"
              aria-label="Apri menu"
            >
              <span
                style={{ fontSize: "18px", lineHeight: 1, transform: "translateY(-1px)" }}
              >
                ≡
              </span>
            </button>
          </div>
        </div>

        <div
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: "20px",
            padding: "22px 20px",
            lineHeight: 1.6
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 700, marginBottom: "18px" }}>
            Privacy
          </div>

          <p style={{ margin: "0 0 18px 0", color: colors.subtext }}>
            Raccogliamo solo le informazioni necessarie per far funzionare l’app.
          </p>

          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>
            Dati utilizzati
          </div>
          <p style={{ margin: "0 0 8px 0", color: colors.subtext }}>
            - Email per l’accesso.
          </p>
          <p style={{ margin: "0 0 8px 0", color: colors.subtext }}>
            - Nome giocatore e HCP per gestire i tuoi giri.
          </p>
          <p style={{ margin: "0 0 18px 0", color: colors.subtext }}>
            - Dati dei giri salvati nel tuo account.
          </p>

          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>
            Come usiamo i dati
          </div>
          <p style={{ margin: "0 0 8px 0", color: colors.subtext }}>
            I dati vengono utilizzati solo per:
          </p>
          <p style={{ margin: "0 0 8px 0", color: colors.subtext }}>
            - permetterti di accedere,
          </p>
          <p style={{ margin: "0 0 8px 0", color: colors.subtext }}>
            - salvare i tuoi giri,
          </p>
          <p style={{ margin: "0 0 18px 0", color: colors.subtext }}>
            - migliorare l’esperienza di gioco.
          </p>

          <p style={{ margin: "0 0 18px 0", color: colors.subtext }}>
            Non vendiamo né condividiamo i tuoi dati con terze parti.
          </p>

          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>
            Accesso e controllo
          </div>
          <p style={{ margin: "0 0 18px 0", color: colors.subtext }}>
            Puoi modificare i tuoi dati in qualsiasi momento dalla sezione Giocatore.
          </p>

          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>
            Contatto
          </div>
          <p style={{ margin: 0, color: colors.subtext }}>
            Per qualsiasi domanda puoi contattarci via email.
          </p>
        </div>

        {overlayPortal}
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        minHeight: "100vh",
        padding: `20px ${SCREEN_HORIZONTAL_PADDING}`,
        boxSizing: "border-box",
        fontFamily: appFont
      }}
    >
      {topSafeAreaBackdrop}

      <div style={homeHeaderStyle}>
        <div style={headerLeftButtonWrapStyle}>
          <button
            onClick={openDialog}
            style={{
              ...headerCircleButtonStyle({
                borderColor: colors.green,
                fontSize: "24px"
              }),
              boxShadow: searchEmptyHintPulse
                ? isLight
                  ? "0 0 0 6px rgba(46, 204, 113, 0.10), 0 8px 20px rgba(17, 24, 39, 0.08)"
                  : "0 0 0 6px rgba(46, 204, 113, 0.12), 0 10px 24px rgba(0, 0, 0, 0.34)"
                : headerCircleButtonBaseStyle.boxShadow,
              transform: searchEmptyHintPulse ? "scale(1.04)" : "scale(1)",
              transition: "transform 0.35s ease, box-shadow 0.35s ease"
            }}
            aria-label="Aggiungi club"
          >
            <span style={{ fontSize: "24px", lineHeight: 1, transform: "translateY(-1px)" }}>
              +
            </span>
          </button>
        </div>

        <div aria-hidden="true" />

        <div style={headerRightButtonWrapStyle}>
          <button
            onClick={() => {
              setSheetClosing(false);
              setActiveSheet("menu");
            }}
            style={headerCircleButtonStyle({ fontSize: "18px" })}
            title="Apri menu"
            aria-label="Apri menu"
          >
            <span
              style={{ fontSize: "18px", lineHeight: 1, transform: "translateY(-1px)" }}
            >
              ≡
            </span>
          </button>
        </div>
      </div>

      <div style={homeIdentityRowStyle}>
        <div style={homeHeaderIdentityStyle}>
          <button onClick={openHcpEditor} style={homeNameButtonStyle} title={userProfile.playerName}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: colors.text,
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {userProfile.playerName}
            </div>
          </button>
        </div>

        <button onClick={openHcpEditor} style={homeHcpPillStyle}>
          HCP{" "}
          <span style={getHcpValueFeedbackStyle(hcpHighlightActive, colors.subtext)}>
            {userProfile.hcp}
          </span>
        </button>
      </div>

      <h2 style={homeSectionTitleStyle}>Club preferiti</h2>
      <div style={homePrimarySectionCardStyle}>
        {favorites.length === 0 ? (
          <div
            style={{
              color: colors.subtext,
              lineHeight: 1.6,
              padding: `14px ${CARD_ROW_HORIZONTAL_PADDING}`
            }}
          >
            Non hai ancora club preferiti. Cercane uno oppure aggiungilo con +.
          </div>
        ) : (
          favorites.map((course) => renderCourseRow(course, { showDivider: false }))
        )}
      </div>

      <h2 style={homeSectionTitleStyle}>Cerca un club</h2>
      <div style={homeSectionCardStyle}>
        <div
          style={homeSearchInnerStyle}
        >
          <div style={{ color: colors.subtext, fontSize: "16px" }}>⌕</div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca o aggiungi un club"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: colors.text,
              fontSize: "15px",
              fontFamily: appFont
            }}
          />
        </div>

        {searchQuery.trim() !== "" && (
          <div style={{ marginTop: "12px" }}>
            {filteredCourses.length > 0 ? (
              filteredCourses.map((course) => renderCourseRow(course))
            ) : (
              <div style={homeSearchEmptyStateStyle}>
                <div style={homeSearchEmptyTextStyle}>
                  <div>Club non trovato</div>
                </div>

                <button onClick={openDialog} style={homeSearchEmptyCtaStyle}>
                  Aggiungi club
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {overlayPortal}

      {showDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: colors.overlay,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
            boxSizing: "border-box",
            zIndex: 30
          }}
        >
          <div
            style={{
              backgroundColor: colors.card,
              padding: "18px",
              borderRadius: "18px",
              width: "100%",
              maxWidth: "390px",
              maxHeight: "90vh",
              overflowY: "auto",
              border: `1px solid ${colors.border}`,
              boxSizing: "border-box",
              fontFamily: appFont
            }}
          >
            {dialogStep === 1 && (
              <>
                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  Aggiungi club
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "16px",
                    lineHeight: 1.4
                  }}
                >
                  Inserisci il nome del club.
                </p>

                <input
                  type="text"
                  placeholder="Nome club"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "13px 14px",
                    backgroundColor: colors.inputBg,
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: "12px",
                    color: colors.text,
                    boxSizing: "border-box",
                    outline: "none",
                    fontSize: "15px",
                    fontFamily: appFont
                  }}
                />

                <button
                  onClick={goToStepTwo}
                  disabled={courseName.trim() === ""}
                  style={primaryButtonStyle(courseName.trim() !== "")}
                >
                  Continua
                </button>

                <button onClick={closeDialog} style={secondaryButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 2 && (
              <>
                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  Quanti percorsi ha il club?
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "20px",
                    lineHeight: 1.4
                  }}
                >
                  Scegli il tipo di club che vuoi aggiungere.
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "12px"
                  }}
                >
                  {[
                    {
                      id: "single",
                      title: "1 percorso",
                      description: "Apri il builder manuale per mappare il club."
                    },
                    {
                      id: "multiple",
                      title: "Più percorsi",
                      description: "Per i club complessi configuriamo noi i dati ufficiali."
                    }
                  ].map((option) => (
                    <div
                      key={option.id}
                      onClick={() => setClubCreationMode(option.id)}
                      style={{
                        flex: 1,
                        padding: "16px",
                        backgroundColor: colors.inputBg,
                        border:
                          clubCreationMode === option.id
                            ? `1px solid ${colors.green}`
                            : `1px solid ${colors.inputBorder}`,
                        borderRadius: "14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer"
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "16px" }}>{option.title}</div>
                        <div
                          style={{
                            marginTop: "4px",
                            color: colors.subtext,
                            fontSize: "13px",
                            lineHeight: 1.5
                          }}
                        >
                          {option.description}
                        </div>
                      </div>
                      <div
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          border:
                            clubCreationMode === option.id
                              ? `2px solid ${colors.green}`
                              : `2px solid ${colors.borderStrong}`,
                          backgroundColor:
                            clubCreationMode === option.id ? colors.green : "transparent"
                        }}
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    if (clubCreationMode === "single") {
                      goToIntroStep();
                    } else if (clubCreationMode === "multiple") {
                      setDialogStep(7);
                    }
                  }}
                  disabled={!clubCreationMode}
                  style={primaryButtonStyle(Boolean(clubCreationMode))}
                >
                  Continua
                </button>

                <button onClick={goBackToStepOne} style={secondaryButtonStyle}>
                  Indietro
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 7 && (
              <>
                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  Richiedi questo club
                </h3>

                <p
                  style={{
                    color: colors.text,
                    fontSize: "15px",
                    marginTop: 0,
                    marginBottom: "14px",
                    lineHeight: 1.6
                  }}
                >
                  Questo club ha più percorsi o combinazioni ufficiali.
                  <br />
                  Per garantirti dati corretti, lo configuriamo noi.
                </p>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "18px",
                    lineHeight: 1.6
                  }}
                >
                  Non trovi un club con più percorsi o combinazioni ufficiali? Richiedilo e ti avviseremo via email quando sarà pronto.
                </p>

                {clubRequestFeedback && (
                  <div
                    style={{
                      marginBottom: "14px",
                      color: clubRequestFeedback.toLowerCase().includes("errore")
                        ? "#d64545"
                        : colors.green,
                      fontSize: "13px",
                      lineHeight: 1.5
                    }}
                  >
                    {clubRequestFeedback}
                  </div>
                )}

                <button
                  onClick={() => submitClubRequest()}
                  disabled={clubRequestSubmitting}
                  style={primaryButtonStyle(!clubRequestSubmitting)}
                >
                  {clubRequestSubmitting ? "Invio in corso..." : "Richiedi questo club"}
                </button>

                <button onClick={() => setDialogStep(2)} style={secondaryButtonStyle}>
                  Indietro
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 3 && (
              <>
                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  {routeCount === 1
                    ? "Il tuo percorso"
                    : `Percorso ${currentRouteIndex + 1} di ${routeCount}`}
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "20px",
                    lineHeight: 1.4
                  }}
                >
                  {routeCount === 1
                    ? "Scegli se il club ha un percorso da 9 o 18 buche."
                    : "Dai un nome al percorso e scegli quante buche ha."}
                </p>

                {routeCount > 1 && (
                  <input
                    type="text"
                    placeholder={`Nome percorso ${currentRouteIndex + 1}`}
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "13px 14px",
                      backgroundColor: colors.inputBg,
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: "12px",
                      color: colors.text,
                      boxSizing: "border-box",
                      outline: "none",
                      fontSize: "15px",
                      fontFamily: appFont,
                      marginBottom: "16px"
                    }}
                  />
                )}

                <div style={{ display: "flex", gap: "12px" }}>
                  <div
                    onClick={() => setHolesCount(9)}
                    style={{
                      flex: 1,
                      padding: "16px",
                      backgroundColor: colors.inputBg,
                      border:
                        holesCount === 9
                          ? `1px solid ${colors.green}`
                          : `1px solid ${colors.inputBorder}`,
                      borderRadius: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer"
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "16px" }}>9 buche</span>
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        border:
                          holesCount === 9
                            ? `2px solid ${colors.green}`
                            : `2px solid ${colors.borderStrong}`,
                        backgroundColor:
                          holesCount === 9 ? colors.green : "transparent"
                      }}
                    />
                  </div>

                  <div
                    onClick={() => setHolesCount(18)}
                    style={{
                      flex: 1,
                      padding: "16px",
                      backgroundColor: colors.inputBg,
                      border:
                        holesCount === 18
                          ? `1px solid ${colors.green}`
                          : `1px solid ${colors.inputBorder}`,
                      borderRadius: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer"
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "16px" }}>18 buche</span>
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        border:
                          holesCount === 18
                            ? `2px solid ${colors.green}`
                            : `2px solid ${colors.borderStrong}`,
                        backgroundColor:
                          holesCount === 18 ? colors.green : "transparent"
                      }}
                    />
                  </div>
                </div>

                <button
                  onClick={saveRouteDetails}
                  disabled={!holesCount || (routeCount > 1 && routeName.trim() === "")}
                  style={primaryButtonStyle(
                    Boolean(holesCount) && (routeCount === 1 || routeName.trim() !== "")
                  )}
                >
                  {currentRouteIndex === routeCount - 1 ? "Continua" : "Prossimo percorso"}
                </button>

                <button
                  onClick={currentRouteIndex === 0 ? goBackToStepTwoFromIntro : () => syncCurrentRouteEditor(currentRouteIndex - 1)}
                  style={secondaryButtonStyle}
                >
                  Indietro
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 4 && (
              <>
                <div
                  style={{
                    width: "70px",
                    height: "70px",
                    borderRadius: "35px",
                    backgroundColor: colors.greenDark,
                    border: `1px solid ${colors.greenBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "28px",
                    margin: "0 auto 18px auto"
                  }}
                >
                  ⛳️
                </div>

                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "10px",
                    fontSize: "24px",
                    fontWeight: 700,
                    textAlign: "center"
                  }}
                >
                  {currentRouteDraft.name}
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "15px",
                    marginTop: 0,
                    marginBottom: "10px",
                    lineHeight: 1.5,
                    textAlign: "center"
                  }}
                >
                  Ora mappiamo il percorso buca per buca.
                </p>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "18px",
                    lineHeight: 1.5,
                    textAlign: "center"
                  }}
                >
                  Alla fine vedrai il riepilogo completo del club e potrai controllare
                  Par e Stroke Index di ogni percorso.
                </p>

                <button onClick={startMapping} style={primaryButtonStyle(true)}>
                  Inizia
                </button>

                <button onClick={goBackToRouteDetails} style={secondaryButtonStyle}>
                  Indietro
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 5 && (
              <>
                <div
                  style={{
                    color: colors.subtext,
                    fontSize: "13px",
                    marginBottom: "10px"
                  }}
                >
                  {currentRouteDraft.name} · Buca {currentHoleIndex + 1} di {holesCount}
                </div>

                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    backgroundColor: colors.cardSecondary,
                    borderRadius: "999px",
                    overflow: "hidden",
                    marginBottom: "20px"
                  }}
                >
                  <div
                    style={{
                      width: `${((currentHoleIndex + 1) / holesCount) * 100}%`,
                      height: "100%",
                      backgroundColor: colors.green,
                      transition: "width 0.25s ease"
                    }}
                  />
                </div>

                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  Buca {currentHole.hole}
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "18px",
                    lineHeight: 1.5
                  }}
                >
                  Inserisci il Par e lo Stroke Index.
                </p>

                <div
                  onClick={() => setSelectedStepper("par")}
                  style={stepperCardStyle(selectedStepper === "par")}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      color: colors.subtext,
                      marginBottom: "8px"
                    }}
                  >
                    Par
                  </label>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: "10px" }}
                  >
                    <button
                      onClick={() => adjustPar(-1)}
                      style={themedStepperButtonStyle}
                    >
                      -
                    </button>

                    <div style={stepperValueStyle}>{currentHole.par}</div>

                    <button
                      onClick={() => adjustPar(1)}
                      style={themedStepperButtonStyle}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div
                  onClick={() => setSelectedStepper("stroke")}
                  style={stepperCardStyle(selectedStepper === "stroke")}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "8px"
                    }}
                  >
                    <label style={{ fontSize: "14px", color: colors.subtext }}>
                      Stroke Index
                    </label>

                    {currentHoleIndex === 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowStrokeInfo((prev) => !prev);
                        }}
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          border: `1px solid ${colors.borderStrong}`,
                          backgroundColor: colors.inputBg,
                          color: colors.subtext,
                          fontSize: "12px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          fontFamily: appFont
                        }}
                      >
                        i
                      </button>
                    )}
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: "10px" }}
                  >
                    <button
                      onClick={() => adjustStrokeIndex(-1)}
                      style={themedStepperButtonStyle}
                    >
                      -
                    </button>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={currentHole.strokeIndex}
                      onChange={(e) => handleStrokeInputChange(e.target.value)}
                      onBlur={normalizeStrokeInput}
                      placeholder="0"
                      style={stepperInputStyle}
                    />

                    <button
                      onClick={() => adjustStrokeIndex(1)}
                      style={themedStepperButtonStyle}
                    >
                      +
                    </button>
                  </div>
                </div>

                {currentHoleIndex === 0 && showStrokeInfo && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "14px",
                      backgroundColor: colors.cardSecondary,
                      border: `1px solid ${colors.border}`,
                      borderRadius: "12px",
                      color: colors.subtext,
                      fontSize: "13px",
                      lineHeight: 1.5
                    }}
                  >
                    Lo Stroke Index serve a determinare su quali buche ricevi più
                    colpi in base al tuo handicap di gioco. Se non conosci questo
                    dato chiedilo alla segreteria del campo.
                  </div>
                )}

                <button
                  onClick={nextHole}
                  disabled={!currentHoleCompleted}
                  style={primaryButtonStyle(currentHoleCompleted)}
                >
                  {currentHoleIndex === holesCount - 1
                    ? currentRouteIndex === routeCount - 1
                      ? "Vai al riepilogo"
                      : "Percorso successivo"
                    : "Avanti"}
                </button>

                <button onClick={previousHole} style={secondaryButtonStyle}>
                  {currentHoleIndex === 0 ? "Indietro" : "Buca precedente"}
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}

            {dialogStep === 6 && (
              <>
                <h3
                  style={{
                    marginTop: 0,
                    marginBottom: "8px",
                    fontSize: "24px",
                    fontWeight: 700
                  }}
                >
                  Riepilogo club
                </h3>

                <p
                  style={{
                    color: colors.subtext,
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "18px",
                    lineHeight: 1.5
                  }}
                >
                  Controlla la mappatura completa di {courseName}.
                </p>

                {routeDrafts.map((route) => {
                  const routeTotalPar = (route.holes || []).reduce(
                    (sum, hole) => sum + Number(hole.par || 0),
                    0
                  );

                  return (
                    <div key={route.name} style={{ marginBottom: "18px" }}>
                      <div
                        style={{
                          fontSize: "18px",
                          fontWeight: 600,
                          marginBottom: "10px"
                        }}
                      >
                        {route.name}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "70px 1fr 1fr",
                          gap: "10px",
                          marginBottom: "12px",
                          fontSize: "13px",
                          color: colors.subtext,
                          padding: "0 4px"
                        }}
                      >
                        <div>Buca</div>
                        <div>Par</div>
                        <div>Stroke Index</div>
                      </div>

                      {(route.holes || []).map((hole) => (
                        <div
                          key={`${route.name}-${hole.hole}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "70px 1fr 1fr",
                            gap: "10px",
                            alignItems: "center",
                            marginBottom: "10px"
                          }}
                        >
                          <div
                            style={{
                              height: "42px",
                              display: "flex",
                              alignItems: "center",
                              paddingLeft: "10px",
                              borderRadius: "10px",
                              backgroundColor: colors.inputBg,
                              border: `1px solid ${colors.inputBorder}`
                            }}
                          >
                            {hole.hole}
                          </div>

                          <div
                            style={{
                              height: "42px",
                              display: "flex",
                              alignItems: "center",
                              paddingLeft: "12px",
                              borderRadius: "10px",
                              backgroundColor: colors.inputBg,
                              border: `1px solid ${colors.inputBorder}`
                            }}
                          >
                            {hole.par}
                          </div>

                          <div
                            style={{
                              height: "42px",
                              display: "flex",
                              alignItems: "center",
                              paddingLeft: "12px",
                              borderRadius: "10px",
                              backgroundColor: colors.inputBg,
                              border: `1px solid ${colors.inputBorder}`
                            }}
                          >
                            {hole.strokeIndex}
                          </div>
                        </div>
                      ))}

                      <div
                        style={{
                          marginTop: "8px",
                          color: colors.subtext,
                          fontSize: "13px"
                        }}
                      >
                        {route.holesCount} buche • Par {routeTotalPar}
                      </div>
                    </div>
                  );
                })}

                <div
                  style={{
                    marginTop: "12px",
                    color: colors.subtext,
                    fontSize: "13px",
                    lineHeight: 1.5
                  }}
                >
                  Una volta salvato, il club resterà nel sistema e potrà essere
                  richiamato senza rimappatura.
                </div>

                {courseSaveError && (
                  <div
                    style={{
                      marginTop: "14px",
                      color: "#d64545",
                      fontSize: "13px",
                      lineHeight: 1.5
                    }}
                  >
                    {courseSaveError}
                  </div>
                )}

                <button onClick={saveCourse} style={primaryButtonStyle(true)}>
                  {courseSaveLoading ? "Salvataggio in corso..." : "Salva club"}
                </button>

                <button onClick={goBackFromSummary} style={secondaryButtonStyle}>
                  Modifica ultima buca
                </button>

                <button onClick={closeDialog} style={subtleButtonStyle}>
                  Annulla
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
