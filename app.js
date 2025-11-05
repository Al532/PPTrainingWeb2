// ===== Perfect Pitch Training — app.js (36 samples, flats display, feedback uniformisé) =====

const NOTE_NAMES_DISPLAY = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]; // flats comme le programme Python
const NOTE_INDEX = { C:0,"C#":1,D:2,Eb:3,E:4,F:5,"F#":6,G:7,Ab:8,A:9,Bb:10,B:11 };
const NOTE_NAMES_SPOKEN_FR = [
  "do",
  "do dièse",
  "ré",
  "mi bémol",
  "mi",
  "fa",
  "fa dièse",
  "sol",
  "la bémol",
  "la",
  "si bémol",
  "si",
];
const AUTO_OUT_DISPLAY = "OUT";
const AUTO_OUT_SPOKEN = "out";

// Normalisation entrée → flats
function toFlat(name){
  if (!name) return name;
  return name.replace("D#","Eb").replace("G#","Ab").replace("A#","Bb");
}

const CHROMAS_APPEAR_ORDER = ["F","E","F#","Eb","G","D","Ab","C#","A","C","Bb","B"];
const MAX_LEVEL = 11;
const ISI_AFTER_RESPONSE_MS = 500;
const AUTO_DELAY_MIN_MS = 1500;
const AUTO_DELAY_MAX_MS = 4000;

const TOTAL_SAMPLES = 36;      // 3 octaves * 12 (C4..B6)
const OCTAVE_COUNT   = 3;
const LEARN_OCTAVE_COUNT = 2;  // C4..B5
const LEARN_TOTAL_SAMPLES = LEARN_OCTAVE_COUNT * 12;
const CHORD_COUNT    = 24;
const VOICE_SAMPLE_COUNT = LEARN_TOTAL_SAMPLES;

let currentBank = "piano";
let chordsEnabled = true;
let running = false;
let level = 1;
let targetPitch = null;        // 0..35
let pendingTimer = null;
const AUTO_STATES = {
  OFF: "off",
  ON: "on",
  LEARN: "learn",
  ACTIVE_LEARN: "active_learn",
};
let autoState = AUTO_STATES.OFF;
let autoQueueTimer = null;
let autoNextTimer = null;
let autoDelayMs = 1700;
let currentUtterance = null;
let toastTimer = null;
let activeLearnTrials = 0;

const ACTIVE_LEARN_FADE_TRIALS = 50;
const ACTIVE_LEARN_MAX_ATTENUATION_DB = 60;

// Fenêtre d'acceptation des réponses
let accepting = false;
let answeredThisTrial = false;

