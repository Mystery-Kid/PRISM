import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectLibrary, StoredAsset } from "../shared/migrations";
import type { TempoMedia } from "../shared/tempo";

/** Stage all files before publishing metadata. Originals and sessions are never mutated. */
export async function storeTempoMedia(library: ProjectLibrary, directory: string, media: TempoMedia[], persist: () => Promise<void>): Promise<void> {
  if (!Array.isArray(media) || media.length > 128) throw new Error("Invalid tempo media transaction.");
  const staged: StoredAsset[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const item of media) {
    if (!item || !/^[\da-f-]{36}$/i.test(item.id) || seen.has(item.id) ||
        library.assets.some(asset => asset.id === item.id) ||
        !library.assets.some(asset => asset.id === item.originalAssetId))
      throw new Error("Invalid or missing original audio reference.");
    seen.add(item.id);
    const data = Buffer.from(item.audioData);
    total += data.length;
    if (total > 128 * 1024 * 1024 || data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" ||
        data.toString("ascii", 8, 12) !== "WAVE" || data.readUInt16LE(20) !== 1 ||
        ![1, 2].includes(data.readUInt16LE(22)) || data.readUInt16LE(34) !== 16 ||
        data.readUInt32LE(40) + 44 !== data.length)
      throw new Error("Invalid or oversized stretched WAV data.");
    staged.push({ id: item.id, fileName: "PRISM tempo derivative.wav", mimeType: "audio/wav", storageName: `${randomUUID()}.wav` });
  }
  const written: string[] = [];
  try {
    for (let index = 0; index < staged.length; index++) {
      const path = join(directory, staged[index].storageName);
      written.push(path);
      await writeFile(path, media[index].audioData, { flag: "wx" });
    }
    library.assets.push(...staged);
    await persist();
  } catch (error) {
    library.assets = library.assets.filter(asset => !seen.has(asset.id));
    await Promise.all(written.map(path => unlink(path).catch(() => undefined)));
    throw error;
  }
}
