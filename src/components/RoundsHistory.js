import { RoundDeleteControl } from "./RoundDeleteControl";

const METRICS = [
  ["Lordo", "grossTotal"],
  ["Netto", "netTotal"],
  ["STABLR Lordo", "stablefordGrossTotal"],
  ["STABLR Netto", "stablefordNetTotal"]
];

function displayValue(value) {
  return value === null || typeof value === "undefined" || value === "" ? "—" : value;
}

function displayDecimal(value) {
  if (value === null || typeof value === "undefined" || value === "") return "—";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(numericValue);
}

function getRoundTitle(round) {
  return round?.displayTitle || round?.courseName || round?.routeName || round?.formattedDate || "—";
}

function getRoundMetadata(round) {
  if (round?.displayMetadata) return round.displayMetadata;
  return [round?.courseName, round?.formattedDate].filter(Boolean).join(" · ");
}

function getMetricStyle(colors, isStablr) {
  return {
    backgroundColor: isStablr ? colors.greenDark : colors.pillBg,
    border: `1px solid ${isStablr ? colors.greenBorder : colors.pillBorder}`,
    color: isStablr ? colors.success : colors.text
  };
}

export function RoundMetricsGrid({ round, colors }) {
  return (
    <div className="round-history-metrics">
      {METRICS.map(([label, key], index) => (
        <div
          key={key}
          className="round-history-metric"
          style={getMetricStyle(colors, index >= 2)}
        >
          <span>{label}</span>
          <strong>{displayValue(round?.[key])}</strong>
        </div>
      ))}
    </div>
  );
}

export function RoundHistoryCard({ round, onOpen, onDelete, colors, appFont }) {
  return (
    <div
      className="round-history-card"
      onClick={() => onOpen(round)}
      style={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        fontFamily: appFont
      }}
    >
      <div className="round-history-card-heading">
        <div>
          <div className="round-history-card-title">{getRoundTitle(round)}</div>
          <div className="round-history-card-metadata" style={{ color: colors.subtext }}>
            {getRoundMetadata(round)}
          </div>
        </div>
        <RoundDeleteControl
          roundName={getRoundTitle(round)}
          onConfirm={() => onDelete(round.id)}
          colors={colors}
          appFont={appFont}
        />
      </div>
      <RoundMetricsGrid round={round} colors={colors} />
    </div>
  );
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function buildHoleResults(round, holes, getReceivedShots, getStablefordPoints) {
  return holes.map((hole, index) => {
    const strokes = Number(round?.scores?.[index] || 0);
    const receivedShots = Number(getReceivedShots(round, hole, index) || 0);
    return {
      number: Number(hole.competitionHoleNumber || index + 1),
      par: Number(hole.par || 0),
      si: hole.strokeIndex || null,
      gross: strokes || null,
      net: strokes ? strokes - receivedShots : null,
      stablrGross: strokes ? getStablefordPoints(hole.par, strokes, 0) : null,
      stablrNet:
        hole.stablefordNet !== null && typeof hole.stablefordNet !== "undefined"
          ? Number(hole.stablefordNet)
          : strokes
            ? getStablefordPoints(hole.par, strokes, receivedShots)
            : null
    };
  });
}

function getScoreRows(round, results) {
  const derivedGross = sum(results.map((hole) => hole.gross));
  const derivedNet = sum(results.map((hole) => hole.net));
  const derivedStablrGross = sum(results.map((hole) => hole.stablrGross));
  const derivedStablrNet = sum(results.map((hole) => hole.stablrNet));

  return [
    { label: "Par", key: "par", total: round?.totalPar || sum(results.map((hole) => hole.par)) },
    { label: "SI", key: "si", total: null },
    { label: "Lordo", key: "gross", total: round?.grossTotal ?? derivedGross },
    { label: "Netto", key: "net", total: round?.netTotal ?? derivedNet },
    {
      label: "STABLR Lordo",
      key: "stablrGross",
      total: round?.stablefordGrossTotal ?? derivedStablrGross
    },
    {
      label: "STABLR Netto",
      key: "stablrNet",
      total: round?.stablefordNetTotal ?? derivedStablrNet
    }
  ];
}

function subtotal(results, key) {
  if (key === "si") return null;
  return sum(results.map((hole) => hole[key]));
}

function TeeSummary({ round, getTeeColor }) {
  const tee = round?.tee;
  if (!tee) return null;
  const colorInfo = getTeeColor(tee.color || tee.label);

  return (
    <div className="round-history-tee">
      <span
        aria-hidden="true"
        className="round-history-tee-dot"
        style={{
          backgroundColor: colorInfo.dotColor,
          borderColor: colorInfo.borderColor || "transparent"
        }}
      />
      <span>{tee.label || colorInfo.label || "Tee"}</span>
    </div>
  );
}

