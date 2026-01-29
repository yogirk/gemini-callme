// Mu-law encoding lookup table
const MULAW_MAX = 0x1fff;
const MULAW_BIAS = 33;

function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  sample += MULAW_BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // Find position of highest bit
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

/**
 * Resample PCM audio from source rate to target rate using linear interpolation
 */
export function resample(
  input: Int16Array,
  sourceRate: number,
  targetRate: number
): Int16Array {
  if (sourceRate === targetRate) {
    return input;
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation
    output[i] = Math.round(
      input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction
    );
  }

  return output;
}

/**
 * Convert 16-bit PCM to mu-law encoded bytes
 */
export function pcmToMulaw(pcm: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    // Scale from 16-bit to 14-bit for mu-law
    const sample = pcm[i] >> 2;
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}

/**
 * Convert PCM buffer (24kHz) to phone-ready mu-law (8kHz)
 * Returns base64 encoded chunks ready for WebSocket transmission
 */
export function prepareAudioForPhone(
  pcm24k: Buffer,
  chunkSize: number = 160
): string[] {
  // Convert Buffer to Int16Array (assuming 16-bit PCM)
  const samples = new Int16Array(
    pcm24k.buffer,
    pcm24k.byteOffset,
    pcm24k.length / 2
  );

  // Resample from 24kHz to 8kHz
  const resampled = resample(samples, 24000, 8000);

  // Convert to mu-law
  const mulaw = pcmToMulaw(resampled);

  // Split into chunks and encode as base64
  const chunks: string[] = [];
  for (let i = 0; i < mulaw.length; i += chunkSize) {
    const chunk = mulaw.slice(i, i + chunkSize);
    chunks.push(Buffer.from(chunk).toString('base64'));
  }

  return chunks;
}

/**
 * Decode base64 mu-law audio to PCM Int16Array
 */
export function mulawToPcm(mulawBase64: string): Int16Array {
  const mulaw = Buffer.from(mulawBase64, 'base64');
  const pcm = new Int16Array(mulaw.length);

  for (let i = 0; i < mulaw.length; i++) {
    pcm[i] = mulawDecode(mulaw[i]);
  }

  return pcm;
}

function mulawDecode(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xff;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0f;

  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;

  // Scale back to 16-bit
  sample <<= 2;

  return sign ? -sample : sample;
}
