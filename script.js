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
const CORRECT_FEEDBACK_DURATION = 400;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 0;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";
const LAST_ANSWER_SET_KEY = "ppt-last-answer-set";
const CUSTOM_CHROMA_STORAGE_KEY = "ppt-custom-chromas";
const TRIAL_LOG_STORAGE_KEY = "ppt-trial-log";
const REDUCED_RANGE_STORAGE_KEY = "ppt-reduced-range-enabled";
const RANDOMIZE_BUTTON_ORDER_KEY = "ppt-randomize-buttons";
const RANDOMIZE_BUTTON_ORDER_REROLL_INTERVAL = 5;
const FADE_DURATION_MS = 100;
const DRONE_CROSSFADE_START_MS = 2000;
const DRONE_CROSSFADE_DURATION_MS = 300;
const DRONE_RESTART_OFFSET_MS = 150;
const DRONE_MIDI_START = 48;
const DRONE_MIDI_END = 59;
const DRONE_AUDIO_EXTENSION = "mp3";
const RECENT_ENTRIES = 1000;
const PREFETCH_TRIAL_COUNT = 10;
// Toggle between "mp3" or "wav" to switch the asset set without exposing UI controls.
const DEFAULT_AUDIO_FORMAT = "mp3";
const CRYPTIC_WORDS = [
  "ba",
  "be",
  "bi",
  "bo",
  "bu",
  "ca",
  "ce",
  "ci",
  "co",
  "cu",
  "da",
  "de",
  "di",
  "du",
  "fe",
  "fi",
  "fo",
  "fu",
  "ga",
  "ge",
  "gi",
  "go",
  "gu",
  "ha",
  "he",
  "hi",
  "ho",
  "hu",
  "ja",
  "je",
  "ji",
  "jo",
  "ju",
  "ka",
  "ke",
  "ki",
  "ko",
  "ku",
  "le",
  "li",
  "lo",
  "lu",
  "ma",
  "me",
  "mo",
  "mu",
  "na",
  "ne",
  "ni",
  "no",
  "nu",
  "pa",
  "pe",
  "pi",
  "po",
  "pu",
  "qa",
  "qe",
  "qi",
  "qo",
  "qu",
  "ra",
  "ri",
  "ro",
  "ru",
  "sa",
  "se",
  "so",
  "su",
  "ta",
  "te",
  "ti",
  "to",
  "tu",
  "va",
  "ve",
  "vi",
  "vo",
  "vu",
  "wa",
  "we",
  "wi",
  "wo",
  "wu",
  "xa",
  "xe",
  "xi",
  "xo",
  "xu",
  "za",
  "ze",
  "zi",
  "zo",
  "zu",
];

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


const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const chromaSetSelect = document.getElementById("chroma-set-select");
const answerSetSelect = document.getElementById("answer-set-select");
const droneCountSelect = document.getElementById("drone-count-select");
const customChromaButton = document.getElementById("custom-chroma-button");
const customChromaButtons = document.getElementById("custom-chroma-buttons");
const customChromaPicker = document.getElementById("custom-chroma-picker");
const customChromaRow = document.getElementById("custom-chroma-row");
const statsButton = document.getElementById("stats-button");
const statsOutput = document.getElementById("stats-output");
const reducedRangeToggle = document.getElementById("reduced-range-toggle");
const randomizeButtonsToggle = document.getElementById("randomize-buttons-toggle");
const feedbackToggle = document.getElementById("feedback-toggle");
// const crypticToggle = document.getElementById("cryptic-toggle");
const replayButton = document.getElementById("replay-button");
const replayRow = document.getElementById("replay-row");

