import {
  appendTrialLog,
  getTrialLog,
  getSetting,
  replaceTrialLog,
  setSetting,
} from "./storage/indexedDbStore.js";

export function formatTrialDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

let trialLog = [];
let nextTrialNumber = 1;

async function migrateTrialLogFromLocalStorage() {
  const migrationKey = "migration:trialLog";
  try {
    const hasMigrated = await getSetting(migrationKey);
    if (hasMigrated) return;

    const legacyPayload = localStorage.getItem("ppt-trial-log");
    if (!legacyPayload) return;

    let parsed = null;
    try {
      parsed = JSON.parse(legacyPayload);
    } catch (error) {
      return;
    }

    if (!Array.isArray(parsed)) return;

    await replaceTrialLog(parsed);
    localStorage.removeItem("ppt-trial-log");
    await setSetting(migrationKey, true);
  } catch (error) {
    // Ignore migration errors to avoid blocking stats.
  }
}

export async function loadTrialLog() {
  try {
    await migrateTrialLogFromLocalStorage();
    const entries = await getTrialLog();
    if (!Array.isArray(entries) || !entries.length) return trialLog;

    trialLog = entries.filter((entry) => typeof entry === "object" && entry !== null);
    const highestTrialNumber = trialLog.reduce((max, entry) => {
      const number = Number(entry.trialNumber);
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0);
    nextTrialNumber = highestTrialNumber + 1;
    return trialLog;
  } catch (error) {
    trialLog = [];
    nextTrialNumber = 1;
  }
  return trialLog;
}

export async function persistTrialLog(entries) {
  const payload = Array.isArray(entries) ? entries : trialLog;
  try {
    await replaceTrialLog(payload);
  } catch (error) {
    // Ignore storage errors to avoid disrupting the session.
  }
}

export async function logTrialResult(entry) {
  const timestampMS = Date.now();
  const logEntry = { ...entry, trialNumber: nextTrialNumber, timestampMS };
  trialLog.push(logEntry);
  nextTrialNumber += 1;
  try {
    await appendTrialLog(logEntry);
  } catch (error) {
    // Ignore storage errors to avoid disrupting the session.
  }
  return logEntry;
}

export function calculateAccuracy(entries) {
  if (!entries.length) return null;

  const eligibleEntries = entries.filter(
    (entry) => entry?.answerSet == null || entry.answerSet === "Auto"
  );

  if (!eligibleEntries.length) return null;

  const correctCount = eligibleEntries.reduce(
    (count, entry) => (entry?.isCorrect ? count + 1 : count),
    0
  );
  return Math.round((correctCount / eligibleEntries.length) * 100);
}

export function getExerciseTypeFromLabel(label = "") {
  const knownTypes = [
    "Tritones",
    "Thirds",
    "Minor thirds",
    "Tones",
    "Chromatic",
  ];

  const trimmedLabel = label.trim();
  return knownTypes.find((type) => trimmedLabel.startsWith(type)) ?? "";
}

function normalizeExerciseType(exerciseType = "") {
  const trimmed = exerciseType.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase() === "custom" ? "Custom" : trimmed;
}

export function getTrialsForExercise(exerciseType) {
  if (!exerciseType) return [];

  const normalizedType = normalizeExerciseType(exerciseType);
  return trialLog.filter((entry) => {
    const entryType =
      normalizeExerciseType(entry.exerciseType) ||
      normalizeExerciseType(getExerciseTypeFromLabel(entry.chromaSetLabel));
    return entryType === normalizedType;
  });
}

export function renderStats({
  statsOutput,
  getCurrentExerciseType,
  recentEntriesCount = 1000,
}) {
  if (!statsOutput) return;

  const totalTrials = trialLog.length;
  const todayString = formatTrialDate(new Date());
  const totalTrialsToday = trialLog.reduce(
    (count, entry) => {
      const entryDay = Number.isFinite(entry?.timestampMS)
        ? formatTrialDate(new Date(entry.timestampMS))
        : entry?.trialDate;
      return entryDay === todayString ? count + 1 : count;
    },
    0
  );

  const exerciseType = typeof getCurrentExerciseType === "function"
    ? getCurrentExerciseType()
    : "";
  if (!exerciseType) {
    statsOutput.innerHTML = `
      <div class="stats-block">
        <div class="stats-heading">Overview</div>
        <p><span class="muted">Total trials:</span> ${totalTrials}</p>
        <p><span class="muted">Total trials today:</span> ${totalTrialsToday}</p>
      </div>
      <p class="muted">Select a chroma set to view stats.</p>
    `;
    return;
  }

  const normalizedExerciseType = normalizeExerciseType(exerciseType);
  const entries = getTrialsForExercise(normalizedExerciseType);
  const totalExerciseTrials = entries.length;
  const eligibleEntries = entries.filter(
    (entry) => entry?.answerSet == null || entry.answerSet === "Auto"
  );
  const overallAccuracy = calculateAccuracy(entries);
  const recentEligibleEntries = eligibleEntries.slice(-recentEntriesCount);
  const recentAccuracy =
    recentEligibleEntries.length === recentEntriesCount
      ? calculateAccuracy(recentEligibleEntries)
      : null;

  const overallDisplay = overallAccuracy == null ? "-" : `${overallAccuracy}%`;
  const recentDisplay = recentAccuracy == null ? "-" : `${recentAccuracy}%`;

  statsOutput.innerHTML = `
    <div class="stats-block">
      <div class="stats-heading">Overview</div>
      <p><span class="muted">Total trials:</span> ${totalTrials}</p>
      <p><span class="muted">Total trials today:</span> ${totalTrialsToday}</p>
    </div>
    <div class="stats-block">
      <div class="stats-heading">${normalizedExerciseType}</div>
      <p><span class="muted">Total trials:</span> ${totalExerciseTrials}</p>
      <p><span class="muted">Overall accuracy:</span> ${overallDisplay}</p>
      <p><span class="muted">Last ${recentEntriesCount} trials accuracy:</span> ${recentDisplay}</p>
    </div>
  `;
}

export function refreshStatsIfOpen(statsPanelOpen, renderStatsFn) {
  if (statsPanelOpen && typeof renderStatsFn === "function") {
    renderStatsFn();
  }
}

export function _getTrialLogForTesting() {
  return trialLog;
}
