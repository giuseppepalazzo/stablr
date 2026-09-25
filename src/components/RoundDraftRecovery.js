import { getDraftCompletedHoles } from "../lib/round-draft";

export function RoundDraftRecovery({ draft, onContinue, onDiscard, colors, appFont }) {
  const isPlaying = draft?.state === "playing";
  const completedHoles = getDraftCompletedHoles(draft);
  const clubName = draft?.courseSnapshot?.name || "Questo club";
  const routeName = String(draft?.routeName || "").trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-draft-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        boxSizing: "border-box",
        backgroundColor: colors.overlay,
        fontFamily: appFont
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          padding: "22px",
          boxSizing: "border-box",
          borderRadius: "20px",
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`
        }}
      >
        <div id="round-draft-title" style={{ fontSize: "21px", fontWeight: 700 }}>
          {isPlaying ? "Hai un giro in corso" : "Stai impostando un giro"}
        </div>
        <div style={{ marginTop: "10px", fontSize: "15px", fontWeight: 600 }}>
          {clubName}
        </div>
        {isPlaying ? (
          <div style={{ marginTop: "4px", color: colors.subtext, fontSize: "14px" }}>
            {[routeName, `${completedHoles} buche completate`].filter(Boolean).join(" · ")}
          </div>
        ) : routeName ? (
          <div style={{ marginTop: "4px", color: colors.subtext, fontSize: "14px" }}>
            {routeName}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onContinue}
          style={{
            marginTop: "22px",
            width: "100%",
            padding: "13px",
            border: "none",
            borderRadius: "12px",
            backgroundColor: colors.green,
            color: "#112018",
            cursor: "pointer",
            fontFamily: appFont,
            fontSize: "15px",
            fontWeight: 700
          }}
        >
          {isPlaying ? "Riprendi il giro" : "Continua"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          style={{
            marginTop: "10px",
            width: "100%",
            padding: "13px",
            border: `1px solid ${colors.border}`,
            borderRadius: "12px",
            backgroundColor: colors.cardSecondary,
            color: colors.text,
            cursor: "pointer",
            fontFamily: appFont,
            fontSize: "15px"
          }}
        >
          Abbandona
        </button>
      </div>
    </div>
  );
}

export function RoundDraftDiscardConfirm({ onCancel, onConfirm, colors, appFont }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-draft-discard-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 71,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        boxSizing: "border-box",
        backgroundColor: colors.overlay,
        fontFamily: appFont
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          padding: "20px",
          boxSizing: "border-box",
          borderRadius: "18px",
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`
        }}
      >
        <div id="round-draft-discard-title" style={{ fontSize: "19px", fontWeight: 700 }}>
          Abbandonare il giro?
        </div>
        <div style={{ marginTop: "8px", color: colors.subtext, fontSize: "14px", lineHeight: 1.45 }}>
          I dati inseriti in questo giro verranno eliminati dal dispositivo.
        </div>
        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "12px", borderRadius: "12px", border: `1px solid ${colors.border}`, backgroundColor: colors.cardSecondary, color: colors.text, fontFamily: appFont, fontWeight: 600 }}>
            Annulla
          </button>
          <button type="button" onClick={onConfirm} style={{ flex: 1, padding: "12px", border: "none", borderRadius: "12px", backgroundColor: "#b53b3b", color: "#fff", fontFamily: appFont, fontWeight: 700 }}>
            Abbandona
          </button>
        </div>
      </div>
    </div>
  );
}
