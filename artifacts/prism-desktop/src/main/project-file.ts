import { randomUUID } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateProjectLibrary, type ProjectLibrary, type StoredAsset } from "../shared/migrations";
import type { Release, SongSession } from "../shared/types";
import { writeAtomicText } from "./atomic-write";

// A deliberately bounded, self-contained file: copying a .prism file also copies
// its audio, sampler media and cover. Larger libraries still have full backups.
export const maxProjectFileBytes = 192 * 1024 * 1024;
const maxMediaBytes = 128 * 1024 * 1024;
type EmbeddedAsset = StoredAsset & { data: string };
type ProjectFile = {
  format: "prism-project";
  version: 1;
  library: ProjectLibrary;
  media: EmbeddedAsset[];
};

function referencedAssets(release: Release, session: SongSession): Set<string> {
  const ids = new Set<string>();
  if (release.artworkAssetId) ids.add(release.artworkAssetId);
  for (const track of session.tracks) {
    track.clips.forEach((clip) => ids.add(clip.assetId));
    if (track.sampler?.sampleAssetId) ids.add(track.sampler.sampleAssetId);
    track.drumKit?.pads.forEach((pad) => {
      if (pad.sampleAssetId) ids.add(pad.sampleAssetId);
    });
  }
  return ids;
}

export async function saveProjectFile(
  destination: string,
  source: ProjectLibrary,
  session: SongSession,
  assetDirectory: string,
): Promise<void> {
  const original = source.releases.find((release) => release.id === session.releaseId);
  if (!original) throw new Error("The project release could not be found.");
  // The workstation exports the open song, not unrelated songs in an album.
  const release: Release = {
    ...structuredClone(original),
    title: session.title,
    releaseType: "Single",
    songIds: [session.id],
  };
  const ids = referencedAssets(release, session);
  const media: EmbeddedAsset[] = [];
  let bytes = 0;
  for (const id of ids) {
    const asset = source.assets.find((entry) => entry.id === id);
    if (!asset) throw new Error(`Referenced project media ${id} is missing. The project was not exported.`);
    const file = join(assetDirectory, asset.storageName);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new Error(`Media "${asset.fileName}" is missing. Restore it before saving a portable project.`);
    bytes += info.size;
    if (bytes > maxMediaBytes) throw new Error("Portable projects currently support up to 128 MB of media. Use Back up PRISM library for larger projects.");
    media.push({ ...asset, data: (await readFile(file)).toString("base64") });
  }
  const library: ProjectLibrary = {
    version: 5,
    releases: [release],
    sessions: [structuredClone(session)],
    assets: media.map(({ data: _data, ...asset }) => asset),
    effectPresets: source.effectPresets.filter((preset) =>
      preset.scope === "global" || preset.projectId === session.releaseId),
  };
  const portable: ProjectFile = { format: "prism-project", version: 1, library, media };
  const text = JSON.stringify(portable);
  if (Buffer.byteLength(text) > maxProjectFileBytes) throw new Error("The portable project exceeds the 192 MB file limit.");
  await writeAtomicText(destination, text);
}

export function parseProjectFile(text: string): { library: ProjectLibrary; media: Map<string, Buffer> } {
  if (Buffer.byteLength(text) > maxProjectFileBytes) throw new Error("This project exceeds the supported file size.");
  const file = JSON.parse(text) as Partial<ProjectFile>;
  if (!file || file.format !== "prism-project" || file.version !== 1 || !Array.isArray(file.media)) {
    throw new Error("Choose a supported PRISM .prism project file.");
  }
  const library = migrateProjectLibrary(file.library);
  if (library.releases.length !== 1 || library.sessions.length !== 1 ||
      library.sessions[0]!.releaseId !== library.releases[0]!.id) {
    throw new Error("A portable project must contain exactly one song and its release.");
  }
  const media = new Map<string, Buffer>();
  let total = 0;
  for (const item of file.media) {
    if (!item || typeof item.id !== "string" || typeof item.data !== "string" ||
        media.has(item.id) || !library.assets.some((asset) => asset.id === item.id) ||
        item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      throw new Error("The project's embedded media is damaged.");
    }
    const buffer = Buffer.from(item.data, "base64");
    if (buffer.toString("base64") !== item.data) throw new Error("The project's embedded media is damaged.");
    total += buffer.length;
    if (total > maxMediaBytes) throw new Error("This project's embedded media exceeds 128 MB.");
    media.set(item.id, buffer);
  }
  if (media.size !== library.assets.length ||
      [...referencedAssets(library.releases[0]!, library.sessions[0]!)].some((id) => !media.has(id))) {
    throw new Error("The project is missing embedded audio or artwork.");
  }
  return { library, media };
}

/** Fresh identities ensure reopening a portable file never overwrites a song. */
export async function importProjectFile(
  file: string,
  assetDirectory: string,
): Promise<{ library: ProjectLibrary; createdFiles: string[] }> {
  if ((await stat(file)).size > maxProjectFileBytes) throw new Error("This project exceeds the 192 MB file limit.");
  const parsed = parseProjectFile(await readFile(file, "utf8"));
  const library = structuredClone(parsed.library);
  const release = library.releases[0]!;
  const session = library.sessions[0]!;
  const previousReleaseId = release.id;
  release.id = randomUUID();
  session.id = randomUUID();
  session.releaseId = release.id;
  release.songIds = [session.id];
  release.releaseType = "Single";
  release.updatedAt = session.updatedAt = new Date().toISOString();
  const remapped = new Map(library.assets.map((asset) => [asset.id, randomUUID()]));
  const mediaId = (id: string | null) => id ? remapped.get(id) ?? id : null;
  release.artworkAssetId = mediaId(release.artworkAssetId);
  for (const track of session.tracks) {
    track.clips.forEach((clip) => { clip.assetId = mediaId(clip.assetId)!; });
    if (track.sampler) track.sampler.sampleAssetId = mediaId(track.sampler.sampleAssetId);
    track.drumKit?.pads.forEach((pad) => { pad.sampleAssetId = mediaId(pad.sampleAssetId); });
  }
  library.effectPresets.forEach((preset) => {
    preset.id = randomUUID();
    if (preset.projectId === previousReleaseId) preset.projectId = release.id;
  });
  const createdFiles: string[] = [];
  try {
    for (const asset of library.assets) {
      const previousId = asset.id;
      const extension = asset.storageName.slice(asset.storageName.lastIndexOf("."));
      asset.id = remapped.get(previousId)!;
      asset.storageName = `${asset.id}${extension}`;
      const destination = join(assetDirectory, asset.storageName);
      await writeFile(destination, parsed.media.get(previousId)!, { flag: "wx" });
      createdFiles.push(destination);
    }
    return { library, createdFiles };
  } catch (error) {
    await Promise.all(createdFiles.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}
