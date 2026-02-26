import {
  METRONOME_SUBDIVISIONS,
  scheduleClick,
  shouldTriggerMetronomeStep
} from "./metronome";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export function audioBufferToWavBlob(buffer) {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let ch = 0; ch < channels; ch += 1) {
    channelData.push(buffer.getChannelData(ch));
  }
  if (channels === 1 && buffer.numberOfChannels > 1) {
    channelData[0] = buffer.getChannelData(0);
  }

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = clamp(channelData[ch][frame] || 0, -1, 1);
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export async function audioBufferToMp3Blob(buffer, kbps = 192, onProgress) {
  if (typeof Worker === "undefined") {
    throw new Error("MP3 export requires Web Worker support.");
  }

  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const left = new Float32Array(buffer.getChannelData(0));
  const right = channels > 1 ? new Float32Array(buffer.getChannelData(1)) : null;

  return new Promise((resolve, reject) => {
    const worker = new Worker("/mp3-worker.js");

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        if (onProgress) {
          onProgress(clamp(Number(message.progress) || 0, 0, 1));
        }
        return;
      }

      if (message.type === "done") {
        worker.terminate();
        resolve(new Blob([message.buffer], { type: "audio/mpeg" }));
        return;
      }

      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message || "MP3 encoding failed."));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message || "MP3 worker crashed."));
    };

    worker.postMessage(
      {
        left: left.buffer,
        right: right ? right.buffer : null,
        channels,
        sampleRate: buffer.sampleRate,
        kbps
      },
      right ? [left.buffer, right.buffer] : [left.buffer]
    );
  });
}

export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  await new Promise((resolve) => {
    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve();
    }, 0);
  });
}

function buildAudioBufferFromChunks({
  audioContext,
  chunksByChannel,
  targetFrames,
  sampleRate,
  channels
}) {
  const buffer = audioContext.createBuffer(channels, targetFrames, sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    const sourceChunks = chunksByChannel[channel] || [];
    let offset = 0;
    for (const chunk of sourceChunks) {
      if (!chunk || !chunk.length || offset >= targetFrames) {
        continue;
      }
      const copyCount = Math.min(chunk.length, targetFrames - offset);
      output.set(chunk.subarray(0, copyCount), offset);
      offset += copyCount;
    }
  }
  return buffer;
}

export async function captureNodeOutputToAudioBuffer({
  audioContext,
  sourceNode,
  durationSeconds,
  channels = 2,
  onProgress
}) {
  if (!audioContext || !sourceNode) {
    throw new Error("Missing audio context or source node for capture.");
  }

  const safeDuration = Math.max(0.1, Number(durationSeconds) || 0);
  const safeChannels = Math.min(2, Math.max(1, Math.round(Number(channels) || 2)));
  const sampleRate = audioContext.sampleRate;
  const targetFrames = Math.max(1, Math.round(safeDuration * sampleRate));
  const processorBufferSize = 4096;
  const chunksByChannel = Array.from({ length: safeChannels }, () => []);
  let recordedFrames = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    const processor = audioContext.createScriptProcessor(
      processorBufferSize,
      safeChannels,
      safeChannels
    );
    const silentSink = audioContext.createGain();
    silentSink.gain.setValueAtTime(0, audioContext.currentTime);

    function cleanup() {
      processor.onaudioprocess = null;
      try {
        sourceNode.disconnect(processor);
      } catch {
        // Ignore disconnect race conditions.
      }
      try {
        processor.disconnect(silentSink);
      } catch {
        // Ignore disconnect race conditions.
      }
      try {
        silentSink.disconnect(audioContext.destination);
      } catch {
        // Ignore disconnect race conditions.
      }
    }

    function finalizeSuccess() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (onProgress) {
        onProgress(1);
      }
      resolve(
        buildAudioBufferFromChunks({
          audioContext,
          chunksByChannel,
          targetFrames,
          sampleRate,
          channels: safeChannels
        })
      );
    }

    function finalizeError(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    processor.onaudioprocess = (event) => {
      try {
        const inputBuffer = event.inputBuffer;
        const frameCount = inputBuffer.length;
        const remaining = targetFrames - recordedFrames;
        if (remaining <= 0) {
          finalizeSuccess();
          return;
        }

        const copyFrames = Math.min(frameCount, remaining);
        for (let channel = 0; channel < safeChannels; channel += 1) {
          const inputChannel =
            channel < inputBuffer.numberOfChannels
              ? inputBuffer.getChannelData(channel)
              : inputBuffer.getChannelData(0);
          chunksByChannel[channel].push(new Float32Array(inputChannel.subarray(0, copyFrames)));
        }

        recordedFrames += copyFrames;
        if (onProgress) {
          onProgress(clamp(recordedFrames / targetFrames, 0, 1));
        }

        if (recordedFrames >= targetFrames) {
          finalizeSuccess();
        }
      } catch (error) {
        finalizeError(error);
      }
    };

    try {
      sourceNode.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(audioContext.destination);
    } catch (error) {
      finalizeError(error);
    }
  });
}