function PortraitScorecard({ results, colors }) {
  return (
    <div className="round-scorecard-portrait-wrap" style={{ borderColor: colors.border }}>
      <table className="round-scorecard-portrait" aria-label="Scorecard verticale">
        <thead>
          <tr style={{ backgroundColor: colors.cardSecondary, color: colors.subtext }}>
            <th>Buca</th><th>Par</th><th>SI</th><th>Lordo</th><th>Netto</th>
            <th>STABLR Lordo</th><th>STABLR Netto</th>
          </tr>
        </thead>
        <tbody>
          {results.map((hole) => (
            <tr key={hole.number} style={{ borderColor: colors.border }}>
              <td>{hole.number}</td><td>{hole.par}</td><td>{displayValue(hole.si)}</td>
              <td>{displayValue(hole.gross)}</td><td>{displayValue(hole.net)}</td>
              <td>{displayValue(hole.stablrGross)}</td>
              <td style={{ color: colors.success, fontWeight: 700 }}>{displayValue(hole.stablrNet)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LandscapeScorecard({ round, results, colors }) {
  const rows = getScoreRows(round, results);
  const isEighteen = results.length > 9;
  const out = results.slice(0, 9);
  const inside = results.slice(9, 18);

  return (
    <div className="round-scorecard-landscape-wrap" style={{ borderColor: colors.border }}>
      <table
        className={`round-scorecard-landscape ${isEighteen ? "round-scorecard-landscape-18" : "round-scorecard-landscape-9"}`}
        aria-label="Scorecard orizzontale"
      >
        <thead>
          <tr style={{ backgroundColor: colors.cardSecondary, color: colors.subtext }}>
            <th>Buche</th>
            {out.map((hole) => <th key={`out-${hole.number}`}>{hole.number}</th>)}
            <th>OUT</th>
            {isEighteen && inside.map((hole) => <th key={`in-${hole.number}`}>{hole.number}</th>)}
            {isEighteen && <th>IN</th>}
            <th>TOT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderColor: colors.border }}>
              <th style={{ backgroundColor: colors.cardSecondary }}>{row.label}</th>
              {out.map((hole) => <td key={`${row.key}-out-${hole.number}`}>{displayValue(hole[row.key])}</td>)}
              <td className="round-scorecard-subtotal">{displayValue(subtotal(out, row.key))}</td>
              {isEighteen && inside.map((hole) => <td key={`${row.key}-in-${hole.number}`}>{displayValue(hole[row.key])}</td>)}
              {isEighteen && <td className="round-scorecard-subtotal">{displayValue(subtotal(inside, row.key))}</td>}
              <td className="round-scorecard-total" style={{ color: row.key === "stablrNet" ? colors.success : colors.text }}>
                {displayValue(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoundHistoryDetail({
  round,
  holes,
  onClose,
  colors,
  appFont,
  getReceivedShots,
  getStablefordPoints,
  getTeeColor,
  onTouchStart,
  onTouchEnd,
  closeButtonStyle
}) {
  const results = buildHoleResults(round, holes, getReceivedShots, getStablefordPoints);
  const headerMetadata = [round.courseName, round.routeName, round.formattedDate]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="round-history-detail-backdrop" onClick={onClose} style={{ backgroundColor: colors.overlay }}>
      <div
        className="round-history-detail"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          fontFamily: appFont
        }}
      >
        <div className="round-history-detail-handle" style={{ backgroundColor: colors.borderStrong }} />
        <div className="round-history-detail-title">{getRoundTitle(round)}</div>
        <div className="round-history-detail-metadata" style={{ color: colors.subtext }}>
          {headerMetadata}
        </div>

        <div className="round-history-details" style={{ color: colors.subtext }}>
          <TeeSummary round={round} getTeeColor={getTeeColor} />
          <span>HCP {displayDecimal(round.handicapIndex)}</span>
          <span>PH {displayValue(round.playingHandicap)}</span>
          <span>CR {displayDecimal(round.tee?.courseRating)}</span>
          <span>Slope {displayValue(round.tee?.slopeRating)}</span>
        </div>

        <RoundMetricsGrid round={round} colors={colors} />

        <div className="round-scorecard-rotate-hint" style={{ color: colors.subtext }}>
          <span className="round-scorecard-rotate-icon" aria-hidden="true">↻</span>
          <span>Ruota il telefono per vedere la scorecard completa</span>
        </div>
        <PortraitScorecard results={results} colors={colors} />
        <LandscapeScorecard round={round} results={results} colors={colors} />

        <button onClick={onClose} style={closeButtonStyle}>Chiudi</button>
      </div>
    </div>
  );
}
