import { useCallback, useEffect, useRef, useState } from "react";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import ClubEditor from "./ClubEditor";
import { createClubEditorService } from "./club-editor-data";
import "./AdminApp.css";

const clubEditorService = createClubEditorService(supabase);

const ADMIN_MANIFEST_PATH = "/admin.webmanifest";
const ADMIN_ICON_PATH = "/stablr-admin-icon.svg";

const NAVIGATION = [
  "Panoramica",
  "Club e percorsi",
  "Club partner",
  "Revisioni",
  "Community",
  "Utenti e giri",
  "Avanzata"
];

const CLUB_FILTERS = ["Tutti", "Pubblicati", "In revisione", "Dati incompleti", "Modifiche FIG"];
const REVIEW_FILTERS = ["Tutti", "Segnalazioni", "Richieste", "Scorecard", "Dati incompleti", "Import FIG", "Modifiche FIG"];
const USER_ROLE_FILTERS = ["Tutti", "Utenti", "Admin"];
const USER_ROUND_FILTERS = ["Tutti", "Con almeno un giro", "Senza giri"];
const USER_SORT_OPTIONS = ["Ultima attività app (più recente)", "Iscrizione più recente", "Più giri", "Nome A–Z"];
const ADVANCED_AREAS = [
  ["fig", "Verifica FIG", "Stato dei collegamenti e delle modifiche FIG disponibili."],
  ["sources", "Fonti e matching", "Provenienza catalogo e matching disponibili."],
  ["history", "Cronologia completa", "Storico di pubblicazione e passaggi catalogo."],
  ["archive", "Archiviati e cestino", "Elementi non più presenti nel catalogo attivo."],
  ["conflicts", "Duplicati e conflitti", "Elementi segnalati dal modello dati corrente."],
  ["technical", "Impostazioni tecniche dei dati", "Struttura concettuale e read-only del catalogo."]
];

