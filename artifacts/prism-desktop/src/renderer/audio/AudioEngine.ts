import type {
  AudioClip,
  EffectState,
  MidiNote,
  RecordedTake,
  SongSession,
  Track,
} from "@shared/types";
import captureProcessorUrl from "./capture-processor.js?url";
import { beatToSeconds, parseTimeSignature, secondsPerBeat } from "./time";
import { getClipWindow, getSessionDuration } from "./timeline";
import { createMasterGraph, createTrackGraph, readMeter, type MasterGraph, type TrackGraph } from "./graph";
import { renderSessionWav } from "./render";

export type AudioDevice = {
  id: string;
  label: string;
  kind: "audioinput" | "audiooutput";
};

export type EngineStatus = "stopped" | "playing" | "recording";

export type AudioEngineSnapshot = {
  status: EngineStatus;
  recording: boolean;
  position: number;
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  meters: Record<string, { peak: number; rms: number }>;
  inputMeter: { peak: number; rms: number };
  inputChannels: 1 | 2 | null;
};

type RecordingCallbacks = {
  onComplete(result: RecordedTake): void;
  onError(error: Error): void;
};

type ScheduledNode = AudioScheduledSourceNode & { __prismCleanup?: () => void };

const scheduleIntervalMs = 50;
const scheduleAheadSeconds = 2;
const startLeadSeconds = 0.12;

export class AudioEngine {
  private context: AudioContext | null = null;
  private session: SongSession | null = null;
  private assetUrl: (assetId: string) => string;
  private decodedAssets = new Map<string, AudioBuffer>();
  private tracks = new Map<string, TrackGraph>();
  private master: MasterGraph | null = null;
  private sources = new Set<ScheduledNode>();
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private playhead = 0;
  private anchorTimeline = 0;
  private anchorAudioTime = 0;
  private nextTimelinePosition = 0;
  private nextAudioTime = 0;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private monitorGain: GainNode | null = null;
  private inputStream: MediaStream | null = null;
  private recordingId: string | null = null;
  private recordingQueue: Promise<void> = Promise.resolve();
  private recordingPeaks: number[] = [];
  private recordingError: Error | null = null;
  private recordingErrorNotified = false;
  private inputMeter = { peak: 0, rms: 0 };
  private inputChannels: 1 | 2 | null = null;
  private recordingComplete: (() => void) | null = null;
  private recordingFailed: ((error: Error) => void) | null = null;
  private recordingCallbacks: RecordingCallbacks | null = null;

