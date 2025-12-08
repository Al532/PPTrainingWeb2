export const BASE_MIDI_RANGE = { min: 36, max: 96 };

export const chromas = [
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

export const chromaLookup = {
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

const baseChromaSets = [
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
    name: "Special tones 1",
    exerciseType: "Special tones",
    notes: ["C", "D", "E", "F♯", "A♭", "B♭"],
  },
  {
    name: "Special tones 2",
    exerciseType: "Special tones",
    notes: ["C♯", "E♭", "F", "G", "A", "B"],
  },
  {
    name: "Chromatic",
    exerciseType: "Chromatic",
    notes: chromas.map((chroma) => chroma.label),
  },
];

export const chromaSets = baseChromaSets.map((set) => ({
  ...set,
  label: `${set.name}: ${set.notes.join(", ")}`,
  chromas: set.notes.map((note) => ({ label: note, index: chromaLookup[note] })),
}));

export const instruments = [
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

export const instrumentRanges = {
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
