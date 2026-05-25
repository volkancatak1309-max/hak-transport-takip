// Generates a soft two-tone chime as a 16-bit PCM WAV (CC0, self-generated).
// Output: public/sounds/lenkzeit-alarm.wav
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sounds");

const sampleRate = 44100;
const durationSec = 1.6;
const totalSamples = Math.floor(sampleRate * durationSec);

// Two gentle notes (A5, then E6) with soft attack/decay — a calm chime, not an alarm blast.
const notes = [
  { freq: 880.0, start: 0.0, len: 0.9 },
  { freq: 1318.51, start: 0.45, len: 1.1 },
];

function envelope(t, len) {
  const attack = 0.04;
  const release = 0.5;
  if (t < attack) return t / attack;
  if (t > len - release) return Math.max(0, (len - t) / release);
  return 1;
}

const samples = new Float32Array(totalSamples);
for (let i = 0; i < totalSamples; i++) {
  const time = i / sampleRate;
  let v = 0;
  for (const n of notes) {
    const local = time - n.start;
    if (local < 0 || local > n.len) continue;
    v += Math.sin(2 * Math.PI * n.freq * local) * envelope(local, n.len) * 0.28;
  }
  samples[i] = v;
}

// Encode 16-bit PCM mono WAV
const bytesPerSample = 2;
const dataSize = totalSamples * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
buffer.writeUInt16LE(bytesPerSample, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);
for (let i = 0; i < totalSamples; i++) {
  const s = Math.max(-1, Math.min(1, samples[i]));
  buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "lenkzeit-alarm.wav"), buffer);
console.log("✓ public/sounds/lenkzeit-alarm.wav", `${(buffer.length / 1024).toFixed(1)} KB`);