  constructor(assetUrl: (assetId: string) => string) {
    this.assetUrl = assetUrl;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      await this.context.audioWorklet.addModule(captureProcessorUrl);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const map = (device: MediaDeviceInfo): AudioDevice => ({
      id: device.deviceId,
      label: device.label || (device.kind === "audioinput" ? "Audio input" : "Audio output"),
      kind: device.kind as AudioDevice["kind"],
    });
    return {
      inputs: devices.filter((device) => device.kind === "audioinput").map(map),
      outputs: devices.filter((device) => device.kind === "audiooutput").map(map),
    };
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const context = await this.ensureContext();
    const capable = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof capable.setSinkId !== "function") {
      throw new Error("This version of Electron does not support selecting an audio output device.");
    }
    await capable.setSinkId(deviceId || "default");
  }

  snapshot(): AudioEngineSnapshot {
    const meters: AudioEngineSnapshot["meters"] = {};
    for (const [trackId, graph] of this.tracks) meters[trackId] = readMeter(graph.analyser);
    if (this.master) meters.master = readMeter(this.master.analyser);
    return {
      status: this.running ? "playing" : "stopped",
      recording: Boolean(this.recordingId),
      position: this.positionNow(),
      sampleRate: this.context?.sampleRate ?? null,
      baseLatency: this.context?.baseLatency ?? null,
      outputLatency: this.context?.outputLatency ?? null,
      meters,
      inputMeter: this.inputMeter,
      inputChannels: this.inputChannels,
    };
  }

  async start(
    session: SongSession,
    position = this.playhead,
    options: { allowEmpty?: boolean; startAt?: number } = {},
  ): Promise<void> {
    const context = await this.ensureContext();
    await this.loadSessionAudio(session);
    session = withDecodedClipDurations(session, this.decodedAssets);
    this.session = session;
    this.syncGraphs(session);
    const duration = getSessionDuration(session);
    if (!options.allowEmpty && duration <= 0) {
      throw new Error("Add an audio clip or instrument note before starting playback.");
    }
    this.stopScheduledSources();
    this.clearScheduler();
    const loop = session.loopRange?.enabled ? session.loopRange : null;
    let from = Math.max(0, position);
    if (loop && from >= loop.endSeconds) from = loop.startSeconds;
    this.playhead = from;
    this.anchorTimeline = from;
    this.anchorAudioTime = options.startAt ?? context.currentTime + startLeadSeconds;
    this.nextTimelinePosition = from;
    this.nextAudioTime = this.anchorAudioTime;
    this.running = true;
    this.fillSchedule(context.currentTime + scheduleAheadSeconds);
    this.scheduler = setInterval(() => {
      if (!this.context || !this.running) return;
      this.fillSchedule(this.context.currentTime + scheduleAheadSeconds);
      this.finishIfAtEnd();
    }, scheduleIntervalMs);
  }

  pause(): number {
    const position = this.positionNow();
    this.running = false;
    this.playhead = position;
    this.clearScheduler();
    this.stopScheduledSources();
    return position;
  }

  stop(resetPosition = false): number {
    this.pause();
    if (resetPosition) this.playhead = 0;
    return this.playhead;
  }

  seek(position: number): void {
    if (this.recordingId) return;
    const target = Math.max(0, Math.min(getSessionDuration(this.session), position));
    const wasRunning = this.running;
    this.playhead = target;
    if (wasRunning && this.session) {
      void this.start(this.session, target).catch(() => {
        this.running = false;
      });
    }
  }

  updateSession(next: SongSession): void {
    const previous = this.session;
    const position = this.positionNow();
    const wasRunning = this.running;
    this.session = next;
    this.syncGraphs(next);
    if (wasRunning && previous && needsReschedule(previous, next)) {
      void this.start(next, position).catch(() => {
        this.running = false;
      });
    }
  }

  async startRecording(
    session: SongSession,
    trackId: string,
    deviceId: string,
    monitoring: boolean,
    callbacks: RecordingCallbacks,
  ): Promise<void> {
    if (this.recordingId) throw new Error("A recording is already in progress.");
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track || track.type !== "audio") {
      throw new Error("Choose an armed audio track before recording.");
    }
    if (!track.recordArmed) throw new Error("Arm an audio track before recording.");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is not available in this desktop environment.");
    }

    const context = await this.ensureContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (cause) {
      throw new Error(
        cause instanceof Error
          ? `Microphone access failed: ${cause.message}`
          : "Microphone access was denied or the input device is unavailable.",
      );
    }

    const settings = stream.getAudioTracks()[0]?.getSettings();
    const channels: 1 | 2 = settings?.channelCount && settings.channelCount > 1 ? 2 : 1;
    const startAt = context.currentTime + startLeadSeconds;
    const startPosition = this.running ? this.positionAt(startAt) : this.playhead;
    this.inputStream = stream;
    let recordingId: string | null = null;
    try {
      recordingId = await window.prism.startRecording({
        sessionId: session.id,
        trackId,
        sampleRate: context.sampleRate,
        channels,
        startSeconds: startPosition,
      });
      this.recordingId = recordingId;
      this.inputChannels = channels;
      this.recordingPeaks = [];
      this.recordingError = null;
      this.recordingErrorNotified = false;
      this.recordingCallbacks = callbacks;
      this.recordingQueue = Promise.resolve();
      this.captureSource = context.createMediaStreamSource(stream);
      this.captureNode = new AudioWorkletNode(context, "prism-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: channels,
        channelCountMode: "explicit",
        outputChannelCount: [channels],
      });
      this.monitorGain = context.createGain();
      this.monitorGain.gain.value = monitoring ? 0.8 : 0;
      this.captureSource.connect(this.captureNode);
      this.captureNode.connect(this.monitorGain);
      this.monitorGain.connect(context.destination);
      this.captureNode.port.onmessage = (event: MessageEvent) => {
        const message = event.data as { type: string; samples?: ArrayBuffer };
        if (message.type === "meter") {
          const meter = event.data as { peak: number; rms: number };
          this.inputMeter = {
            peak: Math.max(0, Math.min(1, meter.peak)),
            rms: Math.max(0, Math.min(1, meter.rms)),
          };
        } else if (message.type === "chunk" && message.samples) {
          const samples = new Float32Array(message.samples);
          this.recordingPeaks.push(chunkPeak(samples));
          this.recordingQueue = this.recordingQueue.then(() =>
            window.prism.appendRecordingChunk(recordingId!, samples),
          ).catch((cause: unknown) => {
            const error = cause instanceof Error ? cause : new Error("Audio data could not be saved.");
            if (!this.recordingError) {
              this.recordingError = error;
              this.recordingCallbacks?.onError(error);
              this.recordingErrorNotified = true;
              this.recordingFailed?.(error);
              this.captureNode?.port.postMessage({
                type: "stop",
                stopFrame: Math.round(context.currentTime * context.sampleRate),
              });
            }
          });
        } else if (message.type === "complete") {
          this.recordingComplete?.();
        }
      };
      this.captureNode.onprocessorerror = () => {
        const error = new Error("The audio capture processor stopped unexpectedly.");
        this.recordingError = error;
        if (!this.recordingErrorNotified) {
          this.recordingCallbacks?.onError(error);
          this.recordingErrorNotified = true;
        }
        this.recordingFailed?.(error);
      };
      if (!this.running) {
        await this.start(session, startPosition, { allowEmpty: true, startAt });
      }
      this.captureNode.port.postMessage({
        type: "start",
        channels,
        startFrame: Math.round(startAt * context.sampleRate),
        monitoring,
      });
    } catch (cause) {
      if (recordingId) await window.prism.cancelRecording(recordingId).catch(() => undefined);
      this.cleanupCapture();
      this.recordingId = null;
      this.recordingCallbacks = null;
      throw cause;
    }
  }

  setMonitoring(enabled: boolean): void {
    if (this.monitorGain && this.context) {
      this.monitorGain.gain.setTargetAtTime(enabled ? 0.8 : 0, this.context.currentTime, 0.01);
    }
  }

  async stopRecording(): Promise<RecordedTake | null> {
    if (!this.recordingId || !this.context || !this.captureNode) return null;
    const recordingId = this.recordingId;
    const completion = new Promise<void>((resolve, reject) => {
      this.recordingComplete = resolve;
      this.recordingFailed = reject;
      if (this.recordingError) reject(this.recordingError);
    });
    this.captureNode.port.postMessage({
      type: "stop",
      stopFrame: Math.round(this.context.currentTime * this.context.sampleRate),
    });
    try {
      await completion;
      await this.recordingQueue;
      if (this.recordingError) throw this.recordingError;
      const waveform = waveformFromPeaks(this.recordingPeaks);
      const result = await window.prism.finishRecording({ recordingId, waveform });
      this.recordingCallbacks?.onComplete(result);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("The recording could not be saved.");
      await window.prism.preserveRecording(recordingId).catch(() => undefined);
      if (!this.recordingErrorNotified) this.recordingCallbacks?.onError(error);
      throw error;
    } finally {
      this.cleanupCapture();
      this.recordingId = null;
      this.recordingCallbacks = null;
      this.recordingComplete = null;
      this.recordingFailed = null;
      this.recordingError = null;
      this.recordingErrorNotified = false;
    }
  }

  async cancelRecording(): Promise<void> {
    const recordingId = this.recordingId;
    this.captureNode?.port.postMessage({ type: "cancel" });
    await this.recordingQueue.catch(() => undefined);
    this.cleanupCapture();
    this.recordingId = null;
    this.recordingCallbacks = null;
    if (recordingId) await window.prism.cancelRecording(recordingId);
  }

  async exportWav(session: SongSession): Promise<boolean> {
    const data = await renderSessionWav(session, (assetId) => this.loadAudio(assetId));
    return window.prism.exportWav({ fileName: session.title, audioData: data });
  }

  async dispose(): Promise<void> {
    if (this.recordingId) await this.stopRecording().catch(() => undefined);
    this.clearScheduler();
    this.stopScheduledSources();
    this.tracks.forEach((graph) => graph.dispose());
    this.tracks.clear();
    this.master?.dispose();
    this.master = null;
    await this.context?.close();
    this.context = null;
    this.decodedAssets.clear();
  }

  private cleanupCapture(): void {
    this.captureNode?.port.close();
    this.captureSource?.disconnect();
    this.captureNode?.disconnect();
    this.monitorGain?.disconnect();
    this.inputStream?.getTracks().forEach((track) => track.stop());
    this.captureNode = null;
    this.captureSource = null;
    this.monitorGain = null;
    this.inputStream = null;
    this.inputChannels = null;
    this.inputMeter = { peak: 0, rms: 0 };
  }

  private async loadSessionAudio(session: SongSession): Promise<void> {
    const ids = new Set(session.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
    await Promise.all([...ids].map((id) => this.loadAudio(id)));
  }

  async loadAudio(assetId: string): Promise<AudioBuffer> {
    const cached = this.decodedAssets.get(assetId);
    if (cached) return cached;
    const context = await this.ensureContext();
    const response = await fetch(this.assetUrl(assetId));
    if (!response.ok) throw new Error("An audio file could not be read from this project.");
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    this.decodedAssets.set(assetId, decoded);
    return decoded;
  }

  private syncGraphs(session: SongSession): void {
    if (!this.context) return;
    if (!this.master) {
      this.master = createMasterGraph(
        this.context,
        session.masterVolume,
        session.masterEffects,
        this.context.destination,
      );
    } else {
      this.master.update(session.masterVolume, session.masterEffects);
    }
    const isSoloed = session.tracks.some((track) => track.solo);
    const ids = new Set(session.tracks.map((track) => track.id));
    for (const [id, graph] of this.tracks) {
      if (!ids.has(id)) {
        graph.dispose();
        this.tracks.delete(id);
      }
    }
    for (const track of session.tracks) {
      let graph = this.tracks.get(track.id);
      if (!graph) {
        graph = createTrackGraph(this.context, track, this.master.input);
        this.tracks.set(track.id, graph);
      }
      graph.update(track, !isSoloed || track.solo);
    }
  }

  private totalDuration(): number {
    return getSessionDuration(this.session);
  }

  private positionAt(audioTime: number): number {
    if (!this.running || !this.session || !this.context) return this.playhead;
    let position = this.anchorTimeline + Math.max(0, audioTime - this.anchorAudioTime);
    const loop = this.session.loopRange;
    if (loop?.enabled && position >= loop.endSeconds) {
      const length = loop.endSeconds - loop.startSeconds;
      if (length > 0) position = loop.startSeconds + ((position - loop.startSeconds) % length);
    }
    return Math.min(position, this.totalDuration() || position);
  }

  private positionNow(): number {
    return this.context ? this.positionAt(this.context.currentTime) : this.playhead;
  }

  private fillSchedule(targetAudioTime: number): void {
    if (!this.context || !this.session || !this.running) return;
    const duration = this.totalDuration();
    const loop = this.session.loopRange?.enabled ? this.session.loopRange : null;
    let safety = 0;
    while (this.nextAudioTime < targetAudioTime && safety < 200) {
      safety += 1;
      if (!loop && this.nextTimelinePosition >= duration) break;
      if (loop && this.nextTimelinePosition >= loop.endSeconds) {
        this.nextTimelinePosition = loop.startSeconds;
      }
      const timelineLimit = loop?.endSeconds ?? duration;
      const segmentDuration = Math.min(
        targetAudioTime - this.nextAudioTime,
        timelineLimit - this.nextTimelinePosition,
      );
      if (segmentDuration <= 0.0001) {
        if (loop) this.nextTimelinePosition = loop.startSeconds;
        else break;
      } else {
        this.scheduleSegment(
          this.session,
          this.nextTimelinePosition,
          this.nextTimelinePosition + segmentDuration,
          this.nextAudioTime,
        );
        this.nextTimelinePosition += segmentDuration;
        this.nextAudioTime += segmentDuration;
      }
    }
  }

  private scheduleSegment(
    session: SongSession,
    timelineFrom: number,
    timelineTo: number,
    contextFrom: number,
  ): void {
    if (!this.context || timelineTo <= timelineFrom) return;
    const isSoloed = session.tracks.some((track) => track.solo);
    for (const track of session.tracks) {
      if (track.muted || (isSoloed && !track.solo)) continue;
      const graph = this.tracks.get(track.id);
      if (!graph) continue;
      for (const clip of track.clips) {
        const window = getClipWindow(clip, timelineFrom, timelineTo);
        if (!window) continue;
        const audio = this.decodedAssets.get(clip.assetId);
        if (audio) this.scheduleClip(
          audio,
          clip,
          graph,
          window.timelineStart,
          window.timelineEnd,
          window.sourceStart,
          timelineFrom,
          contextFrom,
        );
      }
      if (track.type === "instrument") {
        track.notes.forEach((note) =>
          this.scheduleNote(session, track, graph, note, timelineFrom, timelineTo, contextFrom),
        );
      }
    }
    if (session.metronomeEnabled) {
      this.scheduleMetronome(session, timelineFrom, timelineTo, contextFrom);
    }
  }

  private scheduleClip(
    audio: AudioBuffer,
    clip: AudioClip,
    graph: TrackGraph,
    clipFrom: number,
    clipTo: number,
    startOffset: number,
    timelineFrom: number,
    contextFrom: number,
  ): void {
    if (!this.context) return;
    const duration = Math.min(clipTo - clipFrom, clip.sourceDurationSeconds - startOffset);
    if (duration <= 0 || startOffset >= audio.duration) return;
    const source = this.context.createBufferSource() as ScheduledNode;
    const bufferSource = source as AudioBufferSourceNode;
    bufferSource.buffer = audio;
    const clipGain = this.context.createGain();
    const clipGainValue = Math.max(0, Math.min(2, clip.gain));
    const elapsedAtStart = clipFrom - clip.startSeconds;
    const elapsedAtEnd = clipTo - clip.startSeconds;
    const fadeIn = Math.min(clip.fadeInSeconds, clip.durationSeconds);
    const fadeOut = Math.min(clip.fadeOutSeconds, clip.durationSeconds);
    const fadeInLevel = fadeIn > 0 ? Math.min(1, elapsedAtStart / fadeIn) : 1;
    const fadeOutStart = clip.durationSeconds - fadeOut;
    const fadeOutLevel = fadeOut > 0 && elapsedAtStart > fadeOutStart
      ? Math.max(0, Math.min(1, (clip.durationSeconds - elapsedAtStart) / fadeOut))
      : 1;
    const when = contextFrom + clipFrom - timelineFrom;
    clipGain.gain.setValueAtTime(clipGainValue * Math.min(fadeInLevel, fadeOutLevel), when);
    if (fadeIn > elapsedAtStart && fadeIn > 0) {
      clipGain.gain.linearRampToValueAtTime(
        clipGainValue,
        contextFrom + clip.startSeconds + fadeIn - timelineFrom,
      );
    }
    if (fadeOut > 0 && elapsedAtEnd > fadeOutStart) {
      const fadeStart = Math.max(clipFrom, clip.startSeconds + fadeOutStart);
      if (fadeStart > clipFrom) {
        clipGain.gain.setValueAtTime(clipGainValue, contextFrom + fadeStart - timelineFrom);
      }
      clipGain.gain.linearRampToValueAtTime(
        0,
        contextFrom + clip.startSeconds + clip.durationSeconds - timelineFrom,
      );
    }
    source.connect(clipGain);
    clipGain.connect(graph.input);
    source.__prismCleanup = () => {
      source.disconnect();
      clipGain.disconnect();
    };
    source.onended = () => {
      source.__prismCleanup?.();
      this.sources.delete(source);
    };
    this.sources.add(source);
    const playableDuration = Math.min(duration, audio.duration - startOffset);
    bufferSource.start(when, Math.max(0, startOffset), playableDuration);
  }

  private scheduleNote(
    session: SongSession,
    track: Track,
    graph: TrackGraph,
    note: MidiNote,
    timelineFrom: number,
    timelineTo: number,
    contextFrom: number,
  ): void {
    if (!this.context || !track.instrument) return;
    const noteStart = beatToSeconds(note.startBeat, session.tempo, session.timeSignature);
    const noteEnd = beatToSeconds(
      note.startBeat + note.durationBeats,
      session.tempo,
      session.timeSignature,
    );
    const loop = session.loopRange?.enabled ? session.loopRange : null;
    const startsInSegment = noteStart >= timelineFrom && noteStart < timelineTo;
    const resumedAtNote = noteStart < timelineFrom && noteEnd > timelineFrom &&
      (Math.abs(timelineFrom - this.anchorTimeline) < 0.000001 ||
        (loop && Math.abs(timelineFrom - loop.startSeconds) < 0.000001));
    if (!startsInSegment && !resumedAtNote) return;
    const start = startsInSegment ? noteStart : timelineFrom;
    const end = Math.min(noteEnd, loop?.endSeconds ?? noteEnd);
    if (end <= start) return;
    const oscillator = this.context.createOscillator() as ScheduledNode;
    const oscillatorNode = oscillator as OscillatorNode;
    const envelope = this.context.createGain();
    const instrument = track.instrument;
    oscillatorNode.type = instrument.waveform;
    oscillatorNode.frequency.value = 440 * Math.pow(2, (note.pitch - 69) / 12);
    const when = contextFrom + start - timelineFrom;
    const endAt = contextFrom + end - timelineFrom;
    const attack = Math.min(instrument.attack, Math.max(0.005, endAt - when));
    const release = Math.min(instrument.release, Math.max(0.005, endAt - when));
    const sustainLevel = Math.max(0.01, Math.min(1, instrument.sustain)) * Math.max(0, Math.min(1, note.velocity / 127));
    if (resumedAtNote) {
      envelope.gain.setValueAtTime(sustainLevel, when);
    } else {
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(1, when + attack);
      envelope.gain.linearRampToValueAtTime(
        sustainLevel,
        Math.min(endAt, when + attack + instrument.decay),
      );
    }
    envelope.gain.setValueAtTime(sustainLevel, Math.max(when, endAt - release));
    envelope.gain.linearRampToValueAtTime(0, endAt);
    oscillator.connect(envelope);
    envelope.connect(graph.input);
    oscillator.__prismCleanup = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.onended = () => {
      oscillator.__prismCleanup?.();
      this.sources.delete(oscillator);
    };
    this.sources.add(oscillator);
    oscillator.start(when);
    oscillator.stop(endAt + 0.01);
  }

  private scheduleMetronome(
    session: SongSession,
    timelineFrom: number,
    timelineTo: number,
    contextFrom: number,
  ): void {
    if (!this.context) return;
    const beatLength = secondsPerBeat(session.tempo, session.timeSignature);
    const { numerator } = parseTimeSignature(session.timeSignature);
    let beatNumber = Math.ceil((timelineFrom - 1e-6) / beatLength);
    let at = beatNumber * beatLength;
    while (at < timelineTo) {
      const contextAt = contextFrom + at - timelineFrom;
      const accent = beatNumber % numerator === 0;
      const oscillator = this.context.createOscillator() as ScheduledNode;
      const oscillatorNode = oscillator as OscillatorNode;
      const gain = this.context.createGain();
      oscillatorNode.type = "sine";
      oscillatorNode.frequency.value = accent ? 1250 : 850;
      gain.gain.setValueAtTime(0.0001, contextAt);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.12, contextAt + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, contextAt + 0.035);
      oscillator.connect(gain);
      gain.connect(this.master?.input ?? this.context.destination);
      oscillator.__prismCleanup = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.onended = () => {
        oscillator.__prismCleanup?.();
        this.sources.delete(oscillator);
      };
      this.sources.add(oscillator);
      oscillator.start(contextAt);
      oscillator.stop(contextAt + 0.04);
      beatNumber += 1;
      at = beatNumber * beatLength;
    }
  }

  private finishIfAtEnd(): void {
    if (!this.context || !this.running || this.recordingId || this.session?.loopRange?.enabled) return;
    const duration = this.totalDuration();
    if (this.nextTimelinePosition >= duration && this.context.currentTime >= this.nextAudioTime) {
      this.playhead = duration;
      this.running = false;
      this.clearScheduler();
      this.stopScheduledSources();
    }
  }

  private stopScheduledSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // A source can already have ended between scheduler ticks.
      }
      source.__prismCleanup?.();
    }
    this.sources.clear();
  }

  private clearScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }
}

