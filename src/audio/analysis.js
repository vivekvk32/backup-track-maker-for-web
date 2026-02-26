function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeRms(channelData, stride) {
  let sumSquares = 0;
  let count = 0;

  for (let i = 0; i < channelData.length; i += stride) {
    const sample = channelData[i];
    sumSquares += sample * sample;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return Math.sqrt(sumSquares / count);
}

function computeBrightnessProxy(channelData, stride) {
  let previous = channelData[0] || 0;
  let crossings = 0;
  let diffEnergy = 0;
  let count = 0;

  for (let i = stride; i < channelData.length; i += stride) {
    const sample = channelData[i];
    if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) {
      crossings += 1;
    }

    diffEnergy += Math.abs(sample - previous);
    previous = sample;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  const zcr = crossings / count;
  const avgDiff = diffEnergy / count;
  return clamp(zcr * 2 + avgDiff * 6, 0, 1);
}

export function analyzeBuffer(buffer) {
  if (!buffer || buffer.numberOfChannels === 0) {
    return {
      durationSeconds: 0,
      rms: 0,
      brightnessEstimate: 0,
      lengthBadge: "short",
      toneBadge: "dark",
      guess: "Unknown"
    };
  }

  const firstChannel = buffer.getChannelData(0);
  const sampleSpan = Math.min(firstChannel.length, Math.floor(buffer.sampleRate * 0.25));
  const slice = sampleSpan > 0 ? firstChannel.subarray(0, sampleSpan) : firstChannel;
  const stride = Math.max(1, Math.floor(slice.length / 4096));

  const rms = computeRms(slice, stride);
  const brightnessEstimate = computeBrightnessProxy(slice, stride);
  const durationSeconds = buffer.duration;

  return {
    durationSeconds,
    rms,
    brightnessEstimate,
    lengthBadge: durationSeconds <= 0.35 ? "short" : "long",
    toneBadge: brightnessEstimate >= 0.42 ? "bright" : "dark",
    guess: "Unknown"
  };
}
