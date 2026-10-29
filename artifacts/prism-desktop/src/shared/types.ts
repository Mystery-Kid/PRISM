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
  sourceDurationSeconds: number;
  startSeconds: number;
  sourceStartSeconds: number;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  waveform: number[];
};

export type TrackType = "audio" | "instrument" | "sampler" | "drum" | "unsupported";

export type MidiNote = {
  id: string;
  pitch: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  /** Optional arrangement clip association; legacy notes remain absolute-beat events. */
  midiClipId?: string;
};

export type MidiClip = {
  id: string;
  name: string;
  startBeat: number;
  durationBeats: number;
};

export type InstrumentState = {
  waveform: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export type SamplerState = {
  sampleAssetId: string | null;
  rootNote: number;
  gain: number;
};

export type DrumPadState = {
  id: string;
  name: string;
  note: number;
  sampleAssetId: string | null;
  gain: number;
};

export type DrumKitState = {
  pads: DrumPadState[];
  patternLengthBars?: number;
  patternStartBeat?: number;
};

export type InstrumentRecoveryState = {
  originalType: string;
  rawState: JsonValue | null;
  message: string;
};

export type EffectType = "equalizer" | "reverb" | "delay" | "compressor";

export type EffectState = {
  id: string;
  type: EffectType;
  enabled: boolean;
  parameters: Record<string, number>;
};

export type BusSend = {
  id: string;
  busId: string;
  level: number;
  placement: "pre" | "post";
};

export type AudioBus = {
  id: string;
  name: string;
  level: number;
  muted: boolean;
  solo: boolean;
  outputBusId: string | null;
  sends: BusSend[];
  effects: EffectState[];
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EffectPresetEffect = {
  id: string;
  type: string;
  enabled: boolean;
  parameters: Record<string, number>;
  raw: { [key: string]: JsonValue };
};

export type EffectChainPreset = {
  id: string;
  name: string;
  version: 1;
  scope: "global" | "project";
  projectId: string | null;
  effects: EffectPresetEffect[];
  createdAt: string;
  updatedAt: string;
};

export type EffectChainPresetFile = {
  format: "prism-effect-chain";
  version: 1;
  name: string;
  effects: EffectPresetEffect[];
};

export type LoopRange = {
  enabled: boolean;
  startSeconds: number;
  endSeconds: number;
};

export type Track = {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  recordArmed: boolean;
  clips: AudioClip[];
  notes: MidiNote[];
  /** Optional grouping for arrangement editing; notes remain absolute beats for engine compatibility. */
  midiClips?: MidiClip[];
  instrument: InstrumentState | null;
  sampler?: SamplerState | null;
  drumKit?: DrumKitState | null;
  instrumentRecovery?: InstrumentRecoveryState | null;
  effects: EffectState[];
  outputBusId: string | null;
  sends: BusSend[];
};

export type SongSession = {
  id: string;
  releaseId: string;
  title: string;
  tempo: number;
  timeSignature: string;
  loopRange: LoopRange | null;
  metronomeEnabled: boolean;
  masterVolume: number;
  masterEffects: EffectState[];
  buses: AudioBus[];
  tracks: Track[];
  updatedAt: string;
};

export type RecordingStart = {
  sessionId: string;
  trackId: string;
  sampleRate: number;
  channels: 1 | 2;
  startSeconds: number;
};

export type RecordingFinish = {
  recordingId: string;
  waveform: number[];
};

export type RecordedTake = {
  clip: AudioClip;
  assetUrl: string;
  trackId: string;
};

export type ExportWavInput = {
  fileName: string;
  audioData: Uint8Array;
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
  saveProjectAs(session: SongSession): Promise<string | null>;
  openProject(): Promise<{ release: Release; session: SongSession } | null>;
  getAppVersion(): Promise<string>;
  requestExit(): Promise<void>;
  getThemeState(): Promise<import("./themes").ThemeState>;
  claimTheme(themeId: string): Promise<import("./themes").ThemeState>;
  applyTheme(themeId: string): Promise<import("./themes").ThemeState>;
  repairTheme(themeId: string): Promise<import("./themes").ThemeState>;
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
  listEffectPresets(projectId: string): Promise<EffectChainPreset[]>;
  saveEffectPreset(preset: Omit<EffectChainPreset, "createdAt" | "updatedAt">): Promise<EffectChainPreset>;
  deleteEffectPreset(presetId: string, projectId: string): Promise<void>;
  importEffectPreset(): Promise<EffectChainPresetFile | null>;
  exportEffectPreset(preset: EffectChainPresetFile): Promise<boolean>;
  chooseArtwork(releaseId: string): Promise<Release | null>;
  selectArtwork(): Promise<ProjectAsset | null>;
  importAudio(
    sessionId: string,
    trackId?: string,
  ): Promise<{ clip: AudioClip; assetUrl: string } | null>;
  listAudioAssets(): Promise<ProjectAsset[]>;
  importSample(): Promise<ProjectAsset | null>;
  startRecording(input: RecordingStart): Promise<string>;
  appendRecordingChunk(recordingId: string, samples: Float32Array): Promise<void>;
  finishRecording(input: RecordingFinish): Promise<RecordedTake>;
  preserveRecording(recordingId: string): Promise<void>;
  cancelRecording(recordingId: string): Promise<void>;
  exportWav(input: ExportWavInput): Promise<boolean>;
  assetUrl(assetId: string): string;
  openDataFolder(): Promise<void>;
  backupLibrary(): Promise<string | null>;
  restoreLibrary(): Promise<boolean>;
  onCloseRequested(callback: () => void): () => void;
  finishClose(): Promise<void>;
};
