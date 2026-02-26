self.importScripts("/vendor/lame.min.js");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInt16(floatArray) {
  const output = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i += 1) {
    const sample = clamp(floatArray[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

self.onmessage = (event) => {
  try {
    const payload = event.data || {};
    const channels = Math.min(2, Math.max(1, Number(payload.channels) || 2));
    const sampleRate = Number(payload.sampleRate) || 44100;
    const kbps = Number(payload.kbps) || 192;
    const left = new Float32Array(payload.left);
    const right = channels > 1 && payload.right ? new Float32Array(payload.right) : left;
    const encoder = new self.lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const chunkSize = 1152;
    const chunks = [];
    const totalChunks = Math.max(1, Math.ceil(left.length / chunkSize));

    for (let i = 0; i < left.length; i += chunkSize) {
      const leftChunk = toInt16(left.subarray(i, i + chunkSize));
      let encodedChunk;

      if (channels > 1) {
        const rightChunk = toInt16(right.subarray(i, i + chunkSize));
        encodedChunk = encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        encodedChunk = encoder.encodeBuffer(leftChunk);
      }

      if (encodedChunk.length > 0) {
        chunks.push(new Uint8Array(encodedChunk));
      }

      const chunkIndex = Math.floor(i / chunkSize) + 1;
      if (chunkIndex % 20 === 0 || chunkIndex === totalChunks) {
        self.postMessage({
          type: "progress",
          progress: chunkIndex / totalChunks
        });
      }
    }

    const flushed = encoder.flush();
    if (flushed.length > 0) {
      chunks.push(new Uint8Array(flushed));
    }

    const blob = new Blob(chunks, { type: "audio/mpeg" });
    blob.arrayBuffer().then((arrayBuffer) => {
      self.postMessage(
        {
          type: "done",
          buffer: arrayBuffer
        },
        [arrayBuffer]
      );
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || error)
    });
  }
};
