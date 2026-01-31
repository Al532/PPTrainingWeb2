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
import { getSetting, setSetting } from "./storage/indexedDbStore.js";
import {
  SEQUENCING_PRESETS,
  getSequencingOverrides,
  getSequencingPreset,
  setSequencingOverrides,
} from "./sequencing_config.js";
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
const LAST_MODE_STORAGE_KEY = "ppt-last-mode";
const LAST_RECALL_PRECISION_KEY = "ppt-last-recall-precision";
const SEQUENCING_POLICY_STORAGE_KEY = "ppt-sequencing-policy";
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

const SEQUENCING_POLICY_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "antiRelativeChromatic", label: "Anti-relative" },
];

const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const modeSelect = document.getElementById("mode-select");
const precisionSelect = document.getElementById("precision-select");
const chromaSetSelect = document.getElementById("chroma-set-select");
const sequencingSelect = document.getElementById("sequencing-select");
const sequencingAdvancedToggle = document.getElementById("sequencing-advanced-toggle");
const sequencingAdvancedPanel = document.getElementById("sequencing-advanced-panel");
const sequencingFields = document.getElementById("sequencing-fields");
const sequencingResetButton = document.getElementById("sequencing-reset-button");
const sequencingExportButton = document.getElementById("sequencing-export-button");
const sequencingImportButton = document.getElementById("sequencing-import-button");
const sequencingJsonTextarea = document.getElementById("sequencing-json");
const answerSetSelect = document.getElementById("answer-set-select");
const droneCountSelect = document.getElementById("drone-count-select");
const droneResetButton = document.getElementById("drone-reset-button");
const customChromaButton = document.getElementById("custom-chroma-button");
const customChromaButtons = document.getElementById("custom-chroma-buttons");
const customChromaPicker = document.getElementById("custom-chroma-picker");
const customChromaRow = document.getElementById("custom-chroma-row");
const chromaSetRow = document.getElementById("chroma-set-row");
const sequencingRow = document.getElementById("sequencing-row");
const answerSetRow = document.getElementById("answer-set-row");
const droneRow = document.getElementById("drone-row");
const reducedRangeRow = document.getElementById("reduced-range-row");
const feedbackRow = document.getElementById("feedback-row");
const precisionRow = document.getElementById("precision-row");
const recallMessage = document.getElementById("recall-message");
const statsButton = document.getElementById("stats-button");
const statsOutput = document.getElementById("stats-output");
const reducedRangeToggle = document.getElementById("reduced-range-toggle");
const randomizeButtonsToggle = document.getElementById("randomize-buttons-toggle");
const feedbackToggle = document.getElementById("feedback-toggle");
const replayButton = document.getElementById("replay-button");
const replayRow = document.getElementById("replay-row");

let reducedRangeEnabled = false;
let midiRange = getRangeForSetting(reducedRangeEnabled);
let notesByChroma = buildNotesByChroma(midiRange);
const availabilityCache = new Map();
const CUSTOM_CHROMA_SET_VALUE = "custom";
let activeChromaSet = chromaSets[0];
let activeChromaSetValue = "0";
let activeAnswerSet = "Auto";
let sequencingPolicyValue = "default";
let sequencingOverrides = getSequencingOverrides();
let sequencingHistoryEntries = [];
let pendingAfterWrongPolicy = false;
let randomizeButtonsEnabled = false;
let randomizedButtonOrder = [];
let randomizedButtonOrderTrialCount = 0;
let customChromaSelection = chromas.map((chroma) => chroma.index);
let customChromaSet = buildCustomChromaSet(customChromaSelection);
let isCustomSelectionOpen = false;
let pendingCustomSelection = new Set(customChromaSelection);
let audioFormat = DEFAULT_AUDIO_FORMAT;
let lastClickedChromaIndex = null;
let limitedFeedbackEnabled = false;
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
const audioFormats = {
  mp3: { label: "MP3", folder: "MP3", extension: "mp3" },
  wav: { label: "WAV", folder: "WAV", extension: "wav" },
};

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

function getRecallPrecisionConfig(value = recallPrecisionValue) {
  return (
    RECALL_PRECISION_OPTIONS.find((option) => option.value === value) ??
    RECALL_PRECISION_OPTIONS[0]
  );
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
  resetSequencingHistory({ keepCommitted: false });
  pendingAfterWrongPolicy = false;
  showStartButton();
  refreshStatsIfOpen();
}

function getSequencingPolicyValue(value = sequencingPolicyValue) {
  return SEQUENCING_POLICY_OPTIONS.some((option) => option.value === value)
    ? value
    : "default";
}