const els = {
  grid: document.querySelector("#grid"),
  startBtn: document.querySelector("#startStop"),
  startRow: document.querySelector("#startRow"),
  toggleChords: document.querySelector("#toggleChords"),
  toggleTimbre: document.querySelector("#toggleTimbre"),
  specialTraining: document.querySelector("#specialTraining"),
  learnMode: document.querySelector("#learnMode"),
  activeLearnMode: document.querySelector("#activeLearnMode"),
  autoDelaySlider: document.querySelector("#autoDelay"),
  autoDelayLabel: document.querySelector("#autoDelayLabel"),
  status: document.querySelector("#status"),
  timbreLabel: document.querySelector("#timbreLabel"),
  toast: document.querySelector("#toast"),
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sliderValueToDelay(value) {
  const ratio = clamp(Number(value), 0, 100) / 100;
  return Math.round(
    AUTO_DELAY_MAX_MS - ratio * (AUTO_DELAY_MAX_MS - AUTO_DELAY_MIN_MS)
  );
}

function delayToSliderValue(delay) {
  const clampedDelay = clamp(delay, AUTO_DELAY_MIN_MS, AUTO_DELAY_MAX_MS);
  const ratio =
    (AUTO_DELAY_MAX_MS - clampedDelay) /
    (AUTO_DELAY_MAX_MS - AUTO_DELAY_MIN_MS);
  return Math.round(ratio * 100);
}

function updateAutoDelayLabel() {
  if (!els.autoDelayLabel) return;
  const seconds = (autoDelayMs / 1000).toFixed(1).replace(".", ",");
  els.autoDelayLabel.textContent = `${seconds} s`;
}

function isAutoActive() {
  return autoState !== AUTO_STATES.OFF;
}

function isLearnMode() {
  return autoState === AUTO_STATES.LEARN;
}

function isActiveLearnMode() {
  return autoState === AUTO_STATES.ACTIVE_LEARN;
}

function isAnyLearnMode() {
  return isLearnMode() || isActiveLearnMode();
}

function updateModeButtons() {
  if (els.specialTraining) {
    els.specialTraining.classList.toggle(
      "mode-active",
      autoState === AUTO_STATES.ON
    );
    els.specialTraining.setAttribute(
      "aria-pressed",
      autoState === AUTO_STATES.ON ? "true" : "false"
    );
  }
  if (els.learnMode) {
    els.learnMode.classList.toggle(
      "mode-active",
      autoState === AUTO_STATES.LEARN
    );
    els.learnMode.setAttribute(
      "aria-pressed",
      autoState === AUTO_STATES.LEARN ? "true" : "false"
    );
  }
  if (els.activeLearnMode) {
    els.activeLearnMode.classList.toggle(
      "mode-active",
      autoState === AUTO_STATES.ACTIVE_LEARN
    );
    els.activeLearnMode.setAttribute(
      "aria-pressed",
      autoState === AUTO_STATES.ACTIVE_LEARN ? "true" : "false"
    );
  }
}

function updateStartButton() {
  if (!els.startBtn) return;
  els.startBtn.textContent = isAutoActive() ? "Stop" : "Start";
}

// --- Barre de niveau (±) ---
const topBar = document.createElement("div");
topBar.style.display = "flex";
topBar.style.gap = "8px";
topBar.style.alignItems = "center";
topBar.style.margin = "6px 0";

const levelDec = document.createElement("button");
levelDec.textContent = "−";
const levelInc = document.createElement("button");
levelInc.textContent = "+";
const levelLabel = document.createElement("span");
levelLabel.className = "pill";
levelLabel.style.minWidth = "7ch";
levelLabel.style.textAlign = "center";

topBar.append(levelDec, levelInc, levelLabel);
if (els.startRow) {
  els.startRow.before(topBar);
  els.startRow.style.display = "flex";
  els.startRow.style.gap = "8px";
  els.startRow.style.alignItems = "center";
  els.startRow.style.margin = "6px 0";
} else {
  els.grid.before(topBar);
}
if (els.startBtn && els.startRow && !els.startRow.contains(els.startBtn)) {
  els.startRow.appendChild(els.startBtn);
}

if (els.autoDelaySlider) {
  els.autoDelaySlider.value = `${delayToSliderValue(autoDelayMs)}`;
  updateAutoDelayLabel();
  els.autoDelaySlider.addEventListener("input", (event) => {
    const newDelay = sliderValueToDelay(event.target.value);
    if (newDelay === autoDelayMs) return;
    autoDelayMs = newDelay;
    updateAutoDelayLabel();
    if (
      isAutoActive() &&
      running &&
      targetPitch !== null &&
      !answeredThisTrial
    ) {
      queueAutoAnswer();
    }
  });
} else {
  updateAutoDelayLabel();
}

// --- Bouton OUT (à gauche) ---
const bottomBar = document.createElement("div");
bottomBar.style.display = "flex";
bottomBar.style.justifyContent = "flex-start";
bottomBar.style.marginTop = "8px";
const btnOUT = document.createElement("button");
btnOUT.textContent = "OUT";
bottomBar.append(btnOUT);
els.grid.after(bottomBar);

// --- Niveau & set ---
function nameToIdx(name) {
  const flat = toFlat(name);
  return (flat in NOTE_INDEX) ? NOTE_INDEX[flat] : -1;
}
function getLevelNames(L) {
  if (L >= MAX_LEVEL) {
    return [...NOTE_NAMES_DISPLAY];
  }
  return CHROMAS_APPEAR_ORDER.slice(0, Math.min(L, CHROMAS_APPEAR_ORDER.length));
}
function getLevelSet(L) {
  return getLevelNames(L).map(nameToIdx);
}
function updateLevelUI() {
  levelLabel.textContent = `Niveau ${level}`;
  setStatus(`Niveau ${level}`);
  if (btnOUT) {
    btnOUT.style.display = (level >= MAX_LEVEL) ? "none" : "";
  }
}
function stopRunForLevelChange() {
  const message = isAutoActive() ? `Niveau ${level}` : undefined;
  stopRunning(message);
  if (isAutoActive()) {
    ensureAutoRunning();
  }
}
function setLevel(newLevel) {
  level = Math.max(1, Math.min(MAX_LEVEL, newLevel));
  updateLevelUI();
  buildGrid();
  stopRunForLevelChange();
}

// --- Audio & mapping (36 fichiers par banque) ---
function chromaOfPitch(pitchIdx){ return ((pitchIdx % 12) + 12) % 12; } // 0..11
function nameOfChroma(idx){ return NOTE_NAMES_DISPLAY[idx]; }

function samplePath(pitchIdx, bank = currentBank) {
  const n = (pitchIdx + 1); // 1..36
  const code = String(n).padStart(3, "0");
  return bank === "piano"
    ? `assets/Piano1/p1-${code}.wav`
    : `assets/Guitar/g-${code}.wav`;
}

function voiceSamplePath(pitchIdx) {
  const n = pitchIdx + 1; // 1..24
  const code = String(n).padStart(3, "0");
  return `assets/Voice/v-${code}.wav`;
}

let audioCtx = null;
let decodedCache = new Map();
async function getDecodedBuffer(key, url) {
  let buf = decodedCache.get(key);
  if (!buf) {
    buf = await fetchDecode(url);
    decodedCache.set(key, buf);
  }
  return buf;
}
async function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}
async function fetchDecode(url) {
  const ctx = await ensureCtx();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new Promise((resolve, reject) => ctx.decodeAudioData(buf, resolve, reject));
}
async function playBuffer(buffer, gainValue = 1) {
  if (gainValue <= 0) return;
  const ctx = await ensureCtx();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  if (gainValue !== 1) {
    const gainNode = ctx.createGain();
    gainNode.gain.value = gainValue;
    src.connect(gainNode);
    gainNode.connect(ctx.destination);
  } else {
    src.connect(ctx.destination);
  }
  src.start();
}
async function playPitch(pitchIdx, bank = currentBank) {
  try {
    const instrumentPromise = getDecodedBuffer(
      `${bank}:${pitchIdx}`,
      samplePath(pitchIdx, bank)
    );
    const needsVoice = isAnyLearnMode() && pitchIdx < VOICE_SAMPLE_COUNT;
    const voicePromise = needsVoice
      ? getDecodedBuffer(`voice:${pitchIdx}`, voiceSamplePath(pitchIdx))
      : null;

    const instrumentBuffer = await instrumentPromise;
    const voiceBuffer = voicePromise ? await voicePromise : null;

    playBuffer(instrumentBuffer);
    if (voiceBuffer) {
      const gain = isActiveLearnMode()
        ? getActiveLearnVoiceGain()
        : 1;
      if (gain > 0) playBuffer(voiceBuffer, gain);
    }
  } catch (_) {}
}

