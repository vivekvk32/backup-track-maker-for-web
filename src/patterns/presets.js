export const PRESET_NAMES = [
  "Rock",
  "Pop",
  "Funk",
  "HipHop",
  "Empty"
];
export const LANE_IDS = [
  "kick",
  "snare",
  "closed_hat",
  "open_hat",
  "clap",
  "perc",
  "crash",
  "ride",
  "tom",
  "shaker",
  "cowbell"
];

const EVERY_TWO_STEPS = [0, 2, 4, 6, 8, 10, 12, 14];
const EVERY_STEP = Array.from({ length: 16 }, (_, index) => index);

const BASE_PRESETS = {
  Rock: {
    kick: [0, 8],
    snare: [4, 12],
    closed_hat: EVERY_TWO_STEPS
  },
  Pop: {
    kick: [0, 6, 8],
    snare: [4, 12],
    closed_hat: EVERY_TWO_STEPS
  },
  Funk: {
    kick: [0, 3, 7, 10],
    snare: [4, 12],
    closed_hat: EVERY_STEP
  },
  HipHop: {
    kick: [0, 7, 8],
    snare: [4, 12],
    clap: [4, 12],
    closed_hat: EVERY_STEP
  },
  Empty: {}
};

function tileIndices(baseIndices, bars) {
  const tiled = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const offset = bar * 16;
    for (const index of baseIndices) {
      tiled.push(offset + index);
    }
  }
  return tiled;
}

export function createEmptyPattern(totalSteps) {
  const pattern = {};
  for (const laneId of LANE_IDS) {
    pattern[laneId] = Array.from({ length: totalSteps }, () => false);
  }
  return pattern;
}

export function buildPresetPattern(presetName, bars = 1) {
  const safeBars = [1, 2, 4].includes(Number(bars)) ? Number(bars) : 1;
  const totalSteps = safeBars * 16;
  const pattern = createEmptyPattern(totalSteps);
  const basePreset = BASE_PRESETS[presetName] || BASE_PRESETS.Empty;

  for (const laneId of LANE_IDS) {
    const indices = tileIndices(basePreset[laneId] || [], safeBars);
    for (const stepIndex of indices) {
      if (stepIndex >= 0 && stepIndex < totalSteps) {
        pattern[laneId][stepIndex] = true;
      }
    }
  }

  return pattern;
}