function getActiveSequencingPreset() {
  return getSequencingPreset(getSequencingPolicyValue());
}

function isSequencingActive() {
  return currentMode === "recognize" && getSequencingPolicyValue() !== "default";
}

function resetSequencingHistory({ keepCommitted = true } = {}) {
  if (!keepCommitted) {
    sequencingHistoryEntries = [];
    return;
  }
  sequencingHistoryEntries = sequencingHistoryEntries.filter((entry) => !entry.planned);
}

function addSequencingHistoryEntry(entry) {
  if (!entry) return;
  sequencingHistoryEntries.push(entry);
  const maxEntries = 200;
  if (sequencingHistoryEntries.length > maxEntries) {
    sequencingHistoryEntries = sequencingHistoryEntries.slice(-maxEntries);
  }
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

function setLimitedFeedbackEnabled(isEnabled, { skipSave = false } = {}) {
  limitedFeedbackEnabled = Boolean(isEnabled);
  if (feedbackToggle) {
    feedbackToggle.checked = limitedFeedbackEnabled;
  }
  if (!skipSave) {
    saveLimitedFeedbackSetting(limitedFeedbackEnabled);
  }
  if (limitedFeedbackEnabled) {
    resetButtonStates();
  }
}

function setupFeedbackToggle() {
  if (!feedbackToggle) return;
  feedbackToggle.checked = limitedFeedbackEnabled;
  feedbackToggle.addEventListener("change", (event) => {
    setLimitedFeedbackEnabled(event.target?.checked);
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
  if (sequencingRow) sequencingRow.hidden = false;
  if (feedbackRow) feedbackRow.hidden = isRecallLike;
  if (isRecallLike && limitedFeedbackEnabled) {
    setLimitedFeedbackEnabled(false);
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
  resetSequencingHistory({ keepCommitted: false });
  pendingAfterWrongPolicy = false;
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

function renderSequencingOptions(selectedValue = sequencingPolicyValue) {
  if (!sequencingSelect) return;
  sequencingSelect.innerHTML = "";
  SEQUENCING_POLICY_OPTIONS.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    sequencingSelect.appendChild(option);
  });
  sequencingSelect.value = getSequencingPolicyValue(selectedValue);
}

function saveSequencingPolicySelection(value) {
  void setSetting(SEQUENCING_POLICY_STORAGE_KEY, String(value));
}

function setSequencingPolicy(value, { skipSave = false } = {}) {
  sequencingPolicyValue = getSequencingPolicyValue(value);
  if (sequencingSelect) {
    sequencingSelect.value = sequencingPolicyValue;
  }
  updateSequencingFields();
  resetSequencingHistory({ keepCommitted: false });
  pendingAfterWrongPolicy = false;
  if (!skipSave) {
    saveSequencingPolicySelection(sequencingPolicyValue);
  }
  showStartButton();
}

function getFieldPathParts(path) {
  return path.split(".").map((part) => (Number.isNaN(Number(part)) ? part : Number(part)));
}

function getNestedValue(source, pathParts) {
  return pathParts.reduce((acc, key) => (acc == null ? acc : acc[key]), source);
}

function setNestedValue(target, pathParts, value) {
  let current = target;
  pathParts.forEach((part, index) => {
    if (index === pathParts.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    const shouldBeArray = Number.isInteger(pathParts[index + 1]);
    if (next == null) {
      current[part] = shouldBeArray ? [] : {};
    }
    current = current[part];
  });
}

function removeNestedValue(target, pathParts) {
  if (!target) return;
  const parent = pathParts.slice(0, -1).reduce((acc, key) => {
    if (!acc || acc[key] == null) return null;
    return acc[key];
  }, target);
  if (!parent) return;
  delete parent[pathParts[pathParts.length - 1]];
}

const SEQUENCING_FIELDS = [
  { label: "Min abs delta", path: "minAbsDelta", type: "number", step: "1", min: "0" },
  {
    label: "Preferred range 1 min",
    path: "preferredAbsDeltaRanges.0.min",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 1 max",
    path: "preferredAbsDeltaRanges.0.max",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 1 weight",
    path: "preferredAbsDeltaRanges.0.weight",
    type: "number",
    step: "0.1",
    min: "0",
  },
  {
    label: "Preferred range 2 min",
    path: "preferredAbsDeltaRanges.1.min",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 2 max",
    path: "preferredAbsDeltaRanges.1.max",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 2 weight",
    path: "preferredAbsDeltaRanges.1.weight",
    type: "number",
    step: "0.1",
    min: "0",
  },
  {
    label: "Preferred range 3 min",
    path: "preferredAbsDeltaRanges.2.min",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 3 max",
    path: "preferredAbsDeltaRanges.2.max",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Preferred range 3 weight",
    path: "preferredAbsDeltaRanges.2.weight",
    type: "number",
    step: "0.1",
    min: "0",
  },
  {
    label: "Direction window",
    path: "directionBalance.window",
    type: "number",
    step: "1",
    min: "0",
  },
  { label: "Low band max", path: "registerBands.lowMax", type: "number", step: "1" },
  { label: "High band min", path: "registerBands.highMin", type: "number", step: "1" },
  {
    label: "Alternate bands",
    path: "registerBands.alternateBands",
    type: "checkbox",
  },
  {
    label: "After-wrong enabled",
    path: "afterWrongPolicy.enabled",
    type: "checkbox",
  },
  {
    label: "After-wrong min abs delta",
    path: "afterWrongPolicy.forceAbsDeltaMin",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "After-wrong band switch",
    path: "afterWrongPolicy.forceBandSwitch",
    type: "checkbox",
  },
  {
    label: "Max attempts",
    path: "maxAttemptsToFindCandidate",
    type: "number",
    step: "1",
    min: "1",
  },
  {
    label: "Pitch class history window",
    path: "targetPitchClassHistoryWindow",
    type: "number",
    step: "1",
    min: "0",
  },
  {
    label: "Silence between trials (ms)",
    path: "silenceMsBetweenTrials",
    type: "number",
    step: "50",
    min: "0",
  },
  { label: "Weak weight Bb", path: "weakChromaWeights.Bb", type: "number", step: "0.1" },
  { label: "Weak weight F#", path: "weakChromaWeights.F#", type: "number", step: "0.1" },
  { label: "Weak weight F", path: "weakChromaWeights.F", type: "number", step: "0.1" },
  { label: "Weak weight C#", path: "weakChromaWeights.C#", type: "number", step: "0.1" },
  { label: "Weak weight Ab", path: "weakChromaWeights.Ab", type: "number", step: "0.1" },
];

function updateSequencingOverride(path, value) {
  const policyName = getSequencingPolicyValue();
  const basePreset = SEQUENCING_PRESETS[policyName] ?? SEQUENCING_PRESETS.default;
  const overrides = sequencingOverrides ?? {};
  const overrideForPolicy = overrides[policyName] ?? {};
  const pathParts = getFieldPathParts(path);
  const baseValue = getNestedValue(basePreset, pathParts);

  if (value === null || value === "" || value === undefined) {
    removeNestedValue(overrideForPolicy, pathParts);
  } else if (value === baseValue) {
    removeNestedValue(overrideForPolicy, pathParts);
  } else {
    setNestedValue(overrideForPolicy, pathParts, value);
  }

  overrides[policyName] = overrideForPolicy;
  sequencingOverrides = overrides;
  setSequencingOverrides(overrides);
}

function updateSequencingFields() {
  if (!sequencingFields) return;
  const policyName = getSequencingPolicyValue();
  const mergedPreset = getSequencingPreset(policyName);

  sequencingFields.innerHTML = "";
  SEQUENCING_FIELDS.forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.className = "advanced-field";
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = field.type || "number";
    input.dataset.path = field.path;
    if (field.step) input.step = field.step;
    if (field.min != null) input.min = field.min;

    const pathParts = getFieldPathParts(field.path);
    const value = getNestedValue(mergedPreset, pathParts);
    if (field.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value =
        value === undefined || value === null || Number.isNaN(value) ? "" : String(value);
    }

    input.addEventListener("change", (event) => {
      if (field.type === "checkbox") {
        updateSequencingOverride(field.path, Boolean(event.target.checked));
      } else {
        const parsed = Number.parseFloat(event.target.value);
        updateSequencingOverride(field.path, Number.isFinite(parsed) ? parsed : null);
      }
      updateSequencingFields();
      showStartButton();
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    sequencingFields.appendChild(wrapper);
  });

  if (sequencingJsonTextarea) {
    const overrideForPolicy = sequencingOverrides?.[policyName] ?? {};
    sequencingJsonTextarea.value = JSON.stringify(overrideForPolicy, null, 2);
  }
}

function handleSequencingReset() {
  const policyName = getSequencingPolicyValue();
  sequencingOverrides = sequencingOverrides ?? {};
  delete sequencingOverrides[policyName];
  setSequencingOverrides(sequencingOverrides);
  updateSequencingFields();
  showStartButton();
}

function handleSequencingExport() {
  if (!sequencingJsonTextarea) return;
  const policyName = getSequencingPolicyValue();
  const overrideForPolicy = sequencingOverrides?.[policyName] ?? {};
  sequencingJsonTextarea.value = JSON.stringify(overrideForPolicy, null, 2);
}

function handleSequencingImport() {
  if (!sequencingJsonTextarea) return;
  const policyName = getSequencingPolicyValue();
  let parsed = null;
  try {
    parsed = JSON.parse(sequencingJsonTextarea.value || "{}");
  } catch (error) {
    alert("Invalid JSON. Please provide a valid overrides object.");
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    alert("Overrides JSON must be an object.");
    return;
  }
  sequencingOverrides = sequencingOverrides ?? {};
  sequencingOverrides[policyName] = parsed;
  setSequencingOverrides(sequencingOverrides);
  updateSequencingFields();
  showStartButton();
}

function setupSequencingControls() {
  if (!sequencingSelect) return;
  renderSequencingOptions(sequencingPolicyValue);
  sequencingSelect.addEventListener("change", (event) => {
    setSequencingPolicy(event.target.value);
  });

  if (sequencingAdvancedToggle && sequencingAdvancedPanel) {
    sequencingAdvancedToggle.addEventListener("click", () => {
      const isHidden = sequencingAdvancedPanel.hidden;
      sequencingAdvancedPanel.hidden = !isHidden;
      sequencingAdvancedToggle.textContent = isHidden ? "Hide advanced" : "Advanced…";
    });
  }

  if (sequencingResetButton) {
    sequencingResetButton.addEventListener("click", handleSequencingReset);
  }
  if (sequencingExportButton) {
    sequencingExportButton.addEventListener("click", handleSequencingExport);
  }
  if (sequencingImportButton) {
    sequencingImportButton.addEventListener("click", handleSequencingImport);
  }
  updateSequencingFields();
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
  currentTrial = null;
  recallPlayPending = false;
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

function saveDroneCountSetting(count) {
  void setSetting(DRONE_COUNT_STORAGE_KEY, String(count));
}

function saveLimitedFeedbackSetting(isLimited) {
  void setSetting(LIMITED_FEEDBACK_STORAGE_KEY, isLimited ? "true" : "false");
}

function saveModeSelection(value) {
  void setSetting(LAST_MODE_STORAGE_KEY, String(value));
}

function saveRecallPrecisionSelection(value) {
  void setSetting(LAST_RECALL_PRECISION_KEY, String(value));
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
    limitedFeedbackStored,
    modeStored,
    precisionStored,
    chromaSetStored,
    answerSetStored,
    sequencingPolicyStored,
  ] = await Promise.all([
    getSetting(CUSTOM_CHROMA_STORAGE_KEY),
    getSetting(REDUCED_RANGE_STORAGE_KEY),
    getSetting(RANDOMIZE_BUTTON_ORDER_KEY),
    getSetting(DRONE_COUNT_STORAGE_KEY),
    getSetting(LIMITED_FEEDBACK_STORAGE_KEY),
    getSetting(LAST_MODE_STORAGE_KEY),
    getSetting(LAST_RECALL_PRECISION_KEY),
    getSetting(LAST_CHROMA_SET_KEY),
    getSetting(LAST_ANSWER_SET_KEY),
    getSetting(SEQUENCING_POLICY_STORAGE_KEY),
  ]);

  const parsedSelection = parseCustomChromaSelection(customSelectionStored);
  updateCustomChromaSet(parsedSelection, { shouldSelectCustom: false, skipSave: true });

  const resolvedLimitedFeedback = parseBooleanSetting(
    limitedFeedbackStored,
    limitedFeedbackEnabled
  );
  setLimitedFeedbackEnabled(resolvedLimitedFeedback, { skipSave: true });

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

  const resolvedChromaSet = normalizeStoredChromaSetValue(chromaSetStored);
  setActiveChromaSetByValue(resolvedChromaSet, { skipSave: true });

  const resolvedAnswerSet =
    typeof answerSetStored === "string" ? answerSetStored : activeAnswerSet;
  renderAnswerSetOptions({
    selectedValue: resolvedAnswerSet,
    exerciseType: getCurrentExerciseType(),
    skipSave: true,
  });

  const resolvedSequencingPolicy =
    typeof sequencingPolicyStored === "string" ? sequencingPolicyStored : sequencingPolicyValue;
  setSequencingPolicy(resolvedSequencingPolicy, { skipSave: true });
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
  resetSequencingHistory({ keepCommitted: false });
  pendingAfterWrongPolicy = false;
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

function getBandForMidi(midiNote, bands) {
  if (!bands || !Number.isFinite(midiNote)) return null;
  if (Number.isFinite(bands.lowMax) && midiNote <= bands.lowMax) {
    return "low";
  }
  if (Number.isFinite(bands.highMin) && midiNote >= bands.highMin) {
    return "high";
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDirectionBalanceWeights(historyEntries, balanceConfig) {
  if (!balanceConfig?.window) {
    return { up: 1, down: 1 };
  }
  const window = balanceConfig.window;
  const recent = historyEntries.slice(-window);
  const counts = recent.reduce(
    (acc, entry) => {
      if (entry?.direction === "up") acc.up += 1;
      if (entry?.direction === "down") acc.down += 1;
      return acc;
    },
    { up: 0, down: 0 }
  );
  const total = counts.up + counts.down;
  if (!total) return { up: 1, down: 1 };
  const desiredUp = balanceConfig.up ?? 0.5;
  const desiredDown = balanceConfig.down ?? 0.5;
  const upShare = counts.up / total;
  const downShare = counts.down / total;
  const upMultiplier = clamp(1 + (desiredUp - upShare), 0.4, 1.6);
  const downMultiplier = clamp(1 + (desiredDown - downShare), 0.4, 1.6);
  return { up: upMultiplier, down: downMultiplier };
}

function getDeltaWeight(absDelta, ranges = []) {
  if (!Number.isFinite(absDelta)) return 0;
  return ranges.reduce((weight, range) => {
    if (
      Number.isFinite(range?.min) &&
      Number.isFinite(range?.max) &&
      absDelta >= range.min &&
      absDelta <= range.max
    ) {
      return weight + (range.weight ?? 0);
    }
    return weight;
  }, 0);
}

function adjustCandidateToPitchClass(
  candidate,
  prevMidi,
  targetPitchClass,
  absRange,
  allowedRange,
  desiredDirection
) {
  const base = candidate;
  const basePc = ((base % 12) + 12) % 12;
  const diff = (targetPitchClass - basePc + 12) % 12;
  const offsets = [diff, diff - 12, diff + 12, diff - 24, diff + 24];

  for (const offset of offsets) {
    const note = base + offset;
    if (note < allowedRange.min || note > allowedRange.max) continue;
    const delta = note - prevMidi;
    const absDelta = Math.abs(delta);
    if (absDelta < absRange.min || absDelta > absRange.max) continue;
    if (desiredDirection) {
      if (desiredDirection === "up" && delta <= 0) continue;
      if (desiredDirection === "down" && delta >= 0) continue;
    }
    return { note, delta, absDelta };
  }
  return null;
}

function chooseWeightedIndex(weights = [], rng = Math.random) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return -1;
  let target = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    target -= weights[i];
    if (target <= 0) return i;
  }
  return weights.length - 1;
}

function chooseTargetPitchClass(allowedPitchClasses, weights = {}, historyEntries = [], policy) {
  if (!allowedPitchClasses?.length) return null;
  const historyWindow = policy?.targetPitchClassHistoryWindow ?? 0;
  const recentHistory =
    historyWindow > 0 ? historyEntries.slice(-historyWindow) : [];
  const recentCounts = recentHistory.reduce((acc, entry) => {
    if (Number.isInteger(entry?.targetPitchClass)) {
      acc[entry.targetPitchClass] = (acc[entry.targetPitchClass] ?? 0) + 1;
    }
    return acc;
  }, {});

  const candidateWeights = allowedPitchClasses.map((pitchClass) => {
    const label = getChromaLabelByIndex(pitchClass);
    const weightOverride =
      weights?.[label] ??
      weights?.[String(pitchClass)] ??
      weights?.[pitchClass] ??
      1;
    const count = recentCounts[pitchClass] ?? 0;
    const capMultiplier =
      historyWindow > 0 ? clamp(1 - count / historyWindow, 0.2, 1) : 1;
    return weightOverride * capMultiplier;
  });

  const index = chooseWeightedIndex(candidateWeights);
  if (index === -1) return allowedPitchClasses[0];
  return allowedPitchClasses[index];
}

function chooseNextMidiNote(
  prevMidi,
  targetPitchClass,
  policy,
  rng = Math.random,
  {
    historyEntries = [],
    range = midiRange,
    afterWrongActive = false,
  } = {}
) {
  const notesForPitchClass = notesByChroma[targetPitchClass] ?? [];
  if (!Number.isFinite(prevMidi)) {
    if (!notesForPitchClass.length) return null;
    const idx = Math.floor(rng() * notesForPitchClass.length);
    return {
      midiNote: notesForPitchClass[idx],
      absDeltaFromPrev: null,
      directionFromPrev: null,
      chosenBand: getBandForMidi(notesForPitchClass[idx], policy?.registerBands),
      fallbackUsed: false,
    };
  }

  const maxAttempts = policy?.maxAttemptsToFindCandidate ?? 40;
  const preferredRanges = policy?.preferredAbsDeltaRanges ?? [];
  const minAbsDelta = policy?.minAbsDelta ?? 0;
  const registerBands = policy?.registerBands ?? {};
  const afterWrongPolicy = policy?.afterWrongPolicy ?? {};
  const forceAbsDeltaMin = afterWrongActive
    ? afterWrongPolicy.forceAbsDeltaMin ?? 0
    : 0;
  const enforceBandSwitch =
    afterWrongActive && Boolean(afterWrongPolicy.forceBandSwitch);

  const prevBand = getBandForMidi(prevMidi, registerBands);
  const desiredBand =
    registerBands?.alternateBands && prevBand
      ? prevBand === "low"
        ? "high"
        : "low"
      : null;
  const directionWeights = getDirectionBalanceWeights(historyEntries, policy?.directionBalance);

  const attemptFind = ({ enforceBand, relaxMinAbsDelta }) => {
    const effectiveMinAbsDelta = relaxMinAbsDelta
      ? 0
      : Math.max(minAbsDelta, forceAbsDeltaMin);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const rangeWeights = preferredRanges.map((range) => range.weight ?? 0);
      const rangeIndex = chooseWeightedIndex(rangeWeights, rng);
      const rangeChoice =
        preferredRanges[rangeIndex] ??
        preferredRanges[0] ?? { min: 0, max: 127, weight: 1 };
      const absMin = Math.max(rangeChoice.min ?? 0, effectiveMinAbsDelta);
      const absMax = rangeChoice.max ?? 127;
      if (absMin > absMax) continue;

      const absDelta = Math.floor(rng() * (absMax - absMin + 1)) + absMin;
      const directionChoice =
        chooseWeightedIndex(
          [directionWeights.up ?? 1, directionWeights.down ?? 1],
          rng
        ) === 0
          ? "up"
          : "down";
      const signedDelta = directionChoice === "up" ? absDelta : -absDelta;
      const candidate = prevMidi + signedDelta;
      if (candidate < range.min || candidate > range.max) {
        continue;
      }

      const adjusted = adjustCandidateToPitchClass(
        candidate,
        prevMidi,
        targetPitchClass,
        { min: absMin, max: absMax },
        range,
        directionChoice
      );
      if (!adjusted) continue;

      const band = getBandForMidi(adjusted.note, registerBands);
      if (enforceBand) {
        const needsBand =
          enforceBandSwitch || Boolean(registerBands?.alternateBands);
        const requiredBand = enforceBandSwitch
          ? prevBand
            ? prevBand === "low"
              ? "high"
              : "low"
            : null
          : desiredBand;
        if (needsBand && requiredBand && band !== requiredBand) {
          continue;
        }
      }

      if (getDeltaWeight(adjusted.absDelta, preferredRanges) <= 0) {
        continue;
      }

      return {
        midiNote: adjusted.note,
        absDeltaFromPrev: adjusted.absDelta,
        directionFromPrev: adjusted.delta > 0 ? "up" : "down",
        chosenBand: band,
        fallbackUsed: false,
      };
    }
    return null;
  };

  let candidate = attemptFind({ enforceBand: true, relaxMinAbsDelta: false });
  if (candidate) return candidate;

  candidate = attemptFind({ enforceBand: false, relaxMinAbsDelta: false });
  if (candidate) {
    return { ...candidate, fallbackUsed: true };
  }

  candidate = attemptFind({ enforceBand: false, relaxMinAbsDelta: true });
  if (candidate) {
    return { ...candidate, fallbackUsed: true };
  }

  return null;
}

window.debugGenerateTrials = (count = 500) => {
  const total = Number.isFinite(count) ? Math.max(1, count) : 500;
  const policyName = getSequencingPolicyValue();
  const policy = getSequencingPreset(policyName);
  const allowedPitchClasses = activeChromaSet?.chromas?.map((chroma) => chroma.index) ?? [];
  const historyEntries = [];
  const absDeltaHistogram = new Map();
  const directionCounts = { up: 0, down: 0 };
  const bandCounts = { low: 0, high: 0 };
  const pitchClassCounts = new Map();
  let fallbackUsedCount = 0;
  let prevMidi = null;

  for (let i = 0; i < total; i += 1) {
    const targetPitchClass =
      policyName === "default"
        ? pickRandomChroma()
        : chooseTargetPitchClass(
            allowedPitchClasses,
            policy?.weakChromaWeights ?? {},
            historyEntries,
            policy
          );
    if (targetPitchClass == null) continue;

    let selection = null;
    if (policyName === "default") {
      const midiNote = pickRandomNote(targetPitchClass, prevMidi);
      const delta = Number.isFinite(prevMidi) ? midiNote - prevMidi : null;
      selection = {
        midiNote,
        absDeltaFromPrev: delta == null ? null : Math.abs(delta),
        directionFromPrev: delta == null ? null : delta > 0 ? "up" : "down",
        chosenBand: null,
        fallbackUsed: false,
      };
    } else {
      selection = chooseNextMidiNote(prevMidi, targetPitchClass, policy, Math.random, {
        historyEntries,
        range: midiRange,
        afterWrongActive: false,
      });
    }

    if (!selection) continue;
    const absDelta = selection.absDeltaFromPrev;
    if (Number.isFinite(absDelta)) {
      absDeltaHistogram.set(absDelta, (absDeltaHistogram.get(absDelta) ?? 0) + 1);
      if (selection.directionFromPrev === "up") directionCounts.up += 1;
      if (selection.directionFromPrev === "down") directionCounts.down += 1;
    }
    if (selection.chosenBand === "low") bandCounts.low += 1;
    if (selection.chosenBand === "high") bandCounts.high += 1;
    pitchClassCounts.set(
      targetPitchClass,
      (pitchClassCounts.get(targetPitchClass) ?? 0) + 1
    );
    if (selection.fallbackUsed) fallbackUsedCount += 1;

    historyEntries.push({
      direction: selection.directionFromPrev,
      band: selection.chosenBand,
      absDelta,
      targetPitchClass,
    });
    prevMidi = selection.midiNote;
  }

  const histogramEntries = Array.from(absDeltaHistogram.entries()).sort(
    (a, b) => a[0] - b[0]
  );
  const totalDirections = directionCounts.up + directionCounts.down;
  const totalBands = bandCounts.low + bandCounts.high;

  console.log("Sequencing debug summary", {
    policyName,
    totalTrials: total,
    absDeltaHistogram: histogramEntries,
    upDownRatio:
      totalDirections > 0 ? directionCounts.up / totalDirections : null,
    lowHighRatio: totalBands > 0 ? bandCounts.low / totalBands : null,
    pitchClassCounts: Array.from(pitchClassCounts.entries()).sort((a, b) => a[0] - b[0]),
    fallbackUsedPercent: total > 0 ? (fallbackUsedCount / total) * 100 : 0,
  });
};

async function startTrial(attempt = 0) {
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

  if (trial.sequencingHistoryEntry) {
    trial.sequencingHistoryEntry.planned = false;
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

  const trialSnapshot = currentTrial;
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
  const sequencingPolicyName =
    currentMode === "recognize" ? getSequencingPolicyValue() : "default";

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
    "Limited feedback": limitedFeedbackEnabled,
    Mode: getModeLabel(),
    "Recall precision": recallState?.precisionLabel || "",
    "Recall note": recallTargetLabel,
    isCorrect,
    sequencingPolicyName,
    absDeltaFromPrev: trialSnapshot?.absDeltaFromPrev ?? null,
    directionFromPrev: trialSnapshot?.directionFromPrev ?? null,
    isCompound: trialSnapshot?.isCompound ?? null,
    chosenBand: trialSnapshot?.chosenBand ?? null,
    fallbackUsed: trialSnapshot?.fallbackUsed ?? false,
  });

  refreshStatsIfOpen();

  if (!limitedFeedbackEnabled) {
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

  if (shouldFadeOut) {
    scheduleAudioFade(feedbackDuration);
  }

  if (currentMode === "recognize") {
    if (isSequencingActive() && !isCorrect) {
      pendingAfterWrongPolicy = true;
      clearPendingTrials();
    }
    preparePendingTrial();
  }

  if (!limitedFeedbackEnabled) {
    scheduleFeedbackReset(feedbackDuration);
    scheduleNextTrial(feedbackDuration);
    return;
  }

  if (!isCorrect) {
    playLimitedFeedbackSound();
  }

  scheduleNextTrial(feedbackDuration);
}

function cancelNextTrialTimeout() {
  if (nextTrialTimeout) {
    clearTimeout(nextTrialTimeout);
    nextTrialTimeout = null;
  }
}

function getSequencingSilenceDelay() {
  if (!isSequencingActive()) return 0;
  const preset = getActiveSequencingPreset();
  const delay = Number.parseInt(preset?.silenceMsBetweenTrials ?? 0, 10);
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

function scheduleNextTrial(feedbackDuration) {
  cancelNextTrialTimeout();
  const delayUntilNextTrial =
    (feedbackDuration ?? 0) + NEXT_TRIAL_DELAY + getSequencingSilenceDelay();
  nextTrialTimeout = setTimeout(() => {
    nextTrialTimeout = null;
    startTrial();
  }, delayUntilNextTrial);
  if (
    currentMode === "recognize" &&
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
  resetSequencingHistory({ keepCommitted: true });
}

async function preparePendingTrial() {
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

  const useSequencing = isSequencingActive();
  const policyName = getSequencingPolicyValue();
  const policy = getSequencingPreset(policyName);
  const allowedPitchClasses = activeChromaSet.chromas.map((chroma) => chroma.index);
  const chromaIndex = useSequencing
    ? chooseTargetPitchClass(
        allowedPitchClasses,
        policy?.weakChromaWeights ?? {},
        sequencingHistoryEntries,
        policy
      )
    : pickRandomChroma();
  if (chromaIndex === null) return null;

  let midiNote = null;
  let sequencingMeta = {
    sequencingPolicyName: policyName,
    absDeltaFromPrev: null,
    directionFromPrev: null,
    isCompound: null,
    chosenBand: null,
    fallbackUsed: false,
  };
  let sequencingEntry = null;

  if (useSequencing) {
    const afterWrongActive = pendingAfterWrongPolicy;
    const selection = chooseNextMidiNote(
      excludedMidiNote,
      chromaIndex,
      policy,
      Math.random,
      {
        historyEntries: sequencingHistoryEntries,
        range: midiRange,
        afterWrongActive,
      }
    );
    if (!selection) {
      return findPlayableTrial(attempt + 1, excludedMidiNote);
    }
    pendingAfterWrongPolicy = false;
    midiNote = selection.midiNote;
    sequencingMeta = {
      sequencingPolicyName: policyName,
      absDeltaFromPrev: selection.absDeltaFromPrev,
      directionFromPrev: selection.directionFromPrev,
      isCompound:
        selection.absDeltaFromPrev == null ? null : selection.absDeltaFromPrev >= 12,
      chosenBand: selection.chosenBand,
      fallbackUsed: selection.fallbackUsed,
    };
    sequencingEntry = {
      direction: selection.directionFromPrev,
      band: selection.chosenBand,
      absDelta: selection.absDeltaFromPrev,
      targetPitchClass: chromaIndex,
      planned: true,
    };
  } else {
    midiNote = pickRandomNote(chromaIndex, excludedMidiNote);
    if (Number.isFinite(excludedMidiNote) && Number.isFinite(midiNote)) {
      const delta = midiNote - excludedMidiNote;
      sequencingMeta.absDeltaFromPrev = Math.abs(delta);
      sequencingMeta.directionFromPrev = delta > 0 ? "up" : delta < 0 ? "down" : null;
      sequencingMeta.isCompound =
        sequencingMeta.absDeltaFromPrev == null
          ? null
          : sequencingMeta.absDeltaFromPrev >= 12;
    }
  }
  const instrument = await pickInstrumentForNote(midiNote);

  if (!instrument) {
    return findPlayableTrial(attempt + 1, excludedMidiNote);
  }

  const audioElement = await prepareAudioElement(instrument, midiNote);
  if (!audioElement) {
    return findPlayableTrial(attempt + 1, excludedMidiNote);
  }

  if (sequencingEntry) {
    addSequencingHistoryEntry(sequencingEntry);
  }

  return {
    chromaIndex,
    midiNote,
    instrument,
    audioElement,
    sequencingHistoryEntry: sequencingEntry,
    ...sequencingMeta,
  };
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
  setupSequencingControls();
  populateChromaSetSelect();
  populateAnswerSetSelect();
  setupReducedRangeToggle();
  setupRandomizeButtonsToggle();
  setupFeedbackToggle();
  setLimitedFeedbackEnabled(limitedFeedbackEnabled);
  setupDroneCountSelect();
  setupDroneResetButton();
  setupCustomChromaButton();
  updateModeVisibility();
  showStartButton();
  setupMidi();
  if (statsButton) {
    statsButton.addEventListener("click", toggleStatsPanel);
  }
  if (replayButton) {
    replayButton.addEventListener("click", handleReplayClick);
  }
  if (statsOutput) {
    statsOutput.textContent = "Select a chroma set to view stats.";
    statsOutput.hidden = true;
  }
  startDronePlayersForCurrentSet();
  await hydrateSavedSettings();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
