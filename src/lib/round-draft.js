export const ROUND_DRAFT_VERSION = 1;
const ROUND_DRAFT_KEY_PREFIX = "stablr:round-draft:v1";

function getDraftKey(userId) {
  return `${ROUND_DRAFT_KEY_PREFIX}:${String(userId || "").trim()}`;
}

function isValidDraft(draft, userId) {
  return Boolean(
    draft &&
      draft.version === ROUND_DRAFT_VERSION &&
      draft.userId === userId &&
      (draft.state === "setup" || draft.state === "playing") &&
      draft.courseSnapshot?.id &&
      draft.roundSetup
  );
}

export function saveRoundDraft(userId, draft) {
  if (!userId || !draft) return false;

  const nextDraft = {
    ...draft,
    version: ROUND_DRAFT_VERSION,
    userId,
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(getDraftKey(userId), JSON.stringify(nextDraft));
    return true;
  } catch (error) {
    return false;
  }
}

export function loadRoundDraft(userId) {
  if (!userId) return null;

  try {
    const rawDraft = localStorage.getItem(getDraftKey(userId));
    if (!rawDraft) return null;
    const draft = JSON.parse(rawDraft);
    return isValidDraft(draft, userId) ? draft : null;
  } catch (error) {
    return null;
  }
}

export function clearRoundDraft(userId) {
  if (!userId) return false;

  try {
    localStorage.removeItem(getDraftKey(userId));
    return true;
  } catch (error) {
    return false;
  }
}

export function getDraftCompletedHoles(draft) {
  return Array.isArray(draft?.completedHoleIndexes)
    ? new Set(draft.completedHoleIndexes.filter((index) => Number.isInteger(index))).size
    : 0;
}
