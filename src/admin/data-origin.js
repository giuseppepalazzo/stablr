// Read-only projection of one server snapshot. No inference of physical identity.
const ARRAYS = ["structures", "physical_holes", "physical_links", "configurations", "configuration_holes", "components", "tee_overrides", "courses", "course_holes", "combinations", "combination_holes", "route_tees", "combination_tees", "drafts"];
const one = (rows, id) => { const matches = rows.filter((r) => r.id === id); return matches.length === 1 ? matches[0] : null; };
const ordered = (rows, key) => [...rows].sort((a, b) => a[key] - b[key] || String(a.id).localeCompare(String(b.id)));
const gridComplete = (rows, count, key) => [9, 18].includes(count) && rows.length === count && new Set(rows.map((r) => r[key])).size === count && rows.every((r) => Number.isInteger(r[key]) && r[key] >= 1 && r[key] <= count);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

export function validateOriginGraph(data, clubId) {
  if (data?.contract_version !== 2 || data.read_only !== true || data.publication !== "not_assessed" || data.club?.id !== clubId || ARRAYS.some((k) => !Array.isArray(data[k]))) throw new Error("Invalid minimized read-only origin graph");
  return data;
}

function physicalOrigin(g, hole) {
  const link = one(g.physical_links, hole?.source_course_link_id);
  const source = one(g.course_holes, hole?.source_route_hole_id);
  const course = one(g.courses, link?.course_id);
  const structure = one(g.structures, hole?.structure_id);
  const exact = !!source && !!course && source.route_id === course.id && source.physical_hole_number === hole.physical_number
    && g.course_holes.filter((h) => h.route_id === source.route_id && h.physical_hole_number === source.physical_hole_number).length === 1;
  return { link, source, course, structure, exact,
    verified: exact && hole.review_status === "verified" && link.review_status === "verified" && structure?.review_status === "verified"
      && link.structure_id === hole.structure_id && link.club_id === hole.club_id,
    changed: !!link && link.source_state !== "matched" };
}

export function originTargets(g) {
  return [
    ...g.physical_holes.map((h) => ({ type: "physical_hole", id: h.id, label: `${physicalOrigin(g, h).course?.name || one(g.structures, h.structure_id)?.label || "Origine da revisionare"} · Buca ${h.physical_number}` })),
    ...g.configurations.map((c) => ({ type: "configuration", id: c.id, label: c.label })),
    ...g.route_tees.map((t) => ({ type: "route_tee", id: t.id, label: `${one(g.courses, t.route_id)?.name || "Percorso non disponibile"} · ${t.tee_name} · ${t.holes_count ?? "—"} buche` })),
    ...g.combination_tees.map((t) => ({ type: "combination_tee", id: t.id, label: `${one(g.combinations, t.route_combination_id)?.name || "Combinazione non disponibile"} · ${t.tee_name} · ${t.holes_count ?? "—"} buche` }))
  ];
}

