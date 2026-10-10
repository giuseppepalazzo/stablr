import { Children, createContext, useContext, useState } from "react";

const Expansion = createContext(null);

export function TechnicalExpansion({ children }) {
  const [command, setCommand] = useState({ expanded: false, revision: 0 });
  return <Expansion.Provider value={{ ...command, toggle: () => setCommand((current) => ({ expanded: !current.expanded, revision: current.revision + 1 })) }}>{children}</Expansion.Provider>;
}

export function ExpandAllTechnicalRows() {
  const command = useContext(Expansion);
  if (!command) return null;
  return <button className="stablr-admin-abandon-button stablr-admin-technical-global" type="button" aria-expanded={command.expanded} onClick={command.toggle}>{command.expanded ? "Riduci tutte" : "Espandi tutte"}</button>;
}

function useExpansion() {
  const command = useContext(Expansion);
  const [local, setLocal] = useState(null);
  const revision = command?.revision ?? 0;
  const expanded = local?.revision === revision ? local.expanded : (command?.expanded ?? false);
  return [expanded, () => setLocal({ revision, expanded: !expanded })];
}

// Grouped technical sections expand globally; raw JSON disclosures stay separate.
export function TechnicalDisclosure({ summary, children, className }) {
  const [expanded, toggle] = useExpansion();
  return <details className={className} open={expanded}><summary onClick={(event) => { event.preventDefault(); toggle(); }}>{summary}</summary>{children}</details>;
}

// Only wrap technical collections: operational cards and alerts remain visible.
// Fragments preserve the existing table rows, column grids and data order.
export default function TechnicalRows({ children, label, list = false }) {
  const [expanded, toggle] = useExpansion();
  const rows = Children.toArray(children);
  const control = <button className="stablr-admin-technical-toggle" type="button" aria-label={`${expanded ? "Riduci" : "Mostra tutto"} · ${label}`} aria-expanded={expanded} onClick={toggle}>{expanded ? "Riduci" : "Mostra tutto"}<span> · {expanded ? rows.length : 6} di {rows.length}</span></button>;
  return <>
    {expanded ? rows : rows.slice(0, 6)}
    {rows.length > 6 && (list ? <li className="stablr-admin-technical-list-control" role="none">{control}</li> : control)}
  </>;
}
