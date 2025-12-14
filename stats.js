export function formatTrialDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

let trialLog = [];
let nextTrialNumber = 1;

export function loadTrialLog(storageKey) {
  try {
    const serialized = localStorage.getItem(storageKey);
    if (!serialized) return;

    const parsed = JSON.parse(serialized);
    if (Array.isArray(parsed)) {
      trialLog = parsed.filter((entry) => typeof entry === "object" && entry !== null);
      const highestTrialNumber = trialLog.reduce((max, entry) => {
        const number = Number(entry.trialNumber);
        return Number.isFinite(number) ? Math.max(max, number) : max;
      }, 0);
      nextTrialNumber = highestTrialNumber + 1;
    }
  } catch (error) {
    trialLog = [];
    nextTrialNumber = 1;
  }
}

export function persistTrialLog(storageKey) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(trialLog));
  } catch (error) {
    // Ignore storage errors to avoid disrupting the session.
  }
}

export function logTrialResult(entry, { storageKey }) {
  const trialDate = formatTrialDate(new Date());
  const logEntry = { ...entry, trialNumber: nextTrialNumber, trialDate };
  trialLog.push(logEntry);
  nextTrialNumber += 1;
  persistTrialLog(storageKey);
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
    "Special tones",
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
    (count, entry) => (entry?.trialDate === todayString ? count + 1 : count),
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
