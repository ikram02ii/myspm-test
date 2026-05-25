import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function withTempAudioFile<T>(
  buffer: Buffer,
  originalName: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const ext = path.extname(originalName).toLowerCase() || ".wav";
  const safeExt = [".wav", ".mp3", ".mpeg"].includes(ext) ? ext : ".wav";
  const filePath = path.join(os.tmpdir(), `myspm-stt-${Date.now()}-${randomUUID()}${safeExt}`);
  await fs.writeFile(filePath, buffer);
  try {
    return await fn(filePath);
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}