function scheduleLaneSample(offlineContext, outputNode, buffer, atTime, laneGain) {
  const source = offlineContext.createBufferSource();
  const gainNode = offlineContext.createGain();

  source.buffer = buffer;
  gainNode.gain.setValueAtTime(clamp(Number(laneGain) || 0, 0, 1), atTime);

  source.connect(gainNode);
  gainNode.connect(outputNode);
  source.start(atTime);
}

export async function renderPatternOffline({
  bpm,
  swingPercent,
  loopBars,
  durationMinutes,
  masterVolume,
  lanes,
  buffersByPath,
  metronome,
  sampleRate = 44100
}) {
  const safeBpm = clamp(Number(bpm) || 120, 30, 300);
  const safeSwing = clamp(Number(swingPercent) || 0, 0, 60);
  const safeBars = [1, 2, 4].includes(Number(loopBars)) ? Number(loopBars) : 1;
  const safeMinutes = clamp(Number(durationMinutes) || 4, 1, 30);
  const totalSeconds = safeMinutes * 60;
  const frameCount = Math.ceil(totalSeconds * sampleRate);
  const totalSteps = safeBars * 16;
  const sixteenth = (60 / safeBpm) / 4;

  const offlineContext = new OfflineAudioContext(2, frameCount, sampleRate);
  const offlineMaster = offlineContext.createGain();
  offlineMaster.gain.setValueAtTime(clamp(Number(masterVolume) || 0, 0, 1), 0);
  offlineMaster.connect(offlineContext.destination);

  let baseTime = 0;
  let stepIndex = 0;

  while (baseTime < totalSeconds) {
    const swingOffset = stepIndex % 2 === 1 ? (safeSwing / 100) * sixteenth : 0;
    const eventTime = baseTime + swingOffset;
    if (eventTime >= totalSeconds) {
      break;
    }

    const stepInPattern = stepIndex % totalSteps;
    const stepInBar = stepInPattern % 16;

    for (const lane of Object.values(lanes)) {
      if (!lane || !lane.samplePath || !Array.isArray(lane.steps)) {
        continue;
      }
      if (!lane.steps[stepInPattern]) {
        continue;
      }

      const buffer = buffersByPath.get(lane.samplePath);
      if (!buffer) {
        continue;
      }

      scheduleLaneSample(offlineContext, offlineMaster, buffer, eventTime, lane.gain);
    }

    if (
      metronome?.enabled &&
      shouldTriggerMetronomeStep(
        stepInBar,
        metronome.subdivision || METRONOME_SUBDIVISIONS.QUARTER
      )
    ) {
      const isAccent = Boolean(metronome.accentBeatOne) && stepInBar === 0;
      scheduleClick(offlineContext, eventTime, {
        isAccent,
        volume: clamp(Number(metronome.volume) || 0, 0, 1),
        outputNode: offlineMaster
      });
    }

    baseTime += sixteenth;
    stepIndex += 1;
  }

  return offlineContext.startRendering();
}
