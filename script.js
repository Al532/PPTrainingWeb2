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

const buttonsContainer = document.getElementById("chroma-buttons");
const feedbackEl = document.getElementById("feedback");
const midiStatusEl = document.getElementById("midi-status");
const trialStatusEl = document.getElementById("trial-status");
const chromaSetSelect = document.getElementById("chroma-set-select");

const notesByChroma = buildNotesByChroma();
const availabilityCache = new Map();
let activeChromaSet = chromaSets[0];
let currentState = {
  chromaIndex: null,
  midiNote: null,
  awaitingGuess: false,
};

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

function populateChromaSetSelect() {
  chromaSets.forEach((set, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = set.label;
    chromaSetSelect.appendChild(option);
  });

  chromaSetSelect.value = "0";
  chromaSetSelect.addEventListener("change", handleChromaSetChange);
}

function handleChromaSetChange(event) {
  const selectedSet = chromaSets[Number(event.target.value)];
  if (!selectedSet) return;
  activeChromaSet = selectedSet;
  createButtons();
  startTrial();
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
  const idx = Math.floor(Math.random() * notes.length);
  return notes[idx];
}

async function startTrial(attempt = 0) {
  const MAX_ATTEMPTS = 30;
  if (!activeChromaSet || !activeChromaSet.chromas.length) {
    showFeedback("Please select a chroma set to continue.", "error");
    trialStatusEl.textContent = "Paused";
    currentState.awaitingGuess = false;
    return;
  }

  if (attempt >= MAX_ATTEMPTS) {
    showFeedback(
      "Unable to find an audio sample within this note range.",
      "error"
    );
    trialStatusEl.textContent = "Paused";
    currentState.awaitingGuess = false;
    return;
  }

  clearFeedback();
  trialStatusEl.textContent = "Loading a new sample…";
  const chromaIndex = pickRandomChroma();
  if (chromaIndex === null) {
    showFeedback("Please select a chroma set to continue.", "error");
    trialStatusEl.textContent = "Paused";
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
  playSample(instrument, midiNote);
}

function playSample(instrument, midiNote) {
  const audio = new Audio(`assets/${instrument}/${midiNote}.wav`);
  audio
    .play()
    .then(() => {
      trialStatusEl.textContent = "Guess the chroma that was played";
    })
    .catch(() => {
      showFeedback("Unable to play the audio sample.", "error");
    });
}

function handleAnswer(chosenChroma) {
  if (!currentState.awaitingGuess) return;
  currentState.awaitingGuess = false;

  const isCorrect = chosenChroma === currentState.chromaIndex;
  if (!isCorrect) {
    const correctLabel = getChromaLabel(currentState.chromaIndex);
    showFeedback(`Incorrect answer: ${correctLabel}`, "error");
  } else {
    clearFeedback();
  }

  setTimeout(() => startTrial(), 500);
}

function showFeedback(message, type = "") {
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback ${type}`.trim();
}

function clearFeedback() {
  showFeedback("");
}

function getChromaLabel(chromaIndex) {
  if (activeChromaSet) {
    const inSet = activeChromaSet.chromas.find(
      (chroma) => chroma.index === chromaIndex
    );
    if (inSet) return inSet.label;
  }

  const fallback = chromas.find((chroma) => chroma.index === chromaIndex);
  return fallback ? fallback.label : chromaIndex;
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
  createButtons();
  setupMidi();
  startTrial();
}

document.addEventListener("DOMContentLoaded", init);
