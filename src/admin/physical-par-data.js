export const parReason = (reason) => ({
  existing_classification_preserved: "Classificazione già presente: decisione conservata.",
  exact_verified_scope_missing_or_ambiguous: "Configurazione e ambito esatti mancanti o ambigui.",
  unverified_or_changed_dependencies: "Dipendenze non verificate, cambiate o override non coperti.",
  missing_live_par: "Par totale live assente.", live_par_diverges_from_verified_rule: "Par live divergente dalla regola verificata.",
  configuration_not_verified: "Configurazione ancora da verificare.", source_or_tee_base_changed: "Sorgente o base tee cambiata.",
  structure_not_verified: "Struttura non verificata.", incomplete_configuration_grid: "Griglia configurazione incompleta o SI non validi.",
  ambiguous_configuration_live_source: "Più configurazioni dichiarano la stessa sorgente live e ambito.",
  parent_revision_changed: "Revisione della configurazione padre cambiata.", components_incomplete: "Componenti multi-9 incompleti.",
  components_revision_changed: "Componenti multi-9 con revisioni cambiate.", physical_link_not_current: "Origine fisica non verificata o live divergente.",
  exact_live_link_or_si_changed: "Collegamento live esatto o SI della configurazione cambiato.", occurrence_invalid: "Occorrenza fisica incoerente.",
  par_base_diverges: "Par live e base verificata divergenti.", live_total_diverges: "Totale Par live incoerente con la griglia.",
  incomplete_club_coverage: "Copertura del club incompleta: non è possibile escludere altre dipendenze.",
  physical_hole_not_verified: "Buca fisica non verificata.", no_par_change: "Nessuna modifica al Par.",
  no_verified_inherited_configuration: "Nessuna configurazione ereditaria verificata per questa buca.",
  physical_source_configuration_missing: "La configurazione autonoma del Percorso fisico sorgente non è coperta: pubblicazione bloccata.",
  ambiguous_or_uncovered_live_row: "Riga live non coperta o condivisa con un override: pubblicazione bloccata.",
  tee_scope_uncovered: "Ambito tee senza configurazione verificata.", tee_scope_ambiguous: "Ambito tee ambiguo.",
  tee_unknown_review_obsolete_or_override: "Un tee impattato è sconosciuto, da revisionare, obsoleto, certificato o con override non coperto.",
  overlapping_live_draft: "Esiste una bozza catalogo con modifiche reali sui target impattati. Va risolta dal suo autore prima della pubblicazione.",
  overlapping_physical_par_draft: "Esiste una bozza Par fisico con modifiche reali sovrapposte. Nessuna bozza viene chiusa automaticamente.",
  target_not_approved: "Approva prima il batch Par dalla root Struttura e collegamenti.",
  physical_parent_required: "Par fisico unico: usa il publisher del padre. Il 9 e il 18 ripetuto restano coerenti.",
  shared_live_rows_no_local_override: "Righe live condivise: non è possibile creare un override del solo 18. Modifica il Par del padre fisico.",
  explicit_local_override_required: "La buca eredita il Par dal padre: è necessaria l’azione esplicita Crea override locale.",
  no_verified_parent_for_override: "Nessun padre verificato: la configurazione si modifica localmente, senza creare override.",
  overlapping_local_par_draft: "Un’altra bozza Par con modifiche reali si sovrappone alla configurazione.",
  inactive_target: "Configurazione non attiva.",
  no_playable_configuration: "Nessun Percorso o combinazione disponibile: nessuna abilitazione proposta.",
  no_safe_candidate: "Nessuna abilitazione o proposta tee supera i controlli: consulta i motivi della preview.",
  non_unique_exact_reference: "Il riferimento Percorso + numero buca non individua una sola buca.",
  source_busy: "Club occupato: nessuna sua abilitazione è stata registrata.",
  source_or_revision_changed: "Base del club cambiata dopo la preview: nessuna sua abilitazione è stata registrata.",
  club_validation_failed: "Controlli del club non superati: nessuna sua abilitazione è stata registrata."
}[reason] || "Dipendenza da revisionare: pubblicazione bloccata.");

export function parError(error) {
  if (error?.code === "42501") return "Operazione consentita solo all’Admin proprietario della bozza.";
  if (error?.code === "40001") return "La base o la revisione è cambiata. Abbandona esplicitamente la bozza e riapri l’anteprima.";
  if (error?.code === "55P03") return "Dati occupati da un’altra operazione. Riprova senza modificare la proposta.";
  if (error?.code === "23514") return "Pubblicazione bloccata dai controlli di coerenza. Consulta l’impatto e le esclusioni.";
  return "Impossibile completare l’operazione. Riprova.";
}

export function createPhysicalParService(client) {
  const invoke = async (suffix, params) => {
    const { data, error } = await client.rpc(`admin_catalog_par_${suffix}`, params);
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Par response");
    return data;
  };
  const localInvoke = async (suffix, params) => {
    const { data, error } = await client.rpc(`admin_catalog_local_par_${suffix}`, params);
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid local Par response");
    return data;
  };
  return {
    workflowPreview: () => invoke("workflow_preview", {}),
    workflowConfirm: (proposal, note) => invoke("workflow_confirm", { p_proposal: proposal, p_note: note.trim(), p_confirm: true }),
    local: {
      list: (clubId) => localInvoke("list", { p_club_id: clubId }),
      open: (type, target, hole) => localInvoke("open", { p_type: type, p_target: target, p_hole: hole }),
      save: (draft, par, override) => localInvoke("save", { p_draft: draft.id, p_revision: draft.revision, p_par: Number(par), p_override: override }),
      publish: (context, note) => localInvoke("publish", { p_draft: context.draft.id, p_revision: context.draft.revision, p_expected_hash: context.baseline_hash, p_note: note.trim(), p_confirm: true }),
      abandon: (draft) => localInvoke("abandon", { p_draft: draft.id, p_revision: draft.revision, p_confirm: true })
    },
    list: (clubId) => invoke("list", { p_club_id: clubId }),
    proposal: (clubId) => invoke("tee_proposal", { p_club_id: clubId }),
    confirmBatch: (proposal, note) => invoke("tee_confirm", { p_club_id: proposal.club_id, p_proposal_hash: proposal.proposal_hash, p_note: note.trim(), p_confirm: true }),
    open: (holeId) => invoke("open", { p_physical_hole_id: holeId }),
    save: (draft, par) => invoke("save", { p_draft_id: draft.id, p_revision: draft.revision, p_new_par: Number(par) }),
    publish: (context, note) => invoke("publish", { p_draft_id: context.draft.id, p_revision: context.draft.revision, p_expected_hash: context.baseline_hash, p_note: note.trim(), p_confirm: true }),
    abandon: (draft) => invoke("abandon", { p_draft_id: draft.id, p_revision: draft.revision, p_confirm: true })
  };
}
