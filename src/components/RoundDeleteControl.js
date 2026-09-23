import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export function RoundDeleteControl({ roundName, onConfirm, colors, appFont }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const deleteLockRef = useRef(false);

  const closeConfirmation = () => {
    if (isDeleting) return;
    setError("");
    setIsOpen(false);
  };

  // This control can live inside a clickable history card. React events from a
  // portal still bubble through that card's React tree, so every interaction
  // belonging to the confirmation must be consumed here.
  const stopConfirmationEvent = (event) => {
    event.stopPropagation();
  };

  const closeFromBackdrop = (event) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) {
      closeConfirmation();
    }
  };

  const confirmDeletion = async () => {
    if (deleteLockRef.current) return;

    deleteLockRef.current = true;
    setIsDeleting(true);
    setError("");

    try {
      await onConfirm();
      setIsOpen(false);
    } catch (deleteError) {
      setError("Non siamo riusciti a eliminare il giro. Riprova.");
      deleteLockRef.current = false;
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={stopConfirmationEvent}
        onTouchStart={stopConfirmationEvent}
        onClick={(event) => {
          event.stopPropagation();
          setError("");
          setIsOpen(true);
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

      {isOpen &&
        createPortal(
          <div
            data-testid="round-delete-backdrop"
            onPointerDown={stopConfirmationEvent}
            onTouchStart={stopConfirmationEvent}
            onClick={closeFromBackdrop}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              boxSizing: "border-box",
              backgroundColor: colors.overlay
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="round-delete-title"
              onPointerDown={stopConfirmationEvent}
              onTouchStart={stopConfirmationEvent}
              onClick={stopConfirmationEvent}
              style={{
                width: "100%",
                maxWidth: "360px",
                padding: "20px",
                borderRadius: "18px",
                boxSizing: "border-box",
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                fontFamily: appFont
              }}
            >
              <div id="round-delete-title" style={{ fontSize: "19px", fontWeight: 700 }}>
                Eliminare questo giro?
              </div>
              <p
                style={{
                  margin: "8px 0 0",
                  color: colors.subtext,
                  fontSize: "14px",
                  lineHeight: 1.45
                }}
              >
                Questa azione non può essere annullata.
              </p>
              {roundName && (
                <div
                  style={{
                    marginTop: "12px",
                    color: colors.text,
                    fontSize: "13px",
                    fontWeight: 600
                  }}
                >
                  {roundName}
                </div>
              )}
              {error && (
                <div role="alert" style={{ marginTop: "12px", color: "#d64545", fontSize: "13px" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button
                  type="button"
                  onPointerDown={stopConfirmationEvent}
                  onTouchStart={stopConfirmationEvent}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeConfirmation();
                  }}
                  disabled={isDeleting}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "12px",
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.cardSecondary,
                    color: colors.text,
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    fontFamily: appFont,
                    fontSize: "14px",
                    fontWeight: 600
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onPointerDown={stopConfirmationEvent}
                  onTouchStart={stopConfirmationEvent}
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmDeletion();
                  }}
                  disabled={isDeleting}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: "none",
                    borderRadius: "12px",
                    backgroundColor: isDeleting ? colors.borderStrong : "#b53b3b",
                    color: "#fff",
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    fontFamily: appFont,
                    fontSize: "14px",
                    fontWeight: 700
                  }}
                >
                  {isDeleting ? "Eliminazione…" : "Elimina"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
