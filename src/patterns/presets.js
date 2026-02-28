export const PRESET_NAMES = [
  "Rock",
  "Pop",
  "Funk",
  "HipHop",
  "Rock Slow",
  "Rock Driving",
  "Rock Fast 16ths",
  "Swing Slow",
  "Swing Medium",
  "Swing Fast",
  "Jazz Slow Ride",
  "Jazz Medium Swing",
  "Jazz Fast Swing",
  "Reggae One Drop",
  "Reggae Rockers",
  "Reggae Steppers",
  "Bossa Nova Slow",
  "Bossa Nova Basic",
  "Bossa Nova Fast",
  "Latin Dembow Basic",
  "Latin Dembow Busy",
  "Latin Dembow Fill",
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
const QUARTER_NOTES = [0, 4, 8, 12];
const OFF_BEATS_8TH = [2, 6, 10, 14];
const SWING_RIDE = [0, 3, 4, 7, 8, 11, 12, 15];

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
  "Rock Slow": {
    kick: [0, 8],
    snare: [4, 12],
    closed_hat: EVERY_TWO_STEPS,
    open_hat: [14],
    crash: [0]
  },
  "Rock Driving": {
    kick: [0, 6, 8, 10],
    snare: [4, 12],
    closed_hat: EVERY_TWO_STEPS,
    open_hat: [6, 14]
  },
  "Rock Fast 16ths": {
    kick: [0, 5, 8, 11],
    snare: [4, 12],
    closed_hat: EVERY_STEP,
    open_hat: [7, 15]
  },
  "Swing Slow": {
    kick: [0, 10],
    snare: [12],
    ride: SWING_RIDE,
    closed_hat: [4, 12]
  },
  "Swing Medium": {
    kick: [0, 6, 8, 13],
    snare: [12],
    ride: SWING_RIDE,
    closed_hat: [4, 12]
  },
  "Swing Fast": {
    kick: [0, 4, 8, 10, 14],
    snare: [12],
    ride: SWING_RIDE,
    closed_hat: [4, 12]
  },
  "Jazz Slow Ride": {
    kick: [0, 8],
    snare: [12],
    ride: QUARTER_NOTES,
    closed_hat: [4, 12]
  },
  "Jazz Medium Swing": {
    kick: [0, 10],
    snare: [12],
    ride: SWING_RIDE,
    closed_hat: [4, 12]
  },
  "Jazz Fast Swing": {
    kick: [0, 6, 10, 14],
    snare: [12],
    ride: SWING_RIDE,
    closed_hat: [4, 12]
  },
  "Reggae One Drop": {
    kick: [8],
    snare: [8],
    closed_hat: OFF_BEATS_8TH,
    shaker: EVERY_TWO_STEPS
  },
  "Reggae Rockers": {
    kick: [0, 8, 10],
    snare: [8, 12],
    closed_hat: OFF_BEATS_8TH,
    shaker: EVERY_TWO_STEPS
  },
  "Reggae Steppers": {
    kick: QUARTER_NOTES,
    snare: [8],
    closed_hat: OFF_BEATS_8TH,
    shaker: EVERY_TWO_STEPS
  },
  "Bossa Nova Slow": {
    kick: [0, 3, 8, 11],
    snare: [4, 10, 12],
    closed_hat: EVERY_TWO_STEPS,
    shaker: OFF_BEATS_8TH
  },
  "Bossa Nova Basic": {
    kick: [0, 3, 6, 8, 11, 14],
    snare: [4, 7, 10, 12, 15],
    closed_hat: EVERY_TWO_STEPS,
    perc: OFF_BEATS_8TH
  },
  "Bossa Nova Fast": {
    kick: [0, 3, 8, 11],
    snare: [4, 10, 12],
    closed_hat: EVERY_STEP,
    shaker: EVERY_TWO_STEPS
  },
  "Latin Dembow Basic": {
    kick: [0, 3, 8, 10, 11],
    snare: [4, 12],
    clap: [12],
    closed_hat: EVERY_TWO_STEPS,
    open_hat: [7, 15],
    perc: [6, 14]
  },
  "Latin Dembow Busy": {
    kick: [0, 3, 6, 8, 10, 11, 14],
    snare: [4, 12],
    clap: [4, 12],
    closed_hat: EVERY_STEP,
    open_hat: [7, 15],
    perc: [2, 6, 10, 14]
  },
  "Latin Dembow Fill": {
    kick: [0, 3, 8, 10, 11, 14],
    snare: [4, 11, 12, 15],
    clap: [12],
    closed_hat: EVERY_TWO_STEPS,
    open_hat: [15],
    perc: [6, 7, 14, 15],
    tom: [13, 14, 15],
    crash: [0]
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