function getActiveLearnVoiceGain() {
  if (!isActiveLearnMode()) return 1;
  if (ACTIVE_LEARN_FADE_TRIALS <= 1) return 0;
  const ratio = clamp(
    (activeLearnTrials - 1) / (ACTIVE_LEARN_FADE_TRIALS - 1),
    0,
    1
  );
  if (ratio >= 1) return 0;
  const attenuationDb = ACTIVE_LEARN_MAX_ATTENUATION_DB * ratio;
  return Math.pow(10, -attenuationDb / 20);
}
function chordPath(chordIdx) {
  const code = String(chordIdx + 1).padStart(3, "0");
  return `assets/Chords/dom-${code}.wav`;
}
async function playRandomChord() {
  if (!chordsEnabled) return;
  try {
    const chordIdx = Math.floor(Math.random() * CHORD_COUNT);
    const key = `chord:${chordIdx}`;
    const buf = await getDecodedBuffer(key, chordPath(chordIdx));
    await playBuffer(buf);
  } catch (_) {}
}
async function preloadBank(bank) {
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const key = `${bank}:${i}`;
    if (!decodedCache.get(key)) {
      try { decodedCache.set(key, await fetchDecode(samplePath(i, bank))); }
      catch (_) {}
    }
  }
}

async function preloadVoices() {
  for (let i = 0; i < VOICE_SAMPLE_COUNT; i++) {
    const key = `voice:${i}`;
    if (!decodedCache.get(key)) {
      try { decodedCache.set(key, await fetchDecode(voiceSamplePath(i))); }
      catch (_) {}
    }
  }
}
async function preloadChords() {
  for (let i = 0; i < CHORD_COUNT; i++) {
    const key = `chord:${i}`;
    if (!decodedCache.get(key)) {
      try { decodedCache.set(key, await fetchDecode(chordPath(i))); }
      catch (_) {}
    }
  }
}

