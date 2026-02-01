import {
  BASE_MIDI_RANGE,
  chromas,
  chromaLookup,
  chromaSets,
  instruments,
  instrumentRanges,
} from "./music.js";
import {
  getExerciseTypeFromLabel,
  loadTrialLog,
  logTrialResult,
  refreshStatsIfOpen as refreshStatsIfOpenUtil,
  renderStats as renderStatsUtil,
} from "./stats.js";
import { exportLogs } from "./export_logs.js";
import {
  deleteSeries,
  getSeriesById,
  getSeriesList,
  getSetting,
  saveSeries,
  setSetting,
} from "./storage/indexedDbStore.js";
const CORRECT_FEEDBACK_DURATION = 400;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 0;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";
const LAST_ANSWER_SET_KEY = "ppt-last-answer-set";
const CUSTOM_CHROMA_STORAGE_KEY = "ppt-custom-chromas";
const TRIAL_LOG_STORAGE_KEY = "ppt-trial-log";
const REDUCED_RANGE_STORAGE_KEY = "ppt-reduced-range-enabled";
const RANDOMIZE_BUTTON_ORDER_KEY = "ppt-randomize-buttons";
const DRONE_COUNT_STORAGE_KEY = "ppt-drone-count";
const LIMITED_FEEDBACK_STORAGE_KEY = "ppt-limited-feedback";
const FEEDBACK_MODE_STORAGE_KEY = "ppt-feedback-mode";
const SERIES_RANDOMIZE_START_STORAGE_KEY = "ppt-series-randomize-start";
const LAST_MODE_STORAGE_KEY = "ppt-last-mode";
const LAST_RECALL_PRECISION_KEY = "ppt-last-recall-precision";
const RANDOMIZE_BUTTON_ORDER_REROLL_INTERVAL = 5;
const FADE_DURATION_MS = 100;
const DRONE_CROSSFADE_START_MS = 2000;
const DRONE_CROSSFADE_DURATION_MS = 300;
const DRONE_RESTART_OFFSET_MS = 150;
const DRONE_BASE_GAIN_DB = -10;
const DRONE_MIDI_START = 48;
const DRONE_MIDI_END = 59;
const DRONE_AUDIO_EXTENSION = "mp3";
const RECENT_ENTRIES = 1000;
const PREFETCH_TRIAL_COUNT = 10;
// Toggle between "mp3" or "wav" to switch the asset set without exposing UI controls.
const DEFAULT_AUDIO_FORMAT = "mp3";

const ANSWER_SET_TYPES = [
  "Auto",
  "Tritones",
  "Thirds",
  "Minor thirds",
  "Tones",
];

const ANSWER_SET_PRIORITY = [
  "Chromatic",
  "Tones",
  "Minor thirds",
  "Thirds",
  "Tritones",
];

const MODES = [
  { value: "recognize", label: "Recognize" },
  { value: "recall", label: "Recall" },
  { value: "discrimination", label: "Discrimination" },
];

const RECALL_PRECISION_OPTIONS = [
  { value: "fourth", label: "Fourth", semitones: 5 },
  { value: "major-third", label: "Major third", semitones: 4 },
  { value: "minor-third", label: "Minor third", semitones: 3 },
  { value: "second", label: "Major second", semitones: 2 },
  { value: "minor-second", label: "Minor second", semitones: 1 },
];

const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const modeSelect = document.getElementById("mode-select");
const precisionSelect = document.getElementById("precision-select");
const chromaSetSelect = document.getElementById("chroma-set-select");
const answerSetSelect = document.getElementById("answer-set-select");
const droneCountSelect = document.getElementById("drone-count-select");
const droneResetButton = document.getElementById("drone-reset-button");
const customChromaButton = document.getElementById("custom-chroma-button");
const customChromaButtons = document.getElementById("custom-chroma-buttons");
const customChromaPicker = document.getElementById("custom-chroma-picker");
const customChromaRow = document.getElementById("custom-chroma-row");
const chromaSetRow = document.getElementById("chroma-set-row");
const answerSetRow = document.getElementById("answer-set-row");
const droneRow = document.getElementById("drone-row");
const reducedRangeRow = document.getElementById("reduced-range-row");
const feedbackRow = document.getElementById("feedback-row");
const precisionRow = document.getElementById("precision-row");
const recallMessage = document.getElementById("recall-message");
const statsButton = document.getElementById("stats-button");
const statsOutput = document.getElementById("stats-output");
const exportLogsButton = document.getElementById("export-logs-button");
const exportLogsLastButton = document.getElementById("export-logs-last-button");
const exportLogsStatus = document.getElementById("export-logs-status");
const reducedRangeToggle = document.getElementById("reduced-range-toggle");
const randomizeButtonsToggle = document.getElementById("randomize-buttons-toggle");
const feedbackSelect = document.getElementById("feedback-select");
const replayButton = document.getElementById("replay-button");
const replayRow = document.getElementById("replay-row");
const seriesLengthInput = document.getElementById("series-length-input");
const seriesNameInput = document.getElementById("series-name-input");
const seriesGenerateButton = document.getElementById("series-generate-button");
const seriesSelect = document.getElementById("series-select");
const seriesDeleteButton = document.getElementById("series-delete-button");
const seriesPlayButton = document.getElementById("series-play-button");
const seriesStopButton = document.getElementById("series-stop-button");
const seriesExportButton = document.getElementById("series-export-button");
const seriesImportButton = document.getElementById("series-import-button");
const seriesImportInput = document.getElementById("series-import-input");
const seriesStatus = document.getElementById("series-status");
const seriesActivePill = document.getElementById("series-active-pill");
const seriesRandomizeStartToggle = document.getElementById(
  "series-randomize-start-toggle",
);

let reducedRangeEnabled = false;
let midiRange = getRangeForSetting(reducedRangeEnabled);
let notesByChroma = buildNotesByChroma(midiRange);
const availabilityCache = new Map();
const CUSTOM_CHROMA_SET_VALUE = "custom";
let activeChromaSet = chromaSets[0];
let activeChromaSetValue = "0";
let activeAnswerSet = "Auto";
let randomizeButtonsEnabled = false;
let randomizedButtonOrder = [];
let randomizedButtonOrderTrialCount = 0;
let customChromaSelection = chromas.map((chroma) => chroma.index);
let customChromaSet = buildCustomChromaSet(customChromaSelection);
let isCustomSelectionOpen = false;
let pendingCustomSelection = new Set(customChromaSelection);
let audioFormat = DEFAULT_AUDIO_FORMAT;
let lastClickedChromaIndex = null;
let feedbackMode = "feedback";
let preferredFeedbackMode = feedbackMode;
let currentMode = "recognize";
let recallPrecisionValue = RECALL_PRECISION_OPTIONS[0]?.value ?? "fourth";
let selectedDroneCount = 0;
let dronePlayers = [];
let recallState = createEmptyRecallState();
let recallPlayPending = false;
let currentState = {
  chromaIndex: null,
  midiNote: null,
  instrument: null,
  chromaSetLabel: "",
  exerciseType: "",
  answerSet: null,
  awaitingGuess: false,
};
let feedbackResetTimeout = null;
let currentAudio = null;
let currentAudioGainNode = null;
let nextTrialTimeout = null;
let lastMidiNotePlayed = null;
let trialStartTimestampMs = null;
let replayCount = 0;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let pendingTrials = [];
let pendingPreparationPromise = null;
let pendingPreparationToken = 0;
let fadeTimeout = null;
let statsPanelOpen = false;
let currentTrial = null;
let customButtonHome = customChromaRow;
let trialLogReady = Promise.resolve();
let isTrialLogLoaded = false;
let exportStatusTimeout = null;
let seriesStatusTimeout = null;
let seriesList = [];
let activeSeries = null;
let seriesPlaybackActive = false;
let seriesPlaybackIndex = 0;
let seriesPlaybackCount = 0;
let currentSeriesTrialIndex = null;
let seriesRandomizeStartEnabled = false;
let settingsLocked = false;
let seriesPendingTrial = null;
let seriesPlaybackRunId = "";
const audioFormats = {
  mp3: { label: "MP3", folder: "MP3", extension: "mp3" },
  wav: { label: "WAV", folder: "WAV", extension: "wav" },
};

const FEEDBACK_MODE_OPTIONS = [
  { value: "feedback", label: "Feedback" },
  { value: "limited", label: "Limited feedback" },
  { value: "none", label: "No feedback" },
];

function normalizeExerciseType(type = "") {
  const trimmed = type.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase() === "custom" ? "Custom" : trimmed;
}

function getCurrentExerciseType() {
  if (currentMode === "recall") {
    return "Recall";
  }
  if (currentMode === "discrimination") {
    return "Discrimination";
  }
  return (
    normalizeExerciseType(
      activeChromaSet?.exerciseType || getExerciseTypeFromLabel(activeChromaSet?.label)
    )
  );
}

function getModeLabel(mode = currentMode) {
  return MODES.find((option) => option.value === mode)?.label ?? "Recognize";
}

function getFeedbackModeLabel(mode = feedbackMode) {
  return (
    FEEDBACK_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
    FEEDBACK_MODE_OPTIONS[0].label
  );
}

function getRecallPrecisionConfig(value = recallPrecisionValue) {
  return (
    RECALL_PRECISION_OPTIONS.find((option) => option.value === value) ??
    RECALL_PRECISION_OPTIONS[0]
  );
}

function formatSeriesRunTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function generateSeriesRunId(seriesId) {
  const timestamp = formatSeriesRunTimestamp(new Date());
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${seriesId}__run_${timestamp}__${feedbackMode}__${currentMode}__${randomSuffix}`;
}

function createEmptyRecallState() {
  return {
    targetChromaIndex: null,
    options: [],
    playedChromaIndex: null,
    midiNote: null,
    instrument: null,
    audioElement: null,
    precisionLabel: "",
    precisionSemitones: 0,
  };
}

function getRecallOptions(targetChromaIndex, semitones) {
  if (!Number.isInteger(targetChromaIndex) || !Number.isInteger(semitones)) return [];
  const values = [
    targetChromaIndex,
    (targetChromaIndex + semitones + 12) % 12,
    (targetChromaIndex - semitones + 12) % 12,
  ];
  return Array.from(new Set(values));
}

function getRecallExclusionSet() {
  const excluded = new Set();
  if (Number.isInteger(recallState?.targetChromaIndex)) {
    excluded.add(recallState.targetChromaIndex);
  }
  if (Number.isInteger(recallState?.playedChromaIndex)) {
    excluded.add(recallState.playedChromaIndex);
  }
  return excluded;
}

function pickRandomChromaExcluding(excludedIndices) {
  if (!activeChromaSet || !activeChromaSet.chromas.length) return null;
  const eligible = activeChromaSet.chromas
    .map((chroma) => chroma.index)
    .filter((index) => !excludedIndices.has(index));
  if (!eligible.length) return pickRandomChroma();
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx];
}

function pickRecallTargetExcluding(excludedIndices, semitones) {
  if (!activeChromaSet || !activeChromaSet.chromas.length) return null;
  const candidates = activeChromaSet.chromas
    .map((chroma) => chroma.index)
    .filter((index) => !excludedIndices.has(index));
  const eligible = candidates.filter((index) => {
    const options = getRecallOptions(index, semitones);
    return options.length && options.every((option) => !excludedIndices.has(option));
  });
  if (!eligible.length) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx];
}

function buildRecallOptionsExcluding(targetChromaIndex, semitones, excludedIndices) {
  const baseOptions = getRecallOptions(targetChromaIndex, semitones);
  if (!excludedIndices?.size) return baseOptions;

  const filtered = baseOptions.filter((index) => !excludedIndices.has(index));
  if (filtered.length === baseOptions.length) return baseOptions;

  const fallbackPool = chromas
    .map((chroma) => chroma.index)
    .filter((index) => !excludedIndices.has(index) && !filtered.includes(index));

  while (filtered.length < 3 && fallbackPool.length) {
    const idx = Math.floor(Math.random() * fallbackPool.length);
    filtered.push(fallbackPool.splice(idx, 1)[0]);
  }

  return filtered;
}

function normalizeAnswerSetType(answerSet = "") {
  const normalized = normalizeExerciseType(answerSet);
  if (!normalized) return "";
  return normalized;
}

function getAnswerSetPriorityValue(answerSet = "") {
  const normalized = normalizeAnswerSetType(answerSet);
  return ANSWER_SET_PRIORITY.findIndex((type) => type === normalized);
}

function getAvailableAnswerSetsForExercise(exerciseType = getCurrentExerciseType()) {
  const priority = getAnswerSetPriorityValue(exerciseType);
  if (priority < 0) {
    return [...ANSWER_SET_TYPES];
  }
  return ANSWER_SET_TYPES.filter(
    (type) => type === "Auto" || getAnswerSetPriorityValue(type) > priority
  );
}

function getValidAnswerSetValue(value, exerciseType = getCurrentExerciseType()) {
  const available = getAvailableAnswerSetsForExercise(exerciseType);
  if (available.includes(value)) return value;
  return "Auto";
}

const renderStats = () => {
  if (!isTrialLogLoaded) {
    trialLogReady.then(() => {
      renderStatsUtil({
        statsOutput,
        getCurrentExerciseType,
        recentEntriesCount: RECENT_ENTRIES,
      });
    });
    return;
  }
  renderStatsUtil({
    statsOutput,
    getCurrentExerciseType,
    recentEntriesCount: RECENT_ENTRIES,
  });
};

function refreshStatsIfOpen() {
  if (!isTrialLogLoaded) {
    trialLogReady.then(() => {
      refreshStatsIfOpenUtil(statsPanelOpen, renderStats);
    });
    return;
  }
  refreshStatsIfOpenUtil(statsPanelOpen, renderStats);
}

function setStatsPanelOpen(isOpen) {
  statsPanelOpen = isOpen;
  if (statsButton) {
    statsButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
    statsButton.classList.toggle("open", isOpen);
  }
  if (statsOutput) {
    statsOutput.hidden = !isOpen;
  }
  if (isOpen) {
    renderStats();
  }
}

function toggleStatsPanel() {
  setStatsPanelOpen(!statsPanelOpen);
}

function updateExportStatus(message, { autoHide = false } = {}) {
  if (!exportLogsStatus) return;
  exportLogsStatus.textContent = message;
  exportLogsStatus.hidden = false;
  if (exportStatusTimeout) {
    clearTimeout(exportStatusTimeout);
  }
  if (autoHide) {
    exportStatusTimeout = setTimeout(() => {
      exportLogsStatus.hidden = true;
    }, 4000);
  }
}

function setExportButtonsDisabled(disabled) {
  [exportLogsButton, exportLogsLastButton].forEach((button) => {
    if (button) {
      button.disabled = disabled;
    }
  });
}

async function runExportLogs(limit) {
  const label = limit ? `Exporting last ${limit}…` : "Exporting…";
  updateExportStatus(`${label} (0 records)`);

  try {
    const total = await exportLogs({
      dbName: "ppt-training",
      storeName: "trial-log",
      limit,
      onProgress: (count) => {
        updateExportStatus(`${label} (${count} records)`);
      },
    });
    updateExportStatus(`Export complete: ${total} records`, { autoHide: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    updateExportStatus(`Export failed: ${message}`, { autoHide: true });
  }
}

function setupExportLogsButton() {
  if (exportLogsButton) {
    exportLogsButton.addEventListener("click", async () => {
      if (exportLogsButton.disabled) return;
      setExportButtonsDisabled(true);
      try {
        await runExportLogs();
      } finally {
        setExportButtonsDisabled(false);
      }
    });
  }
  if (exportLogsLastButton) {
    exportLogsLastButton.addEventListener("click", async () => {
      if (exportLogsLastButton.disabled) return;
      setExportButtonsDisabled(true);
      try {
        await runExportLogs(RECENT_ENTRIES);
      } finally {
        setExportButtonsDisabled(false);
      }
    });
  }
}

function setupSeriesControls() {
  if (seriesGenerateButton) {
    seriesGenerateButton.addEventListener("click", () => {
      void handleGenerateSeries();
    });
  }
  if (seriesSelect) {
    seriesSelect.addEventListener("change", () => {
      const selected = seriesList.find((entry) => entry.id === seriesSelect.value);
      setActiveSeries(selected ?? null);
    });
  }
  if (seriesPlayButton) {
    seriesPlayButton.addEventListener("click", () => {
      void handlePlaySeries();
    });
  }
  if (seriesStopButton) {
    seriesStopButton.addEventListener("click", handleStopSeries);
  }
  if (seriesDeleteButton) {
    seriesDeleteButton.addEventListener("click", () => {
      void handleDeleteSeries();
    });
  }
  if (seriesExportButton) {
    seriesExportButton.addEventListener("click", handleExportSeries);
  }
  if (seriesImportButton && seriesImportInput) {
    seriesImportButton.addEventListener("click", () => {
      seriesImportInput.click();
    });
    seriesImportInput.addEventListener("change", async (event) => {
      const file = event.target?.files?.[0];
      if (!file) return;
      await handleImportSeriesFile(file);
      seriesImportInput.value = "";
    });
  }
}

function updateSeriesStatus(message, { autoHide = false } = {}) {
  if (!seriesStatus) return;
  seriesStatus.textContent = message;
  seriesStatus.hidden = false;
  if (seriesStatusTimeout) {
    clearTimeout(seriesStatusTimeout);
  }
  if (autoHide) {
    seriesStatusTimeout = setTimeout(() => {
      seriesStatus.hidden = true;
    }, 5000);
  }
}

function clearSeriesStatus() {
  if (!seriesStatus) return;
  seriesStatus.textContent = "";
  seriesStatus.hidden = true;
}

function generateSeriesId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `series-${Date.now()}-${randomPart}`;
}

function formatSeriesLabel(series) {
  if (!series) return "Unknown series";
  const name = typeof series.name === "string" ? series.name.trim() : "";
  const date = series.createdAt ? new Date(series.createdAt) : null;
  const dateLabel = date ? date.toLocaleString() : "Unknown date";
  const count = Number.isFinite(series.trials?.length) ? series.trials.length : 0;
  const modeLabel = getModeLabel(series.settingsSnapshot?.mode);
  const details = `${dateLabel} · ${modeLabel} · ${count} trials`;
  return name ? `${name} · ${details}` : details;
}

function updateSeriesSelectOptions({ preserveSelection = true } = {}) {
  if (!seriesSelect) return;
  const currentValue = preserveSelection ? seriesSelect.value : null;
  seriesSelect.innerHTML = "";
  if (!seriesList.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No series available";
    seriesSelect.appendChild(option);
    seriesSelect.value = "";
    return;
  }
  seriesList.forEach((series) => {
    const option = document.createElement("option");
    option.value = series.id;
    option.textContent = formatSeriesLabel(series);
    seriesSelect.appendChild(option);
  });
  if (preserveSelection && currentValue) {
    seriesSelect.value = currentValue;
  }
}

async function loadSeriesList() {
  try {
    const entries = await getSeriesList();
    seriesList = Array.isArray(entries) ? entries.sort((a, b) => {
      const aTime = Number(a?.createdAt ?? 0);
      const bTime = Number(b?.createdAt ?? 0);
      return bTime - aTime;
    }) : [];
  } catch (error) {
    seriesList = [];
  }
  updateSeriesSelectOptions({ preserveSelection: false });
  if (seriesSelect?.value) {
    const selected = seriesList.find((entry) => entry.id === seriesSelect.value);
    setActiveSeries(selected ?? null);
  } else if (!seriesList.length) {
    setActiveSeries(null);
  }
  updateSeriesControlsState();
}

function getSeriesSettingsSnapshot() {
  return {
    mode: currentMode,
    chromaSetValue: activeChromaSetValue,
    customChromaSelection: [...customChromaSelection],
    precisionValue: recallPrecisionValue,
    answerSet: activeAnswerSet,
    reducedRangeEnabled,
    randomizeButtonsEnabled,
    droneCount: selectedDroneCount,
    audioFormat,
  };
}

function applySeriesSettingsSnapshot(snapshot) {
  if (!snapshot) return;
  if (Array.isArray(snapshot.customChromaSelection)) {
    updateCustomChromaSet(snapshot.customChromaSelection, {
      shouldSelectCustom: false,
      skipSave: true,
    });
  }

  if (typeof snapshot.mode === "string") {
    setMode(snapshot.mode, { skipSave: true });
  }
  if (typeof snapshot.precisionValue === "string") {
    setRecallPrecision(snapshot.precisionValue, { skipSave: true });
  }
  if (typeof snapshot.reducedRangeEnabled === "boolean") {
    applyRangeSetting(snapshot.reducedRangeEnabled);
    if (reducedRangeToggle) {
      reducedRangeToggle.checked = snapshot.reducedRangeEnabled;
    }
  }
  if (typeof snapshot.randomizeButtonsEnabled === "boolean") {
    randomizeButtonsEnabled = snapshot.randomizeButtonsEnabled;
    if (randomizeButtonsToggle) {
      randomizeButtonsToggle.checked = snapshot.randomizeButtonsEnabled;
    }
    resetRandomizedButtonOrder();
    refreshButtonOrder();
  }
  if (Number.isFinite(snapshot.droneCount)) {
    setDroneCount(snapshot.droneCount, { skipSave: true });
  }
  if (typeof snapshot.chromaSetValue === "string") {
    setActiveChromaSetByValue(snapshot.chromaSetValue, { skipSave: true });
  }
  if (typeof snapshot.answerSet === "string") {
    renderAnswerSetOptions({
      selectedValue: snapshot.answerSet,
      exerciseType: getCurrentExerciseType(),
      skipSave: true,
    });
  }
  if (typeof snapshot.audioFormat === "string") {
    audioFormat = snapshot.audioFormat;
  }
}

function setSettingsLocked(isLocked) {
  settingsLocked = isLocked;
  const lockTargets = [
    modeSelect,
    chromaSetSelect,
    precisionSelect,
    answerSetSelect,
    droneCountSelect,
    droneResetButton,
    reducedRangeToggle,
    randomizeButtonsToggle,
    feedbackSelect,
    customChromaButton,
  ];
  lockTargets.forEach((el) => {
    if (el) {
      el.disabled = isLocked;
    }
  });
  if (customChromaButtons) {
    customChromaButtons.querySelectorAll("button").forEach((btn) => {
      btn.disabled = isLocked;
    });
  }
  if (isLocked && isCustomSelectionOpen) {
    closeCustomChromaPicker();
  }
  if (seriesActivePill) {
    seriesActivePill.hidden = !isLocked;
  }
}

function updateSeriesControlsState() {
  const hasSeries = seriesList.length > 0;
  const hasActiveSeries = Boolean(activeSeries?.id);
  const selectedSeriesId = seriesSelect?.value;
  if (seriesSelect) {
    seriesSelect.disabled = seriesPlaybackActive || !hasSeries;
  }
  if (seriesGenerateButton) {
    seriesGenerateButton.disabled = seriesPlaybackActive;
  }
  if (seriesPlayButton) {
    seriesPlayButton.disabled = !hasSeries || !selectedSeriesId || seriesPlaybackActive;
  }
  if (seriesStopButton) {
    seriesStopButton.disabled = !seriesPlaybackActive;
  }
  if (seriesExportButton) {
    seriesExportButton.disabled = !hasActiveSeries;
  }
  if (seriesDeleteButton) {
    seriesDeleteButton.disabled = !hasSeries || !selectedSeriesId || seriesPlaybackActive;
  }
  if (seriesImportButton) {
    seriesImportButton.disabled = seriesPlaybackActive;
  }
  if (seriesRandomizeStartToggle) {
    seriesRandomizeStartToggle.disabled = seriesPlaybackActive;
  }
}

function setActiveSeries(series) {
  activeSeries = series ?? null;
  if (seriesSelect && series?.id) {
    seriesSelect.value = series.id;
  }
  if (seriesNameInput) {
    seriesNameInput.value = series?.name ?? "";
  }
  updateSeriesControlsState();
}

async function handleGenerateSeries() {
  if (seriesPlaybackActive) return;
  clearSeriesStatus();
  const count = Number.parseInt(seriesLengthInput?.value ?? "0", 10);
  if (!Number.isFinite(count) || count <= 0) {
    updateSeriesStatus("Enter a valid series length.", { autoHide: true });
    return;
  }
  if (!activeChromaSet?.chromas?.length) {
    updateSeriesStatus("Select a chroma set before generating.", { autoHide: true });
    return;
  }
  const settingsSnapshot = getSeriesSettingsSnapshot();
  updateSeriesStatus("Generating series…");
  const trials = await generateSeriesTrials(count, settingsSnapshot);
  if (!trials.length) {
    updateSeriesStatus("No trials generated.", { autoHide: true });
    return;
  }
  const name = typeof seriesNameInput?.value === "string"
    ? seriesNameInput.value.trim()
    : "";
  const series = {
    id: generateSeriesId(),
    createdAt: Date.now(),
    name: name || undefined,
    settingsSnapshot,
    trials,
  };
  await saveSeries(series);
  await loadSeriesList();
  setActiveSeries(series);
  updateSeriesStatus(`Series saved (${trials.length} trials).`, { autoHide: true });
}

async function handlePlaySeries() {
  if (seriesPlaybackActive) return;
  if (!seriesSelect?.value) {
    updateSeriesStatus("Select a series first.", { autoHide: true });
    return;
  }
  clearSeriesStatus();
  const series = await getSeriesById(seriesSelect.value);
  if (!series) {
    updateSeriesStatus("Series not found.", { autoHide: true });
    return;
  }
  setActiveSeries(series);
  startSeriesPlayback(activeSeries);
}

function handleStopSeries() {
  if (!seriesPlaybackActive) return;
  stopSeriesPlayback({ showStatus: true, message: "Series stopped." });
}

async function handleDeleteSeries() {
  if (seriesPlaybackActive) return;
  if (!seriesSelect?.value) return;
  clearSeriesStatus();
  const seriesId = seriesSelect.value;
  const series = seriesList.find((entry) => entry.id === seriesId);
  const label = series ? formatSeriesLabel(series) : "this series";
  const shouldDelete = window.confirm(`Delete ${label}?`);
  if (!shouldDelete) return;
  await deleteSeries(seriesId);
  if (activeSeries?.id === seriesId) {
    activeSeries = null;
  }
  await loadSeriesList();
  if (!seriesList.length) {
    if (seriesNameInput) {
      seriesNameInput.value = "";
    }
  }
  updateSeriesStatus("Series deleted.", { autoHide: true });
}

function downloadSeriesJson(series) {
  if (!series) return;
  const blob = new Blob([JSON.stringify(series, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${series.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function handleExportSeries() {
  if (!activeSeries) {
    updateSeriesStatus("Select a series before exporting.", { autoHide: true });
    return;
  }
  downloadSeriesJson(activeSeries);
  updateSeriesStatus("Series exported.", { autoHide: true });
}

async function handleImportSeriesFile(file) {
  if (!file) return;
  const text = await file.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    updateSeriesStatus("Invalid JSON file.", { autoHide: true });
    return;
  }
  const incoming = Array.isArray(payload) ? payload : [payload];
  const saved = [];
  for (const entry of incoming) {
    if (!entry?.trials || !Array.isArray(entry.trials) || !entry.trials.length) {
      continue;
    }
    const normalized = {
      ...entry,
      id: entry.id && !seriesList.some((series) => series.id === entry.id)
        ? entry.id
        : generateSeriesId(),
      createdAt: Number(entry.createdAt) || Date.now(),
    };
    await saveSeries(normalized);
    saved.push(normalized);
  }
  if (!saved.length) {
    updateSeriesStatus("No valid series found in file.", { autoHide: true });
    return;
  }
  await loadSeriesList();
  setActiveSeries(saved[saved.length - 1]);
  updateSeriesStatus(`Imported ${saved.length} series.`, { autoHide: true });
}

function getSeriesPlaybackLogContext() {
  if (!seriesPlaybackActive || !activeSeries?.id) {
    return { seriesPlaybackActive: false };
  }
  return {
    seriesId: activeSeries.id,
    seriesRunId: seriesPlaybackRunId,
    seriesIndex:
      Number.isInteger(currentSeriesTrialIndex) ? currentSeriesTrialIndex + 1 : null,
    seriesPlaybackActive: true,
  };
}

function getChromaLabelByIndex(chromaIndex) {
  return chromas.find((chroma) => chroma.index === chromaIndex)?.label ?? String(chromaIndex);
}

function getActiveDroneLabels() {
  return dronePlayers
    .map((player) => player?.chromaIndex)
    .filter((chromaIndex) => Number.isFinite(chromaIndex))
    .sort((a, b) => a - b)
    .map((chromaIndex) => getChromaLabelByIndex(chromaIndex));
}

function getDroneChromaPool() {
  if (currentMode === "recall" || currentMode === "discrimination") {
    return chromas.map((chroma) => chroma.index);
  }
  return activeChromaSet?.chromas?.map((chroma) => chroma.index) ?? [];
}

function getAudioContext() {
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {
      // Ignore errors resuming the audio context (e.g., autoplay policies).
    });
  }

  return audioContext;
}

function buildNotesByChroma(range = midiRange) {
  const buckets = Array.from({ length: 12 }, () => []);
  for (let note = range.min; note <= range.max; note += 1) {
    buckets[note % 12].push(note);
  }
  return buckets;
}

function getRangeForSetting(isReduced) {
  if (!isReduced) {
    return { ...BASE_MIDI_RANGE };
  }

  return {
    min: BASE_MIDI_RANGE.min + 12,
    max: BASE_MIDI_RANGE.max - 12,
  };
}

function applyRangeSetting(isReduced) {
  reducedRangeEnabled = Boolean(isReduced);
  midiRange = getRangeForSetting(reducedRangeEnabled);
  notesByChroma = buildNotesByChroma(midiRange);
  lastMidiNotePlayed = null;
  showStartButton();
  refreshStatsIfOpen();
}

function setupReducedRangeToggle() {
  if (!reducedRangeToggle) return;

  reducedRangeToggle.checked = reducedRangeEnabled;
  reducedRangeToggle.addEventListener("change", (event) => {
    applyRangeSetting(event.target?.checked);
    saveReducedRangeSetting(event.target?.checked);
  });
}

function setupRandomizeButtonsToggle() {
  if (!randomizeButtonsToggle) return;

  randomizeButtonsToggle.checked = randomizeButtonsEnabled;
  randomizeButtonsToggle.addEventListener("change", (event) => {
    randomizeButtonsEnabled = Boolean(event.target?.checked);
    saveRandomizeButtonsSetting(randomizeButtonsEnabled);
    resetRandomizedButtonOrder();
    refreshButtonOrder();
  });
}

function setupSeriesRandomizeStartToggle() {
  if (!seriesRandomizeStartToggle) return;
  seriesRandomizeStartToggle.checked = seriesRandomizeStartEnabled;
  seriesRandomizeStartToggle.addEventListener("change", (event) => {
    seriesRandomizeStartEnabled = Boolean(event.target?.checked);
    saveSeriesRandomizeStartSetting(seriesRandomizeStartEnabled);
  });
}

function normalizeFeedbackMode(value, fallback = feedbackMode) {
  if (value === "feedback" || value === "limited" || value === "none") {
    return value;
  }
  if (value === true || value === "true") return "limited";
  if (value === false || value === "false") return "feedback";
  return fallback;
}

function setFeedbackMode(mode, { skipSave = false, skipPreference = false } = {}) {
  feedbackMode = normalizeFeedbackMode(mode);
  if (!skipPreference) {
    preferredFeedbackMode = feedbackMode;
  }
  if (feedbackSelect) {
    feedbackSelect.value = feedbackMode;
  }
  if (!skipSave) {
    saveFeedbackModeSetting(feedbackMode);
  }
  if (feedbackMode !== "feedback") {
    resetButtonStates();
  }
}

function renderFeedbackOptions(selectedValue = feedbackMode) {
  if (!feedbackSelect) return;
  feedbackSelect.innerHTML = "";
  FEEDBACK_MODE_OPTIONS.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    feedbackSelect.appendChild(option);
  });
  feedbackSelect.value = selectedValue;
}

function setupFeedbackSelect() {
  if (!feedbackSelect) return;
  renderFeedbackOptions(feedbackMode);
  feedbackSelect.addEventListener("change", (event) => {
    setFeedbackMode(event.target?.value);
  });
}

function renderModeOptions(selectedValue = currentMode) {
  if (!modeSelect) return;
  modeSelect.innerHTML = "";
  MODES.forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode.value;
    option.textContent = mode.label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = selectedValue;
}

function renderPrecisionOptions(selectedValue = recallPrecisionValue) {
  if (!precisionSelect) return;
  precisionSelect.innerHTML = "";
  RECALL_PRECISION_OPTIONS.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    precisionSelect.appendChild(option);
  });
  precisionSelect.value = selectedValue;
}

function updateModeVisibility() {
  const isRecallLike = currentMode === "recall" || currentMode === "discrimination";
  if (answerSetRow) answerSetRow.hidden = isRecallLike;
  if (droneRow) droneRow.hidden = false;
  if (reducedRangeRow) reducedRangeRow.hidden = false;
  if (precisionRow) precisionRow.hidden = !isRecallLike;
  if (chromaSetRow) chromaSetRow.hidden = false;
  if (feedbackRow) feedbackRow.hidden = isRecallLike;
  if (isRecallLike && feedbackMode !== "feedback") {
    setFeedbackMode("feedback", { skipSave: true, skipPreference: true });
  } else if (!isRecallLike && feedbackMode !== preferredFeedbackMode) {
    setFeedbackMode(preferredFeedbackMode, { skipSave: true, skipPreference: true });
  }
  updateReplayLabel();
}

function setMode(modeValue, { skipSave = false } = {}) {
  const resolvedMode = MODES.some((mode) => mode.value === modeValue)
    ? modeValue
    : "recognize";
  currentMode = resolvedMode;
  if (modeSelect) {
    modeSelect.value = resolvedMode;
  }
  updateModeVisibility();
  populateDroneCountSelect({ selectedCount: selectedDroneCount });
  startDronePlayersForCurrentSet();
  if (!skipSave) {
    saveModeSelection(resolvedMode);
  }
  showStartButton();
  refreshStatsIfOpen();
}

function setRecallPrecision(value, { skipSave = false } = {}) {
  const resolvedValue = RECALL_PRECISION_OPTIONS.some(
    (option) => option.value === value
  )
    ? value
    : RECALL_PRECISION_OPTIONS[0]?.value ?? "fourth";
  recallPrecisionValue = resolvedValue;
  if (precisionSelect) {
    precisionSelect.value = resolvedValue;
  }
  if (!skipSave) {
    saveRecallPrecisionSelection(resolvedValue);
  }
  if (currentMode === "recall" || currentMode === "discrimination") {
    showStartButton();
  }
}

function setupModeSelect() {
  if (!modeSelect) return;
  renderModeOptions(currentMode);
  modeSelect.addEventListener("change", (event) => {
    setMode(event.target.value);
  });
}

function setupPrecisionSelect() {
  if (!precisionSelect) return;
  renderPrecisionOptions(recallPrecisionValue);
  precisionSelect.addEventListener("change", (event) => {
    setRecallPrecision(event.target.value);
  });
}

function setupDroneCountSelect() {
  if (!droneCountSelect) return;
  populateDroneCountSelect();
  droneCountSelect.addEventListener("change", handleDroneCountChange);
}

function setupDroneResetButton() {
  if (!droneResetButton) return;
  updateDroneResetButtonState();
  droneResetButton.addEventListener("click", handleDroneReset);
}

function updateDroneResetButtonState() {
  if (!droneResetButton) return;
  droneResetButton.disabled = selectedDroneCount === 0;
}

function getAudioFormatConfig(format = audioFormat) {
  return audioFormats[format] ?? audioFormats.mp3;
}

function shuffleArray(values = []) {
  const array = [...values];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function shuffleArrayWithLastClickedGuard(
  values = [],
  previousOrder = [],
  lastClickedIndex = null
) {
  if (!previousOrder?.length || values.length <= 1 || !Number.isInteger(lastClickedIndex)) {
    return shuffleArray(values);
  }

  const previousIndex = previousOrder.indexOf(lastClickedIndex);
  if (previousIndex === -1) {
    return shuffleArray(values);
  }

  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const shuffled = shuffleArray(values);
    if (shuffled[previousIndex] !== lastClickedIndex) {
      return shuffled;
    }
  }

  const shuffled = shuffleArray(values);
  if (shuffled[previousIndex] === lastClickedIndex) {
    const swapIndex = shuffled.findIndex(
      (value, idx) => value !== lastClickedIndex && idx !== previousIndex
    );

    if (swapIndex !== -1) {
      [shuffled[swapIndex], shuffled[previousIndex]] = [
        shuffled[previousIndex],
        shuffled[swapIndex],
      ];
    }
  }

  return shuffled;
}

function resetRandomizedButtonOrder() {
  randomizedButtonOrder = [];
  randomizedButtonOrderTrialCount = 0;
}

function getChromaOrderForButtons(chromasForButtons = []) {
  if (!randomizeButtonsEnabled) {
    return chromasForButtons.map((chroma) => chroma.index);
  }

  const chromaIndices = chromasForButtons.map((chroma) => chroma.index);
  const hasSameChromas =
    randomizedButtonOrder.length === chromaIndices.length &&
    chromaIndices.every((index) => randomizedButtonOrder.includes(index));

  const shouldReroll =
    !randomizedButtonOrder.length ||
    randomizedButtonOrderTrialCount >= RANDOMIZE_BUTTON_ORDER_REROLL_INTERVAL ||
    !hasSameChromas;

  if (shouldReroll) {
    const previousOrder = [...randomizedButtonOrder];
    randomizedButtonOrder = shuffleArrayWithLastClickedGuard(
      chromaIndices,
      previousOrder,
      lastClickedChromaIndex
    );
    randomizedButtonOrderTrialCount = 0;
  }

  randomizedButtonOrderTrialCount += 1;
  return randomizedButtonOrder;
}

function findAnswerSetForChroma(chromaIndex, answerSetType) {
  if (!Number.isInteger(chromaIndex)) return null;
  const normalizedAnswerSet = normalizeAnswerSetType(answerSetType);
  if (!normalizedAnswerSet) return null;

  return chromaSets.find(
    (set) =>
      normalizeAnswerSetType(set.exerciseType) === normalizedAnswerSet &&
      set.chromas.some((chroma) => chroma.index === chromaIndex)
  );
}

function getDefaultAnswerChromasForTrial(chromaIndex) {
  return activeChromaSet?.chromas ?? [];
}

function getChromasForTrial(chromaIndex) {
  const defaultChromas = getDefaultAnswerChromasForTrial(chromaIndex);
  if (activeAnswerSet === "Auto") {
    return defaultChromas;
  }

  const answerSetMatch = findAnswerSetForChroma(chromaIndex, activeAnswerSet);
  if (answerSetMatch?.chromas?.length) {
    return answerSetMatch.chromas;
  }

  return defaultChromas;
}

function createButtons(chromasForButtons = activeChromaSet?.chromas) {
  if (!chromasForButtons?.length) return;

  buttonsContainer.innerHTML = "";
  const chromaByIndex = new Map(
    chromasForButtons.map((chroma) => [chroma.index, chroma])
  );

  const chromaOrder = getChromaOrderForButtons(chromasForButtons);

  chromaOrder.forEach((chromaIndex) => {
    const chroma = chromaByIndex.get(chromaIndex);
    if (!chroma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chroma";
    btn.textContent = chroma.label;
    btn.dataset.index = chroma.index;
    btn.addEventListener("click", () => handleAnswer(chroma.index));
    buttonsContainer.appendChild(btn);
  });
}

function getRecallButtonOrder(chromaIndices = [], targetChromaIndex, semitones) {
  const uniqueIndices = Array.from(new Set(chromaIndices));
  if (!uniqueIndices.length) return [];
  if (!Number.isInteger(targetChromaIndex)) return uniqueIndices;
  if (uniqueIndices.length === 1) return uniqueIndices;

  const otherIndices = uniqueIndices.filter((index) => index !== targetChromaIndex);
  if (!otherIndices.length) return [targetChromaIndex];

  if (Number.isInteger(semitones)) {
    const lower = (targetChromaIndex - semitones + 12) % 12;
    const higher = (targetChromaIndex + semitones) % 12;
    const order = [];
    if (otherIndices.includes(lower)) {
      order.push(lower);
    } else {
      order.push(otherIndices[0]);
    }
    order.push(targetChromaIndex);
    const remaining = otherIndices.filter((index) => index !== order[0]);
    if (otherIndices.includes(higher)) {
      order.push(higher);
    } else if (remaining.length) {
      order.push(remaining[0]);
    }
    return order;
  }

  const sortedOther = otherIndices.sort((a, b) => a - b);
  if (sortedOther.length === 1) return [sortedOther[0], targetChromaIndex];
  return [sortedOther[0], targetChromaIndex, sortedOther[1]];
}

function createRecallButtons(
  chromaIndices = [],
  { targetChromaIndex = recallState?.targetChromaIndex, semitones } = {}
) {
  if (!chromaIndices.length) return;
  buttonsContainer.innerHTML = "";
  const order = getRecallButtonOrder(chromaIndices, targetChromaIndex, semitones);
  order.forEach((chromaIndex) => {
    const chroma = chromas.find((entry) => entry.index === chromaIndex);
    if (!chroma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chroma";
    btn.textContent = chroma.label;
    btn.dataset.index = chroma.index;
    btn.addEventListener("click", () => handleAnswer(chroma.index));
    buttonsContainer.appendChild(btn);
  });
}

function scrollButtonsToBottom() {
  if (!buttonsContainer) return;
  requestAnimationFrame(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  });
}

function renderRecallMessage() {
  if (!recallMessage) return;
  if (currentMode !== "recall") {
    recallMessage.hidden = true;
    recallMessage.textContent = "";
    return;
  }
  if (recallState?.targetChromaIndex == null) {
    recallMessage.hidden = true;
    recallMessage.textContent = "";
    return;
  }
  const label = getChromaLabelByIndex(recallState.targetChromaIndex);
  recallMessage.textContent = `Recall ${label}`;
  recallMessage.hidden = false;
}

function showStartButton() {
  resetTrialState();
  resetRandomizedButtonOrder();

  buttonsContainer.innerHTML = "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "start-button";
  btn.className = "start-button";
  btn.textContent = "START";
  btn.addEventListener("click", handleStartClick);
  buttonsContainer.appendChild(btn);
  if (currentMode === "recognize") {
    preparePendingTrial();
  }
  updateReplayAvailability();
}

function getChromaButton(chromaIndex) {
  return buttonsContainer.querySelector(`button[data-index="${chromaIndex}"]`);
}

function resetButtonStates() {
  buttonsContainer.querySelectorAll("button.chroma").forEach((btn) => {
    btn.classList.remove("correct", "incorrect");
  });
}


function resetButtonFocus() {
  const activeElement = document.activeElement;
  if (activeElement && typeof activeElement.blur === "function") {
    activeElement.blur();
  }
}


function resetTrialState() {
  cancelNextTrialTimeout();
  cancelScheduledFade();
  fadeOutCurrentAudio();
  trialStartTimestampMs = null;
  replayCount = 0;
  currentTrial = null;
  recallPlayPending = false;
  seriesPendingTrial = null;
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }
  resetButtonStates();
  currentState = {
    chromaIndex: null,
    midiNote: null,
    instrument: null,
    chromaSetLabel: "",
    exerciseType: "",
    answerSet: null,
    awaitingGuess: false,
  };
  recallState = createEmptyRecallState();
  if (recallMessage) {
    recallMessage.hidden = true;
    recallMessage.textContent = "";
  }
  clearPendingTrials();
}

function refreshButtonOrder() {
  if (currentMode === "recall" || currentMode === "discrimination") return;
  if (!currentState.awaitingGuess || currentState.chromaIndex == null) return;

  const chromasForButtons = getChromasForTrial(currentState.chromaIndex);
  createButtons(chromasForButtons);
  scrollButtonsToBottom();
}

function handleStartClick() {
  startTrial();
}

function updateReplayAvailability() {
  if (!replayButton) return;

  let canReplay = false;

  if (currentMode === "recall" || currentMode === "discrimination") {
    const hasTarget = recallState?.targetChromaIndex != null;
    const hasPlayed = recallState?.playedChromaIndex != null;
    canReplay =
      hasTarget && !recallPlayPending && (currentState.awaitingGuess || !hasPlayed);
  } else {
    canReplay =
      currentState.awaitingGuess &&
      currentTrial?.instrument &&
      Number.isFinite(currentTrial?.midiNote);
  }

  replayButton.disabled = !canReplay;
  updateReplayLabel();
}

function updateReplayLabel() {
  if (!replayButton) return;
  if (currentMode === "recall" || currentMode === "discrimination") {
    const shouldReplay =
      recallState?.playedChromaIndex != null && currentState.awaitingGuess;
    replayButton.textContent = shouldReplay ? "Replay" : "Play";
    return;
  }
  replayButton.textContent = "Replay";
}

function scheduleFeedbackReset(durationMs = CORRECT_FEEDBACK_DURATION) {
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
  }

  feedbackResetTimeout = setTimeout(() => {
    resetButtonStates();
    feedbackResetTimeout = null;
  }, durationMs);
}

function buildCustomChromaSet(selection = []) {
  const uniqueIndices = Array.from(
    new Set(
      selection.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < chromas.length
      )
    )
  ).sort((a, b) => a - b);

  const selectedChromas = uniqueIndices
    .map((index) => chromas.find((chroma) => chroma.index === index))
    .filter(Boolean);

  const labelSuffix = selectedChromas.map((chroma) => chroma.label).join(", ");

  return {
    label: `Custom: ${labelSuffix || "aucun chroma"}`,
    chromas: selectedChromas,
    exerciseType: "Custom",
  };
}

function parseBooleanSetting(value, fallback = false) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function parseFeedbackModeSetting(value, fallback = feedbackMode) {
  return normalizeFeedbackMode(value, fallback);
}

function parseNumberSetting(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseCustomChromaSelection(value) {
  let parsedValue = value;
  if (typeof value === "string") {
    try {
      parsedValue = JSON.parse(value);
    } catch (error) {
      parsedValue = null;
    }
  }
  if (!Array.isArray(parsedValue) || !parsedValue.length) {
    return chromas.map((chroma) => chroma.index);
  }
  return parsedValue
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isInteger(entry))
    .sort((a, b) => a - b);
}

function saveCustomChromaSelection(selection) {
  void setSetting(CUSTOM_CHROMA_STORAGE_KEY, selection);
}

function saveReducedRangeSetting(isReduced) {
  void setSetting(REDUCED_RANGE_STORAGE_KEY, isReduced ? "true" : "false");
}

function saveRandomizeButtonsSetting(isRandomized) {
  void setSetting(RANDOMIZE_BUTTON_ORDER_KEY, isRandomized ? "true" : "false");
}

function saveSeriesRandomizeStartSetting(isRandomized) {
  void setSetting(SERIES_RANDOMIZE_START_STORAGE_KEY, isRandomized ? "true" : "false");
}

function saveDroneCountSetting(count) {
  void setSetting(DRONE_COUNT_STORAGE_KEY, String(count));
}

function saveModeSelection(value) {
  void setSetting(LAST_MODE_STORAGE_KEY, String(value));
}

function saveRecallPrecisionSelection(value) {
  void setSetting(LAST_RECALL_PRECISION_KEY, String(value));
}

function saveFeedbackModeSetting(value) {
  void setSetting(FEEDBACK_MODE_STORAGE_KEY, value);
}

function getChromaSetOptions() {
  return [...chromaSets, customChromaSet];
}

function renderChromaSetOptions(selectedValue, { skipActivation = false } = {}) {
  const chromaSetOptions = getChromaSetOptions();
  const resolvedValue = getValidChromaSetValue(selectedValue);

  chromaSetSelect.innerHTML = "";

  chromaSetOptions.forEach((set, index) => {
    const option = document.createElement("option");
    const isCustom = normalizeExerciseType(set.exerciseType) === "Custom";
    option.value = isCustom ? CUSTOM_CHROMA_SET_VALUE : String(index);
    option.textContent = set.label;
    chromaSetSelect.appendChild(option);
  });

  chromaSetSelect.value = resolvedValue;
  if (!skipActivation) {
    setActiveChromaSetByValue(resolvedValue, { skipSave: true });
  }
}

function renderAnswerSetOptions({
  selectedValue = activeAnswerSet,
  exerciseType,
  skipSave = false,
} = {}) {
  if (!answerSetSelect) return;
  const effectiveExerciseType = exerciseType ?? getCurrentExerciseType();
  const available = getAvailableAnswerSetsForExercise(effectiveExerciseType);
  const resolvedValue = getValidAnswerSetValue(selectedValue, effectiveExerciseType);

  answerSetSelect.innerHTML = "";
  available.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    answerSetSelect.appendChild(option);
  });

  answerSetSelect.value = resolvedValue;
  activeAnswerSet = resolvedValue;
  if (!skipSave) {
    saveAnswerSetSelection(resolvedValue);
  }
}

function handleChromaSetChange(event) {
  if (isCustomSelectionOpen) {
    closeCustomChromaPicker();
  }
  setActiveChromaSetByValue(event.target.value);
}

function handleAnswerSetChange(event) {
  const newValue = getValidAnswerSetValue(event.target.value);
  activeAnswerSet = newValue;
  if (answerSetSelect) {
    answerSetSelect.value = newValue;
  }
  saveAnswerSetSelection(newValue);
  showStartButton();
}

function getValidChromaSetValue(value) {
  const chromaSetOptions = getChromaSetOptions();
  const parsed = Number.parseInt(value, 10);
  if (
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed < chromaSets.length &&
    chromaSetOptions[parsed]
  ) {
    return String(parsed);
  }

  if (value === CUSTOM_CHROMA_SET_VALUE && customChromaSet.chromas.length) {
    return CUSTOM_CHROMA_SET_VALUE;
  }

  return "0";
}

function normalizeStoredChromaSetValue(storedValue) {
  if (storedValue === CUSTOM_CHROMA_SET_VALUE) {
    return storedValue;
  }

  const parsed = Number.parseInt(storedValue ?? "", 10);
  if (Number.isInteger(parsed) && chromaSets[parsed]) {
    return String(parsed);
  }

  return "0";
}

function saveChromaSetSelection(value) {
  void setSetting(LAST_CHROMA_SET_KEY, String(value));
}

function saveAnswerSetSelection(value) {
  void setSetting(LAST_ANSWER_SET_KEY, value);
}

async function hydrateSavedSettings() {
  const [
    customSelectionStored,
    reducedRangeStored,
    randomizeStored,
    droneCountStored,
    seriesRandomizeStored,
    feedbackModeStored,
    limitedFeedbackStored,
    modeStored,
    precisionStored,
    chromaSetStored,
    answerSetStored,
  ] = await Promise.all([
    getSetting(CUSTOM_CHROMA_STORAGE_KEY),
    getSetting(REDUCED_RANGE_STORAGE_KEY),
    getSetting(RANDOMIZE_BUTTON_ORDER_KEY),
    getSetting(DRONE_COUNT_STORAGE_KEY),
    getSetting(SERIES_RANDOMIZE_START_STORAGE_KEY),
    getSetting(FEEDBACK_MODE_STORAGE_KEY),
    getSetting(LIMITED_FEEDBACK_STORAGE_KEY),
    getSetting(LAST_MODE_STORAGE_KEY),
    getSetting(LAST_RECALL_PRECISION_KEY),
    getSetting(LAST_CHROMA_SET_KEY),
    getSetting(LAST_ANSWER_SET_KEY),
  ]);

  const parsedSelection = parseCustomChromaSelection(customSelectionStored);
  updateCustomChromaSet(parsedSelection, { shouldSelectCustom: false, skipSave: true });

  const resolvedFeedbackMode =
    feedbackModeStored ?? limitedFeedbackStored ?? feedbackMode;
  setFeedbackMode(parseFeedbackModeSetting(resolvedFeedbackMode), { skipSave: true });

  const resolvedMode =
    typeof modeStored === "string" ? modeStored : currentMode;
  setMode(resolvedMode, { skipSave: true });

  const resolvedPrecision =
    typeof precisionStored === "string" ? precisionStored : recallPrecisionValue;
  setRecallPrecision(resolvedPrecision, { skipSave: true });

  const resolvedRange = parseBooleanSetting(reducedRangeStored, reducedRangeEnabled);
  applyRangeSetting(resolvedRange);
  if (reducedRangeToggle) {
    reducedRangeToggle.checked = resolvedRange;
  }

  randomizeButtonsEnabled = parseBooleanSetting(randomizeStored, randomizeButtonsEnabled);
  if (randomizeButtonsToggle) {
    randomizeButtonsToggle.checked = randomizeButtonsEnabled;
  }
  resetRandomizedButtonOrder();
  refreshButtonOrder();

  const resolvedDroneCount = parseNumberSetting(droneCountStored, selectedDroneCount);
  setDroneCount(resolvedDroneCount, { skipSave: true });

  seriesRandomizeStartEnabled = parseBooleanSetting(
    seriesRandomizeStored,
    seriesRandomizeStartEnabled
  );
  if (seriesRandomizeStartToggle) {
    seriesRandomizeStartToggle.checked = seriesRandomizeStartEnabled;
  }

  const resolvedChromaSet = normalizeStoredChromaSetValue(chromaSetStored);
  setActiveChromaSetByValue(resolvedChromaSet, { skipSave: true });

  const resolvedAnswerSet =
    typeof answerSetStored === "string" ? answerSetStored : activeAnswerSet;
  renderAnswerSetOptions({
    selectedValue: resolvedAnswerSet,
    exerciseType: getCurrentExerciseType(),
    skipSave: true,
  });
}

function setActiveChromaSetByValue(value, { skipSave = false } = {}) {
  const resolvedValue = getValidChromaSetValue(value);
  activeChromaSetValue = resolvedValue;
  activeChromaSet =
    resolvedValue === CUSTOM_CHROMA_SET_VALUE
      ? customChromaSet
      : chromaSets[Number(resolvedValue)];
  if (chromaSetSelect) {
    chromaSetSelect.value = resolvedValue;
  }
  renderAnswerSetOptions({
    exerciseType: getCurrentExerciseType(),
    skipSave,
  });
  populateDroneCountSelect({ selectedCount: selectedDroneCount });
  startDronePlayersForCurrentSet();
  if (!skipSave) {
    saveChromaSetSelection(resolvedValue);
  }
  showStartButton();
  refreshStatsIfOpen();
}

function populateChromaSetSelect() {
  renderChromaSetOptions(activeChromaSetValue);
  chromaSetSelect.addEventListener("change", handleChromaSetChange);
}

function populateAnswerSetSelect() {
  renderAnswerSetOptions();
  if (answerSetSelect) {
    answerSetSelect.addEventListener("change", handleAnswerSetChange);
  }
}

function updateCustomChromaSet(
  selection,
  { shouldSelectCustom = true, skipSave = false } = {}
) {
  customChromaSelection = Array.from(
    new Set(
      selection.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < chromas.length
      )
    )
  ).sort((a, b) => a - b);
  pendingCustomSelection = new Set(customChromaSelection);
  customChromaSet = buildCustomChromaSet(customChromaSelection);
  if (!skipSave) {
    saveCustomChromaSelection(customChromaSelection);
  }
  renderChromaSetOptions(activeChromaSetValue, { skipActivation: true });
  if (shouldSelectCustom) {
    setActiveChromaSetByValue(CUSTOM_CHROMA_SET_VALUE);
  }
}

function toggleCustomChromaSelection(chromaIndex) {
  if (pendingCustomSelection.has(chromaIndex)) {
    pendingCustomSelection.delete(chromaIndex);
  } else {
    pendingCustomSelection.add(chromaIndex);
  }
}

function renderCustomChromaButtons() {
  if (!customChromaButtons) return;
  customChromaButtons.innerHTML = "";
  chromas.forEach((chroma) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chroma";
    const isSelected = pendingCustomSelection.has(chroma.index);
    if (isSelected) {
      btn.classList.add("selected");
    }
    btn.textContent = chroma.label;
    btn.addEventListener("click", () => {
      toggleCustomChromaSelection(chroma.index);
      btn.classList.toggle("selected", pendingCustomSelection.has(chroma.index));
    });
    customChromaButtons.appendChild(btn);
  });
}

function openCustomChromaPicker() {
  if (!customChromaPicker || !customChromaButton) return;
  isCustomSelectionOpen = true;
  customChromaPicker.hidden = false;
  resetTrialState();
  if (replayRow && customChromaButton) {
    replayRow.hidden = false;
    replayRow.innerHTML = "";
    replayRow.appendChild(customChromaButton);
  }
  if (buttonsContainer) {
    buttonsContainer.innerHTML = "";
    buttonsContainer.hidden = true;
  }
  customChromaButton.textContent = "OK";
  pendingCustomSelection = new Set(customChromaSelection);
  renderCustomChromaButtons();
}

function closeCustomChromaPicker() {
  if (!customChromaPicker || !customChromaButton) return;
  isCustomSelectionOpen = false;
  customChromaPicker.hidden = true;
  if (replayRow) {
    replayRow.hidden = false;
    replayRow.innerHTML = "";
    if (replayButton) {
      replayRow.appendChild(replayButton);
    }
  }
  if (customButtonHome) {
    customButtonHome.appendChild(customChromaButton);
  }
  if (buttonsContainer) {
    buttonsContainer.hidden = false;
    showStartButton();
  }
  customChromaButton.textContent = "Custom chroma set";
}

function confirmCustomChromaSelection() {
  const selection = Array.from(pendingCustomSelection).sort((a, b) => a - b);
  if (!selection.length) {
    alert("Sélectionnez au moins un chroma pour le custom set.");
    return;
  }

  updateCustomChromaSet(selection);
  closeCustomChromaPicker();
}

function setupCustomChromaButton() {
  if (!customChromaButton || !customChromaPicker || !customChromaButtons) return;

  customButtonHome = customChromaButton.parentElement || customButtonHome;
  customChromaPicker.hidden = true;
  customChromaButton.addEventListener("click", () => {
    if (!isCustomSelectionOpen) {
      openCustomChromaPicker();
    } else {
      confirmCustomChromaSelection();
    }
  });
}

function getAudioSrc(instrument, midiNote, format = audioFormat) {
  const { folder, extension } = getAudioFormatConfig(format);
  return `assets/${folder}/${instrument}/${midiNote}.${extension}`;
}

async function checkSampleExists(instrument, midiNote) {
  const key = `${audioFormat}-${instrument}-${midiNote}`;
  if (availabilityCache.has(key)) {
    return availabilityCache.get(key);
  }

  const src = getAudioSrc(instrument, midiNote);

  try {
    const response = await fetch(src, {
      method: "HEAD",
    });
    const ok = response.ok;
    availabilityCache.set(key, ok);
    return ok;
  } catch (error) {
    availabilityCache.set(key, false);
    return false;
  }
}

async function pickInstrumentForNote(midiNote) {
  const checks = await Promise.all(
    instruments.map(async (instrument) => {
      const range = instrumentRanges[instrument];
      if (range && (midiNote < range.min || midiNote > range.max)) {
        return null;
      }
      const hasSample = await checkSampleExists(instrument, midiNote);
      return hasSample ? instrument : null;
    })
  );
  const available = checks.filter(Boolean);
  if (!available.length) return null;
  const index = Math.floor(Math.random() * available.length);
  return available[index];
}

function pickRandomChroma() {
  if (!activeChromaSet || !activeChromaSet.chromas.length) return null;
  const idx = Math.floor(Math.random() * activeChromaSet.chromas.length);
  return activeChromaSet.chromas[idx].index;
}

function pickRandomNote(chromaIndex, excludedMidiNote) {
  const notes = notesByChroma[chromaIndex];
  const pool = notes.filter((note) => note !== excludedMidiNote);
  const source = pool.length ? pool : notes;
  const idx = Math.floor(Math.random() * source.length);
  return source[idx];
}

async function buildRecognizeSeriesTrial(excludedMidiNote) {
  const trial = await findPlayableTrial(0, excludedMidiNote);
  if (!trial) return null;
  return {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
  };
}

async function buildRecallSeriesTrial(
  excludedMidiNote,
  lastTargetChroma,
  lastPlayedChroma,
  precisionConfig
) {
  const excludedRecallNotes = new Set();
  if (Number.isInteger(lastTargetChroma)) {
    excludedRecallNotes.add(lastTargetChroma);
  }
  if (Number.isInteger(lastPlayedChroma)) {
    excludedRecallNotes.add(lastPlayedChroma);
  }

  const targetChromaIndex =
    pickRecallTargetExcluding(excludedRecallNotes, precisionConfig.semitones) ??
    pickRandomChromaExcluding(excludedRecallNotes);
  if (targetChromaIndex == null) return null;

  const options = buildRecallOptionsExcluding(
    targetChromaIndex,
    precisionConfig.semitones,
    excludedRecallNotes
  );

  const optionPool = options.length
    ? options
    : getRecallOptions(targetChromaIndex, precisionConfig.semitones);
  const chosenChroma =
    optionPool[Math.floor(Math.random() * optionPool.length)] ?? targetChromaIndex;

  const trial = await findPlayableTrialForChroma(chosenChroma, excludedMidiNote);
  if (!trial) return null;

  return {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
    targetChromaIndex,
    options,
  };
}

async function generateSeriesTrials(count, settingsSnapshot) {
  const trials = [];
  let lastMidiNote = null;
  let lastTargetChroma = null;
  let lastPlayedChroma = null;
  const precisionConfig = getRecallPrecisionConfig(settingsSnapshot.precisionValue);

  for (let i = 0; i < count; i += 1) {
    let trial = null;
    if (settingsSnapshot.mode === "recall" || settingsSnapshot.mode === "discrimination") {
      trial = await buildRecallSeriesTrial(
        lastMidiNote,
        lastTargetChroma,
        lastPlayedChroma,
        precisionConfig
      );
      if (trial) {
        lastTargetChroma = trial.targetChromaIndex;
        lastPlayedChroma = trial.chromaIndex;
      }
    } else {
      trial = await buildRecognizeSeriesTrial(lastMidiNote);
    }

    if (!trial) {
      break;
    }

    trials.push(trial);
    lastMidiNote = trial.midiNote;
  }

  return trials;
}

async function startSeriesTrial() {
  if (!activeSeries?.trials?.length) {
    stopSeriesPlayback({ showStatus: true, message: "No trials in series." });
    return;
  }
  if (seriesPlaybackCount >= activeSeries.trials.length) {
    stopSeriesPlayback({ showStatus: true, message: "Series complete." });
    return;
  }

  cancelNextTrialTimeout();
  resetButtonFocus();
  trialStartTimestampMs = null;
  replayCount = 0;

  const totalTrials = activeSeries.trials.length;
  const trialData = activeSeries.trials[seriesPlaybackIndex];
  const trialIndex = seriesPlaybackIndex;
  seriesPlaybackIndex = (seriesPlaybackIndex + 1) % totalTrials;
  seriesPlaybackCount += 1;
  currentSeriesTrialIndex = trialIndex;

  if (!trialData) {
    stopSeriesPlayback({ showStatus: true, message: "Series trial missing." });
    return;
  }

  const audioElement = await prepareAudioElement(trialData.instrument, trialData.midiNote);
  if (!audioElement) {
    stopSeriesPlayback({ showStatus: true, message: "Series audio unavailable." });
    return;
  }

  const baseTrial = {
    chromaIndex: trialData.chromaIndex,
    midiNote: trialData.midiNote,
    instrument: trialData.instrument,
    audioElement,
  };

  if (currentMode === "recall" || currentMode === "discrimination") {
    const precisionConfig = getRecallPrecisionConfig();
    recallState = {
      ...createEmptyRecallState(),
      targetChromaIndex: trialData.targetChromaIndex,
      options:
        Array.isArray(trialData.options) && trialData.options.length
          ? trialData.options
          : getRecallOptions(trialData.targetChromaIndex, precisionConfig.semitones),
      precisionLabel: precisionConfig.label,
      precisionSemitones: precisionConfig.semitones,
    };

    currentState = {
      chromaIndex: null,
      midiNote: null,
      instrument: null,
      chromaSetLabel: activeChromaSet?.label ?? "",
      exerciseType: getCurrentExerciseType(),
      answerSet: null,
      awaitingGuess: false,
    };
    currentTrial = null;
    lastMidiNotePlayed = baseTrial.midiNote;
    seriesPendingTrial = baseTrial;
    if (buttonsContainer) {
      buttonsContainer.innerHTML = "";
    }
    scrollButtonsToBottom();
    updateReplayAvailability();
    if (currentMode === "recall") {
      renderRecallMessage();
    } else if (recallMessage) {
      recallMessage.hidden = true;
      recallMessage.textContent = "";
    }
    if (currentMode === "discrimination") {
      handleRecallPlay();
    }
    return;
  }

  const trialChromas = getChromasForTrial(baseTrial.chromaIndex);
  createButtons(trialChromas);
  scrollButtonsToBottom();
  currentState = {
    chromaIndex: baseTrial.chromaIndex,
    midiNote: baseTrial.midiNote,
    instrument: baseTrial.instrument,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: normalizeExerciseType(activeChromaSet?.exerciseType ?? ""),
    answerSet: activeAnswerSet,
    awaitingGuess: true,
  };
  currentTrial = baseTrial;
  lastMidiNotePlayed = baseTrial.midiNote;
  updateReplayAvailability();
  playPreparedTrial(baseTrial);
}

function startSeriesPlayback(series) {
  if (!series?.trials?.length) {
    updateSeriesStatus("Series is empty.", { autoHide: true });
    return;
  }
  activeSeries = series;
  applySeriesSettingsSnapshot(series.settingsSnapshot);
  seriesPlaybackRunId = generateSeriesRunId(series.id);
  seriesPlaybackActive = true;
  seriesPlaybackIndex = seriesRandomizeStartEnabled
    ? Math.floor(Math.random() * series.trials.length)
    : 0;
  seriesPlaybackCount = 0;
  currentSeriesTrialIndex = null;
  seriesPendingTrial = null;
  setSettingsLocked(true);
  clearPendingTrials();
  updateSeriesControlsState();
  updateSeriesStatus("Series playback started.", { autoHide: true });
  startTrial();
}

function stopSeriesPlayback({ showStatus = false, message } = {}) {
  seriesPlaybackActive = false;
  seriesPlaybackRunId = "";
  seriesPlaybackIndex = 0;
  seriesPlaybackCount = 0;
  currentSeriesTrialIndex = null;
  seriesPendingTrial = null;
  setSettingsLocked(false);
  cancelNextTrialTimeout();
  resetTrialState();
  updateSeriesControlsState();
  if (showStatus && message) {
    updateSeriesStatus(message, { autoHide: true });
  }
}

async function startTrial(attempt = 0) {
  if (seriesPlaybackActive) {
    return startSeriesTrial();
  }
  if (currentMode === "recall") {
    return startRecallTrial();
  }
  if (currentMode === "discrimination") {
    return startDiscriminationTrial();
  }
  return startRecognizeTrial(attempt);
}

async function startRecognizeTrial(attempt = 0) {
  cancelNextTrialTimeout();
  resetButtonFocus();
  trialStartTimestampMs = null;
  replayCount = 0;

  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    currentState.awaitingGuess = false;
    clearPendingTrials();
    return;
  }

  let trial = pendingTrials.shift();

  if (!trial && pendingPreparationPromise) {
    await pendingPreparationPromise;
    trial = pendingTrials.shift();
  }

  if (!trial) {
    const lastQueuedNote =
      pendingTrials.length > 0
        ? pendingTrials[pendingTrials.length - 1].midiNote
        : lastMidiNotePlayed;
    trial = await findPlayableTrial(attempt, lastQueuedNote);
  }

  if (!trial) {
    currentState.awaitingGuess = false;
    clearPendingTrials();
    currentTrial = null;
    updateReplayAvailability();
    return;
  }

  const trialChromas = getChromasForTrial(trial.chromaIndex);
  createButtons(trialChromas);
  scrollButtonsToBottom();

  currentState = {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: normalizeExerciseType(activeChromaSet?.exerciseType ?? ""),
    answerSet: activeAnswerSet,
    awaitingGuess: true,
  };
  currentTrial = trial;
  lastMidiNotePlayed = trial.midiNote;
  updateReplayAvailability();
  playPreparedTrial(trial);
  preparePendingTrial();
}

async function startRecallTrial() {
  cancelNextTrialTimeout();
  resetButtonFocus();
  clearPendingTrials();
  trialStartTimestampMs = null;
  replayCount = 0;

  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    currentState.awaitingGuess = false;
    currentTrial = null;
    updateReplayAvailability();
    return;
  }

  const precisionConfig = getRecallPrecisionConfig();
  const excludedRecallNotes = getRecallExclusionSet();
  const targetChromaIndex =
    pickRecallTargetExcluding(excludedRecallNotes, precisionConfig.semitones) ??
    pickRandomChromaExcluding(excludedRecallNotes);
  if (targetChromaIndex == null) {
    currentState.awaitingGuess = false;
    currentTrial = null;
    updateReplayAvailability();
    return;
  }

  recallState = {
    ...createEmptyRecallState(),
    targetChromaIndex,
    options: buildRecallOptionsExcluding(
      targetChromaIndex,
      precisionConfig.semitones,
      excludedRecallNotes
    ),
    precisionLabel: precisionConfig.label,
    precisionSemitones: precisionConfig.semitones,
  };

  currentState = {
    chromaIndex: null,
    midiNote: null,
    instrument: null,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: getCurrentExerciseType(),
    answerSet: null,
    awaitingGuess: false,
  };
  currentTrial = null;
  renderRecallMessage();
  buttonsContainer.innerHTML = "";
  updateReplayAvailability();
}

async function startDiscriminationTrial() {
  cancelNextTrialTimeout();
  resetButtonFocus();
  clearPendingTrials();
  trialStartTimestampMs = null;
  replayCount = 0;

  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    currentState.awaitingGuess = false;
    currentTrial = null;
    updateReplayAvailability();
    return;
  }

  const precisionConfig = getRecallPrecisionConfig();
  const excludedRecallNotes = getRecallExclusionSet();
  const targetChromaIndex =
    pickRecallTargetExcluding(excludedRecallNotes, precisionConfig.semitones) ??
    pickRandomChromaExcluding(excludedRecallNotes);
  if (targetChromaIndex == null) {
    currentState.awaitingGuess = false;
    currentTrial = null;
    updateReplayAvailability();
    return;
  }

  recallState = {
    ...createEmptyRecallState(),
    targetChromaIndex,
    options: buildRecallOptionsExcluding(
      targetChromaIndex,
      precisionConfig.semitones,
      excludedRecallNotes
    ),
    precisionLabel: precisionConfig.label,
    precisionSemitones: precisionConfig.semitones,
  };

  currentState = {
    chromaIndex: null,
    midiNote: null,
    instrument: null,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: getCurrentExerciseType(),
    answerSet: null,
    awaitingGuess: false,
  };
  currentTrial = null;
  if (recallMessage) {
    recallMessage.hidden = true;
    recallMessage.textContent = "";
  }
  buttonsContainer.innerHTML = "";
  updateReplayAvailability();
  await handleRecallPlay();
}

function stopCurrentAudio() {
  cancelScheduledFade();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (currentAudioGainNode) {
    currentAudioGainNode.disconnect();
    currentAudioGainNode = null;
  }
}

function getAudioElementForTrial(trial) {
  if (trial?.audioElement) {
    try {
      const clone = trial.audioElement.cloneNode(true);
      clone.currentTime = 0;
      return clone;
    } catch (error) {
      // Ignore clone errors and fall back to a fresh audio element.
    }
  }

  const audio = new Audio(getAudioSrc(trial.instrument, trial.midiNote));
  audio.preload = "auto";
  return audio;
}

function playPreparedTrial(trial) {
  const { instrument, midiNote } = trial;
  const audio = getAudioElementForTrial(trial);
  if (!audio) return;

  stopCurrentAudio();
  if (trialStartTimestampMs == null) {
    trialStartTimestampMs = Date.now();
  }

  const context = getAudioContext();
  if (context) {
    const source = context.createMediaElementSource(audio);
    const gainNode = context.createGain();

    gainNode.gain.setValueAtTime(1, context.currentTime);
    source.connect(gainNode).connect(context.destination);

    currentAudioGainNode = gainNode;
  } else {
    currentAudioGainNode = null;
  }

  currentAudio = audio;

  audio
    .play()
    .catch(() => {
      // Fail silently to avoid on-screen feedback.
    });
}

async function handleRecallPlay() {
  if (recallPlayPending || recallState?.targetChromaIndex == null) return;

  if (currentTrial && recallState.playedChromaIndex != null) {
    playPreparedTrial(currentTrial);
    return;
  }

  if (seriesPlaybackActive && seriesPendingTrial) {
    const trial = seriesPendingTrial;
    seriesPendingTrial = null;
    recallState = {
      ...recallState,
      playedChromaIndex: trial.chromaIndex,
      midiNote: trial.midiNote,
      instrument: trial.instrument,
      audioElement: trial.audioElement,
    };

    currentState = {
      chromaIndex: trial.chromaIndex,
      midiNote: trial.midiNote,
      instrument: trial.instrument,
      chromaSetLabel: activeChromaSet?.label ?? "",
      exerciseType: getCurrentExerciseType(),
      answerSet: null,
      awaitingGuess: true,
    };
    currentTrial = trial;
    lastMidiNotePlayed = trial.midiNote;
    createRecallButtons(recallState.options, {
      targetChromaIndex: recallState.targetChromaIndex,
      semitones: recallState.precisionSemitones,
    });
    scrollButtonsToBottom();
    updateReplayAvailability();
    playPreparedTrial(trial);
    return;
  }

  recallPlayPending = true;
  updateReplayAvailability();

  const optionPool = recallState.options.length
    ? recallState.options
    : getRecallOptions(recallState.targetChromaIndex, recallState.precisionSemitones);
  const chosenChroma =
    optionPool[Math.floor(Math.random() * optionPool.length)] ??
    recallState.targetChromaIndex;

  const trial = await findPlayableTrialForChroma(chosenChroma, lastMidiNotePlayed);
  recallPlayPending = false;

  if (!trial) {
    updateReplayAvailability();
    return;
  }

  recallState = {
    ...recallState,
    playedChromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
    audioElement: trial.audioElement,
  };

  currentState = {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: getCurrentExerciseType(),
    answerSet: null,
    awaitingGuess: true,
  };
  currentTrial = trial;
  lastMidiNotePlayed = trial.midiNote;
  createRecallButtons(recallState.options, {
    targetChromaIndex: recallState.targetChromaIndex,
    semitones: recallState.precisionSemitones,
  });
  scrollButtonsToBottom();
  updateReplayAvailability();
  playPreparedTrial(trial);
}

function replayCurrentTrial() {
  if (!currentState.awaitingGuess || !currentTrial) return;

  playPreparedTrial(currentTrial);
}

function handleReplayClick() {
  if (replayButton?.disabled) return;
  if (currentState.awaitingGuess || recallState?.targetChromaIndex != null) {
    replayCount += 1;
  }
  if (currentMode === "recall" || currentMode === "discrimination") {
    handleRecallPlay();
    return;
  }
  replayCurrentTrial();
}

function fadeOutCurrentAudio() {
  cancelScheduledFade();
  const audio = currentAudio;
  const gainNode = currentAudioGainNode;
  if (!audio) return;

  if (!gainNode) {
    audio.pause();
    audio.currentTime = 0;
    if (currentAudio === audio) {
      currentAudio = null;
    }
    return;
  }

  const context = getAudioContext();
  const fadeDurationSeconds = FADE_DURATION_MS / 1000;
  const now = context.currentTime;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + fadeDurationSeconds);

  const cleanup = () => {
    audio.pause();
    audio.currentTime = 0;
    gainNode.disconnect();
    if (currentAudio === audio) {
      currentAudio = null;
      currentAudioGainNode = null;
    }
  };

  setTimeout(cleanup, FADE_DURATION_MS);
}

function cancelScheduledFade() {
  if (fadeTimeout) {
    clearTimeout(fadeTimeout);
    fadeTimeout = null;
  }
}

function scheduleAudioFade(feedbackDuration) {
  if (!currentAudio) return;

  cancelScheduledFade();

  const fadeDelay = Math.max((feedbackDuration ?? 0) - FADE_DURATION_MS, 0);

  fadeTimeout = setTimeout(() => {
    fadeTimeout = null;
    fadeOutCurrentAudio();
  }, fadeDelay);
}

function playLimitedFeedbackSound() {
  return new Promise((resolve) => {
    const audio = new Audio("assets/feedback.mp3");
    const cleanup = () => resolve();
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio
      .play()
      .then(() => {
        // Playback started; wait for ended event.
      })
      .catch(() => {
        cleanup();
      });
  });
}

function handleAnswer(chosenChroma, { shouldFadeOut = true } = {}) {

  if (!currentState.awaitingGuess) return;

  currentState.awaitingGuess = false;
  lastClickedChromaIndex = chosenChroma;
  currentTrial = null;
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }
  updateReplayAvailability();

  const isCorrect = chosenChroma === currentState.chromaIndex;
  const chosenButton = getChromaButton(chosenChroma);
  const correctButton = getChromaButton(currentState.chromaIndex);
  const resolvedAnswerSet =
    currentState.answerSet === undefined ? activeAnswerSet : currentState.answerSet;
  const recallTargetLabel =
    recallState?.targetChromaIndex != null
      ? getChromaLabelByIndex(recallState.targetChromaIndex)
      : "";
  const timestampMS = Date.now();
  const rtMs =
    trialStartTimestampMs == null ? null : Math.max(0, timestampMS - trialStartTimestampMs);
  const seriesLogContext = getSeriesPlaybackLogContext();

  void logTrialResult({
    chromaSetLabel: currentState.chromaSetLabel,
    targetChromaLabel: getChromaLabelByIndex(currentState.chromaIndex),
    midiNote: currentState.midiNote,
    instrument: currentState.instrument,
    userSelectedChroma: getChromaLabelByIndex(chosenChroma),
    exerciseType: currentState.exerciseType || getCurrentExerciseType(),
    answerSet: resolvedAnswerSet,
    reducedRangeEnabled,
    dronesPlayed: getActiveDroneLabels(),
    "Feedback mode": getFeedbackModeLabel(),
    Mode: getModeLabel(),
    "Recall precision": recallState?.precisionLabel || "",
    "Recall note": recallTargetLabel,
    timestampMS,
    rtMs,
    replayCount,
    isCorrect,
    ...seriesLogContext,
  });

  refreshStatsIfOpen();

  if (feedbackMode === "feedback") {
    if (isCorrect) {
      chosenButton?.classList.add("correct");
    } else {
      chosenButton?.classList.add("incorrect");
      correctButton?.classList.add("correct");
    }
  }

  const feedbackDuration = isCorrect
    ? CORRECT_FEEDBACK_DURATION
    : INCORRECT_FEEDBACK_DURATION;

  if (shouldFadeOut && feedbackMode !== "none") {
    scheduleAudioFade(feedbackDuration);
  }

  if (currentMode === "recognize") {
    preparePendingTrial();
  }

  if (feedbackMode === "feedback") {
    scheduleFeedbackReset(feedbackDuration);
    scheduleNextTrial(feedbackDuration);
    return;
  }

  if (feedbackMode === "limited" && !isCorrect) {
    playLimitedFeedbackSound();
  }

  scheduleNextTrial(feedbackMode === "none" ? 0 : feedbackDuration);
}

function cancelNextTrialTimeout() {
  if (nextTrialTimeout) {
    clearTimeout(nextTrialTimeout);
    nextTrialTimeout = null;
  }
}

function scheduleNextTrial(feedbackDuration) {
  cancelNextTrialTimeout();
  const delayUntilNextTrial = (feedbackDuration ?? 0) + NEXT_TRIAL_DELAY;
  nextTrialTimeout = setTimeout(() => {
    nextTrialTimeout = null;
    startTrial();
  }, delayUntilNextTrial);
  if (
    currentMode === "recognize" &&
    !seriesPlaybackActive &&
    pendingTrials.length < PREFETCH_TRIAL_COUNT &&
    !pendingPreparationPromise
  ) {
    preparePendingTrial();
  }
}

function clearPendingTrials() {
  pendingTrials = [];
  pendingPreparationPromise = null;
  pendingPreparationToken += 1;
}

async function preparePendingTrial() {
  if (seriesPlaybackActive) return null;
  if (currentMode === "recall" || currentMode === "discrimination") return null;
  if (pendingTrials.length >= PREFETCH_TRIAL_COUNT) return pendingTrials[0];
  if (pendingPreparationPromise) return pendingPreparationPromise;

  const token = pendingPreparationToken;
  pendingPreparationPromise = (async () => {
    let lastQueuedNote =
      pendingTrials.length > 0
        ? pendingTrials[pendingTrials.length - 1].midiNote
        : lastMidiNotePlayed;
    while (pendingTrials.length < PREFETCH_TRIAL_COUNT) {
      const trial = await findPlayableTrial(0, lastQueuedNote);
      if (token !== pendingPreparationToken) {
        pendingPreparationPromise = null;
        return null;
      }
      if (!trial) break;
      pendingTrials.push(trial);
      lastQueuedNote = trial.midiNote;
    }
    pendingPreparationPromise = null;
    return pendingTrials[0] ?? null;
  })();

  return pendingPreparationPromise;
}

async function findPlayableTrial(attempt = 0, excludedMidiNote = null) {
  const MAX_ATTEMPTS = 30;
  if (!activeChromaSet || !activeChromaSet.chromas.length) return null;
  if (attempt >= MAX_ATTEMPTS) return null;

  const chromaIndex = pickRandomChroma();
  if (chromaIndex === null) return null;

  const midiNote = pickRandomNote(chromaIndex, excludedMidiNote);
  const instrument = await pickInstrumentForNote(midiNote);

  if (!instrument) {
    return findPlayableTrial(attempt + 1, excludedMidiNote);
  }

  const audioElement = await prepareAudioElement(instrument, midiNote);
  if (!audioElement) {
    return findPlayableTrial(attempt + 1, excludedMidiNote);
  }

  return { chromaIndex, midiNote, instrument, audioElement };
}

async function findPlayableTrialForChroma(chromaIndex, excludedMidiNote = null, attempt = 0) {
  const MAX_ATTEMPTS = 30;
  if (!Number.isInteger(chromaIndex)) return null;
  if (attempt >= MAX_ATTEMPTS) return null;

  const midiNote = pickRandomNote(chromaIndex, excludedMidiNote);
  const instrument = await pickInstrumentForNote(midiNote);

  if (!instrument) {
    return findPlayableTrialForChroma(chromaIndex, excludedMidiNote, attempt + 1);
  }

  const audioElement = await prepareAudioElement(instrument, midiNote);
  if (!audioElement) {
    return findPlayableTrialForChroma(chromaIndex, excludedMidiNote, attempt + 1);
  }

  return { chromaIndex, midiNote, instrument, audioElement };
}

async function prepareAudioElement(instrument, midiNote) {
  const src = getAudioSrc(instrument, midiNote);
  const audio = new Audio(src);
  audio.preload = "auto";

  try {
    await fetch(src, { method: "GET" });
  } catch (error) {
    return null;
  }

  try {
    audio.load();
  } catch (error) {
    // Ignore load errors; rely on the fetch above.
  }

  return audio;
}

function setupMidi() {
  if (!navigator.requestMIDIAccess) {
    midiStatusEl.textContent = "MIDI not supported by this browser";
    midiStatusEl.classList.add("muted");
    return;
  }

  navigator
    .requestMIDIAccess()
    .then((access) => {
      midiStatusEl.textContent = "MIDI connected";
      midiStatusEl.classList.remove("muted");
      access.inputs.forEach((input) => {
        input.onmidimessage = handleMidiMessage;
      });
      access.onstatechange = (event) => {
        const port = event.port;
        if (port.type === "input" && port.state === "connected") {
          port.onmidimessage = handleMidiMessage;
        }
      };
    })
    .catch(() => {
      midiStatusEl.textContent = "MIDI access denied";
      midiStatusEl.classList.add("muted");
    });
}

function handleMidiMessage(message) {
  const [status, data1, data2] = message.data;
  const isNoteOn = (status & 0xf0) === 0x90 && data2 > 0;
  if (!isNoteOn) return;
  if (
    currentMode === "recall" &&
    recallState?.targetChromaIndex != null &&
    recallState?.playedChromaIndex == null &&
    !currentState.awaitingGuess
  ) {
    handleRecallPlay();
    return;
  }
  if (data1 <= DRONE_MIDI_START - 1) {
    handleDroneReset();
    return;
  }
  const chromaIndex = data1 % 12;

  handleAnswer(chromaIndex);
}

function getDroneAudioSrc(chromaIndex) {
  const clampedIndex = Math.max(0, Math.min(chromaIndex, DRONE_MIDI_END - DRONE_MIDI_START));
  const midiNote = DRONE_MIDI_START + clampedIndex;
  return `assets/Drones/${midiNote}.${DRONE_AUDIO_EXTENSION}`;
}

function getMaxDroneCount() {
  return getDroneChromaPool().length;
}

function populateDroneCountSelect({ selectedCount = selectedDroneCount } = {}) {
  if (!droneCountSelect) return;
  const maxCount = getMaxDroneCount();
  const resolvedCount = Math.max(0, Math.min(selectedCount, maxCount));
  droneCountSelect.innerHTML = "";
  for (let count = 0; count <= maxCount; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = String(count);
    droneCountSelect.appendChild(option);
  }
  selectedDroneCount = resolvedCount;
  droneCountSelect.value = String(resolvedCount);
  updateDroneResetButtonState();
}

function fadeAudioVolume(audio, durationMs, targetVolume = 0) {
  if (!audio || durationMs <= 0) {
    if (audio) {
      audio.volume = targetVolume;
    }
    return;
  }
  const startVolume = audio.volume;
  const startTime = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - startTime) / durationMs, 1);
    audio.volume = startVolume + (targetVolume - startVolume) * progress;
    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

function stopDronePlayers({ fadeOutMs = 0 } = {}) {
  const players = [...dronePlayers];
  dronePlayers = [];
  const context = getAudioContext();
  const now = context?.currentTime ?? 0;
  const fadeDurationSeconds = fadeOutMs / 1000;
  players.forEach((player) => {
    if (player.crossfadeTimeout) {
      clearTimeout(player.crossfadeTimeout);
    }
    if (player.instance) {
      if (fadeOutMs > 0) {
        applyEqualPowerFade(
          player.instance.gain,
          now,
          fadeDurationSeconds,
          false,
          player.targetGain ?? 1
        );
        setTimeout(() => cleanupDroneInstance(player.instance), fadeOutMs);
      } else {
        cleanupDroneInstance(player.instance);
      }
    }
    if (player.fallbackAudio) {
      if (fadeOutMs > 0) {
        fadeAudioVolume(player.fallbackAudio, fadeOutMs, 0);
        setTimeout(() => {
          player.fallbackAudio.pause();
          player.fallbackAudio.currentTime = 0;
        }, fadeOutMs);
      } else {
        player.fallbackAudio.pause();
        player.fallbackAudio.currentTime = 0;
      }
    }
  });
}

function startDronePlayersForCurrentSet() {
  stopDronePlayers();
  if (!selectedDroneCount) return;
  const availableChromas = getDroneChromaPool();
  const requested = Math.min(selectedDroneCount, availableChromas.length);
  if (!requested) return;
  const targetGain = getDroneGainForCount(requested);
  const chosen = shuffleArray(availableChromas).slice(0, requested);
  chosen.forEach((chromaIndex) => {
    const player = createDronePlayer(chromaIndex, targetGain);
    if (player) {
      dronePlayers.push(player);
    }
  });
}

function setDroneCount(count, { fadeOutMs = 0, skipSave = false } = {}) {
  const maxCount = getMaxDroneCount();
  const resolved = Number.isFinite(count)
    ? Math.max(0, Math.min(count, maxCount))
    : 0;
  selectedDroneCount = resolved;
  if (droneCountSelect) {
    droneCountSelect.value = String(resolved);
  }
  updateDroneResetButtonState();
  if (!skipSave) {
    saveDroneCountSetting(resolved);
  }
  if (fadeOutMs > 0 && dronePlayers.length) {
    stopDronePlayers({ fadeOutMs });
    setTimeout(() => startDronePlayersForCurrentSet(), fadeOutMs);
  } else {
    startDronePlayersForCurrentSet();
  }
}

function handleDroneCountChange(event) {
  const count = Number.parseInt(event.target.value, 10);
  setDroneCount(count, { fadeOutMs: FADE_DURATION_MS });
}

function handleDroneReset() {
  if (!selectedDroneCount) return;
  stopDronePlayers({ fadeOutMs: FADE_DURATION_MS });
  setTimeout(() => startDronePlayersForCurrentSet(), FADE_DURATION_MS);
}

function createEqualPowerCurve(isFadeIn, steps = 32, targetGain = 1) {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const value = isFadeIn ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
    curve[i] = value * targetGain;
  }
  return curve;
}

function applyEqualPowerFade(gainNode, startTime, durationSeconds, isFadeIn, targetGain = 1) {
  const curve = createEqualPowerCurve(isFadeIn, 32, targetGain);
  gainNode.gain.cancelScheduledValues(startTime);
  gainNode.gain.setValueAtTime(isFadeIn ? 0 : targetGain, startTime);
  if (durationSeconds > 0) {
    gainNode.gain.setValueCurveAtTime(curve, startTime, durationSeconds);
  } else {
    gainNode.gain.setValueAtTime(isFadeIn ? targetGain : 0, startTime);
  }
}

function cleanupDroneInstance(instance) {
  if (!instance) return;
  instance.audio.pause();
  instance.audio.currentTime = 0;
  instance.gain.disconnect();
  instance.source.disconnect();
}

function createDroneInstance({
  src,
  offsetSeconds = 0,
  fadeInDurationMs = 0,
  targetGain = 1,
}) {
  const context = getAudioContext();
  if (!context) return null;
  const audio = new Audio(src);
  audio.preload = "auto";

  if (offsetSeconds > 0) {
    const setOffset = () => {
      try {
        audio.currentTime = offsetSeconds;
      } catch (error) {
        // Ignore offset errors and let playback continue at the default position.
      }
    };
    audio.addEventListener("loadedmetadata", setOffset, { once: true });
    setOffset();
  }

  const source = context.createMediaElementSource(audio);
  const gain = context.createGain();
  source.connect(gain).connect(context.destination);

  const now = context.currentTime;
  const fadeDurationSeconds = fadeInDurationMs / 1000;
  if (fadeInDurationMs > 0) {
    applyEqualPowerFade(gain, now, fadeDurationSeconds, true, targetGain);
  } else {
    gain.gain.setValueAtTime(targetGain, now);
  }

  audio.play().catch(() => {
    cleanupDroneInstance({ audio, gain, source });
  });

  return { audio, gain, source };
}

function scheduleDroneCrossfade(player) {
  if (!player?.instance) return;
  if (player.crossfadeTimeout) {
    clearTimeout(player.crossfadeTimeout);
  }
  player.crossfadeTimeout = setTimeout(() => {
    player.crossfadeTimeout = null;
    crossfadeDrone(player);
  }, DRONE_CROSSFADE_START_MS);
}

function crossfadeDrone(player) {
  const context = getAudioContext();
  if (!context || !player?.instance) return;

  const fadeDurationSeconds = DRONE_CROSSFADE_DURATION_MS / 1000;
  const now = context.currentTime;

  const currentInstance = player.instance;
  applyEqualPowerFade(
    currentInstance.gain,
    now,
    fadeDurationSeconds,
    false,
    player.targetGain ?? 1
  );

  const nextInstance = createDroneInstance({
    src: player.src,
    offsetSeconds: DRONE_RESTART_OFFSET_MS / 1000,
    fadeInDurationMs: DRONE_CROSSFADE_DURATION_MS,
    targetGain: player.targetGain ?? 1,
  });

  player.instance = nextInstance;

  setTimeout(() => {
    cleanupDroneInstance(currentInstance);
  }, DRONE_CROSSFADE_DURATION_MS);

  scheduleDroneCrossfade(player);
}

function createDronePlayer(chromaIndex, targetGain = 1) {
  const src = getDroneAudioSrc(chromaIndex);
  const context = getAudioContext();
  if (!context) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = targetGain;
    audio.play().catch(() => {
      // Ignore autoplay errors; the drone will start once playback is allowed.
    });
    return {
      src,
      chromaIndex,
      fallbackAudio: audio,
      instance: null,
      crossfadeTimeout: null,
      targetGain,
    };
  }

  const instance = createDroneInstance({
    src,
    offsetSeconds: 0,
    fadeInDurationMs: 0,
    targetGain,
  });
  if (!instance) return null;
  const player = { src, chromaIndex, instance, crossfadeTimeout: null, targetGain };
  scheduleDroneCrossfade(player);
  return player;
}

function getDroneGainForCount(count) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const attenuationDb = -10 * Math.log10(count);
  const totalDb = DRONE_BASE_GAIN_DB + attenuationDb;
  return Math.pow(10, totalDb / 20);
}

async function init() {
  trialLogReady = loadTrialLog()
    .then(() => {
      isTrialLogLoaded = true;
    })
    .catch(() => {
      isTrialLogLoaded = true;
    });
  await trialLogReady;
  setupModeSelect();
  setupPrecisionSelect();
  populateChromaSetSelect();
  populateAnswerSetSelect();
  setupReducedRangeToggle();
  setupRandomizeButtonsToggle();
  setupSeriesRandomizeStartToggle();
  setupFeedbackSelect();
  setFeedbackMode(feedbackMode);
  setupDroneCountSelect();
  setupDroneResetButton();
  setupCustomChromaButton();
  updateModeVisibility();
  showStartButton();
  setupMidi();
  if (statsButton) {
    statsButton.addEventListener("click", toggleStatsPanel);
  }
  setupExportLogsButton();
  setupSeriesControls();
  if (replayButton) {
    replayButton.addEventListener("click", handleReplayClick);
  }
  if (statsOutput) {
    statsOutput.textContent = "Select a chroma set to view stats.";
    statsOutput.hidden = true;
  }
  startDronePlayersForCurrentSet();
  await hydrateSavedSettings();
  await loadSeriesList();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
