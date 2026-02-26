function createToken(degree, octaveOffset = 0, lengthSteps = 1, velocity = 0.85) {
  return {
    degree,
    octaveOffset,
    lengthSteps,
    velocity
  };
}

const BASE_PATTERNS = {
  "Root Groove": {
    0: createToken(1, 0, 2, 0.88),
    4: createToken(1, 0, 2, 0.84),
    8: createToken(5, 0, 2, 0.88),
    12: createToken(1, 0, 2, 0.84)
  },
  Walking: {
    0: createToken(1, 0, 1, 0.84),
    2: createToken(3, 0, 1, 0.8),
    4: createToken(5, 0, 1, 0.84),
    6: createToken(7, 0, 1, 0.78),
    8: createToken(1, 1, 1, 0.86),
    10: createToken(7, 0, 1, 0.8),
    12: createToken(5, 0, 1, 0.84),
    14: createToken(3, 0, 1, 0.8)
  },
  Octaves: {
    0: createToken(1, 0, 1, 0.88),
    2: createToken(1, 1, 1, 0.82),
    4: createToken(5, 0, 1, 0.86),
    6: createToken(5, 1, 1, 0.8),
    8: createToken(1, 0, 1, 0.88),
    10: createToken(1, 1, 1, 0.82),
    12: createToken(5, 0, 1, 0.86),
    14: createToken(5, 1, 1, 0.8)
  },
  "Simple 8ths": {
    0: createToken(1, 0, 1, 0.84),
    2: createToken(1, 0, 1, 0.8),
    4: createToken(5, 0, 1, 0.84),
    6: createToken(5, 0, 1, 0.8),
    8: createToken(1, 0, 1, 0.84),
    10: createToken(1, 0, 1, 0.8),
    12: createToken(7, 0, 1, 0.82),
    14: createToken(5, 0, 1, 0.8)
  },
  Empty: {}
};

export const BASS_PRESETS = Object.keys(BASE_PATTERNS);

export function buildBassPresetPattern(presetName, loopBars = 1) {
  const safeBars = [1, 2, 4].includes(Number(loopBars)) ? Number(loopBars) : 1;
  const totalSteps = safeBars * 16;
  const result = Array.from({ length: totalSteps }, () => null);
  const base = BASE_PATTERNS[presetName] || BASE_PATTERNS.Empty;

  for (let bar = 0; bar < safeBars; bar += 1) {
    const barOffset = bar * 16;
    for (const [step, token] of Object.entries(base)) {
      const index = barOffset + Number(step);
      if (index < 0 || index >= totalSteps) {
        continue;
      }
      result[index] = token ? { ...token } : null;
    }
  }

  return result;
}

