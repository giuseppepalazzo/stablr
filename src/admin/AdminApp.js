import { useEffect, useState } from "react";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import "./AdminApp.css";

const ADMIN_MANIFEST_PATH = "/admin.webmanifest";
const ADMIN_ICON_PATH = "/stablr-admin-icon.svg";

const NAVIGATION = [
  "Panoramica",
  "Club e percorsi",
  "Revisioni",
  "Community",
  "Utenti e giri",
  "Avanzata"
];

const CLUB_FILTERS = ["Tutti", "Pubblicati", "In revisione", "Dati incompleti", "Modifiche FIG"];

const emptyAdminData = {
  loading: true,
  clubs: [],
  requests: null,
  reports: null,
  catalogAvailable: true
};

function isTrue(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

export function getClubFilter(club) {
  const payload = club?.source_payload || {};
  const needsReview = String(club?.data_status || "").toLowerCase() === "needs_review";
  if (club?.playable === false && needsReview) return "Dati incompleti";
  if (club?.playable !== false && needsReview) return "In revisione";
  if (isTrue(payload.fig_change_pending) || isTrue(payload.fig_update_pending)) return "Modifiche FIG";
  return "Pubblicati";
}

function getClubStatusLabel(filter) {
  return filter === "Pubblicati" ? "Pubblicato" : filter;
}

function formatActivity(dateValue) {
  if (!dateValue) return "—";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(date);
}

function buildQueue(label, section, rows, getLabel) {
  if (rows === null) {
    return { label, section, count: "—", items: ["Dato non disponibile"] };
  }
  return {
    label,
    section,
    count: rows.length,
    items: rows.slice(0, 4).map(getLabel)
  };
}

export function filterCatalogClubs(clubs, query, filter) {
  const normalizedQuery = query.trim().toLocaleLowerCase("it");

  return clubs.filter((club) => {
    const matchesFilter = filter === "Tutti" || club.filter === filter;
    const searchable = `${club.name} ${club.city} ${club.courseNames.join(" ")} ${club.figCode || ""}`.toLocaleLowerCase("it");
    return matchesFilter && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
}

function setAdminDocumentMetadata() {
  const manifest = document.querySelector('link[rel="manifest"]');
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  const themeColor = document.querySelector('meta[name="theme-color"]');

  document.title = "STABLR Admin";
  document.documentElement.setAttribute("data-stablr-theme", "dark");
  if (manifest) manifest.setAttribute("href", ADMIN_MANIFEST_PATH);
  if (appleIcon) appleIcon.setAttribute("href", ADMIN_ICON_PATH);
  if (themeColor) themeColor.setAttribute("content", "#0b2a21");
}

function AdminBrand() {
  return (
    <div className="stablr-admin-brand" aria-label="STABLR Admin">
      <span>STABLR</span>
      <small>ADMIN</small>
    </div>
  );
}

function AdminLogin({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requestCode = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("Inserisci l’email.");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    const { error: requestError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false }
    });
    setSubmitting(false);

    if (requestError) {
      setError("Non è stato possibile inviare il codice. Verifica l’email e riprova.");
      return;
    }

    setStep("code");
    setMessage("Controlla la tua email e inserisci il codice ricevuto.");
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    if (!code.trim()) {
      setError("Inserisci il codice.");
      return;
    }

    setSubmitting(true);
    setError("");
    const {
      data: { session },
      error: verifyError
    } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email"
    });
    setSubmitting(false);

    if (verifyError || !session) {
      setError("Codice non valido o scaduto.");
      return;
    }

    onAuthenticated(session);
  };

  return (
    <main className="stablr-admin-auth">
      <section className="stablr-admin-auth-card">
        <AdminBrand />
        <h1>Accesso amministratore</h1>
        <p>Accedi con il tuo account STABLR autorizzato.</p>
        <form onSubmit={step === "email" ? requestCode : verifyCode}>
          {step === "email" ? (
            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@email.it"
              />
            </label>
          ) : (
            <label>
              Codice di accesso
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Codice ricevuto via email"
              />
            </label>
          )}
          {message && <p className="stablr-admin-form-message">{message}</p>}
          {error && <p className="stablr-admin-form-error">{error}</p>}
          <button className="stablr-admin-white-button" disabled={submitting} type="submit">
            {submitting ? "Attendi…" : step === "email" ? "Invia codice" : "Verifica accesso"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminDenied({ onSignOut }) {
  return (
    <main className="stablr-admin-auth">
      <section className="stablr-admin-auth-card">
        <AdminBrand />
        <h1>Accesso non autorizzato</h1>
        <p>Questo account non dispone del ruolo Admin richiesto da STABLR Admin.</p>
        <button className="stablr-admin-white-button" onClick={onSignOut} type="button">
          Esci
        </button>
      </section>
    </main>
  );
}

function EmptySection({ section }) {
  return (
    <section className="stablr-admin-empty-section">
      <h1>{section}</h1>
      <p>Questa sezione sarà disponibile prossimamente.</p>
    </section>
  );
}

function Overview({ queues, clubs, loading, catalogAvailable, onViewAll, onOpenClub }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Tutti");
  const previewClubs = filterCatalogClubs(clubs, query, filter).slice(0, 4);

  return (
    <div className="stablr-admin-overview">
      <header className="stablr-admin-page-header">
        <div>
          <h1>Panoramica</h1>
          <p>Le attività che richiedono una decisione.</p>
        </div>
        <button className="stablr-admin-white-button" type="button" disabled>
          + Nuovo club
        </button>
      </header>

      <section className="stablr-admin-queue-grid" aria-label="Coda di lavoro">
        {queues.map((card) => (
          <article className="stablr-admin-metric-card" key={card.label}>
            <div className="stablr-admin-metric-heading">
              <p>{card.label}</p>
              <strong>{card.count}</strong>
            </div>
            {card.items.length > 0 && (
              <ul>
                {card.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            <button onClick={() => onViewAll(card.section)} type="button">Vedi tutto</button>
          </article>
        ))}
      </section>

      <section className="stablr-admin-decision-section">
        <h2>Da decidere ora</h2>
        {queues.every((queue) => Number(queue.count) <= 0) ? (
          <article className="stablr-admin-empty-card">
            <strong>Nessun elemento richiede una decisione.</strong>
            <span>Le revisioni e le segnalazioni aperte compariranno qui.</span>
          </article>
        ) : (
          queues
            .filter((queue) => Number(queue.count) > 0)
            .slice(0, 2)
            .map((queue) => (
              <article className="stablr-admin-decision-card" key={queue.label}>
                <div>
                  <strong>{queue.items[0] || queue.label}</strong>
                  <span>{queue.label}</span>
                </div>
                <button onClick={() => onViewAll(queue.section)} type="button">Apri</button>
              </article>
            ))
        )}
      </section>

      <section className="stablr-admin-overview-catalog" aria-label="Accesso rapido al catalogo">
        <header className="stablr-admin-overview-catalog-header">
          <div>
            <h2>Club e percorsi</h2>
            <p>Ricerca prima del catalogo completo.</p>
          </div>
          <button onClick={() => onViewAll("Club e percorsi")} type="button">Apri catalogo</button>
        </header>
        <label className="stablr-admin-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca club, FIG ID, città o percorso"
          />
        </label>
        <div className="stablr-admin-filter-row" role="group" aria-label="Filtri catalogo rapido">
          {CLUB_FILTERS.map((item) => (
            <button
              className={filter === item ? "is-active" : ""}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="stablr-admin-overview-club-list">
          {previewClubs.map((club) => (
            <button
              className="stablr-admin-club-row"
              key={club.id}
              onClick={() => onOpenClub(club)}
              type="button"
            >
              <span className="stablr-admin-club-identity">
                <strong>{club.name}</strong>
                <span>{club.city} · {club.courses}</span>
              </span>
              <span className={`stablr-admin-status stablr-admin-status--${club.filter.toLocaleLowerCase("it").replaceAll(" ", "-")}`}>
                {club.status}
              </span>
              <span className="stablr-admin-club-activity">{club.activity}</span>
            </button>
          ))}
          {!previewClubs.length && (
            <div className="stablr-admin-list-empty">
              {loading
                ? "Caricamento catalogo…"
                : catalogAvailable
                  ? "Nessun club corrisponde ai filtri selezionati."
                  : "Catalogo non disponibile."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ClubBreadcrumb({ club, onBack, course, onBackToClub }) {
  return (
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione">
      <button onClick={onBack} type="button">Club e percorsi</button>
      {club && <><span>/</span><button onClick={onBackToClub} type="button">{club.name}</button></>}
      {course && <><span>/</span><span>{course.name}</span></>}
    </nav>
  );
}

function ClubSummary({ club, onBack, onOpenCourse }) {
  const sources = [club.sourceType, club.hasFigLink ? "FIG" : null, club.figMatchStatus || null].filter(Boolean);
  const alerts = [];
  if (!club.playable) alerts.push("Il club non è giocabile: non risultano configurazioni pubblicate.");
  if (club.dataStatus === "needs_review") alerts.push("Dati in revisione.");
  if (club.figChangePending) alerts.push("È presente una modifica FIG da verificare.");

  return (
    <section className="stablr-admin-detail">
      <ClubBreadcrumb onBack={onBack} />
      <header className="stablr-admin-page-header">
        <div><h1>{club.name}</h1><p>{club.city}</p></div>
        <span className={`stablr-admin-status stablr-admin-status--${club.filter.toLocaleLowerCase("it").replaceAll(" ", "-")}`}>{club.status}</span>
      </header>
      <div className="stablr-admin-detail-grid">
        <article><span>Codice FIG</span><strong>{club.figCode || "—"}</strong></article>
        <article><span>Fonti e matching</span><strong>{sources.join(" · ") || "—"}</strong></article>
        <article><span>Ultima attività</span><strong>{club.activity}</strong></article>
      </div>
      <section className="stablr-admin-detail-section">
        <h2>Percorsi</h2>
        {club.routes.length ? club.routes.map((course) => (
          <button className="stablr-admin-course-row" key={course.id} onClick={() => onOpenCourse(course)} type="button">
            <span><strong>{course.name}</strong><small>{course.holesCount ? `${course.holesCount} buche` : "—"} · {course.completeness}</small></span>
            <span className="stablr-admin-status">{course.status}</span>
          </button>
        )) : <p className="stablr-admin-detail-empty">Nessun percorso pubblicato disponibile.</p>}
      </section>
      <section className="stablr-admin-detail-section">
        <h2>Alert</h2>
        {alerts.length ? <ul className="stablr-admin-detail-list">{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul> : <p className="stablr-admin-detail-empty">Nessun alert disponibile.</p>}
      </section>
      <section className="stablr-admin-detail-section">
        <h2>Cronologia</h2>
        <p className="stablr-admin-detail-empty">{club.activity === "—" ? "—" : club.activity}</p>
      </section>
      <p className="stablr-admin-data-sequence">Club → Percorsi → Route/combinazioni → Buche → Par/SI → Tee/distanze → CR/Slope</p>
    </section>
  );
}

function CourseDetail({ club, course, onBack, onBackToCatalog }) {
  const routeCombinations = club.combinations.filter((combination) =>
    combination.frontRouteId === course.id || combination.backRouteId === course.id
  );
  return (
    <section className="stablr-admin-detail">
      <ClubBreadcrumb club={club} course={course} onBack={onBackToCatalog} onBackToClub={onBack} />
      <header className="stablr-admin-page-header"><div><h1>{course.name}</h1><p>{club.name}</p></div><span className="stablr-admin-status">{course.status}</span></header>
      <div className="stablr-admin-detail-grid">
        <article><span>Struttura</span><strong>{course.holesCount ? `${course.holesCount} buche` : "—"}</strong></article>
        <article><span>Route disponibili</span><strong>{course.isActive ? "Disponibile" : "—"}</strong></article>
        <article><span>Combinazioni disponibili</span><strong>{routeCombinations.length || "—"}</strong></article>
      </div>
      <section className="stablr-admin-detail-section"><h2>Combinazioni</h2>
        {routeCombinations.length ? <ul className="stablr-admin-detail-list">{routeCombinations.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <p className="stablr-admin-detail-empty">—</p>}
      </section>
      <p className="stablr-admin-data-sequence">Club → Percorsi → Route/combinazioni → Buche → Par/SI → Tee/distanze → CR/Slope</p>
    </section>
  );
}

function ClubsAndCourses({ clubs, loading, catalogAvailable, initialQuery = "", onOpenClub }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState("Tutti");
  const filteredClubs = filterCatalogClubs(clubs, query, filter);

  return (
    <>
      <header className="stablr-admin-page-header">
        <div>
          <h1>Club e percorsi</h1>
          <p>Ricerca prima del catalogo completo.</p>
        </div>
        <button className="stablr-admin-white-button" type="button" disabled>
          + Nuovo club
        </button>
      </header>

      <section className="stablr-admin-club-controls" aria-label="Ricerca e filtri">
        <label className="stablr-admin-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca club, FIG ID, città o percorso"
          />
        </label>
        <div className="stablr-admin-filter-row" role="group" aria-label="Filtri catalogo">
          {CLUB_FILTERS.map((item) => (
            <button
              className={filter === item ? "is-active" : ""}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="stablr-admin-club-list" aria-label="Club e percorsi">
        {filteredClubs.map((club) => (
          <button className="stablr-admin-club-row" key={club.id} onClick={() => onOpenClub(club)} type="button">
            <span className="stablr-admin-club-identity">
              <strong>{club.name}</strong>
              <span>{club.city} · {club.courses}</span>
            </span>
            <span className={`stablr-admin-status stablr-admin-status--${club.filter.toLocaleLowerCase("it").replaceAll(" ", "-")}`}>
              {club.status}
            </span>
            <span className="stablr-admin-club-activity">{club.activity}</span>
          </button>
        ))}
        {!filteredClubs.length && (
          <div className="stablr-admin-list-empty">
            {loading
              ? "Caricamento catalogo…"
              : catalogAvailable
                ? "Nessun club corrisponde ai filtri selezionati."
                : "Catalogo non disponibile."}
          </div>
        )}
      </section>
    </>
  );
}

export function AdminShell({ onSignOut }) {
  const [section, setSection] = useState("Panoramica");
  const [adminData, setAdminData] = useState(emptyAdminData);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedClub, setSelectedClub] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setAdminData({ ...emptyAdminData, loading: false, catalogAvailable: false });
      return undefined;
    }

    let active = true;

    const loadAdminData = async () => {
      try {
        const [{ data: clubs, error: clubsError }, requestsResult, reportsResult] = await Promise.all([
          supabase
            .from("clubs")
            .select("id,name,city,data_status,source_type,source_payload,fig_club_id,fig_match_status,fig_match_confidence,playable,created_at,updated_at,fig_clubs(source_external_id),course_routes(id,name,holes_count,is_active,updated_at,route_holes(id,par,stroke_index),route_tees(id,is_active)),route_combinations(id,name,front_route_id,back_route_id,is_active,combination_tees(id,is_active))")
            .eq("is_active", true)
            .order("name", { ascending: true }),
          supabase
            .from("club_requests")
            .select("id,club_name,status,created_at")
            .in("status", ["requested", "in_review"])
            .order("created_at", { ascending: false }),
          supabase
            .from("club_reports")
            .select("id,message,status,created_at,clubs(name)")
            .order("created_at", { ascending: false })
        ]);

        if (!active) return;

        const normalizedClubs = (clubs || []).map((club) => {
          const routes = (club.course_routes || []).filter((route) => route.is_active !== false).map((route) => {
            const holes = route.route_holes || [];
            const hasParAndSi = holes.length > 0 && holes.every((hole) => hole.par != null && hole.stroke_index != null);
            const hasTeeData = (route.route_tees || []).some((tee) => tee.is_active !== false);
            return {
              id: route.id,
              name: route.name || "—",
              holesCount: route.holes_count,
              isActive: route.is_active !== false,
              completeness: hasParAndSi && hasTeeData ? "Completo" : hasParAndSi ? "Par/SI disponibili" : "Dati parziali",
              status: route.is_active !== false ? "Attivo" : "—"
            };
          });
          const combinations = (club.route_combinations || []).filter(
            (combination) => combination.is_active !== false
          ).map((combination) => ({
            id: combination.id,
            name: combination.name || "—",
            frontRouteId: combination.front_route_id,
            backRouteId: combination.back_route_id
          }));
          const routeCount = routes.length;
          const combinationCount = combinations.length;
          const filter = getClubFilter(club);
          const courseLabel = `${routeCount} ${routeCount === 1 ? "percorso" : "percorsi"} · ${routeCount + combinationCount} route`;

          return {
            id: club.id,
            name: club.name,
            city: club.city || "—",
            courses: courseLabel,
            status: getClubStatusLabel(filter),
            filter,
            activity: formatActivity(club.updated_at || club.created_at) === "—"
              ? "—"
              : `Aggiornato ${formatActivity(club.updated_at || club.created_at)}`,
            dataStatus: club.data_status,
            playable: club.playable !== false,
            figCode: club.fig_clubs?.source_external_id || club.source_payload?.figClubCode || club.source_payload?.fig_club_code || "",
            hasFigLink: Boolean(club.fig_club_id),
            sourceType: club.source_type || "",
            figMatchStatus: club.fig_match_status || "",
            figChangePending: isTrue(club.source_payload?.fig_change_pending) || isTrue(club.source_payload?.fig_update_pending),
            routes,
            combinations,
            courseNames: [...routes.map((route) => route.name), ...combinations.map((combination) => combination.name)]
          };
        });

        setAdminData({
          loading: false,
          clubs: clubsError ? [] : normalizedClubs,
          requests: requestsResult.error ? null : requestsResult.data || [],
          reports: reportsResult.error ? null : reportsResult.data || [],
          catalogAvailable: !clubsError
        });
      } catch (error) {
        if (active) {
          setAdminData({ ...emptyAdminData, loading: false, catalogAvailable: false });
        }
      }
    };

    loadAdminData();

    return () => {
      active = false;
    };
  }, []);

  const reviewClubs = adminData.catalogAvailable
    ? adminData.clubs.filter((club) => club.dataStatus === "needs_review" && club.playable)
    : null;
  const incompleteClubs = adminData.catalogAvailable
    ? adminData.clubs.filter((club) => club.dataStatus === "needs_review" && !club.playable)
    : null;
  const queues = [
    buildQueue("Da revisionare", "Revisioni", reviewClubs, (club) => club.name),
    buildQueue("Dati incompleti", "Club e percorsi", incompleteClubs, (club) => club.name),
    buildQueue(
      "Richieste nuovi club",
      "Community",
      adminData.requests,
      (request) => request.club_name || "Richiesta senza nome club"
    ),
    buildQueue(
      "Segnalazioni / conflitti",
      "Revisioni",
      adminData.reports,
      (report) => report.clubs?.name || report.message || "Segnalazione senza club"
    )
  ];
  const content =
    section === "Panoramica" ? (
      <Overview
        catalogAvailable={adminData.catalogAvailable}
        clubs={adminData.clubs}
        loading={adminData.loading}
        onOpenClub={(club) => {
          setSelectedClub(club);
          setSelectedCourse(null);
          setSection("Club e percorsi");
        }}
        onViewAll={setSection}
        queues={queues}
      />
    ) : section === "Club e percorsi" ? (
      selectedCourse && selectedClub ? <CourseDetail
        club={selectedClub}
        course={selectedCourse}
        onBack={() => setSelectedCourse(null)}
        onBackToCatalog={() => { setSelectedCourse(null); setSelectedClub(null); }}
      /> : selectedClub ? <ClubSummary
        club={selectedClub}
        onBack={() => setSelectedClub(null)}
        onOpenCourse={setSelectedCourse}
      /> : <ClubsAndCourses
        catalogAvailable={adminData.catalogAvailable}
        clubs={adminData.clubs}
        initialQuery={catalogQuery}
        key={catalogQuery || "catalog"}
        loading={adminData.loading}
        onOpenClub={setSelectedClub}
      />
    ) : (
      <EmptySection section={section} />
    );

  return (
    <main className="stablr-admin-shell">
      <aside className="stablr-admin-sidebar">
        <AdminBrand />
        <nav aria-label="Navigazione amministrazione">
          {NAVIGATION.map((item) => (
            <button
              className={item === section ? "is-active" : ""}
              key={item}
              onClick={() => {
                if (item === "Club e percorsi") {
                  setCatalogQuery("");
                  setSelectedClub(null);
                  setSelectedCourse(null);
                }
                setSection(item);
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
        <button className="stablr-admin-signout" onClick={onSignOut} type="button">
          Esci
        </button>
      </aside>
      <div className="stablr-admin-content">{content}</div>
    </main>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingAdminAccess, setCheckingAdminAccess] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessError, setAccessError] = useState("");
  const sessionUserId = session?.user?.id || null;

  useEffect(() => {
    setAdminDocumentMetadata();
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setLoading(false);
      setAccessError("Configurazione Supabase mancante.");
      return undefined;
    }

    let active = true;
    const loadSession = async () => {
      const {
        data: { session: nextSession }
      } = await supabase.auth.getSession();
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    };
    loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId || !supabase) {
      setIsAdmin(false);
      setAccessError("");
      setCheckingAdminAccess(false);
      return;
    }

    let active = true;
    setAccessError("");
    setCheckingAdminAccess(true);
    const verifyAdminAccess = async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (!active) return;
      if (error) {
        setIsAdmin(false);
        setAccessError("Impossibile verificare i permessi Admin.");
        setCheckingAdminAccess(false);
        return;
      }
      setIsAdmin(data === true);
      setCheckingAdminAccess(false);
    };
    verifyAdminAccess();

    return () => {
      active = false;
    };
  }, [sessionUserId]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
  };

  if (!hasSupabaseConfig || accessError) {
    return (
      <main className="stablr-admin-auth">
        <section className="stablr-admin-auth-card">
          <AdminBrand />
          <h1>STABLR Admin non disponibile</h1>
          <p>{accessError || "Configurazione Supabase mancante."}</p>
        </section>
      </main>
    );
  }

  if (loading || (session?.user && checkingAdminAccess)) {
    return <main className="stablr-admin-loading">Verifica accesso…</main>;
  }

  if (!session?.user) {
    return <AdminLogin onAuthenticated={setSession} />;
  }

  if (!isAdmin) {
    return <AdminDenied onSignOut={signOut} />;
  }

  return <AdminShell onSignOut={signOut} />;
}