function needsReschedule(previous: SongSession, next: SongSession): boolean {
  if (
    previous.tempo !== next.tempo ||
    previous.timeSignature !== next.timeSignature ||
    previous.metronomeEnabled !== next.metronomeEnabled ||
    JSON.stringify(previous.loopRange) !== JSON.stringify(next.loopRange) ||
    previous.tracks.length !== next.tracks.length
  ) return true;
  return previous.tracks.some((track, index) => {
    const updated = next.tracks[index];
    return (
      !updated ||
      track.id !== updated.id ||
      track.type !== updated.type ||
      track.clips !== updated.clips ||
      track.notes !== updated.notes
    );
  });
}

function chunkPeak(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return Math.min(1, peak);
}

function withDecodedClipDurations(
  session: SongSession,
  assets: Map<string, AudioBuffer>,
): SongSession {
  let changed = false;
  const tracks = session.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const buffer = assets.get(clip.assetId);
      if (!buffer) return clip;
      const sourceDuration = Math.min(clip.sourceDurationSeconds || buffer.duration, buffer.duration);
      const available = Math.max(0, Math.min(sourceDuration, buffer.duration) - clip.sourceStartSeconds);
      const duration = clip.durationSeconds > 0
        ? Math.min(clip.durationSeconds, available)
        : available;
      if (
        sourceDuration === clip.sourceDurationSeconds &&
        duration === clip.durationSeconds
      ) return clip;
      changed = true;
      return { ...clip, sourceDurationSeconds: sourceDuration, durationSeconds: duration };
    }),
  }));
  return changed ? { ...session, tracks } : session;
}

function waveformFromPeaks(peaks: number[]): number[] {
  if (peaks.length === 0) return Array.from({ length: 112 }, () => 0);
  const bins = 112;
  return Array.from({ length: bins }, (_, index) => {
    const from = Math.floor(index * peaks.length / bins);
    const to = Math.max(from + 1, Math.floor((index + 1) * peaks.length / bins));
    return Math.max(0, ...peaks.slice(from, to));
  });
}