const emptyAdminData = {
  loading: true,
  clubs: [],
  requests: null,
  reports: null,
  scorecards: null,
  users: null,
  usersError: null,
  rounds: null,
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

function formatDateTime(dateValue) {
  if (!dateValue) return "—";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function getRoundFormatLabel(roundType) {
  return {
    single_9: "9 buche",
    single_18: "18 buche",
    repeat_9: "9 buche × 2",
    combined_9x2: "Combinazione 18"
  }[roundType] || "—";
}

function getRoundRouteLabel(round) {
  if (round?.route_combinations?.name) return round.route_combinations.name;
  const names = (Array.isArray(round?.selected_routes) ? round.selected_routes : [])
    .map((route) => route?.route_name)
    .filter((name, index, all) => name && all.indexOf(name) === index);
  return names.join(" / ") || "—";
}

function getRoundResultLabel(round) {
  const values = [
    round?.gross_total == null ? null : `Lordo ${round.gross_total}`,
    round?.net_total == null ? null : `Netto ${round.net_total}`,
    round?.stableford_net_total == null ? null : `STABLR ${round.stableford_net_total}`
  ].filter(Boolean);
  return values.join(" · ") || "—";
}

export function filterAdminUsers(users, search, roleFilter, roundFilter) {
  const normalizedSearch = search.trim().toLocaleLowerCase("it");
  return users.filter((user) => {
    const matchesSearch = !normalizedSearch || `${user.player_name || ""} ${user.email || ""}`.toLocaleLowerCase("it").includes(normalizedSearch);
    const matchesRole = roleFilter === "Tutti" || (roleFilter === "Admin" ? user.role === "admin" : user.role !== "admin");
    const roundCount = Number(user.round_count || 0);
    const matchesRounds = roundFilter === "Tutti" || (roundFilter === "Con almeno un giro" ? roundCount > 0 : roundCount === 0);
    return matchesSearch && matchesRole && matchesRounds;
  });
}

export function sortAdminUsers(users, sort) {
  const timestamp = (value) => {
    const parsed = new Date(value || "").getTime();
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  return [...users].sort((left, right) => {
    if (sort === "Iscrizione più recente") return timestamp(right.joined_at) - timestamp(left.joined_at);
    if (sort === "Più giri") return Number(right.round_count || 0) - Number(left.round_count || 0);
    if (sort === "Nome A–Z") return (left.player_name || "").localeCompare(right.player_name || "", "it");
    return timestamp(right.last_seen_at) - timestamp(left.last_seen_at);
  });
}

export function buildAdminRounds(rounds, users) {
  const usersById = new Map((users || []).map((user) => [user.user_id, user]));
  return (rounds || []).map((round) => {
    const user = usersById.get(round.user_id);
    return {
      ...round,
      playerName: user?.player_name || "—",
      playerEmail: user?.email || "—",
      clubName: round.clubs?.name || "—",
      routeName: getRoundRouteLabel(round),
      formatLabel: getRoundFormatLabel(round.round_type),
      resultLabel: getRoundResultLabel(round),
      statusLabel: "—"
    };
  });
}

function buildQueue(label, section, rows, getLabel, reviewFilter) {
  if (rows === null) {
    return { label, section, reviewFilter, count: "—", items: ["Dato non disponibile"] };
  }
  return {
    label,
    section,
    reviewFilter,
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

export function buildReviewItems({ clubs = [], requests = [], reports = [], scorecards = [] }) {
  const items = [
    ...reports.map((report) => ({
      id: `report-${report.id}`, type: "Segnalazioni", priority: 0, title: report.clubs?.name || "Segnalazione senza club",
      source: "Community", date: report.created_at, reason: report.message || "—", detail: report
    })),
    ...requests.map((request) => ({
      id: `request-${request.id}`, type: "Richieste", priority: 1, title: request.club_name || "Richiesta senza nome club",
      source: "Community", date: request.created_at, reason: request.status === "in_review" ? "Richiesta già in revisione" : "Nuova richiesta club", detail: request
    })),
    ...scorecards.map((scorecard) => ({
      id: `scorecard-${scorecard.id}`, type: "Scorecard", priority: 2,
      title: scorecard.clubs?.name || scorecard.fig_clubs?.name || "Scorecard senza club",
      source: scorecard.source_type || "—", date: scorecard.updated_at || scorecard.created_at,
      reason: scorecard.notes || "Scorecard inviata per revisione", detail: scorecard
    })),
    ...clubs.filter((club) => club.dataStatus === "needs_review" || club.figChangePending).map((club) => {
      const type = club.figChangePending ? "Modifiche FIG" : !club.playable ? "Dati incompleti" : "Import FIG";
      return {
        id: `club-${club.id}`, type, priority: !club.playable ? 3 : 4, title: club.name,
        source: [club.sourceType, club.figCode ? "FIG" : null].filter(Boolean).join(" · ") || "—",
        date: club.updatedAt || club.createdAt,
        reason: club.figChangePending ? "Modifica FIG rilevata" : !club.playable ? "Club non giocabile: dati pubblicati mancanti" : "Import FIG/GesGolf da verificare",
        detail: club
      };
    })
  ];
  return items.sort((left, right) => right.priority === left.priority
    ? new Date(right.date || 0) - new Date(left.date || 0)
    : left.priority - right.priority);
}

export function filterReviewItems(items, filter) {
  return filter === "Tutti" ? items : items.filter((item) => item.type === filter);
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

function EmptySection({ section, description }) {
  return (
    <section className="stablr-admin-empty-section">
      <h1>{section}</h1>
      <p>{description || "Questa sezione sarà disponibile prossimamente."}</p>
    </section>
  );
}

function getImportReference(club) {
  const payload = club.sourcePayload || {};
  const value = payload.import_batch || payload.importBatch || payload.import_batch_id || payload.importBatchId;
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function formatFigMatchStatus(status) {
  return String(status || "").toLowerCase() === "unmatched" ? "Da collegare" : status || "—";
}

function getSourceMatchingState(club) {
  if (String(club.figMatchStatus || "").toLowerCase() === "unmatched") return "Da collegare";
  if (club.hasFigLink || String(club.figMatchStatus || "").toLowerCase() === "matched") return "Collegati";
  return null;
}

function AdvancedDataRows({ clubs, variant }) {
  const [filter, setFilter] = useState("Tutti");
  const rows = clubs.filter((club) => variant === "fig"
    ? club.hasFigLink || club.figCode || club.figMatchStatus || club.figChangePending
    : club.sourceType || club.hasFigLink || club.figMatchStatus || getImportReference(club) !== "—");

  if (!rows.length) {
    return <p className="stablr-admin-detail-empty">{variant === "fig" ? "Nessun dato FIG disponibile." : "Nessuna fonte o matching disponibile."}</p>;
  }

  const matchingCounts = rows.reduce((counts, club) => {
    const state = getSourceMatchingState(club);
    if (state) counts[state] += 1;
    return counts;
  }, { Collegati: 0, "Da collegare": 0 });
  const filteredRows = variant === "sources" && filter !== "Tutti"
    ? rows.filter((club) => getSourceMatchingState(club) === filter)
    : rows;
  const hasImportReference = filteredRows.some((club) => getImportReference(club) !== "—");

  return <>
    {variant === "sources" && <>
      <div className="stablr-admin-filter-row stablr-admin-advanced-filters" role="group" aria-label="Filtri fonti e matching">
        {["Tutti", "Collegati", "Da collegare"].map((item) => <button className={filter === item ? "is-active" : ""} key={item} onClick={() => setFilter(item)} type="button">{item}</button>)}
      </div>
      <div className="stablr-admin-advanced-summary" aria-label="Riepilogo stati matching"><span>Collegati <strong>{matchingCounts.Collegati}</strong></span><span>Da collegare <strong>{matchingCounts["Da collegare"]}</strong></span></div>
    </>}
    <section className="stablr-admin-advanced-data-list" aria-label={variant === "fig" ? "Dati FIG" : "Fonti e matching"}>
    {filteredRows.map((club) => <article className={`stablr-admin-advanced-data-row${variant === "sources" && !hasImportReference ? " is-without-batch" : ""}`} key={club.id}>
      <div><span>Club</span><strong>{club.name || "—"}</strong></div>
      {variant === "fig" ? <>
        <div><span>Codice FIG</span><strong>{club.figCode || "—"}</strong></div>
        <div><span>Matching</span><strong>{formatFigMatchStatus(club.figMatchStatus)}</strong></div>
        <div><span>Modifica FIG</span><strong>{club.figChangePending ? "Rilevata" : "—"}</strong></div>
      </> : <>
        <div><span>Fonte</span><strong>{club.sourceType || "—"}</strong></div>
        <div><span>Matching FIG</span><strong>{formatFigMatchStatus(club.figMatchStatus)}</strong></div>
        {hasImportReference && <div><span>Batch/import</span><strong>{getImportReference(club)}</strong></div>}
      </>}
    </article>)}
    {!filteredRows.length && <div className="stablr-admin-list-empty">Nessun record per questo stato.</div>}
  </section>
  </>;
}

function AdvancedDetail({ area, clubs, onBack }) {
  const [id, title, description] = area;
  let content;
  if (id === "fig") content = <AdvancedDataRows clubs={clubs} variant="fig" />;
  else if (id === "sources") content = <AdvancedDataRows clubs={clubs} variant="sources" />;
  else if (id === "history") content = <p className="stablr-admin-detail-empty">Nessuna cronologia di pubblicazione disponibile</p>;
  else if (id === "archive") content = <p className="stablr-admin-detail-empty">Nessun elemento archiviato o nel cestino</p>;
  else if (id === "conflicts") content = <p className="stablr-admin-detail-empty">Nessun duplicato o conflitto rilevato</p>;
  else content = <div className="stablr-admin-technical-grid">
    <article><span>Catalogo</span><strong>Club → Percorsi → Route/combinazioni → Buche</strong></article>
    <article><span>Dati di gioco</span><strong>Par/SI → Tee/distanze → CR/Slope</strong></article>
    <article><span>Provenienza</span><strong>Fonti e matching restano associati ai dati catalogo.</strong></article>
    <article><span>Stato</span><strong>Gli stati indicano disponibilità e revisione dei dati.</strong></article>
  </div>;

  return <section className="stablr-admin-detail stablr-admin-advanced-detail">
    <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button onClick={onBack} type="button">Avanzata</button><span>/</span><span>{title}</span></nav>
    <header className="stablr-admin-page-header"><div><h1>{title}</h1><p>{description}</p></div></header>
    <section className="stablr-admin-detail-section">{content}</section>
  </section>;
}

export function Advanced({ clubs, loading }) {
  const [selectedArea, setSelectedArea] = useState(null);
  if (selectedArea) return <AdvancedDetail area={selectedArea} clubs={clubs || []} onBack={() => setSelectedArea(null)} />;
  return <section className="stablr-admin-advanced">
    <header className="stablr-admin-page-header"><div><h1>Avanzata</h1><p>Consultazione read-only delle informazioni catalogo disponibili.</p></div></header>
    <div className="stablr-admin-advanced-grid">
      {ADVANCED_AREAS.map((area) => <button className="stablr-admin-advanced-card" key={area[0]} onClick={() => setSelectedArea(area)} type="button"><strong>{area[1]}</strong><span>{area[2]}</span></button>)}
    </div>
    {loading && <p className="stablr-admin-detail-empty">Caricamento dati catalogo…</p>}
  </section>;
}

export function ReviewDetail({ item, onBack }) {
  const detail = item.detail;
  const isClub = item.id.startsWith("club-");
  const fields = isClub
    ? [
        ["Stato", detail.dataStatus || "—"],
        ["Giocabile", detail.playable ? "Sì" : "No"],
        ["Fonte", item.source],
        ["Matching FIG", formatFigMatchStatus(detail.figMatchStatus)],
        ["Percorsi", detail.courses || "—"],
        ["Ultima attività", formatActivity(item.date)]
      ]
    : [
        ["Provenienza", item.source],
        ["Stato", detail.status || detail.review_status || "—"],
        ["Data", formatActivity(item.date)],
        ["Club STABLR", detail.clubs?.name || "—"],
        ["Club FIG", detail.fig_clubs?.name || "—"]
      ];
  const comparison = isClub
    ? detail.hasFigLink ? `Collegamento FIG disponibile${detail.figCode ? `: ${detail.figCode}` : ""}.` : "Nessun collegamento FIG disponibile."
    : detail.club_id ? "Collegamento a club STABLR disponibile." : "Nessun collegamento a club STABLR disponibile.";

  return (
    <section className="stablr-admin-detail">
      <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button onClick={onBack} type="button">Revisioni</button><span>/</span><span>{item.title}</span></nav>
      <header className="stablr-admin-page-header"><div><h1>{item.title}</h1><p>{item.reason}</p></div><span className="stablr-admin-status">{item.type}</span></header>
      <div className="stablr-admin-detail-grid">
        {fields.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value || "—"}</strong></article>)}
      </div>
      <section className="stablr-admin-detail-section"><h2>Collegamento FIG</h2><p className="stablr-admin-detail-empty">{comparison}</p></section>
      {isClub && detail.routes.length > 0 && <section className="stablr-admin-detail-section"><h2>Percorsi disponibili</h2><ul className="stablr-admin-detail-list">{detail.routes.map((route) => <li key={route.id}>{route.name} · {route.completeness}</li>)}</ul></section>}
      {!isClub && detail.notes && <section className="stablr-admin-detail-section"><h2>Note</h2><p className="stablr-admin-detail-empty">{detail.notes}</p></section>}
    </section>
  );
}

export function Reviews({ items, loading, onOpenItem, initialFilter = "Tutti" }) {
  const [filter, setFilter] = useState(initialFilter);
  const filteredItems = filterReviewItems(items, filter);
  return (
    <section className="stablr-admin-reviews">
      <header className="stablr-admin-page-header"><div><h1>Revisioni</h1><p>Elementi reali che richiedono verifica.</p></div></header>
      <div className="stablr-admin-filter-row" role="group" aria-label="Filtri revisioni">
        {REVIEW_FILTERS.map((item) => <button className={filter === item ? "is-active" : ""} key={item} onClick={() => setFilter(item)} type="button">{item}</button>)}
      </div>
      <section className="stablr-admin-review-list" aria-label="Coda revisioni">
        {filteredItems.map((item) => <button className="stablr-admin-review-row" key={item.id} onClick={() => onOpenItem(item)} type="button">
          <span className="stablr-admin-club-identity"><strong>{item.title}</strong><span>{item.source} · {item.reason}</span></span>
          <span className="stablr-admin-status">{item.type}</span>
          <span className="stablr-admin-club-activity">{formatActivity(item.date)}</span>
        </button>)}
        {!filteredItems.length && <div className="stablr-admin-list-empty">{loading ? "Caricamento revisioni…" : "Nessun elemento per questo filtro."}</div>}
      </section>
    </section>
  );
}

function AdminRoundDetail({ round, onBack }) {
  const holes = (round.round_holes || []).slice().sort((left, right) => left.round_hole_number - right.round_hole_number);
  return (
    <section className="stablr-admin-detail">
      <nav className="stablr-admin-breadcrumb" aria-label="Percorso di navigazione"><button onClick={onBack} type="button">Utenti e giri</button><span>/</span><span>Giro</span></nav>
      <header className="stablr-admin-page-header"><div><h1>{round.clubName}</h1><p>{round.playerName} · {formatDateTime(round.created_at)}</p></div><span className="stablr-admin-status">{round.formatLabel}</span></header>
      <div className="stablr-admin-detail-grid">
        <article><span>Percorso</span><strong>{round.routeName}</strong></article>
        <article><span>Risultato</span><strong>{round.resultLabel}</strong></article>
        <article><span>Stato</span><strong>{round.statusLabel}</strong></article>
      </div>
      <section className="stablr-admin-detail-section"><h2>Buche</h2>
        {holes.length ? <div className="stablr-admin-hole-grid">{holes.map((hole) => <div key={hole.id}><strong>{hole.round_hole_number}</strong><span>Par {hole.par ?? "—"} · SI {hole.stroke_index ?? "—"}</span><small>Colpi {hole.strokes ?? "—"} · STABLR {hole.stableford_points ?? "—"}</small></div>)}</div> : <p className="stablr-admin-detail-empty">—</p>}
      </section>
    </section>
  );
}

export function UsersAndRounds({ users, rounds, loading, usersError, onRetryUsers }) {
  const [tab, setTab] = useState("Utenti");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("Tutti");
  const [roundFilter, setRoundFilter] = useState("Tutti");
  const [sort, setSort] = useState(USER_SORT_OPTIONS[0]);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [selectedRound, setSelectedRound] = useState(null);
  const filteredUsers = sortAdminUsers(filterAdminUsers(users || [], search, roleFilter, roundFilter), sort);
  const filteredEmails = filteredUsers.map((user) => user.email).filter(Boolean);
  const selectedFilteredEmails = selectedEmails.filter((email) => filteredEmails.includes(email));

  const copyEmails = async (emails, message) => {
    if (!emails.length || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(emails.join(","));
    setCopyFeedback(message);
  };
  const toggleEmail = (email) => setSelectedEmails((current) => current.includes(email) ? current.filter((item) => item !== email) : [...current, email]);
  const toggleAll = () => setSelectedEmails((current) => selectedFilteredEmails.length === filteredEmails.length ? current.filter((email) => !filteredEmails.includes(email)) : [...new Set([...current, ...filteredEmails])]);

  if (selectedRound) return <AdminRoundDetail round={selectedRound} onBack={() => setSelectedRound(null)} />;

  return (
    <section className="stablr-admin-users-rounds">
      <header className="stablr-admin-page-header"><div><h1>Utenti e giri</h1><p>Directory e storico in sola lettura.</p></div></header>
      <div className="stablr-admin-tabs" role="tablist" aria-label="Utenti e giri">
        {["Utenti", "Giri"].map((item) => <button aria-selected={tab === item} className={tab === item ? "is-active" : ""} key={item} onClick={() => setTab(item)} role="tab" type="button">{item}</button>)}
      </div>
      {tab === "Utenti" ? <>
        {usersError ? <section className="stablr-admin-directory-error" role="alert"><strong>Impossibile caricare la directory utenti</strong><button onClick={onRetryUsers} type="button">Riprova</button></section> : <>
        <label className="stablr-admin-search"><span aria-hidden="true">⌕</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Cerca nome o email" value={search} /></label>
        <div className="stablr-admin-user-filters">
          <div className="stablr-admin-filter-row" role="group" aria-label="Filtro ruolo utenti">{USER_ROLE_FILTERS.map((item) => <button className={roleFilter === item ? "is-active" : ""} key={item} onClick={() => setRoleFilter(item)} type="button">{item}</button>)}</div>
          <div className="stablr-admin-filter-row" role="group" aria-label="Filtro giri utenti">{USER_ROUND_FILTERS.map((item) => <button className={roundFilter === item ? "is-active" : ""} key={item} onClick={() => setRoundFilter(item)} type="button">{item}</button>)}</div>
        </div>
        <label className="stablr-admin-sort">Ordina per<select aria-label="Ordina per" onChange={(event) => setSort(event.target.value)} value={sort}>{USER_SORT_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="stablr-admin-copy-actions"><label><input checked={filteredEmails.length > 0 && selectedFilteredEmails.length === filteredEmails.length} onChange={toggleAll} type="checkbox" /> Seleziona tutti i risultati filtrati</label><button disabled={!selectedFilteredEmails.length} onClick={() => copyEmails(selectedFilteredEmails, `${selectedFilteredEmails.length} email copiate.`)} type="button">Copia {selectedFilteredEmails.length} email selezionate</button>{copyFeedback && <span>{copyFeedback}</span>}</div>
        <section className="stablr-admin-user-list" aria-label="Directory utenti">
          {filteredUsers.map((user) => <article className="stablr-admin-user-row" key={user.user_id}>
            <label><input checked={selectedEmails.includes(user.email)} onChange={() => toggleEmail(user.email)} type="checkbox" /></label>
            <div><strong>{user.player_name || "—"}</strong><span>{user.email || "—"}</span></div>
            <span className="stablr-admin-status">{user.role === "admin" ? "Admin" : "Utente"}</span>
            <span>Iscrizione <strong>{formatDateTime(user.joined_at)}</strong></span>
            <span>Accesso <strong>{formatDateTime(user.last_login_at)}</strong></span>
            <span>Attività <strong>{formatDateTime(user.last_seen_at)}</strong></span>
            <span>Giri <strong>{user.round_count || 0}</strong></span>
            <span>Ultimo giro <strong>{formatDateTime(user.last_round_at)}</strong></span>
            <button aria-label={`Copia email ${user.player_name || user.email}`} onClick={() => copyEmails([user.email], "Email copiata.")} type="button">Copia email</button>
          </article>)}
          {!filteredUsers.length && <div className="stablr-admin-list-empty">{loading ? "Caricamento utenti…" : "Nessun utente corrisponde ai filtri selezionati."}</div>}
        </section>
        </>}
      </> : <section className="stablr-admin-review-list" aria-label="Lista giri">
        {(rounds || []).map((round) => <button className="stablr-admin-review-row" key={round.id} onClick={() => setSelectedRound(round)} type="button"><span className="stablr-admin-club-identity"><strong>{round.clubName}</strong><span><strong className="stablr-admin-round-player">{round.playerName}</strong> · {round.routeName} · {round.resultLabel} · Stato {round.statusLabel}</span></span><span className="stablr-admin-status">{round.formatLabel}</span><span className="stablr-admin-club-activity">{formatDateTime(round.created_at)}</span></button>)}
        {!(rounds || []).length && <div className="stablr-admin-list-empty">{loading ? "Caricamento giri…" : "Nessun giro disponibile."}</div>}
      </section>}
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
        {loading ? Array.from({ length: 4 }, (_, index) => (
          <article aria-hidden="true" className="stablr-admin-metric-card stablr-admin-metric-card--skeleton" key={index}>
            <span className="stablr-admin-skeleton-line stablr-admin-skeleton-line--label" />
            <span className="stablr-admin-skeleton-line stablr-admin-skeleton-line--count" />
            <span className="stablr-admin-skeleton-line" />
            <span className="stablr-admin-skeleton-line stablr-admin-skeleton-line--short" />
          </article>
        )) : queues.map((card) => (
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
            <button onClick={() => onViewAll(card.section, card.reviewFilter)} type="button">Vedi tutto</button>
          </article>
        ))}
      </section>

      <section className="stablr-admin-decision-section">
        <h2>Da decidere ora</h2>
        {loading ? <article aria-hidden="true" className="stablr-admin-empty-card stablr-admin-empty-card--skeleton"><span className="stablr-admin-skeleton-line" /><span className="stablr-admin-skeleton-line stablr-admin-skeleton-line--short" /></article> : queues.every((queue) => Number(queue.count) <= 0) ? (
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
                <button onClick={() => onViewAll(queue.section, queue.reviewFilter)} type="button">Apri</button>
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

function ClubSummary({ club, onBack, onOpenCourse, onEdit }) {
  const [draftStatus, setDraftStatus] = useState({ loading: true, draft: null, error: false });
  useEffect(() => {
    let active = true;
    clubEditorService.getDraft(club.id).then((draft) => {
      if (active) setDraftStatus({ loading: false, draft, error: false });
    }).catch((error) => {
      console.error("Admin Club draft status unavailable", error);
      if (active) setDraftStatus({ loading: false, draft: null, error: true });
    });
    return () => { active = false; };
  }, [club.id]);
  const sources = [club.sourceType, club.hasFigLink ? "FIG" : null, club.figMatchStatus ? formatFigMatchStatus(club.figMatchStatus) : null].filter(Boolean);
  const alerts = [];
  if (!club.playable) alerts.push("Il club non è giocabile: non risultano configurazioni pubblicate.");
  if (club.dataStatus === "needs_review") alerts.push("Dati in revisione.");
  if (club.figChangePending) alerts.push("È presente una modifica FIG da verificare.");

  return (
    <section className="stablr-admin-detail">
      <ClubBreadcrumb onBack={onBack} />
      <header className="stablr-admin-page-header">
        <div><h1>{club.name}</h1>{club.city !== "—" && <p>{club.city}</p>}</div>
        <span className={`stablr-admin-status stablr-admin-status--${club.filter.toLocaleLowerCase("it").replaceAll(" ", "-")}`}>{club.status}</span>
      </header>
      <div className="stablr-admin-editor-actions stablr-admin-club-edit-entry">
        <button className="stablr-admin-white-button" onClick={onEdit} type="button">Modifica dati</button>
        {draftStatus.loading ? <span className="stablr-admin-detail-empty">Verifica bozza…</span> : draftStatus.draft ? <span className="stablr-admin-status">Bozza in corso</span> : draftStatus.error ? <span className="stablr-admin-detail-empty">Stato bozza non disponibile</span> : null}
      </div>
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
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewInitialFilter, setReviewInitialFilter] = useState("Tutti");
  const [directoryRetryKey, setDirectoryRetryKey] = useState(0);
  const [usersSectionKey, setUsersSectionKey] = useState(0);
  const [advancedSectionKey, setAdvancedSectionKey] = useState(0);
  const [editingClub, setEditingClub] = useState(false);
  const clubExitGuard = useRef(null);
  const registerClubExitGuard = useCallback((guard) => { clubExitGuard.current = guard; }, []);
  const navigate = (action) => clubExitGuard.current ? clubExitGuard.current(action) : action();
  const acceptClubPublication = (live) => {
    const apply = (club) => ({ ...club, name: live.name, city: live.city || "—", updatedAt: live.updated_at,
      activity: `Aggiornato ${formatActivity(live.updated_at)}` });
    setAdminData((current) => ({ ...current, clubs: current.clubs.map((club) => club.id === live.id ? apply(club) : club) }));
    setSelectedClub((club) => apply(club));
    setEditingClub(false);
  };

  useEffect(() => {
    if (!supabase) {
      setAdminData({ ...emptyAdminData, loading: false, catalogAvailable: false });
      return undefined;
    }

    let active = true;

    const loadAdminData = async () => {
      try {
        const [{ data: clubs, error: clubsError }, requestsResult, reportsResult, scorecardsResult, usersResult, roundsResult] = await Promise.all([
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
            .eq("status", "open")
            .order("created_at", { ascending: false }),
          supabase
            .from("scorecard_submissions")
            .select("id,club_id,fig_club_id,fig_playable_course_id,submission_type,review_status,source_type,confidence,notes,submitted_payload,created_at,updated_at,clubs(name),fig_clubs(name,source_external_id),fig_playable_courses(name,holes_count)")
            .eq("review_status", "in_review")
            .order("created_at", { ascending: false }),
          supabase
            .rpc("admin_user_directory"),
          supabase
            .from("rounds")
            .select("id,user_id,club_id,route_combination_id,holes_count,total_par,round_type,selected_routes,gross_total,net_total,stableford_gross_total,stableford_net_total,estimated_hcp_after_round,created_at,updated_at,clubs(name),route_combinations(name),round_holes(id,round_hole_number,par,stroke_index,strokes,stableford_points)")
            .order("created_at", { ascending: false })
        ]);

        if (!active) return;
        if (usersResult.error) {
          console.error("Admin user directory RPC failed", usersResult.error);
        }

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
            sourcePayload: club.source_payload || {},
            createdAt: club.created_at,
            updatedAt: club.updated_at,
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
          scorecards: scorecardsResult.error ? null : scorecardsResult.data || [],
          users: usersResult.error ? null : usersResult.data || [],
          usersError: usersResult.error ? usersResult.error.message || "unknown" : null,
          rounds: roundsResult.error ? null : roundsResult.data || [],
          catalogAvailable: !clubsError
        });
      } catch (error) {
        if (active) {
          setAdminData((current) => {
            const hasVisibleData = current.clubs.length > 0 || current.requests !== null || current.reports !== null || current.scorecards !== null;
            return hasVisibleData ? { ...current, loading: false } : { ...emptyAdminData, loading: false, catalogAvailable: false };
          });
        }
      }
    };

    loadAdminData();

    return () => {
      active = false;
    };
  }, [directoryRetryKey]);

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
      "Revisioni",
      adminData.requests,
      (request) => request.club_name || "Richiesta senza nome club",
      "Richieste"
    ),
    buildQueue(
      "Segnalazioni / conflitti",
      "Revisioni",
      adminData.reports,
      (report) => report.clubs?.name || report.message || "Segnalazione senza club"
    )
  ];
  const reviewItems = buildReviewItems({
    clubs: adminData.catalogAvailable ? adminData.clubs : [],
    requests: adminData.requests || [],
    reports: adminData.reports || [],
    scorecards: adminData.scorecards || []
  });
  const adminRounds = buildAdminRounds(adminData.rounds || [], adminData.users || []);
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
        onViewAll={(nextSection, reviewFilter) => {
          if (nextSection === "Revisioni") {
            setSelectedReview(null);
            setReviewInitialFilter(reviewFilter || "Tutti");
          }
          setSection(nextSection);
        }}
        queues={queues}
      />
    ) : section === "Club e percorsi" ? (
      editingClub && selectedClub ? <ClubEditor
        club={selectedClub}
        onBack={() => navigate(() => setEditingClub(false))}
        onPublished={acceptClubPublication}
        registerExitGuard={registerClubExitGuard}
        service={clubEditorService}
      /> : selectedCourse && selectedClub ? <CourseDetail
        club={selectedClub}
        course={selectedCourse}
        onBack={() => setSelectedCourse(null)}
        onBackToCatalog={() => { setSelectedCourse(null); setSelectedClub(null); }}
      /> : selectedClub ? <ClubSummary
        club={selectedClub}
        onBack={() => setSelectedClub(null)}
        onEdit={() => setEditingClub(true)}
        onOpenCourse={setSelectedCourse}
      /> : <ClubsAndCourses
        catalogAvailable={adminData.catalogAvailable}
        clubs={adminData.clubs}
        initialQuery={catalogQuery}
        key={catalogQuery || "catalog"}
        loading={adminData.loading}
        onOpenClub={setSelectedClub}
      />
    ) : section === "Revisioni" ? (
      selectedReview ? <ReviewDetail item={selectedReview} onBack={() => setSelectedReview(null)} /> : <Reviews
        initialFilter={reviewInitialFilter}
        key={reviewInitialFilter}
        items={reviewItems}
        loading={adminData.loading}
        onOpenItem={setSelectedReview}
      />
    ) : section === "Utenti e giri" ? (
      <UsersAndRounds
        key={usersSectionKey}
        loading={adminData.loading}
        onRetryUsers={() => setDirectoryRetryKey((current) => current + 1)}
        rounds={adminRounds}
        users={adminData.users || []}
        usersError={adminData.usersError}
      />
    ) : section === "Club partner" ? (
      <EmptySection section="Club partner" description="Area futura per la gestione interna di contatti e relazioni con i club." />
    ) : section === "Avanzata" ? (
      <Advanced clubs={adminData.clubs} key={advancedSectionKey} loading={adminData.loading} />
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
              onClick={() => navigate(() => {
                setEditingClub(false);
                if (item === "Club e percorsi") {
                  setCatalogQuery("");
                  setSelectedClub(null);
                  setSelectedCourse(null);
                }
                if (item === "Revisioni") {
                  setSelectedReview(null);
                  setReviewInitialFilter("Tutti");
                }
                if (item === "Utenti e giri") setUsersSectionKey((current) => current + 1);
                if (item === "Avanzata") setAdvancedSectionKey((current) => current + 1);
                setSection(item);
              })}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
        <button className="stablr-admin-signout" onClick={() => navigate(onSignOut)} type="button">
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