function configView(g, c) {
  const issues = [];
  const ambiguous = g.configurations.some((other) => other.id !== c.id && other.holes_count === c.holes_count
    && ((c.legacy_course_route_id && other.legacy_course_route_id === c.legacy_course_route_id)
      || (c.legacy_combination_id && other.legacy_combination_id === c.legacy_combination_id)));
  if (ambiguous) issues.push("ambiguous_live_link");
  const components = ordered(g.components.filter((p) => p.configuration_id === c.id), "component_position").map((p) => {
    const parent = one(g.configurations, p.parent_configuration_id), link = one(g.physical_links, p.physical_course_link_id);
    return { ...p, parent_label: parent?.label, course_name: one(g.courses, link?.course_id)?.name,
      valid: p.review_status === "verified" && parent?.review_status === "verified" && link?.review_status === "verified"
        && parent.structure_id === c.structure_id && link.structure_id === c.structure_id
        && parent.revision === p.parent_configuration_revision && link.revision === p.physical_course_link_revision };
  });
  if (c.registration_kind === "multi9_18" && (components.length !== 2 || components.some((p) => !p.valid))) issues.push("components_incomplete");
  if (c.parent_configuration_id) {
    const parent = one(g.configurations, c.parent_configuration_id);
    if (!parent || parent.review_status !== "verified" || parent.revision !== c.parent_configuration_revision) issues.push("parent_changed");
  }
  const slots = ordered(g.configuration_holes.filter((h) => h.configuration_id === c.id), "position").map((s) => {
    const physical = one(g.physical_holes, s.physical_hole_id), origin = physicalOrigin(g, physical);
    const routeHole = one(g.course_holes, s.legacy_route_hole_id), combinationHole = one(g.combination_holes, s.legacy_combination_hole_id);
    const source = routeHole || combinationHole;
    const sourceCourse = routeHole ? one(g.courses, routeHole.route_id) : null;
    const basePar = physical?.base_par ?? null;
    const effectivePar = s.par_mode === "inherited" ? basePar : s.par_mode === "override" ? s.par_override : null;
    // Compare a repeated occurrence only under the explicitly registered rule.
    const liveSI = source?.stroke_index == null ? null : c.derivation_rule === "repeat_same_9_si_base_then_plus_1_cap_18" && s.occurrence === 2
      ? Math.min(18, source.stroke_index + 1) : source.stroke_index;
    const liveReferenceValid = !!source && !(routeHole && combinationHole) && (routeHole ? routeHole.route_id === c.legacy_course_route_id
      : combinationHole.route_combination_id === c.legacy_combination_id && origin.source?.route_id === combinationHole.route_id
        && origin.source?.physical_hole_number === combinationHole.physical_hole_number);
    const linked = !!physical && origin.verified && s.review_status === "verified" && s.structure_id === c.structure_id && physical.structure_id === c.structure_id && liveReferenceValid;
    return { ...s, physical, origin, source, source_course_name: sourceCourse?.name,
      base_par: basePar, effective_par: effectivePar, live_par: source?.par ?? null, live_si: liveSI,
      linked, changed: !!source && (source.par !== effectivePar || liveSI !== s.stroke_index),
      label: `${origin.course?.name || "Origine da revisionare"} · Buca ${physical?.physical_number ?? "—"}` };
  });
  const cardinality = gridComplete(slots, c.holes_count, "position");
  if (!cardinality) issues.push("incomplete_grid");
  if (c.review_status !== "verified" || slots.some((s) => !s.linked) || !slots.length) issues.push("unverified_link");
  if (new Set(slots.map((s) => `${s.physical_hole_id}:${s.occurrence}`)).size !== slots.length) issues.push("duplicate_occurrence");
  if (slots.some((s) => !Number.isInteger(s.stroke_index) || s.stroke_index < 1 || s.stroke_index > 18) || new Set(slots.map((s) => s.stroke_index)).size !== c.holes_count) issues.push("invalid_si");
  if (slots.some((s) => s.origin.changed || s.changed)) issues.push("source_changed");
  if (slots.some((s) => !["inherited", "override"].includes(s.par_mode) || !Number.isInteger(s.effective_par) || s.effective_par < 3 || s.effective_par > 6)) issues.push("invalid_par");
  const currentSource = c.legacy_combination_id ? one(g.combinations, c.legacy_combination_id) : one(g.courses, c.legacy_course_route_id);
  if (c.source_state === "unknown" || !currentSource) issues.push("source_snapshot_missing");
  else if (c.source_state !== "matched") issues.push("source_snapshot_changed");
  if (!["matched", "not_recorded"].includes(c.tee_state)) issues.push("tee_snapshot_changed");
  return { ...c, slots, components, cardinality_complete: cardinality, linkage_verified: c.review_status === "verified" && slots.length > 0 && slots.every((s) => s.linked)
      && !ambiguous && !issues.includes("parent_changed") && (c.registration_kind !== "multi9_18" || (components.length === 2 && components.every((p) => p.valid))),
    issues: [...new Set(issues)], total_par: slots.length && slots.every((s) => s.effective_par != null) ? slots.reduce((n, s) => n + s.effective_par, 0) : null,
    parent_label: one(g.configurations, c.parent_configuration_id)?.label,
    live_source_name: currentSource?.name, live_source_system: currentSource?.source_system };
}

