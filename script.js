import {
  BASE_MIDI_RANGE,
  chromas,
  chromaLookup,
  chromaSets,
  instruments,
  instrumentRanges,
} from "./data/music.js";
import {
  getExerciseTypeFromLabel,
  loadTrialLog,
  logTrialResult,
  refreshStatsIfOpen as refreshStatsIfOpenUtil,
  renderStats as renderStatsUtil,
} from "./src/utils/stats.js";
const CORRECT_FEEDBACK_DURATION = 400;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 0;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";
const TRIAL_LOG_STORAGE_KEY = "ppt-trial-log";
const FADE_DURATION_MS = 100;
const RECENT_ENTRIES = 1000;
const PREFETCH_TRIAL_COUNT = 10;
// Toggle between "mp3" or "wav" to switch the asset set without exposing UI controls.
const DEFAULT_AUDIO_FORMAT = "mp3";


const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const chromaSetSelect = document.getElementById("chroma-set-select");
const statsButton = document.getElementById("stats-button");
const statsOutput = document.getElementById("stats-output");
const reducedRangeToggle = document.getElementById("reduced-range-toggle");
const replayButton = document.getElementById("replay-button");

let midiRange = { ...BASE_MIDI_RANGE };
let reducedRangeEnabled = false;
let notesByChroma = buildNotesByChroma();
const availabilityCache = new Map();
let activeChromaSet = chromaSets[0];
let audioFormat = DEFAULT_AUDIO_FORMAT;
let currentState = {
  chromaIndex: null,
  midiNote: null,
  instrument: null,
  chromaSetLabel: "",
  exerciseType: "",
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
const audioFormats = {
  mp3: { label: "MP3", folder: "MP3", extension: "mp3" },
  wav: { label: "WAV", folder: "WAV", extension: "wav" },
};

function getCurrentExerciseType() {
  return (
    activeChromaSet?.exerciseType || getExerciseTypeFromLabel(activeChromaSet?.label)
  );
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
  });
}

function getAudioFormatConfig(format = audioFormat) {
  return audioFormats[format] ?? audioFormats.mp3;
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
    awaitingGuess: false,
  };
  clearPendingTrials();
}

function handleStartClick() {
  createButtons();
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
}

function handleChromaSetChange(event) {
  const selectedIndex = Number(event.target.value);
  const selectedSet = chromaSets[selectedIndex];
  if (!selectedSet) return;
  activeChromaSet = selectedSet;
  saveChromaSetSelection(selectedIndex);
  showStartButton();
  refreshStatsIfOpen();
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

  currentState = {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    instrument: trial.instrument,
    chromaSetLabel: activeChromaSet?.label ?? "",
    exerciseType: activeChromaSet?.exerciseType ?? "",
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

function handleAnswer(chosenChroma, { shouldFadeOut = true } = {}) {

  if (!currentState.awaitingGuess) return;

  currentState.awaitingGuess = false;
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
      reducedRangeEnabled,
      isCorrect,
    },
    { storageKey: TRIAL_LOG_STORAGE_KEY }
  );

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

function init() {
  loadTrialLog(TRIAL_LOG_STORAGE_KEY);
  populateChromaSetSelect();
  setupReducedRangeToggle();
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
}

document.addEventListener("DOMContentLoaded", init);
