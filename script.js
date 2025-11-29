const BASE_MIDI_RANGE = { min: 36, max: 96 };
const CORRECT_FEEDBACK_DURATION = 400;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 0;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";
const TRIAL_LOG_STORAGE_KEY = "ppt-trial-log";
const FADE_DURATION_MS = 100;
const RECENT_ENTRIES = 1000;
const PREFETCH_TRIAL_COUNT = 10;


const chromas = [
  { label: "C", index: 0 },
  { label: "C♯", index: 1 },
  { label: "D", index: 2 },
  { label: "E♭", index: 3 },
  { label: "E", index: 4 },
  { label: "F", index: 5 },
  { label: "F♯", index: 6 },
  { label: "G", index: 7 },
  { label: "A♭", index: 8 },
  { label: "A", index: 9 },
  { label: "B♭", index: 10 },
  { label: "B", index: 11 },
];

const chromaLookup = {
  C: 0,
  "C♯": 1,
  Db: 1,
  D: 2,
  "D♯": 3,
  Eb: 3,
  "E♭": 3,
  E: 4,
  F: 5,
  "F♯": 6,
  Gb: 6,
  "G♭": 6,
  G: 7,
  "G♯": 8,
  Ab: 8,
  "A♭": 8,
  A: 9,
  "A♯": 10,
  Bb: 10,
  "B♭": 10,
  B: 11,
};

const chromaSets = [
  { name: "Tritones 1", exerciseType: "Tritones", notes: ["C", "F♯"] },
  { name: "Tritones 2", exerciseType: "Tritones", notes: ["C♯", "G"] },
  { name: "Tritones 3", exerciseType: "Tritones", notes: ["D", "A♭"] },
  { name: "Tritones 4", exerciseType: "Tritones", notes: ["E♭", "A"] },
  { name: "Tritones 5", exerciseType: "Tritones", notes: ["E", "B♭"] },
  { name: "Tritones 6", exerciseType: "Tritones", notes: ["F", "B"] },
  { name: "Thirds 1", exerciseType: "Thirds", notes: ["C", "E", "A♭"] },
  { name: "Thirds 2", exerciseType: "Thirds", notes: ["C♯", "F", "A"] },
  { name: "Thirds 3", exerciseType: "Thirds", notes: ["D", "F♯", "B♭"] },
  { name: "Thirds 4", exerciseType: "Thirds", notes: ["E♭", "G", "B"] },
  { name: "Minor thirds 1", exerciseType: "Minor thirds", notes: ["C", "E♭", "F♯", "A"] },
  { name: "Minor thirds 2", exerciseType: "Minor thirds", notes: ["C♯", "E", "G", "B♭"] },
  { name: "Minor thirds 3", exerciseType: "Minor thirds", notes: ["D", "F", "A♭", "B"] },
  { name: "Tones 1", exerciseType: "Tones", notes: ["C", "D", "E", "F♯", "A♭", "B♭"] },
  { name: "Tones 2", exerciseType: "Tones", notes: ["C♯", "E♭", "F", "G", "A", "B"] },
  {
    name: "Chromatic",
    exerciseType: "Chromatic",
    notes: chromas.map((chroma) => chroma.label),
  },
].map((set) => ({
  label: `${set.name}: ${set.notes.join(", ")}`,
  chromas: set.notes.map((note) => ({ label: note, index: chromaLookup[note] })),
  exerciseType: set.exerciseType,
}));

const instruments = [
  "Bassoon",
  "Cellos",
  "Clarinet",
  "Flute",
  "Harp",
  "Horn",
  "Oboe",
  "Piano",
  "Trumpet",
  "Violins",
];

const instrumentRanges = {
  Bassoon: { min: 36, max: 79 },
  Cellos: { min: 36, max: 80 },
  Clarinet: { min: 50, max: 92 },
  Flute: { min: 60, max: 96 },
  Harp: { min: 36, max: 96 },
  Horn: { min: 36, max: 79 },
  Oboe: { min: 58, max: 93 },
  Piano: { min: 36, max: 96 },
  Trumpet: { min: 52, max: 91 },
  Violins: { min: 55, max: 96 },
};


const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const chromaSetSelect = document.getElementById("chroma-set-select");
const statsButton = document.getElementById("stats-button");
const statsOutput = document.getElementById("stats-output");
const reducedRangeToggle = document.getElementById("reduced-range-toggle");
const specialExerciseToggle = document.getElementById("special-exercise-toggle");
const replayButton = document.getElementById("replay-button");

let midiRange = { ...BASE_MIDI_RANGE };
let reducedRangeEnabled = false;
let notesByChroma = buildNotesByChroma();
const availabilityCache = new Map();
let activeChromaSet = chromaSets[0];
let specialExerciseEnabled = false;
let activeTrial = null;
let currentState = {
  chromaIndex: null,
  midiNote: null,
  instrument: null,
  chromaSetLabel: "",
  exerciseType: "",
  awaitingGuess: false,
};
let feedbackResetTimeout = null;
let currentAudioElements = [];
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
let trialLog = [];
let nextTrialNumber = 1;

function formatTrialDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function loadTrialLog() {
  try {
    const serialized = localStorage.getItem(TRIAL_LOG_STORAGE_KEY);
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

function persistTrialLog() {
  try {
    localStorage.setItem(TRIAL_LOG_STORAGE_KEY, JSON.stringify(trialLog));
  } catch (error) {
    // Ignore storage errors to avoid disrupting the session.
  }
}

function logTrialResult(entry) {
  const trialDate = formatTrialDate(new Date());
  const logEntry = { ...entry, trialNumber: nextTrialNumber, trialDate };
  trialLog.push(logEntry);
  nextTrialNumber += 1;
  persistTrialLog();
}

function calculateAccuracy(entries) {
  if (!entries.length) return null;

  const correctCount = entries.reduce(
    (count, entry) => (entry?.isCorrect ? count + 1 : count),
    0
  );
  return Math.round((correctCount / entries.length) * 100);
}

function getExerciseTypeFromLabel(label = "") {
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

function getCurrentExerciseType() {
  return (
    activeChromaSet?.exerciseType || getExerciseTypeFromLabel(activeChromaSet?.label)
  );
}

function getTrialsForExercise(exerciseType) {
  if (!exerciseType) return [];

  return trialLog.filter((entry) => {
    const entryType = entry.exerciseType || getExerciseTypeFromLabel(entry.chromaSetLabel);
    return entryType === exerciseType;
  });
}

function renderStats() {
  if (!statsOutput) return;

  const totalTrials = trialLog.length;
  const todayString = formatTrialDate(new Date());
  const totalTrialsToday = trialLog.reduce(
    (count, entry) => (entry?.trialDate === todayString ? count + 1 : count),
    0
  );

  const exerciseType = getCurrentExerciseType();
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

  const entries = getTrialsForExercise(exerciseType);
  const totalExerciseTrials = entries.length;
  const overallAccuracy = calculateAccuracy(entries);
  const recentEntries = entries.slice(-RECENT_ENTRIES);
  const recentAccuracy =
    recentEntries.length === RECENT_ENTRIES ? calculateAccuracy(recentEntries) : null;

  const overallDisplay = overallAccuracy == null ? "-" : `${overallAccuracy}%`;
  const recentDisplay = recentAccuracy == null ? "-" : `${recentAccuracy}%`;

  statsOutput.innerHTML = `
    <div class="stats-block">
      <div class="stats-heading">Overview</div>
      <p><span class="muted">Total trials:</span> ${totalTrials}</p>
      <p><span class="muted">Total trials today:</span> ${totalTrialsToday}</p>
    </div>
    <div class="stats-block">
      <div class="stats-heading">${exerciseType}</div>
      <p><span class="muted">Total trials:</span> ${totalExerciseTrials}</p>
      <p><span class="muted">Overall accuracy:</span> ${overallDisplay}</p>
      <p><span class="muted">Last 1000 trials accuracy:</span> ${recentDisplay}</p>
    </div>
  `;
}

function refreshStatsIfOpen() {
  if (statsPanelOpen) {
    renderStats();
  }
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
  });
}

function setSpecialExerciseEnabled(isEnabled) {
  specialExerciseEnabled = Boolean(isEnabled);
  if (specialExerciseToggle) {
    specialExerciseToggle.checked = specialExerciseEnabled;
  }
  showStartButton();
}

function updateSpecialExerciseAvailability() {
  const available = Boolean(activeChromaSet?.chromas?.length >= 2);
  if (!specialExerciseToggle) return;

  specialExerciseToggle.disabled = !available;
  if (!available && specialExerciseEnabled) {
    setSpecialExerciseEnabled(false);
  }
}

function setupSpecialExerciseToggle() {
  if (!specialExerciseToggle) return;

  specialExerciseToggle.checked = specialExerciseEnabled;
  specialExerciseToggle.addEventListener("change", (event) => {
    setSpecialExerciseEnabled(event.target?.checked);
  });
}

function createButtons() {
  if (!activeChromaSet) return;

  buttonsContainer.innerHTML = "";
  activeChromaSet.chromas.forEach((chroma) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chroma";
    btn.textContent = chroma.label;
    btn.dataset.index = chroma.index;
    btn.addEventListener("click", () => handleAnswer(chroma.index));
    buttonsContainer.appendChild(btn);
  });
}

function setReplayButtonEnabled(isEnabled) {
  if (!replayButton) return;

  replayButton.disabled = !isEnabled;
}

