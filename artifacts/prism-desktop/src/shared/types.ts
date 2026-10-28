export type ReleaseType = "Single" | "EP" | "Album" | "LP" | "Other";

export type ProjectAsset = {
  id: string;
  fileName: string;
  mimeType: string;
};

export type Release = {
  id: string;
  title: string;
  artistName: string;
  releaseType: ReleaseType;
  customReleaseType: string;
  description: string;
  artworkAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  songIds: string[];
};

export type AudioClip = {
  id: string;
  assetId: string;
  name: string;
  durationSeconds: number;
  startSeconds: number;
  gain: number;
  waveform: number[];
};

export type Track = {
  id: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  clips: AudioClip[];
};

export type SongSession = {
  id: string;
  releaseId: string;
  title: string;
  tempo: number;
  timeSignature: string;
  tracks: Track[];
  updatedAt: string;
};

export type CreateReleaseInput = {
  title: string;
  artistName: string;
  releaseType: ReleaseType;
  customReleaseType?: string;
  description: string;
};

export type UpdateReleaseInput = Partial<
  Pick<Release, "title" | "artistName" | "description" | "artworkAssetId">
>;

export type CreateSongInput = {
  releaseId: string;
  title: string;
};

export type AppBridge = {
  listReleases(): Promise<Release[]>;
  markReleaseOpened(releaseId: string): Promise<void>;
  getSession(sessionId: string): Promise<SongSession | null>;
  getRelease(releaseId: string): Promise<Release | null>;
  createRelease(input: CreateReleaseInput): Promise<{
    release: Release;
    session: SongSession | null;
  }>;
  updateRelease(releaseId: string, input: UpdateReleaseInput): Promise<Release>;
  duplicateRelease(releaseId: string): Promise<Release>;
  deleteRelease(releaseId: string): Promise<void>;
  addSong(input: CreateSongInput): Promise<SongSession>;
  updateSongTitle(sessionId: string, title: string): Promise<SongSession>;
  duplicateSong(sessionId: string): Promise<SongSession>;
  deleteSong(sessionId: string): Promise<void>;
  reorderSongs(releaseId: string, songIds: string[]): Promise<Release>;
  saveSession(session: SongSession): Promise<SongSession>;
  chooseArtwork(releaseId: string): Promise<Release | null>;
  selectArtwork(): Promise<ProjectAsset | null>;
  importAudio(sessionId: string): Promise<{ clip: AudioClip; assetUrl: string } | null>;
  assetUrl(assetId: string): string;
  openDataFolder(): Promise<void>;
  onCloseRequested(callback: () => void): () => void;
  finishClose(): Promise<void>;
};
