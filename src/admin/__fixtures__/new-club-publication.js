// Automatic tests only: no production/demo data.
export function emptyPublicationPreview(draft) {
  return { draft_id: draft.draft_id, revision: draft.revision, confirmation_hash: "a".repeat(64),
    club: draft.snapshot, courses: [], can_publish: false, blockers: ["Almeno un Percorso attivo richiesto: aggiungi un Percorso privato."],
    counts: { courses: 0, holes: 0, tees: 0 }, checklist: { club_name: !!draft.snapshot.name, unique_name: true, provenance: true, courses: false, holes: false, tees: false } };
}