function showStartButton() {
  resetTrialState();

  buttonsContainer.innerHTML = "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "start-button";
  btn.className = "start-button";
  btn.textContent = "START";
  btn.addEventListener("click", handleStartClick);
  buttonsContainer.appendChild(btn);
  preparePendingTrial();
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
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }
  resetButtonStates();
  activeTrial = null;
  currentState = {
    chromaIndex: null,
    midiNote: null,
    instrument: null,
    chromaSetLabel: "",
    exerciseType: "",
    awaitingGuess: false,
  };
  clearPendingTrials();
  setReplayButtonEnabled(false);
}

function handleStartClick() {
  createButtons();
  startTrial();
}

function replayCurrentTrial() {
  if (!activeTrial) return;

  fadeOutCurrentAudio();
  playPreparedTrial(activeTrial);
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

function populateChromaSetSelect() {
  chromaSets.forEach((set, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = set.label;
    chromaSetSelect.appendChild(option);
  });

  const savedIndex = loadSavedChromaSetIndex();
  activeChromaSet = chromaSets[savedIndex];
  chromaSetSelect.value = String(savedIndex);
  chromaSetSelect.addEventListener("change", handleChromaSetChange);
  updateSpecialExerciseAvailability();
}

function handleChromaSetChange(event) {
  const selectedIndex = Number(event.target.value);
  const selectedSet = chromaSets[selectedIndex];
  if (!selectedSet) return;
  activeChromaSet = selectedSet;
  saveChromaSetSelection(selectedIndex);
  showStartButton();
  refreshStatsIfOpen();
  updateSpecialExerciseAvailability();
}

function loadSavedChromaSetIndex() {
  try {
    const storedValue = localStorage.getItem(LAST_CHROMA_SET_KEY);
    const parsed = Number.parseInt(storedValue ?? "", 10);
    if (Number.isInteger(parsed) && chromaSets[parsed]) {
      return parsed;
    }
  } catch (error) {
    // Ignore storage errors and fall back to default.
  }

  return 0;
}

function saveChromaSetSelection(index) {
  try {
    localStorage.setItem(LAST_CHROMA_SET_KEY, String(index));
  } catch (error) {
    // Ignore storage errors; the selection just won't persist.
  }
}

async function checkSampleExists(instrument, midiNote) {
  const key = `${instrument}-${midiNote}`;
  if (availabilityCache.has(key)) {
    return availabilityCache.get(key);
  }

  try {
    const response = await fetch(`assets/${instrument}/${midiNote}.wav`, {
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

function pickRandomDistinctChromas(count) {
  if (!activeChromaSet || !activeChromaSet.chromas.length) return [];

  const available = [...activeChromaSet.chromas];
  const selected = [];
  for (let i = 0; i < count && available.length; i += 1) {
    const idx = Math.floor(Math.random() * available.length);
    const chroma = available.splice(idx, 1)[0];
    selected.push(chroma.index);
  }

  return selected;
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
    setReplayButtonEnabled(false);
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
        ? pendingTrials[pendingTrials.length - 1].targetMidiNote
        : lastMidiNotePlayed;
    trial = await findPlayableTrial(attempt, lastQueuedNote);
  }

  if (!trial) {
    currentState.awaitingGuess = false;
    clearPendingTrials();
    setReplayButtonEnabled(false);
    return;
  }

  activeTrial = trial;
  currentState = {
    chromaIndex: trial.targetChromaIndex,
    midiNote: trial.targetMidiNote,
    instrument: trial.targetInstrument,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: activeChromaSet?.exerciseType ?? "",
    awaitingGuess: true,
  };
  lastMidiNotePlayed = trial.targetMidiNote;
  playPreparedTrial(trial);
  setReplayButtonEnabled(true);
  preparePendingTrial();
}

function playPreparedTrial(trial) {
  const context = getAudioContext();
  const audios = trial.notes.map((note) => {
    const baseAudio = note.audioElement;
    const audio =
      baseAudio?.cloneNode(true) ||
      new Audio(`assets/${note.instrument}/${note.midiNote}.wav`);
    audio.currentTime = 0;
    return audio;
  });

  if (context) {
    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(1, context.currentTime);

    audios.forEach((audio) => {
      const source = context.createMediaElementSource(audio);
      source.connect(gainNode);
    });

    gainNode.connect(context.destination);
    currentAudioGainNode = gainNode;
  } else {
    currentAudioGainNode = null;
  }

  currentAudioElements = audios;

  audios.forEach((audio) => {
    audio.play().catch(() => {
      // Fail silently to avoid on-screen feedback.
    });
  });
}

function fadeOutCurrentAudio() {
  cancelScheduledFade();
  const audios = currentAudioElements;
  const gainNode = currentAudioGainNode;
  if (!audios?.length) return;

  if (!gainNode) {
    audios.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    currentAudioElements = [];
    return;
  }

  const context = getAudioContext();
  const fadeDurationSeconds = FADE_DURATION_MS / 1000;
  const now = context.currentTime;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + fadeDurationSeconds);

  const cleanup = () => {
    audios.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    gainNode.disconnect();
    currentAudioElements = [];
    currentAudioGainNode = null;
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
  if (!currentAudioElements.length) return;

  cancelScheduledFade();

  const fadeDelay = Math.max((feedbackDuration ?? 0) - FADE_DURATION_MS, 0);

  fadeTimeout = setTimeout(() => {
    fadeTimeout = null;
    fadeOutCurrentAudio();
  }, fadeDelay);
}

function handleAnswer(chosenChroma, { shouldFadeOut = true } = {}) {

  if (!currentState.awaitingGuess) return;

  currentState.awaitingGuess = false;
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }

  const isCorrect = chosenChroma === currentState.chromaIndex;
  const chosenButton = getChromaButton(chosenChroma);
  const correctButton = getChromaButton(currentState.chromaIndex);

  logTrialResult({
    chromaSetLabel: currentState.chromaSetLabel,
    targetChromaLabel: getChromaLabelByIndex(currentState.chromaIndex),
    midiNote: currentState.midiNote,
    instrument: currentState.instrument,
    userSelectedChroma: getChromaLabelByIndex(chosenChroma),
    exerciseType: currentState.exerciseType || getCurrentExerciseType(),
    reducedRangeEnabled,
    specialExerciseEnabled,
    isCorrect,
  });

  refreshStatsIfOpen();

  if (isCorrect) {
    chosenButton?.classList.add("correct");
  } else {
    chosenButton?.classList.add("incorrect");
    correctButton?.classList.add("correct");
  }

  const feedbackDuration = isCorrect
    ? CORRECT_FEEDBACK_DURATION
    : INCORRECT_FEEDBACK_DURATION;

  if (shouldFadeOut) {
    scheduleAudioFade(feedbackDuration);
  }

  preparePendingTrial();
  scheduleFeedbackReset(feedbackDuration);
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
        ? pendingTrials[pendingTrials.length - 1].targetMidiNote
        : lastMidiNotePlayed;
    while (pendingTrials.length < PREFETCH_TRIAL_COUNT) {
      const trial = await findPlayableTrial(0, lastQueuedNote);
      if (token !== pendingPreparationToken) {
        pendingPreparationPromise = null;
        return null;
      }
      if (!trial) break;
      pendingTrials.push(trial);
      lastQueuedNote = trial.targetMidiNote;
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

  const buildTrialFromNotes = (notes) => {
    const targetNote = notes.reduce((lowest, note) =>
      lowest && lowest.midiNote < note.midiNote ? lowest : note
    );
    return {
      notes,
      targetChromaIndex: targetNote.chromaIndex,
      targetMidiNote: targetNote.midiNote,
      targetInstrument: targetNote.instrument,
    };
  };

  if (specialExerciseEnabled) {
    const chromaIndices = pickRandomDistinctChromas(2);
    if (chromaIndices.length < 2) return null;

    const preparedNotes = [];
    for (const chromaIndex of chromaIndices) {
      const midiNote = pickRandomNote(chromaIndex, excludedMidiNote);
      const instrument = await pickInstrumentForNote(midiNote);
      if (!instrument) {
        return findPlayableTrial(attempt + 1, excludedMidiNote);
      }

      const audioElement = await prepareAudioElement(instrument, midiNote);
      if (!audioElement) {
        return findPlayableTrial(attempt + 1, excludedMidiNote);
      }

      preparedNotes.push({ chromaIndex, midiNote, instrument, audioElement });
    }

    return buildTrialFromNotes(preparedNotes);
  }

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

  return buildTrialFromNotes([{ chromaIndex, midiNote, instrument, audioElement }]);
}

async function prepareAudioElement(instrument, midiNote) {
  const src = `assets/${instrument}/${midiNote}.wav`;
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

function setupReplayButton() {
  if (!replayButton) return;

  replayButton.addEventListener("click", replayCurrentTrial);
}

function handleMidiMessage(message) {
  const [status, data1, data2] = message.data;
  const isNoteOn = (status & 0xf0) === 0x90 && data2 > 0;
  if (!isNoteOn) return;
  const chromaIndex = data1 % 12;

  handleAnswer(chromaIndex);
}

function init() {
  loadTrialLog();
  populateChromaSetSelect();
  setupReducedRangeToggle();
  setupSpecialExerciseToggle();
  setupReplayButton();
  showStartButton();
  setupMidi();
  if (statsButton) {
    statsButton.addEventListener("click", toggleStatsPanel);
  }
  if (statsOutput) {
    statsOutput.textContent = "Select a chroma set to view stats.";
    statsOutput.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", init);
