import { hasTeeRatings } from "../lib/tee-selection";

export default function TeeScopeNotice({ holesCount, options, selectedTee, color, appFont }) {
  const scope = Number(holesCount);
  let message = "";
  if (!options.length) message = [9, 18].includes(scope)
    ? `Nessun tee disponibile per ${scope} buche. CR/Slope di altri ambiti non vengono utilizzati.`
    : "Ambito tee non disponibile.";
  else if (selectedTee && !hasTeeRatings(selectedTee)) message = "CR/Slope non disponibili per questo tee. Nessun rating viene stimato o sostituito.";
  return message ? <p role="status" style={{ marginTop: "8px", color, fontFamily: appFont, fontSize: "13px", lineHeight: 1.5 }}>{message}</p> : null;
}
