// ===== Perfect Pitch Training — app.js (36 samples, flats display, feedback uniformisé) =====

const NOTE_NAMES_DISPLAY = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]; // flats comme le programme Python
const NOTE_INDEX = { C:0,"C#":1,D:2,Eb:3,E:4,F:5,"F#":6,G:7,Ab:8,A:9,Bb:10,B:11 };

// Normalisation entrée → flats
function toFlat(name){
  if (!name) return name;
  return name.replace("D#","Eb").replace("G#","Ab").replace("A#","Bb");
}

const CHROMAS_APPEAR_ORDER = ["F","E","F#","Eb","G","D","Ab","C#","A","C","Bb","B"];
const MAX_LEVEL = 12;
const ISI_AFTER_RESPONSE_MS = 500;

const TOTAL_SAMPLES = 36;      // 3 octaves * 12 (C4..B6)
const OCTAVE_COUNT   = 3;

let currentBank = "piano";
let running = false;
let level = 1;
let targetPitch = null;        // 0..35
let pendingTimer = null;

// Fenêtre d'acceptation des réponses
let accepting = false;
let answeredThisTrial = false;

const els = {
  grid: document.querySelector("#grid"),
  startBtn: document.querySelector("#startStop"),
  toggleTimbre: document.querySelector("#toggleTimbre"),
  status: document.querySelector("#status"),
  timbreLabel: document.querySelector("#timbreLabel"),
  toast: document.querySelector("#toast"),
  test: document.querySelector("#test"),
  joke: document.querySelector("#joke"),
};

// Supprimer "tester le son" si présent
if (els.test) els.test.remove();

const JOKES = [
  "Pourquoi le musicien est allé en prison ? Parce qu'il a pris des notes !",
  "Quelle est la note préférée des fantômes ? Le si bémol (BOO-mol) !",
  "Pourquoi la guitare avait l'air fatiguée ? Parce qu'elle avait trop tiré sur ses cordes !",
];

function displayJoke() {
  if (!els.joke || !JOKES.length) return;
  const randomIndex = Math.floor(Math.random() * JOKES.length);
  els.joke.textContent = JOKES[randomIndex];
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
els.grid.before(topBar);

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
  return CHROMAS_APPEAR_ORDER.slice(0, Math.min(L, MAX_LEVEL));
}
function getLevelSet(L) {
  return getLevelNames(L).map(nameToIdx);
}
function updateLevelUI() {
  levelLabel.textContent = `Niveau ${level}`;
  setStatus(`Niveau ${level}`);
}
function stopRunForLevelChange() {
  running = false;
  accepting = false;
  answeredThisTrial = false;
  clearTimeout(pendingTimer);
  setStatus(`Niveau ${level} sélectionné · appuie sur Start`);
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

let audioCtx = null;
let decodedCache = new Map();
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
async function playBuffer(buffer) {
  const ctx = await ensureCtx();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
}
async function playPitch(pitchIdx, bank = currentBank) {
  try {
    const key = `${bank}:${pitchIdx}`;
    let buf = decodedCache.get(key);
    if (!buf) {
      buf = await fetchDecode(samplePath(pitchIdx, bank));
      decodedCache.set(key, buf);
    }
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

// --- UI utils ---
function toast(msg, t=1000) {
  els.toast.textContent = msg;
  if (t>0) {
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>{ els.toast.textContent = ""; }, t);
  }
}
function setStatus(msg) { els.status.textContent = msg; }

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
  const baseSet = getLevelSet(level);        // chromas autorisées
  const baseChroma = baseSet[Math.floor(Math.random() * baseSet.length)];
  const octave = Math.floor(Math.random() * OCTAVE_COUNT); // 0,1,2
  const basePitch = octave * 12 + baseChroma;
  const shift = [-2,-1,0,1,2][Math.floor(Math.random() * 5)];
  return wrapPitch(basePitch + shift);       // 0..35
}

// --- Boucle ---
function restartPendingNext(delayMs = ISI_AFTER_RESPONSE_MS) {
  clearTimeout(pendingTimer);
  if (!running) return;
  pendingTimer = setTimeout(nextTrial, delayMs);
}
function nextTrial() {
  if (!running) return;
  accepting = false;
  answeredThisTrial = false;

  targetPitch = pickTargetPitch();
  setStatus(`Niveau ${level} · Écoute…`);
  setTimeout(() => {
    playPitch(targetPitch);
    accepting = true;
  }, 40);
}

// --- Réponses ---
function onAnswer(evt) {
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
els.startBtn.textContent = "Start";
els.startBtn.addEventListener("click", async () => {
  await ensureCtx();
  preloadBank(currentBank);
  if (!running) {
    running = true;
    toast("Go !");
    nextTrial();
  }
});

els.toggleTimbre.addEventListener("click", async () => {
  currentBank = (currentBank === "piano") ? "guitar" : "piano";
  const label = (currentBank === "guitar") ? "Guitar" : "Piano";
  els.toggleTimbre.textContent = `Timbre : ${label}`;
  els.timbreLabel.textContent = label;
  await ensureCtx();
  preloadBank(currentBank);
});

levelDec.addEventListener("click", () => setLevel(level - 1));
levelInc.addEventListener("click", () => setLevel(level + 1));
btnOUT.addEventListener("click", () => onAnswer({type:"out"}));

// Init
displayJoke();
buildGrid();
setLevel(1);
setStatus("Prêt");
