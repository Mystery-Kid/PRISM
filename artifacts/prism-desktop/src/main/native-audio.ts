import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeAtomicText } from "./atomic-write";
import {
  validateNativeAudioConfiguration, type NativeAudioConfiguration,
  type NativeAudioProbe, type NativeAudioStatus,
} from "../shared/native-audio";

/** IPC/disk stay on this control thread, never on the native device callback. */
export class NativeAudioManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private output = "";
  private saved: NativeAudioConfiguration | null = null;
  private initialized = false;
  private lastError: string | null = null;
  private faulted = false;
  private starting: Promise<void> | null = null;
  private readonly settingsPath: string;
  constructor(directory: string) { this.settingsPath = join(directory, "native-audio-settings.json"); }
  private fail(message: string): void {
    this.faulted = true;
    this.lastError = message;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(message)); }
    this.pending.clear();
  }
  dispose(): void {
    const child = this.child;
    this.child = null; this.output = ""; this.starting = null;
    this.fail("Native audio host was closed.");
    child?.kill();
  }
  private async start(): Promise<void> {
    if (this.faulted) throw new Error(this.lastError || "Refresh native audio explicitly to reconnect.");
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async launch(): Promise<void> {
    if (process.platform !== "win32") throw new Error("The native audio device host is available on Windows only. Existing Web Audio playback remains available.");
    if (!this.initialized) {
      try { this.saved = validateNativeAudioConfiguration(JSON.parse(await readFile(this.settingsPath, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.lastError = "Saved native audio settings could not be read. Choose and apply valid settings explicitly.";
      }
      this.initialized = true;
    }
    const executable = app.isPackaged ? join(process.resourcesPath, "native", "prism-audio-host.exe") :
      resolve(app.getAppPath(), "../../generated-artifacts/prism-native-runtime/prism-audio-host.exe");
    await access(executable).catch(() => { throw new Error("Native audio host is not included in this build. Use the Web Audio compatibility path."); });
    const child = spawn(executable, [], { windowsHide: true, stdio: "pipe" });
    this.child = child; this.output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      this.output += chunk;
      if (this.output.length > 1024 * 1024) { this.dispose(); this.lastError = "Native audio response exceeded its limit."; return; }
      let end: number;
      while ((end = this.output.indexOf("\n")) >= 0) {
        const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
        let response: { id: number; ok: boolean; result?: unknown; error?: string };
        try { response = JSON.parse(line); } catch { this.dispose(); this.lastError = "Malformed native audio response."; return; }
        const entry = this.pending.get(response.id);
        if (!entry) continue;
        clearTimeout(entry.timer); this.pending.delete(response.id);
        if (response.ok === true) entry.resolve(response.result);
        else entry.reject(new Error(response.error || "Native audio command failed."));
      }
    });
    // Drain stderr to prevent a child from blocking; do not forward unbounded driver messages.
    child.stderr.resume();
    child.on("error", () => {
      if (this.child !== child) return;
      this.child = null; this.output = ""; this.fail("Native audio host could not start.");
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null; this.output = ""; this.fail("Native audio host stopped. Device audio is stopped; refresh explicitly to reconnect.");
    });
  }
  private async request<T>(command: string, fields: Record<string, unknown> = {}, timeout = 8000): Promise<T> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("Native audio host is unavailable.");
    if (this.pending.size >= 16) throw new Error("Native audio host is busy.");
    const id = ++this.sequence, payload = JSON.stringify({ ...fields, protocolVersion: 1, command, id }) + "\n";
    if (payload.length > 65536) throw new Error("Native audio command exceeds its size limit.");
    return new Promise<T>((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.dispose(); this.lastError = "Native audio host timed out and was stopped. Existing song data is unchanged.";
      }, timeout);
      this.pending.set(id, { timer, resolve: result => resolveRequest(result as T), reject });
      child.stdin.write(payload, error => {
        if (!error) return;
        this.dispose(); this.lastError = "Native audio command pipe failed.";
      });
    });
  }
  async status(refresh = false): Promise<NativeAudioStatus> {
    if (refresh) this.faulted = false;
    try {
      const status = await this.request<Omit<NativeAudioStatus, "stage" | "savedConfiguration">>(refresh ? "refresh" : "status");
      if (status.protocolVersion !== 1 || !Array.isArray(status.devices)) throw new Error("Native audio host protocol mismatch.");
      return { ...status, error: status.error || this.lastError, savedConfiguration: this.saved, stage: "device-host" };
    } catch (error) {
      return { protocolVersion: 1, available: false, asioCompiled: false, devices: [], active: null,
        savedConfiguration: this.saved, stage: "device-host", error: error instanceof Error ? error.message : "Native audio host unavailable." };
    }
  }
  async probe(input: unknown): Promise<NativeAudioProbe> {
    const value = validateNativeAudioConfiguration({ ...(input as object), sampleRate: 48000, bufferFrames: 256 });
    return this.request("probe", { deviceId: value.deviceId, mode: value.mode, channels: value.channels });
  }
  async open(input: unknown): Promise<NativeAudioStatus> {
    const value = validateNativeAudioConfiguration(input);
    await this.request("open", value);
    try { await writeAtomicText(this.settingsPath, JSON.stringify(value, null, 2)); }
    catch (error) { await this.request("close").catch(() => this.dispose()); throw error; }
    this.saved = value; this.lastError = null;
    return this.status();
  }
  async close(): Promise<NativeAudioStatus> {
    await this.request("close"); this.lastError = null; return this.status();
  }
  async testTone(): Promise<{ scheduled: boolean; durationMs: number }> { return this.request("test-tone"); }
  async controlPanel(deviceId: unknown): Promise<NativeAudioStatus> {
    if (typeof deviceId !== "string" || !deviceId.startsWith("asio:") || deviceId.length > 2048) throw new Error("Choose an available ASIO device.");
    await this.request("control-panel", { deviceId }, 120000); return this.status();
  }
}
