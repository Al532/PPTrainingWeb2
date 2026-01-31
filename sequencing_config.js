const SEQUENCING_OVERRIDES_KEY = "pptraining.sequencingOverrides";

const DEFAULT_PRESET = {
  name: "default",
  label: "Default",
  minAbsDelta: 0,
  preferredAbsDeltaRanges: [{ min: 0, max: 127, weight: 1 }],
  directionBalance: { up: 0.5, down: 0.5, window: 20 },
  registerBands: { lowMax: 52, highMin: 76, alternateBands: false },
  afterWrongPolicy: {
    enabled: false,
    forceAbsDeltaMin: 24,
    forceBandSwitch: false,
  },
  maxAttemptsToFindCandidate: 40,
  weakChromaWeights: {},
  targetPitchClassHistoryWindow: 24,
  silenceMsBetweenTrials: 0,
};

export const SEQUENCING_PRESETS = {
  default: DEFAULT_PRESET,
  antiRelativeChromatic: {
    name: "antiRelativeChromatic",
    label: "Anti-relative",
    minAbsDelta: 12,
    preferredAbsDeltaRanges: [
      { min: 24, max: 35, weight: 0.6 },
      { min: 12, max: 23, weight: 0.3 },
      { min: 0, max: 127, weight: 0.1 },
    ],
    directionBalance: { up: 0.5, down: 0.5, window: 20 },
    registerBands: { lowMax: 52, highMin: 76, alternateBands: true },
    afterWrongPolicy: {
      enabled: true,
      forceAbsDeltaMin: 24,
      forceBandSwitch: true,
    },
    maxAttemptsToFindCandidate: 40,
    weakChromaWeights: { Bb: 1.6, "F#": 1.4, F: 1.3, "C#": 1.2, Ab: 1.2 },
    targetPitchClassHistoryWindow: 30,
    silenceMsBetweenTrials: 400,
  },
};

function getStoredOverrides() {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(SEQUENCING_OVERRIDES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function getSequencingOverrides() {
  return getStoredOverrides();
}

export function setSequencingOverrides(overrides) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SEQUENCING_OVERRIDES_KEY, JSON.stringify(overrides ?? {}));
}

function mergeValues(base, override) {
  if (Array.isArray(base)) {
    const overrideArray = Array.isArray(override) ? override : [];
    return base.map((value, index) => mergeValues(value, overrideArray[index]));
  }
  if (base && typeof base === "object") {
    const merged = { ...base };
    if (override && typeof override === "object") {
      Object.keys(override).forEach((key) => {
        merged[key] = mergeValues(base[key], override[key]);
      });
    }
    return merged;
  }
  return override === undefined ? base : override;
}

export function getSequencingPreset(presetName = "default") {
  const basePreset = SEQUENCING_PRESETS[presetName] ?? SEQUENCING_PRESETS.default;
  const overrides = getStoredOverrides();
  const overrideForPreset = overrides?.[basePreset.name] ?? {};
  return mergeValues(basePreset, overrideForPreset);
}
