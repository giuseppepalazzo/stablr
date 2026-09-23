export function RoundsHistoryEmptyState({ colors, appFont }) {
  return (
    <div
      style={{
        color: colors.subtext,
        lineHeight: 1.5,
        backgroundColor: colors.cardSecondary,
        border: `1px solid ${colors.border}`,
        borderRadius: "14px",
        padding: "16px",
        fontFamily: appFont
      }}
    >
      <div style={{ color: colors.text, fontSize: "16px", fontWeight: 700 }}>
        Nessun giro salvato
      </div>
      <div style={{ marginTop: "4px", fontSize: "14px" }}>
        I tuoi giri completati appariranno qui.
      </div>
    </div>
  );
}
