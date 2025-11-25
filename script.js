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

const notesByChroma = buildNotesByChroma();
const availabilityCache = new Map();
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
  chromas.forEach((chroma) => {
    const btn = document.createElement("button");
    btn.className = "chroma";
    btn.textContent = chroma.label;
    btn.dataset.index = chroma.index;
    btn.addEventListener("click", () => handleAnswer(chroma.index));
    buttonsContainer.appendChild(btn);
  });
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
  return Math.floor(Math.random() * chromas.length);
}

function pickRandomNote(chromaIndex) {
  const notes = notesByChroma[chromaIndex];
  const idx = Math.floor(Math.random() * notes.length);
  return notes[idx];
}

async function startTrial(attempt = 0) {
  const MAX_ATTEMPTS = 30;
  if (attempt >= MAX_ATTEMPTS) {
    showFeedback(
      "Impossible de trouver un échantillon audio pour cette plage de notes.",
      "error"
    );
    trialStatusEl.textContent = "En pause";
    currentState.awaitingGuess = false;
    return;
  }

  clearFeedback();
  trialStatusEl.textContent = "Lecture d'un nouvel échantillon…";
  const chromaIndex = pickRandomChroma();
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
      trialStatusEl.textContent = "Devinez le chroma joué";
    })
    .catch(() => {
      showFeedback("Impossible de lire l'échantillon audio.", "error");
    });
}

function handleAnswer(chosenChroma) {
  if (!currentState.awaitingGuess) return;
  currentState.awaitingGuess = false;

  const isCorrect = chosenChroma === currentState.chromaIndex;
  if (!isCorrect) {
    showFeedback(`Mauvaise réponse : ${chromas[currentState.chromaIndex].label}`, "error");
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

function setupMidi() {
  if (!navigator.requestMIDIAccess) {
    midiStatusEl.textContent = "MIDI non supporté par ce navigateur";
    midiStatusEl.classList.add("muted");
    return;
  }

  navigator
    .requestMIDIAccess()
    .then((access) => {
      midiStatusEl.textContent = "MIDI connecté";
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
      midiStatusEl.textContent = "Accès MIDI refusé";
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
  createButtons();
  setupMidi();
  startTrial();
}

document.addEventListener("DOMContentLoaded", init);