function liveCoverage(g, configs) {
  return [
    ...g.courses.filter((r) => r.is_active).map((r) => ({ type: "course", id: r.id, label: r.name, holes_count: r.holes_count,
      cardinality_complete: gridComplete(g.course_holes.filter((h) => h.route_id === r.id), r.holes_count, "physical_hole_number"),
      linked: configs.some((c) => c.legacy_course_route_id === r.id && c.holes_count === r.holes_count && c.cardinality_complete && c.linkage_verified) })),
    ...g.combinations.filter((r) => r.is_active).map((r) => ({ type: "combination", id: r.id, label: r.name, holes_count: r.holes_count,
      cardinality_complete: gridComplete(g.combination_holes.filter((h) => h.route_combination_id === r.id), r.holes_count, "round_hole_number"),
      linked: configs.some((c) => c.legacy_combination_id === r.id && c.cardinality_complete && c.linkage_verified) }))
  ].filter((r) => !r.linked);
}

function draftViews(g, ids) {
  return g.drafts.filter((d) => ids.has(d.live_entity_id)).map((d) => {
    const course = one(g.courses, d.live_entity_id), combo = one(g.combinations, d.live_entity_id);
    const tee = one(g.route_tees, d.live_entity_id) || one(g.combination_tees, d.live_entity_id);
    const live = course || combo || tee;
    return { ...d, label: live?.name || tee?.tee_name || (d.entity_type === "club" ? g.club.name : "Dato collegato"),
      has_changes: d.has_changes !== false, base_status: ["changed", "checked_fields"].includes(d.base_status) ? d.base_status : "unknown" };
  });
}

