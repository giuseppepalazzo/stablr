import { createCatalogWorkflow } from "./catalog-workflow";
import { normalizeClubFields } from "./club-editor-data";
import { createNewClubCourseService } from "./new-club-course-data";

const FIG_FIELDS = "id,name,city,source_system,source_external_id";
const LINKED_CLUB_FIELDS = "id,name,city,data_status,source_type,source_system,source_external_id,fig_club_id,fig_match_status,fig_payload_code:source_payload->>figClubCode,fig_payload_legacy_code:source_payload->>fig_club_code,playable,created_at,updated_at,fig_clubs(source_external_id),course_routes(id,name,holes_count,display_order,is_active,route_holes(id,par,stroke_index),route_tees(id,is_active)),route_combinations(id,name,front_route_id,back_route_id,holes_count,is_active)";
const validFigSource = (source) => source && typeof source.id === "string" && source.id &&
  source.source_system === "fig" && typeof source.source_external_id === "string" && source.source_external_id &&
  typeof source.name === "string" && source.name.trim() && (source.city == null || typeof source.city === "string") &&
  Object.keys(source).every((key) => ["id", "name", "city", "source_system", "source_external_id"].includes(key));

// This reference belongs only to the private snapshot. It is not a live FIG
// foreign key or a definitive matching decision. Legacy name/city drafts work.
export function normalizeNewClubFields(fields) {
  return { ...normalizeClubFields(fields), fig_code: String(fields.fig_code || "").trim() || null };
}

