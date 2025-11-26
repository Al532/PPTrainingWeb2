const midiRange = { min: 36, max: 96 };
const CORRECT_FEEDBACK_DURATION = 400;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 0;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";
const FADE_DURATION_MS = 100;


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
  { name: "Tritones 1", notes: ["C", "F♯"] },
  { name: "Tritones 2", notes: ["C♯", "G"] },
  { name: "Tritones 3", notes: ["D", "A♭"] },
  { name: "Tritones 4", notes: ["E♭", "A"] },
  { name: "Tritones 5", notes: ["E", "B♭"] },
  { name: "Tritones 6", notes: ["F", "B"] },
  { name: "Thirds 1", notes: ["C", "E", "A♭"] },
  { name: "Thirds 2", notes: ["C♯", "F", "A"] },
  { name: "Thirds 3", notes: ["D", "F♯", "B♭"] },
  { name: "Thirds 4", notes: ["E♭", "G", "B"] },
  { name: "Minor thirds 1", notes: ["C", "E♭", "F♯", "A"] },
  { name: "Minor thirds 2", notes: ["C♯", "E", "G", "B♭"] },
  { name: "Minor thirds 3", notes: ["D", "F", "A♭", "B"] },
  { name: "Tones 1", notes: ["C", "D", "E", "F♯", "A♭", "B♭"] },
  { name: "Tones 2", notes: ["C♯", "E♭", "F", "G", "A", "B"] },
].map((set) => ({
  label: `${set.name}: ${set.notes.join(", ")}`,
  chromas: set.notes.map((note) => ({ label: note, index: chromaLookup[note] })),
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

const notesByChroma = buildNotesByChroma();
const availabilityCache = new Map();
let activeChromaSet = chromaSets[0];
let currentState = {
  chromaIndex: null,
  midiNote: null,
  awaitingGuess: false,
};
let feedbackResetTimeout = null;
let currentAudio = null;
let currentAudioGainNode = null;
let nextTrialTimeout = null;
let lastMidiNotePlayed = null;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let pendingTrial = null;
let pendingPreparationPromise = null;
let pendingPreparationToken = 0;

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

function buildNotesByChroma() {
  const buckets = Array.from({ length: 12 }, () => []);
  for (let note = midiRange.min; note <= midiRange.max; note += 1) {
    buckets[note % 12].push(note);
  }
  return buckets;
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
  fadeOutCurrentAudio();
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }
  resetButtonStates();
  currentState = { chromaIndex: null, midiNote: null, awaitingGuess: false };
  clearPendingTrial();
}

function handleStartClick() {
  createButtons();
  startTrial();
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

function pickRandomNote(chromaIndex) {
  const notes = notesByChroma[chromaIndex];
  const pool = notes.filter((note) => note !== lastMidiNotePlayed);
  const source = pool.length ? pool : notes;
  const idx = Math.floor(Math.random() * source.length);
  return source[idx];
}

async function startTrial(attempt = 0) {
  cancelNextTrialTimeout();
  resetButtonFocus();

  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    currentState.awaitingGuess = false;
    clearPendingTrial();
    return;
  }

  let trial = pendingTrial;
  pendingTrial = null;

  if (!trial) {
    trial = await findPlayableTrial(attempt);
  }

  if (!trial) {
    currentState.awaitingGuess = false;
    clearPendingTrial();
    return;
  }

  currentState = {
    chromaIndex: trial.chromaIndex,
    midiNote: trial.midiNote,
    awaitingGuess: true,
  };
  lastMidiNotePlayed = trial.midiNote;
  playPreparedTrial(trial);
  preparePendingTrial();
}

function playPreparedTrial(trial) {
  const { instrument, midiNote, audioElement } = trial;
  const context = getAudioContext();
  const audio = audioElement ?? new Audio(`assets/${instrument}/${midiNote}.wav`);
  audio.currentTime = 0;
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

function fadeOutCurrentAudio() {
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

function handleAnswer(chosenChroma, { shouldFadeOut = true } = {}) {

  if (!currentState.awaitingGuess) return;

  if (shouldFadeOut) {
    fadeOutCurrentAudio();
  }
  currentState.awaitingGuess = false;
  if (feedbackResetTimeout) {
    clearTimeout(feedbackResetTimeout);
    feedbackResetTimeout = null;
  }

  const isCorrect = chosenChroma === currentState.chromaIndex;
  const chosenButton = getChromaButton(chosenChroma);
  const correctButton = getChromaButton(currentState.chromaIndex);

  if (isCorrect) {
    chosenButton?.classList.add("correct");
  } else {
    chosenButton?.classList.add("incorrect");
    correctButton?.classList.add("correct");
  }

  const feedbackDuration = isCorrect
    ? CORRECT_FEEDBACK_DURATION
    : INCORRECT_FEEDBACK_DURATION;

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
  if (!pendingTrial && !pendingPreparationPromise) {
    preparePendingTrial();
  }
}

function clearPendingTrial() {
  pendingTrial = null;
  pendingPreparationPromise = null;
  pendingPreparationToken += 1;
}

async function preparePendingTrial() {
  if (pendingTrial) return pendingTrial;
  if (pendingPreparationPromise) return pendingPreparationPromise;

  const token = pendingPreparationToken;
  pendingPreparationPromise = (async () => {
    const trial = await findPlayableTrial();
    if (token !== pendingPreparationToken) {
      pendingPreparationPromise = null;
      return null;
    }
    pendingTrial = trial;
    pendingPreparationPromise = null;
    return trial;
  })();

  return pendingPreparationPromise;
}

async function findPlayableTrial(attempt = 0) {
  const MAX_ATTEMPTS = 30;
  if (!activeChromaSet || !activeChromaSet.chromas.length) return null;
  if (attempt >= MAX_ATTEMPTS) return null;

  const chromaIndex = pickRandomChroma();
  if (chromaIndex === null) return null;

  const midiNote = pickRandomNote(chromaIndex);
  const instrument = await pickInstrumentForNote(midiNote);

  if (!instrument) {
    return findPlayableTrial(attempt + 1);
  }

  const audioElement = await prepareAudioElement(instrument, midiNote);
  if (!audioElement) {
    return findPlayableTrial(attempt + 1);
  }

  return { chromaIndex, midiNote, instrument, audioElement };
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

function handleMidiMessage(message) {
  const [status, data1, data2] = message.data;
  const isNoteOn = (status & 0xf0) === 0x90 && data2 > 0;
  if (!isNoteOn) return;
  const chromaIndex = data1 % 12;

  handleAnswer(chromaIndex);
}

function init() {
  populateChromaSetSelect();
  showStartButton();
  setupMidi();
}

document.addEventListener("DOMContentLoaded", init);