// --- UI utils ---
function clearToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (els.toast) {
    els.toast.textContent = "";
  }
}

function toast(msg, t = 1000) {
  if (isAutoActive() && !isActiveLearnMode()) {
    clearToast();
    return;
  }
  if (!els.toast) return;
  clearToast();
  els.toast.textContent = msg;
  if (t > 0) {
    toastTimer = setTimeout(() => {
      if (els.toast) {
        els.toast.textContent = "";
      }
      toastTimer = null;
    }, t);
  }
}

async function beginRun({ silent = false } = {}) {
  await ensureCtx();
  preloadBank(currentBank);
  if (chordsEnabled) preloadChords();
  if (isAnyLearnMode()) preloadVoices();
  const wasRunning = running;
  running = true;
  accepting = false;
  answeredThisTrial = false;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!silent && !isAutoActive()) {
    toast(wasRunning ? "Nouvelle note" : "Go !");
  }
  nextTrial();
}

function stopRunning(message) {
  running = false;
  accepting = false;
  answeredThisTrial = false;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  targetPitch = null;
  cancelAutoFlow();
  clearToast();
  const statusMsg = (message !== undefined)
    ? message
    : `Niveau ${level} sélectionné · appuie sur Start`;
  if (statusMsg) setStatus(statusMsg);
}

async function ensureAutoRunning() {
  if (!isAutoActive()) return;
  clearToast();
  if (!running) {
    await beginRun({ silent: true });
    return;
  }
  if (targetPitch !== null && !answeredThisTrial && !isActiveLearnMode()) {
    queueAutoAnswer();
  }
}

async function enableAutoMode(newState) {
  if (newState === AUTO_STATES.OFF) {
    disableAutoMode({ announce: false });
    return;
  }
  if (autoState === newState) {
    await ensureAutoRunning();
    return;
  }
  autoState = newState;
  cancelAutoFlow();
  if (isActiveLearnMode()) {
    activeLearnTrials = 0;
  }
  updateModeButtons();
  updateStartButton();
  clearToast();
  if (running) {
    if (isAnyLearnMode()) preloadVoices();
    answeredThisTrial = false;
    accepting = false;
    targetPitch = null;
    nextTrial();
    return;
  }
  updateModeButtons();
  updateStartButton();
  await ensureAutoRunning();
}

function disableAutoMode({ announce = true } = {}) {
  if (!isAutoActive()) return;
  autoState = AUTO_STATES.OFF;
  updateModeButtons();
  updateStartButton();
  stopRunning();
  if (announce) toast("Mode auto OFF", 900);
}
function setStatus(msg) { els.status.textContent = msg; }

function clearAutoTimers() {
  clearTimeout(autoQueueTimer);
  clearTimeout(autoNextTimer);
  autoQueueTimer = null;
  autoNextTimer = null;
}