export function createNewClubDraftService(client) {
  const workflow = createCatalogWorkflow(client);
  const requireOwner = (ownerId) => {
    if (!client || !ownerId) throw new Error("Authenticated Admin required");
  };
  const requireDraft = (draft, ownerId) => {
    if (!draft?.draft_id || draft.entity_type !== "club" || draft.live_entity_id !== null ||
      draft.created_by !== ownerId || draft.workflow_status !== "draft" || draft.schema_version !== 1 ||
      draft.parent_draft_id != null || draft.base_version_id != null || draft.base_snapshot != null ||
      !Number.isInteger(draft.revision) || draft.revision < 1 ||
      typeof draft.snapshot?.name !== "string" ||
      (draft.snapshot.city != null && typeof draft.snapshot.city !== "string") ||
      (draft.snapshot.fig_code != null && typeof draft.snapshot.fig_code !== "string") ||
      (draft.snapshot.fig_source != null && !validFigSource(draft.snapshot.fig_source)) ||
      Object.keys(draft.snapshot).some((key) => !["name", "city", "fig_code", "fig_source"].includes(key))) {
      throw new Error("Invalid owned new Club draft");
    }
    return draft;
  };
  const query = (ownerId) => {
    requireOwner(ownerId);
    return client.from("admin_catalog_drafts")
      .select("draft_id,entity_type,live_entity_id,parent_draft_id,base_version_id,base_snapshot,schema_version,snapshot,workflow_status,revision,created_by,created_at,updated_at")
      .eq("entity_type", "club").eq("created_by", ownerId).eq("workflow_status", "draft")
      .eq("schema_version", 1).is("live_entity_id", null).is("parent_draft_id", null)
      .is("base_version_id", null).is("base_snapshot", null);
  };
  const findLinkedClubs = async (figClubs, ownerId) => {
    requireOwner(ownerId);
    if (!figClubs.length) return [];
    const ids = figClubs.map((club) => club.id);
    const references = [...new Set(figClubs.map((club) => club.source_external_id).filter(Boolean))];
    const read = () => client.from("clubs").select(LINKED_CLUB_FIELDS);
    // These are stored identities used by catalog imports and the Admin FIG
    // label, never name/city/colour similarity or a matching status alone.
    const queries = [read().in("fig_club_id", ids)];
    if (references.length) queries.push(
      read().eq("source_system", "fig").in("source_external_id", references),
      read().in("source_payload->>figClubCode", references),
      read().in("source_payload->>fig_club_code", references)
    );
    const linked = new Map();
    for (const { data, error } of await Promise.all(queries.map((item) => item.limit(1000)))) {
      if (error) throw error;
      if (!Array.isArray(data) || data.length >= 1000) throw new Error("Incomplete linked Club response");
      for (const row of data) {
        if (!row?.id) throw new Error("Invalid linked Club response");
        linked.set(row.id, row);
      }
    }
    return [...linked.values()];
  };
  const hasExactLink = (club, fig) => club.fig_club_id === fig.id || (fig.source_external_id && (
    (club.source_system === "fig" && club.source_external_id === fig.source_external_id) ||
    club.fig_payload_code === fig.source_external_id || club.fig_payload_legacy_code === fig.source_external_id
  ));
  const ensureUnlinked = async (figId, ownerId, externalId = null) => {
    const fig = { id: figId, source_external_id: externalId };
    const matches = (await findLinkedClubs([fig], ownerId)).filter((club) => hasExactLink(club, fig));
    if (matches.length > 1) throw Object.assign(new Error("Ambiguous FIG link"), { code: "FIG_LINK_AMBIGUOUS" });
    if (matches.length) throw Object.assign(new Error("FIG Club already linked"), { code: "FIG_CLUB_EXISTS", club: matches[0] });
  };
  const checkSnapshotLink = async (snapshot, ownerId) => {
    if (snapshot.fig_source) await ensureUnlinked(snapshot.fig_source.id, ownerId, snapshot.fig_source.source_external_id);
    // A manually entered reference is checked by exact source identity only.
    // It never assigns a FIG relationship or uses name/city similarity.
    if (snapshot.fig_code && snapshot.fig_code !== snapshot.fig_source?.source_external_id) {
      const { data, error } = await client.from("fig_clubs").select("id")
        .eq("source_system", "fig").eq("source_external_id", snapshot.fig_code).maybeSingle();
      if (error) throw error;
      if (data) await ensureUnlinked(data.id, ownerId, snapshot.fig_code);
    }
  };
  return {
    ...createNewClubCourseService(client),
    async searchFigClubs(text, ownerId) {
      requireOwner(ownerId);
      const term = String(text || "").trim().slice(0, 200);
      if (!term) return [];
      // Column-specific ilike avoids interpolating user text into PostgREST OR
      // syntax. Escape wildcard characters so each query is a literal search.
      const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      const results = await Promise.all(["name", "city", "source_external_id"].map((column) =>
        client.from("fig_clubs").select(FIG_FIELDS).eq("source_system", "fig")
          .ilike(column, pattern).order("name", { ascending: true }).limit(25)));
      const rows = new Map();
      for (const { data, error } of results) {
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error("Invalid FIG search response");
        for (const row of data) {
          if (!validFigSource(row)) throw new Error("Invalid FIG Club source");
          rows.set(row.id, row);
        }
      }
      const figClubs = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
      const linked = await findLinkedClubs(figClubs, ownerId);
      return figClubs.map((fig) => ({ ...fig, existingClubs: linked.filter((club) => hasExactLink(club, fig)) }));
    },
    async listDrafts(ownerId) {
      const { data, error } = await query(ownerId).order("updated_at", { ascending: false });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Invalid new Club draft list");
      return data.map((draft) => requireDraft(draft, ownerId));
    },
    async openDraft(draftId, ownerId, figClubId = null) {
      requireOwner(ownerId);
      if (!draftId) {
        let snapshot = { name: "", city: null };
        if (figClubId) {
          // Re-read the exact DB record on confirmation, not a client search
          // result or an external fetch. Never retain source_payload.
          const { data, error } = await client.from("fig_clubs").select(FIG_FIELDS)
            .eq("source_system", "fig").eq("id", figClubId).single();
          if (error) throw error;
          if (!validFigSource(data) || data.id !== figClubId) throw new Error("Invalid FIG Club source");
          await ensureUnlinked(figClubId, ownerId, data.source_external_id);
          const prior = await query(ownerId).contains("snapshot", { fig_source: { id: figClubId } }).limit(2);
          if (prior.error) throw prior.error;
          if (!Array.isArray(prior.data) || prior.data.length > 1) throw new Error("Ambiguous new FIG Club drafts");
          if (prior.data.length) return requireDraft(prior.data[0], ownerId);
          snapshot = { ...normalizeClubFields(data), fig_code: data.source_external_id,
            fig_source: { id: data.id, name: data.name, city: data.city ?? null,
              source_system: data.source_system, source_external_id: data.source_external_id } };
        }
        return requireDraft(await workflow.createDraft({ entityType: "club", snapshot }), ownerId);
      }
      const { data, error } = await query(ownerId).eq("draft_id", draftId).single();
      if (error) throw error;
      const draft = requireDraft(data, ownerId);
      if (draft.draft_id !== draftId) throw new Error("New Club draft target mismatch");
      await checkSnapshotLink(draft.snapshot, ownerId);
      return draft;
    },
    async saveDraft(draft, fields, ownerId) {
      requireOwner(ownerId);requireDraft(draft, ownerId);
      const normalized = normalizeNewClubFields(fields);
      const snapshot = { ...normalizeClubFields(fields),
        ...(Object.hasOwn(draft.snapshot, "fig_code") || normalized.fig_code ? { fig_code: normalized.fig_code } : {}),
        ...(draft.snapshot.fig_source ? { fig_source: draft.snapshot.fig_source } : {}) };
      if (!snapshot.name || snapshot.name.length > 200 || (snapshot.city?.length || 0) > 200 || (snapshot.fig_code?.length || 0) > 200) {
        throw new Error("Club name and city validation failed");
      }
      await checkSnapshotLink(snapshot, ownerId);
      const saved = requireDraft(await workflow.saveDraft({
        draftId: draft.draft_id, snapshot, expectedRevision: draft.revision
      }), ownerId);
      if (saved.draft_id !== draft.draft_id) throw new Error("New Club draft target mismatch");
      return saved;
    },
    async abandonDraft(draft, ownerId) {
      requireOwner(ownerId);requireDraft(draft, ownerId);
      const { data, error } = await client.rpc("admin_catalog_archive_draft", {
        p_draft_id: draft.draft_id, p_entity_type: "club", p_expected_revision: draft.revision
      });
      if (error) throw error;
      const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
      if (row?.draft_id !== draft.draft_id || row.workflow_status !== "archived" ||
        row.live_entity_id !== null || row.created_by !== ownerId) throw new Error("New Club draft was not archived");
      return row;
    }
  };
}