export function analyseOrigin(g, target = null) {
  const configs = g.configurations.map((c) => configView(g, c));
  const uncovered = liveCoverage(g, configs);
  const related = new Set([g.club.id]);
  let selected = null, involved = configs;
  if (target?.type === "physical_hole") {
    const hole = one(g.physical_holes, target.id);
    if (hole) {
      const origin = physicalOrigin(g, hole);
      involved = configs.filter((c) => c.slots.some((s) => s.physical_hole_id === hole.id));
      const exactLiveRefs = origin.exact ? g.combination_holes.filter((h) => h.route_id === origin.source.route_id && h.physical_hole_number === origin.source.physical_hole_number
        && g.course_holes.filter((r) => r.route_id === h.route_id && r.physical_hole_number === h.physical_hole_number).length === 1)
        .map((h) => ({ ...h, combination_name: one(g.combinations, h.route_combination_id)?.name,
          registered: involved.some((c) => c.slots.some((s) => s.legacy_combination_hole_id === h.id && s.linked)) })) : [];
      selected = { type: target.type, record: hole, origin, exact_live_references: exactLiveRefs };
      if (origin.course) related.add(origin.course.id);
      if (origin.source) related.add(origin.source.id);
      exactLiveRefs.forEach((r) => { related.add(r.route_combination_id); related.add(r.id); });
    }
  } else if (target?.type === "configuration") {
    const c = configs.find((r) => r.id === target.id);
    if (c) { selected = { type: target.type, record: c }; involved = [c]; }
  } else if (["route_tee", "combination_tee"].includes(target?.type)) {
    const tee = one(target.type === "route_tee" ? g.route_tees : g.combination_tees, target.id);
    if (tee) {
      const course = one(g.courses, tee.route_id), combo = one(g.combinations, tee.route_combination_id);
      const overrides = g.tee_overrides.filter((o) => target.type === "route_tee" ? o.route_tee_id === tee.id : o.combination_tee_id === tee.id);
      const scope = tee.holes_count ?? course?.holes_count ?? combo?.holes_count;
      involved = configs.filter((c) => (course && c.legacy_course_route_id === course.id && c.holes_count === scope) || (combo && c.legacy_combination_id === combo.id && c.holes_count === scope) || overrides.some((o) => o.configuration_id === c.id));
      selected = { type: target.type, record: tee, course, combination: combo, overrides, effective_holes_count: scope };
      related.add(tee.id); if (course) related.add(course.id); if (combo) related.add(combo.id);
    }
  }
  if (target && !selected) throw new Error("Origin target not present in this snapshot");
  involved.forEach((c) => {
    if (c.legacy_course_route_id) related.add(c.legacy_course_route_id);
    if (c.legacy_combination_id) related.add(c.legacy_combination_id);
    c.slots.forEach((s) => { if (s.source) related.add(s.source.id); if (s.origin.course) related.add(s.origin.course.id); });
    c.components.forEach((p) => { const link = one(g.physical_links, p.physical_course_link_id); if (link) related.add(link.course_id); });
  });
  if (!target) [...g.courses, ...g.combinations, ...g.route_tees, ...g.combination_tees].forEach((r) => related.add(r.id));
  g.route_tees.filter((t) => related.has(t.route_id)).forEach((t) => related.add(t.id));
  g.combination_tees.filter((t) => related.has(t.route_combination_id)).forEach((t) => related.add(t.id));
  const overrides = g.tee_overrides.filter((o) => selected?.overrides ? selected.overrides.some((x) => x.id === o.id) : involved.some((c) => c.id === o.configuration_id
    && (target?.type !== "physical_hole" || c.slots.some((s) => s.id === o.configuration_hole_id && s.physical_hole_id === target.id)))).map((o) => {
    const c = configs.find((x) => x.id === o.configuration_id), slot = c?.slots.find((s) => s.id === o.configuration_hole_id);
    const tee = one(g.route_tees, o.route_tee_id) || one(g.combination_tees, o.combination_tee_id);
    if (tee) related.add(tee.id);
    const scope = tee?.holes_count ?? one(g.courses, tee?.route_id)?.holes_count ?? one(g.combinations, tee?.route_combination_id)?.holes_count;
    return { ...o, configuration_label: c?.label, tee_label: tee?.tee_name, position: slot?.position,
      explicit_link: !!slot && !!tee && scope === c.holes_count && (o.route_tee_id ? tee.route_id === c.legacy_course_route_id : tee.route_combination_id === c.legacy_combination_id),
      configuration_par: slot?.effective_par, configuration_si: slot?.stroke_index,
      foundation_par: own(o, "par_override") && o.par_override != null ? o.par_override : slot?.effective_par,
      foundation_si: o.stroke_index_override ?? slot?.stroke_index };
  });
  const matrices = g.courses.filter((r) => related.has(r.id) && r.tee_matrix?.present === true)
    .map((r) => ({ course_name: r.name, course_id: r.id, matrix: r.tee_matrix, association_verified: false }));
  const drafts = draftViews(g, related);
  const issues = [...new Set(involved.flatMap((c) => c.issues))];
  if (uncovered.length) issues.push("incomplete_coverage");
  if (selected?.type === "physical_hole" && !selected.origin.verified) issues.push("unverified_origin");
  if (selected?.type === "physical_hole" && selected.origin.changed) issues.push("source_changed");
  if (!involved.length) issues.push("impact_not_certified");
  if (drafts.some((d) => d.base_status === "changed")) issues.push("stale_draft");
  if (overrides.some((o) => !o.explicit_link || o.review_status !== "verified")) issues.push("unverified_tee_override");
  if (matrices.length) issues.push("matrix_association_unverified");
  return { selected, configurations: involved, uncovered_live: uncovered, overrides, matrices, drafts, issues: [...new Set(issues)],
    coverage_complete: !uncovered.length && involved.length > 0 && involved.every((c) => c.linkage_verified && c.cardinality_complete)
      && !matrices.length && !overrides.some((o) => !o.explicit_link || o.review_status !== "verified")
      && !(selected?.type === "physical_hole" && !selected.origin.verified),
    publication: "not_assessed" };
}
