export function isFigCatalogClubAwaitingPlayableData(club) {
  const sourcePayload = club?.sourcePayload || {};
  const hasNoPublishedConfigurations =
    (!Array.isArray(club?.routes) || club.routes.length === 0) &&
    (!Array.isArray(club?.routeCombinations) || club.routeCombinations.length === 0);

  return (
    club?.sourceType === "fig_import" &&
    Boolean(club?.figClubId) &&
    club?.playable === false &&
    club?.dataStatus === "needs_review" &&
    (sourcePayload.governance_state === "in_review" ||
      sourcePayload.verification_status === "in_review") &&
    hasNoPublishedConfigurations
  );
}