function cancelAutoFlow() {
  clearAutoTimers();
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

// --- Grille : ordre C..B mais seulement les notes du set ---
function buildGrid() {
  els.grid.innerHTML = "";
  const set = new Set(getLevelSet(level));
  NOTE_NAMES_DISPLAY.forEach((name, idx) => {
    if (!set.has(idx)) return;
    const b = document.createElement("button");
    b.textContent = name;               // affichage flats
    b.addEventListener("click", () => onAnswer({type:"note", idx}));
    els.grid.appendChild(b);
  });
}

// --- Tirage cible (0..35) ---
function wrapPitch(p){ let x = p % TOTAL_SAMPLES; if (x < 0) x += TOTAL_SAMPLES; return x; }
function pickTargetPitch() {
  const levelSet = getLevelSet(level);        // chromas autorisées

  if (isAnyLearnMode()) {
    const chroma = levelSet[Math.floor(Math.random() * levelSet.length)];
    const octave = Math.floor(Math.random() * LEARN_OCTAVE_COUNT); // 0,1
    return octave * 12 + chroma;              // 0..23
  }

  if (level <= 3) {
    const chromasOut = [];
    for (let i = 0; i < 12; i += 1) {
      if (!levelSet.includes(i)) chromasOut.push(i);
    }

    const forceOut = chromasOut.length > 0 && Math.random() < 0.5;
    const chromaPool = forceOut ? chromasOut : levelSet;
    const chosenChroma = chromaPool[Math.floor(Math.random() * chromaPool.length)];
    const octave = Math.floor(Math.random() * OCTAVE_COUNT); // 0,1,2
    return octave * 12 + chosenChroma;       // 0..35
  }

  const baseChroma = levelSet[Math.floor(Math.random() * levelSet.length)];
  const octave = Math.floor(Math.random() * OCTAVE_COUNT); // 0,1,2
  const basePitch = octave * 12 + baseChroma;
  const shift = [-2,-1,0,1,2][Math.floor(Math.random() * 5)];
  return wrapPitch(basePitch + shift);       // 0..35
}

// --- Boucle ---
function queueAutoAnswer() {
  clearAutoTimers();
  if (!isAutoActive() || !running || targetPitch === null) return;
  if (isActiveLearnMode()) return;

  const levelSet = getLevelSet(level);
  const tgtChroma = chromaOfPitch(targetPitch);
  const isOut = !levelSet.includes(tgtChroma);
  const displayLabel = isOut ? AUTO_OUT_DISPLAY : NOTE_NAMES_DISPLAY[tgtChroma];

  toast(`🔊 Auto : ${displayLabel}`, 1200);
  accepting = false;

  autoQueueTimer = setTimeout(() => {
    if (!running || !isAutoActive()) return;

    if (isLearnMode()) {
      autoNextTimer = setTimeout(() => {
        if (!running || !isAutoActive()) return;
        nextTrial();
      }, 500);
      return;
    }

    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      autoNextTimer = setTimeout(() => {
        if (!running || !isAutoActive()) return;
        nextTrial();
      }, 500);
      return;
    }

    let utterance = null;
    if (isOut) {
      // Feedback audio désactivé pour OUT.
      // const outUtterance = new SpeechSynthesisUtterance(AUTO_OUT_SPOKEN);
      // outUtterance.lang = "en-US";
      // utterance = outUtterance;
    } else {
      utterance = new SpeechSynthesisUtterance(NOTE_NAMES_SPOKEN_FR[tgtChroma]);
      utterance.lang = "fr-FR";
    }

    if (!utterance) {
      autoNextTimer = setTimeout(() => {
        if (!running || !isAutoActive()) return;
        nextTrial();
      }, 500);
      return;
    }

    currentUtterance = utterance;

    const cleanup = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
      currentUtterance = null;
      if (!running || !isAutoActive()) return;
      autoNextTimer = setTimeout(() => {
        if (!running || !isAutoActive()) return;
        nextTrial();
      }, 500);
    };

    utterance.onend = cleanup;
    utterance.onerror = cleanup;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, autoDelayMs);
}

