const chromas = [
  { label: "C", index: 0 },
  { label: "C#", index: 1 },
  { label: "D", index: 2 },
  { label: "Eb", index: 3 },
  { label: "E", index: 4 },
  { label: "F", index: 5 },
  { label: "F#", index: 6 },
  { label: "G", index: 7 },
  { label: "Ab", index: 8 },
  { label: "A", index: 9 },
  { label: "Bb", index: 10 },
  { label: "B", index: 11 },
];

const chromaLookup = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const chromaSets = [
  { name: "Thirds 1", notes: ["C", "E", "Ab"] },
  { name: "Thirds 2", notes: ["C#", "F", "A"] },
  { name: "Thirds 3", notes: ["D", "F#", "Bb"] },
  { name: "Thirds 4", notes: ["Eb", "G", "B"] },
  { name: "Minor thirds 1", notes: ["C", "Eb", "F#", "A"] },
  { name: "Minor thirds 2", notes: ["C#", "E", "G", "Bb"] },
  { name: "Minor thirds 3", notes: ["D", "F", "Ab", "B"] },
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

const midiRange = { min: 36, max: 96 };
const CORRECT_FEEDBACK_DURATION = 800;
const INCORRECT_FEEDBACK_DURATION = 1500;
const NEXT_TRIAL_DELAY = 300;
const LAST_CHROMA_SET_KEY = "ppt-last-chroma-set";

const buttonsContainer = document.getElementById("chroma-buttons");
const midiStatusEl = document.getElementById("midi-status");
const chromaSetSelect = document.getElementById("chroma-set-select");

const notesByChroma = buildNotesByChroma();
let instrumentAvailabilityPromise = null;
let activeChromaSet = chromaSets[0];
let currentState = {
  chromaIndex: null,
  midiNote: null,
  awaitingGuess: false,
};
let feedbackResetTimeout = null;
let currentAudio = null;
let nextTrialTimeout = null;
let lastMidiNotePlayed = null;

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

async function loadInstrumentAvailability() {
  if (instrumentAvailabilityPromise) return instrumentAvailabilityPromise;

  instrumentAvailabilityPromise = buildAvailabilityManifest();
  return instrumentAvailabilityPromise;
}

async function buildAvailabilityManifest() {
  const availability = {};

  for (const instrument of instruments) {
    const availableNotes = new Set();
    for (let midiNote = midiRange.min; midiNote <= midiRange.max; midiNote += 1) {
      const exists = await sampleExists(instrument, midiNote);
      if (exists) {
        availableNotes.add(midiNote);
      }
    }
    if (availableNotes.size) {
      availability[instrument] = availableNotes;
    }
  }

  return availability;
}

async function sampleExists(instrument, midiNote) {
  try {
    const response = await fetch(`assets/${instrument}/${midiNote}.wav`, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function pickInstrumentForNote(midiNote) {
  const availability = await loadInstrumentAvailability();
  const available = instruments.filter((instrument) =>
    availability[instrument]?.has(midiNote)
  );
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
  const MAX_ATTEMPTS = 30;

  cancelNextTrialTimeout();
  resetButtonFocus();

  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    currentState.awaitingGuess = false;
    return;
  }

  if (attempt >= MAX_ATTEMPTS) {
    currentState.awaitingGuess = false;
    return;
  }
  const chromaIndex = pickRandomChroma();
  if (chromaIndex === null) {
    currentState.awaitingGuess = false;
    return;
  }
  const midiNote = pickRandomNote(chromaIndex);
  const instrument = await pickInstrumentForNote(midiNote);

  if (!instrument) {
    startTrial(attempt + 1);
    return;
  }

  currentState = { chromaIndex, midiNote, awaitingGuess: true };
  lastMidiNotePlayed = midiNote;
  playSample(instrument, midiNote);
}

function playSample(instrument, midiNote) {
  const audio = new Audio(`assets/${instrument}/${midiNote}.wav`);
  audio.volume = 1;
  currentAudio = audio;

  audio
    .play()
    .catch(() => {
      // Fail silently to avoid on-screen feedback.
    });
}

function fadeOutCurrentAudio() {
  const audio = currentAudio;
  if (!audio) return;

  const fadeDurationMs = 200;
  const startVolume = audio.volume;
  const startTime = performance.now();

  function step() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / fadeDurationMs, 1);
    audio.volume = Math.max(startVolume * (1 - progress), 0);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      audio.pause();
      audio.currentTime = 0;
      if (currentAudio === audio) {
        currentAudio = null;
      }
    }
  }

  requestAnimationFrame(step);
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