let reducedRangeEnabled = loadSavedReducedRangeSetting();
let midiRange = getRangeForSetting(reducedRangeEnabled);
let notesByChroma = buildNotesByChroma(midiRange);
const availabilityCache = new Map();
const CUSTOM_CHROMA_SET_VALUE = "custom";
let activeChromaSet = chromaSets[0];
let activeChromaSetValue = "0";
let activeAnswerSet = loadSavedAnswerSet();
let randomizeButtonsEnabled = loadSavedRandomizeButtonsSetting();
let randomizedButtonOrder = [];
let randomizedButtonOrderTrialCount = 0;
let customChromaSelection = loadSavedCustomChromaSelection();
let customChromaSet = buildCustomChromaSet(customChromaSelection);
let isCustomSelectionOpen = false;
let pendingCustomSelection = new Set(customChromaSelection);
let audioFormat = DEFAULT_AUDIO_FORMAT;
let crypticModeEnabled = false;
let crypticAssignments = new Map();
let crypticButtonOrder = [];
let lastClickedChromaIndex = null;
let limitedFeedbackEnabled = false;
let selectedDroneCount = 0;
let dronePlayers = [];
let currentState = {
  chromaIndex: null,
  midiNote: null,
  instrument: null,
  chromaSetLabel: "",
  exerciseType: "",
  answerSet: "",
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
  return (
    normalizeExerciseType(
      activeChromaSet?.exerciseType || getExerciseTypeFromLabel(activeChromaSet?.label)
    )
  );
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

const renderStats = () =>
  renderStatsUtil({
    statsOutput,
    getCurrentExerciseType,
    recentEntriesCount: RECENT_ENTRIES,
  });

function refreshStatsIfOpen() {
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

function setLimitedFeedbackEnabled(isEnabled) {
  limitedFeedbackEnabled = Boolean(isEnabled);
  if (feedbackToggle) {
    feedbackToggle.checked = limitedFeedbackEnabled;
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

function setupDroneCountSelect() {
  if (!droneCountSelect) return;
  populateDroneCountSelect();
  droneCountSelect.addEventListener("change", handleDroneCountChange);
}

// function setupCrypticToggle() {
//   if (!crypticToggle) return;

//   crypticToggle.checked = crypticModeEnabled;
//   crypticToggle.addEventListener("change", (event) => {
//     applyCrypticMode(event.target?.checked);
//   });
// }

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

function resetCrypticAssignments() {
  crypticAssignments = new Map();
  crypticButtonOrder = [];
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

  // Cryptic mode disabled.
  resetCrypticAssignments();

  buttonsContainer.innerHTML = "";
  const chromaByIndex = new Map(
    chromasForButtons.map((chroma) => [chroma.index, chroma])
  );

  // const chromaOrder = crypticModeEnabled
  //   ? crypticButtonOrder
  //   : chromasForButtons.map((chroma) => chroma.index);
  const chromaOrder = getChromaOrderForButtons(chromasForButtons);

  chromaOrder.forEach((chromaIndex) => {
    const chroma = chromaByIndex.get(chromaIndex);
    if (!chroma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chroma";
    // btn.textContent = crypticModeEnabled
    //   ? crypticAssignments.get(chroma.index)
    //   : chroma.label;
    btn.textContent = chroma.label;
    btn.dataset.index = chroma.index;
    btn.addEventListener("click", () => handleAnswer(chroma.index));
    buttonsContainer.appendChild(btn);
  });
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
  preparePendingTrial();
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
    answerSet: "",
    awaitingGuess: false,
  };
  clearPendingTrials();
}

function refreshButtonOrder() {
  if (!currentState.awaitingGuess || currentState.chromaIndex == null) return;

  const chromasForButtons = getChromasForTrial(currentState.chromaIndex);
  createButtons(chromasForButtons);
}

function handleStartClick() {
  startTrial();
}

function updateReplayAvailability() {
  if (!replayButton) return;

  const canReplay =
    currentState.awaitingGuess &&
    currentTrial?.instrument &&
    Number.isFinite(currentTrial?.midiNote);

  replayButton.disabled = !canReplay;
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

function loadSavedCustomChromaSelection() {
  try {
    const storedValue = localStorage.getItem(CUSTOM_CHROMA_STORAGE_KEY);
    if (storedValue) {
      const parsed = JSON.parse(storedValue);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isInteger(value))
          .sort((a, b) => a - b);
      }
    }
  } catch (error) {
    // Ignore storage errors and fall back to defaults.
  }

  return chromas.map((chroma) => chroma.index);
}

function saveCustomChromaSelection(selection) {
  try {
    localStorage.setItem(CUSTOM_CHROMA_STORAGE_KEY, JSON.stringify(selection));
  } catch (error) {
    // Ignore storage errors; the selection just won't persist.
  }
}

function loadSavedReducedRangeSetting() {
  try {
    const storedValue = localStorage.getItem(REDUCED_RANGE_STORAGE_KEY);
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
  } catch (error) {
    // Ignore storage errors and fall back to defaults.
  }

  return false;
}

function loadSavedRandomizeButtonsSetting() {
  try {
    const storedValue = localStorage.getItem(RANDOMIZE_BUTTON_ORDER_KEY);
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
  } catch (error) {
    // Ignore storage errors and fall back to defaults.
  }

  return false;
}

function saveReducedRangeSetting(isReduced) {
  try {
    localStorage.setItem(REDUCED_RANGE_STORAGE_KEY, isReduced ? "true" : "false");
  } catch (error) {
    // Ignore storage errors; the setting just won't persist.
  }
}

function saveRandomizeButtonsSetting(isRandomized) {
  try {
    localStorage.setItem(RANDOMIZE_BUTTON_ORDER_KEY, isRandomized ? "true" : "false");
  } catch (error) {
    // Ignore storage errors; the setting just won't persist.
  }
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

function renderAnswerSetOptions({ selectedValue = activeAnswerSet, exerciseType } = {}) {
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
  saveAnswerSetSelection(resolvedValue);
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

function loadSavedChromaSetValue() {
  try {
    const storedValue = localStorage.getItem(LAST_CHROMA_SET_KEY);
    if (storedValue === CUSTOM_CHROMA_SET_VALUE) {
      return storedValue;
    }

    const parsed = Number.parseInt(storedValue ?? "", 10);
    if (Number.isInteger(parsed) && chromaSets[parsed]) {
      return String(parsed);
    }
  } catch (error) {
    // Ignore storage errors and fall back to default.
  }

  return "0";
}

function loadSavedAnswerSet() {
  try {
    const storedValue = localStorage.getItem(LAST_ANSWER_SET_KEY);
    if (storedValue && ANSWER_SET_TYPES.includes(storedValue)) {
      return storedValue;
    }
  } catch (error) {
    // Ignore storage errors and fall back to default.
  }

  return "Auto";
}

function saveChromaSetSelection(value) {
  try {
    localStorage.setItem(LAST_CHROMA_SET_KEY, String(value));
  } catch (error) {
    // Ignore storage errors; the selection just won't persist.
  }
}

function saveAnswerSetSelection(value) {
  try {
    localStorage.setItem(LAST_ANSWER_SET_KEY, value);
  } catch (error) {
    // Ignore storage errors; the selection just won't persist.
  }
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
  renderAnswerSetOptions({ exerciseType: getCurrentExerciseType() });
  resetCrypticAssignments();
  populateDroneCountSelect({ selectedCount: selectedDroneCount });
  startDronePlayersForCurrentSet();
  if (!skipSave) {
    saveChromaSetSelection(resolvedValue);
  }
  showStartButton();
  refreshStatsIfOpen();
}

function populateChromaSetSelect() {
  const savedValue = loadSavedChromaSetValue();
  renderChromaSetOptions(savedValue);
  chromaSetSelect.addEventListener("change", handleChromaSetChange);
}

function populateAnswerSetSelect() {
  renderAnswerSetOptions();
  if (answerSetSelect) {
    answerSetSelect.addEventListener("change", handleAnswerSetChange);
  }
}

function updateCustomChromaSet(selection, { shouldSelectCustom = true } = {}) {
  customChromaSelection = Array.from(
    new Set(
      selection.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < chromas.length
      )
    )
  ).sort((a, b) => a - b);
  pendingCustomSelection = new Set(customChromaSelection);
  customChromaSet = buildCustomChromaSet(customChromaSelection);
  saveCustomChromaSelection(customChromaSelection);
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

async function startTrial(attempt = 0) {
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

  const trialChromas = getChromasForTrial(trial.chromaIndex);
  createButtons(trialChromas);

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

function replayCurrentTrial() {
  if (!currentState.awaitingGuess || !currentTrial) return;

  playPreparedTrial(currentTrial);
}

function handleReplayClick() {
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

  logTrialResult(
    {
      chromaSetLabel: currentState.chromaSetLabel,
      targetChromaLabel: getChromaLabelByIndex(currentState.chromaIndex),
      midiNote: currentState.midiNote,
      instrument: currentState.instrument,
      userSelectedChroma: getChromaLabelByIndex(chosenChroma),
      exerciseType: currentState.exerciseType || getCurrentExerciseType(),
      answerSet: currentState.answerSet || activeAnswerSet,
      reducedRangeEnabled,
      "Limited feedback": limitedFeedbackEnabled,
      isCorrect,
    },
    { storageKey: TRIAL_LOG_STORAGE_KEY }
  );

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

  preparePendingTrial();

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

function scheduleNextTrial(feedbackDuration) {
  cancelNextTrialTimeout();
  const delayUntilNextTrial = (feedbackDuration ?? 0) + NEXT_TRIAL_DELAY;
  nextTrialTimeout = setTimeout(() => {
    nextTrialTimeout = null;
    startTrial();
  }, delayUntilNextTrial);
  if (pendingTrials.length < PREFETCH_TRIAL_COUNT && !pendingPreparationPromise) {
    preparePendingTrial();
  }
}

function clearPendingTrials() {
  pendingTrials = [];
  pendingPreparationPromise = null;
  pendingPreparationToken += 1;
}

async function preparePendingTrial() {
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
  const chromaIndex = data1 % 12;

  handleAnswer(chromaIndex);
}

function getDroneAudioSrc(chromaIndex) {
  const clampedIndex = Math.max(0, Math.min(chromaIndex, DRONE_MIDI_END - DRONE_MIDI_START));
  const midiNote = DRONE_MIDI_START + clampedIndex;
  return `assets/Drones/${midiNote}.${DRONE_AUDIO_EXTENSION}`;
}

function getMaxDroneCount() {
  return activeChromaSet?.chromas?.length ?? 0;
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
}

function stopDronePlayers() {
  dronePlayers.forEach((player) => {
    if (player.crossfadeTimeout) {
      clearTimeout(player.crossfadeTimeout);
    }
    if (player.instance) {
      cleanupDroneInstance(player.instance);
    }
    if (player.fallbackAudio) {
      player.fallbackAudio.pause();
      player.fallbackAudio.currentTime = 0;
    }
  });
  dronePlayers = [];
}

function startDronePlayersForCurrentSet() {
  stopDronePlayers();
  if (!selectedDroneCount) return;
  const availableChromas = activeChromaSet?.chromas?.map((chroma) => chroma.index) ?? [];
  const requested = Math.min(selectedDroneCount, availableChromas.length);
  if (!requested) return;
  const chosen = shuffleArray(availableChromas).slice(0, requested);
  chosen.forEach((chromaIndex) => {
    const player = createDronePlayer(chromaIndex);
    if (player) {
      dronePlayers.push(player);
    }
  });
}

function setDroneCount(count) {
  const maxCount = getMaxDroneCount();
  const resolved = Number.isFinite(count)
    ? Math.max(0, Math.min(count, maxCount))
    : 0;
  selectedDroneCount = resolved;
  if (droneCountSelect) {
    droneCountSelect.value = String(resolved);
  }
  startDronePlayersForCurrentSet();
}

function handleDroneCountChange(event) {
  const count = Number.parseInt(event.target.value, 10);
  setDroneCount(count);
}

function createEqualPowerCurve(isFadeIn, steps = 32) {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    curve[i] = isFadeIn ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
  }
  return curve;
}

function applyEqualPowerFade(gainNode, startTime, durationSeconds, isFadeIn) {
  const curve = createEqualPowerCurve(isFadeIn);
  gainNode.gain.cancelScheduledValues(startTime);
  gainNode.gain.setValueAtTime(isFadeIn ? 0 : 1, startTime);
  if (durationSeconds > 0) {
    gainNode.gain.setValueCurveAtTime(curve, startTime, durationSeconds);
  }
}

function cleanupDroneInstance(instance) {
  if (!instance) return;
  instance.audio.pause();
  instance.audio.currentTime = 0;
  instance.gain.disconnect();
  instance.source.disconnect();
}

function createDroneInstance({ src, offsetSeconds = 0, fadeInDurationMs = 0 }) {
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
    applyEqualPowerFade(gain, now, fadeDurationSeconds, true);
  } else {
    gain.gain.setValueAtTime(1, now);
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
  applyEqualPowerFade(currentInstance.gain, now, fadeDurationSeconds, false);

  const nextInstance = createDroneInstance({
    src: player.src,
    offsetSeconds: DRONE_RESTART_OFFSET_MS / 1000,
    fadeInDurationMs: DRONE_CROSSFADE_DURATION_MS,
  });

  player.instance = nextInstance;

  setTimeout(() => {
    cleanupDroneInstance(currentInstance);
  }, DRONE_CROSSFADE_DURATION_MS);

  scheduleDroneCrossfade(player);
}

function createDronePlayer(chromaIndex) {
  const src = getDroneAudioSrc(chromaIndex);
  const context = getAudioContext();
  if (!context) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = "auto";
    audio.play().catch(() => {
      // Ignore autoplay errors; the drone will start once playback is allowed.
    });
    return { src, chromaIndex, fallbackAudio: audio, instance: null, crossfadeTimeout: null };
  }

  const instance = createDroneInstance({
    src,
    offsetSeconds: 0,
    fadeInDurationMs: 0,
  });
  if (!instance) return null;
  const player = { src, chromaIndex, instance, crossfadeTimeout: null };
  scheduleDroneCrossfade(player);
  return player;
}

function init() {
  loadTrialLog(TRIAL_LOG_STORAGE_KEY);
  populateChromaSetSelect();
  populateAnswerSetSelect();
  setupReducedRangeToggle();
  setupRandomizeButtonsToggle();
  setupFeedbackToggle();
  setupDroneCountSelect();
  // setupCrypticToggle();
  setupCustomChromaButton();
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
}

document.addEventListener("DOMContentLoaded", init);