function restartPendingNext(delayMs = ISI_AFTER_RESPONSE_MS) {
  clearTimeout(pendingTimer);
  if (!running) return;
  pendingTimer = setTimeout(nextTrial, delayMs);
}
function nextTrial() {
  if (!running) return;
  accepting = false;
  answeredThisTrial = false;
  cancelAutoFlow();

  if (isActiveLearnMode()) {
    activeLearnTrials += 1;
  }

  targetPitch = pickTargetPitch();
  setStatus(`Niveau ${level} · Écoute…`);
  setTimeout(() => {
    playPitch(targetPitch);
    playRandomChord();
    if (isActiveLearnMode()) {
      accepting = true;
    } else if (isAutoActive()) {
      queueAutoAnswer();
    } else {
      accepting = true;
    }
  }, 40);
}

// --- Réponses ---
function onAnswer(evt) {
  if (isAutoActive() && !isActiveLearnMode()) return;
  if (!running || !accepting || answeredThisTrial) return;

  const levelSet = getLevelSet(level);
  const tgtChroma = chromaOfPitch(targetPitch);
  const tgtName = nameOfChroma(tgtChroma); // flats

  if (evt.type === "out") {
    const isOutCorrect = !levelSet.includes(tgtChroma);
    toast(isOutCorrect ? "✅ Correct" : `❌ ${tgtName}`, 900);
    answeredThisTrial = true;
    accepting = false;
    return restartPendingNext();
  }

  const ok = (evt.idx === tgtChroma);
  if (ok) {
    toast("✅ Correct", 600);
  } else {
    if (levelSet.includes(tgtChroma)) {
      toast(`❌ ${tgtName}`, 1100);
    } else {
      toast("❌ Out", 900);
    }
  }
  answeredThisTrial = true;
  accepting = false;
  restartPendingNext();
}

// --- Événements UI ---
if (els.startBtn) {
  updateStartButton();
  els.startBtn.addEventListener("click", async () => {
    if (isAutoActive()) {
      disableAutoMode();
      return;
    }
    await beginRun();
  });
}

els.toggleTimbre.addEventListener("click", async () => {
  currentBank = (currentBank === "piano") ? "guitar" : "piano";
  const label = (currentBank === "guitar") ? "Guitar" : "Piano";
  els.toggleTimbre.textContent = `Timbre : ${label}`;
  els.timbreLabel.textContent = label;
  await ensureCtx();
  preloadBank(currentBank);
});

els.toggleChords.addEventListener("click", async () => {
  chordsEnabled = !chordsEnabled;
  els.toggleChords.textContent = chordsEnabled ? "Chords ON" : "Chords OFF";
  if (chordsEnabled) {
    await ensureCtx();
    preloadChords();
  }
});

updateModeButtons();

if (els.specialTraining) {
  els.specialTraining.addEventListener("click", async () => {
    if (autoState === AUTO_STATES.ON) {
      disableAutoMode({ announce: false });
    } else {
      await enableAutoMode(AUTO_STATES.ON);
    }
  });
}

if (els.learnMode) {
  els.learnMode.addEventListener("click", async () => {
    if (autoState === AUTO_STATES.LEARN) {
      disableAutoMode({ announce: false });
    } else {
      await enableAutoMode(AUTO_STATES.LEARN);
    }
  });
}

if (els.activeLearnMode) {
  els.activeLearnMode.addEventListener("click", async () => {
    if (autoState === AUTO_STATES.ACTIVE_LEARN) {
      disableAutoMode({ announce: false });
    } else {
      await enableAutoMode(AUTO_STATES.ACTIVE_LEARN);
    }
  });
}

levelDec.addEventListener("click", () => setLevel(level - 1));
levelInc.addEventListener("click", () => setLevel(level + 1));
btnOUT.addEventListener("click", () => onAnswer({type:"out"}));

// Init
buildGrid();
setLevel(1);
setStatus("Prêt");
