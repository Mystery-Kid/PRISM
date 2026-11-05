import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, AudioLines, Check, CircleHelp, LoaderCircle,
  RefreshCw, ShieldCheck, Volume2,
} from "lucide-react";
import type {
  NativeAudioConfiguration, NativeAudioMode, NativeAudioProbe, NativeAudioStatus,
} from "@shared/native-audio";
import "./NativeAudioSettings.css";

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Native audio request failed. Your project data was not changed.";

const modeName = (mode: NativeAudioMode) => ({
  "wasapi-shared": "WASAPI Shared",
  "wasapi-exclusive": "WASAPI Exclusive",
  asio: "ASIO",
}[mode]);

const formatRate = (rate: number) => {
  if (!Number.isFinite(rate) || rate <= 0) return "Not reported";
  return rate >= 1000 ? `${(rate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz` : `${rate} Hz`;
};

function stopCompatibilityPlayback() {
  window.dispatchEvent(new CustomEvent("prism:stop-compatibility-playback"));
}

export function NativeAudioSettings() {
  const [status, setStatus] = useState<NativeAudioStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [mode, setMode] = useState<NativeAudioMode>("wasapi-shared");
  const [channels, setChannels] = useState(2);
  const [sampleRate, setSampleRate] = useState<number | "">("");
  const [bufferFrames, setBufferFrames] = useState("256");
  const [probe, setProbe] = useState<NativeAudioProbe | null>(null);
  const [ownsStream, setOwnsStream] = useState(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(false);
  const activeRequestRef = useRef<{ key: string | null; promise: Promise<unknown> } | null>(null);
  const initialRequestRef = useRef<Promise<NativeAudioStatus | undefined> | null>(null);
  const ownsStreamRef = useRef(false);
  const probeVersionRef = useRef(0);

  const setOwnership = useCallback((next: boolean) => {
    ownsStreamRef.current = next;
    if (mountedRef.current) setOwnsStream(next);
  }, []);

  const execute = useCallback(async <T,>(label: string, operation: () => Promise<T>, requestKey: string | null = null): Promise<T | undefined> => {
    if (requestRef.current) {
      if (requestKey && activeRequestRef.current?.key === requestKey) {
        return activeRequestRef.current.promise.then((value) => value as T, () => undefined);
      }
      return undefined;
    }
    requestRef.current = true;
    if (mountedRef.current) { setBusy(label); setError(""); setMessage(""); }
    const promise = Promise.resolve().then(operation);
    activeRequestRef.current = { key: requestKey, promise };
    try {
      return await promise;
    } catch (cause) {
      if (mountedRef.current) setError(errorMessage(cause));
      return undefined;
    } finally {
      requestRef.current = false;
      activeRequestRef.current = null;
      if (mountedRef.current) setBusy("");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    if (!initialRequestRef.current) {
      initialRequestRef.current = execute("Reading device host", () => window.prism.nativeAudioStatus());
    }
    void initialRequestRef.current.then((initial) => {
      if (cancelled || !mountedRef.current) return;
      if (initial) {
        setStatus(initial);
        const saved = initial.savedConfiguration;
        if (saved) {
          setSelectedDeviceId(saved.deviceId);
          setMode(saved.mode);
          setChannels(saved.channels);
          setSampleRate(saved.sampleRate);
          setBufferFrames(String(saved.bufferFrames));
        } else {
          const firstUsable = initial.devices.find((device) =>
            device.outputChannels > 0 && (device.api !== "asio" || initial.asioCompiled)
          );
          if (firstUsable) {
            setSelectedDeviceId(firstUsable.id);
            setMode(firstUsable.api === "asio" ? "asio" : "wasapi-shared");
            setChannels(Math.min(2, firstUsable.outputChannels));
          }
        }
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      probeVersionRef.current += 1;
      if (ownsStreamRef.current) {
        ownsStreamRef.current = false;
        void window.prism.nativeAudioClose().catch(() => undefined);
      }
    };
  }, [execute]);

  const selectedDevice = useMemo(
    () => status?.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [status?.devices, selectedDeviceId],
  );
  const modeIsValid = selectedDevice?.api === "asio"
    ? mode === "asio" && Boolean(status?.asioCompiled)
    : selectedDevice?.api === "wasapi" && (mode === "wasapi-shared" || mode === "wasapi-exclusive");
  const channelCountValid = Boolean(selectedDevice && channels >= 1 && channels <= selectedDevice.outputChannels);
  const rateIsProbed = typeof sampleRate === "number" && Boolean(probe?.sampleRates.includes(sampleRate));
  const parsedBuffer = Number(bufferFrames);
  const bufferIsValid = Number.isInteger(parsedBuffer) && parsedBuffer >= 16 && parsedBuffer <= 8192;
  const canOpen = Boolean(
    status?.available && selectedDevice && modeIsValid && channelCountValid
      && rateIsProbed && bufferIsValid && !busy,
  );

  const outputChannelLimit = selectedDevice?.outputChannels ?? 0;
  const statusAvailable = Boolean(status?.available);
  useEffect(() => {
    const version = ++probeVersionRef.current;
    setProbe(null);
    if (!selectedDevice || !statusAvailable || !modeIsValid || !channelCountValid) return;
    let cancelled = false;
    const requestKey = `probe:${selectedDevice.id}:${mode}:${channels}`;
    void execute("Checking device capabilities", () => window.prism.nativeAudioProbe({
      deviceId: selectedDevice.id,
      mode,
      channels,
    }), requestKey).then((result) => {
      if (!result || cancelled || !mountedRef.current || version !== probeVersionRef.current) return;
      setProbe(result);
    });
    return () => { cancelled = true; };
  }, [selectedDevice?.id, selectedDevice?.api, outputChannelLimit, statusAvailable, mode, channels, modeIsValid, channelCountValid, execute]);

  const activeRunning = Boolean(status?.active?.running);
  useEffect(() => {
    if (!activeRunning) return;
    const interval = window.setInterval(() => {
      if (requestRef.current) return;
      void execute("Checking active stream", () => window.prism.nativeAudioStatus()).then((next) => {
        if (!next || !mountedRef.current) return;
        setStatus(next);
        if (!next.active?.running && ownsStreamRef.current) setOwnership(false);
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [activeRunning, execute, setOwnership]);

  const refreshStoppedHardware = async () => {
    if (activeRunning) return;
    const next = await execute("Refreshing stopped hardware", () => window.prism.nativeAudioStatus(true));
    if (next && mountedRef.current) setStatus(next);
  };

  const openDiagnosticStream = async () => {
    if (requestRef.current || !canOpen || !selectedDevice || typeof sampleRate !== "number") return;
    const configuration: NativeAudioConfiguration = {
      deviceId: selectedDevice.id,
      mode,
      channels,
      sampleRate,
      bufferFrames: parsedBuffer,
    };
    stopCompatibilityPlayback();
    const next = await execute("Opening diagnostic stream", () => window.prism.nativeAudioOpen(configuration));
    if (!next) return;
    if (!mountedRef.current) {
      if (next.active?.running) await window.prism.nativeAudioClose().catch(() => undefined);
      return;
    }
    setStatus(next);
    setOwnership(Boolean(next.active?.running));
    if (next.active?.running) setMessage("Diagnostic output stream is open. No song playback or recording is routed through it.");
    else setError(next.error || "The host did not confirm an active diagnostic stream. Check the device and try again.");
  };

  const closeDiagnosticStream = async () => {
    if (!ownsStreamRef.current) return;
    const next = await execute("Closing diagnostic stream", () => window.prism.nativeAudioClose());
    if (!next || !mountedRef.current) return;
    setStatus(next);
    if (!next.active?.running) {
      setOwnership(false);
      setMessage("Diagnostic stream closed. Existing song playback remains on the compatibility path.");
    } else {
      setError("The host still reports an active stream. Retry close before using exclusive output elsewhere.");
    }
  };

  const testOutput = async () => {
    if (requestRef.current || !ownsStreamRef.current) return;
    stopCompatibilityPlayback();
    const result = await execute("Scheduling output test", () => window.prism.nativeAudioTestTone());
    if (result && mountedRef.current) {
      setMessage(result.scheduled
        ? `Short low-level test tone scheduled for ${result.durationMs} ms.`
        : "The native host did not schedule the output test.");
    }
  };

  const openAsioControlPanel = async () => {
    if (!selectedDevice || selectedDevice.api !== "asio" || !status?.asioCompiled) return;
    const next = await execute("Opening ASIO control panel", () => window.prism.nativeAudioControlPanel(selectedDevice.id));
    if (next && mountedRef.current) {
      setStatus(next);
      setMessage("ASIO control panel request completed. Review the driver’s own settings window.");
    }
  };

  const chooseDevice = (deviceId: string) => {
    const device = status?.devices.find((entry) => entry.id === deviceId);
    setSelectedDeviceId(deviceId);
    if (!device) return;
    setMode(device.api === "asio" ? "asio" : "wasapi-shared");
    setChannels(Math.min(2, device.outputChannels));
    setSampleRate("");
  };

  return (
    <div className="native-audio-settings" data-testid="native-audio-settings">
      <header className="native-audio-heading">
        <div>
          <span className="native-audio-kicker">DEVICE HOST · DIAGNOSTIC ONLY</span>
          <h3>Audio Devices</h3>
          <p>Inspect a real output device and test its native stream without changing any song.</p>
        </div>
        <button
          type="button"
          className="native-audio-refresh"
          onClick={() => void refreshStoppedHardware()}
          disabled={Boolean(busy) || activeRunning}
          data-testid="native-audio-refresh"
          title={activeRunning ? "Close the diagnostic stream before refreshing hardware." : "Refresh hardware while the diagnostic stream is stopped."}
        >
          {busy === "Refreshing stopped hardware" ? <LoaderCircle className="native-audio-spin" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </header>

      <div className="native-audio-project-note" role="note">
        <ShieldCheck size={17} />
        <span><strong>This is not the song engine.</strong> Current projects continue to use Web Audio and buffered VST3. Native realtime project playback, MIDI, and recording are not integrated in this stage.</span>
      </div>

      {loading && <div className="native-audio-loading" aria-label="Loading native audio device status"><i /><i /><i /></div>}
      {!loading && !status && <div className="native-audio-state native-audio-error" role="alert">
        <AlertCircle size={16} /><span>{error || "Device-host status could not be read."}</span>
        <button type="button" onClick={() => void refreshStoppedHardware()} disabled={Boolean(busy)}>Retry</button>
      </div>}

      {status && <>
        <div className={`native-audio-host-state ${status.available ? "is-available" : "is-unavailable"}`} data-testid="native-audio-host-state" role="status">
          <span className="native-audio-state-dot" />
          <div><strong>{status.available ? "Native device host available" : "Native device host unavailable"}</strong>
            <span>{status.available
              ? `${status.devices.length} device${status.devices.length === 1 ? "" : "s"} reported · ${status.asioCompiled ? "ASIO compiled" : "WASAPI modes only"}`
              : status.error || "No native host or supported platform detected."}</span>
          </div>
        </div>

        {status.error && status.available && <div className="native-audio-state native-audio-error" role="alert"><AlertCircle size={15} />{status.error}</div>}

        {!status.devices.length && <div className="native-audio-empty" data-testid="native-audio-empty">
          <AudioLines size={20} />
          <strong>{status.available ? "No output devices reported" : "Device enumeration is unavailable"}</strong>
          <span>{status.available ? "Connect or enable a WASAPI device, then refresh while the stream is stopped." : "The diagnostic host is unavailable here. No physical-device capability is being assumed."}</span>
        </div>}

        {status.devices.length > 0 && <div className="native-audio-config">
          <div className="native-audio-section-head">
            <div><span className="native-audio-kicker">OUTPUT CONFIGURATION</span><h4>Diagnostic stream</h4></div>
            <span className="native-audio-read-only"><CircleHelp size={13} /> Explicit open only</span>
          </div>
          <label className="native-audio-field native-audio-device">
            <span>Output device</span>
            <select aria-label="Native audio output device" data-testid="native-audio-device" value={selectedDeviceId} onChange={(event) => chooseDevice(event.target.value)} disabled={Boolean(busy) || activeRunning}>
              {!selectedDeviceId && <option value="">Choose a detected output device</option>}
              {selectedDeviceId && !status.devices.some((device) => device.id === selectedDeviceId) && <option value={selectedDeviceId} disabled>Saved device not currently detected</option>}
              {status.devices.map((device) => <option key={device.id} value={device.id} disabled={device.api === "asio" && !status.asioCompiled}>
                {device.name} · {device.api === "asio" ? "ASIO" : "WASAPI"}{device.outputChannels ? ` · ${device.outputChannels} out` : " · no output channels"}{device.defaultSampleRate ? ` · default ${formatRate(device.defaultSampleRate)}` : ""}
                {device.api === "asio" && !status.asioCompiled ? " · unavailable in this build" : ""}
              </option>)}
            </select>
          </label>

          <div className="native-audio-field-grid">
            <label className="native-audio-field">
              <span>Driver mode</span>
              <select aria-label="Native audio driver mode" data-testid="native-audio-mode" value={selectedDevice?.api === "asio" && !status.asioCompiled ? "" : mode} onChange={(event) => setMode(event.target.value as NativeAudioMode)} disabled={Boolean(busy) || activeRunning || !selectedDevice || selectedDevice.api === "asio"}>
                {selectedDevice?.api === "asio"
                  ? status.asioCompiled
                    ? <option value="asio">ASIO · device driver</option>
                    : <option value="" disabled>Driver unavailable in this build</option>
                  : <>
                    {mode === "asio" && <option value="asio" disabled>Saved ASIO mode unavailable for this device</option>}
                    <option value="wasapi-shared">WASAPI Shared</option>
                    <option value="wasapi-exclusive">WASAPI Exclusive</option>
                  </>}
              </select>
            </label>
            <label className="native-audio-field">
              <span>Output channels <small>Device maximum: {outputChannelLimit}</small></span>
              <select aria-label="Native audio output channels" data-testid="native-audio-channels" value={channels} onChange={(event) => setChannels(Number(event.target.value))} disabled={Boolean(busy) || activeRunning || !selectedDevice || outputChannelLimit < 1}>
                {selectedDevice && (channels < 1 || channels > outputChannelLimit) && <option value={channels} disabled>{channels} · not reported by this device</option>}
                {Array.from({ length: outputChannelLimit }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? "channel" : "channels"}</option>)}
              </select>
            </label>
            <label className="native-audio-field">
              <span>Sample rate <small>Native probe results only</small></span>
              <select aria-label="Native audio sample rate" data-testid="native-audio-rate" value={sampleRate === "" ? "" : String(sampleRate)} onChange={(event) => setSampleRate(event.target.value ? Number(event.target.value) : "")} disabled={Boolean(busy) || activeRunning || !probe?.sampleRates.length}>
                <option value="">Choose a probed rate</option>
                {typeof sampleRate === "number" && !probe?.sampleRates.includes(sampleRate) && <option value={sampleRate} disabled>{formatRate(sampleRate)} · not reported by this device</option>}
                {(probe?.sampleRates ?? []).map((rate) => <option key={rate} value={rate}>{formatRate(rate)}</option>)}
              </select>
            </label>
            <label className="native-audio-field">
              <span>Requested buffer <small>Frames requested from host</small></span>
              <input aria-label="Requested audio buffer frames" data-testid="native-audio-buffer" type="number" min={16} max={8192} step={1} inputMode="numeric" value={bufferFrames} onChange={(event) => setBufferFrames(event.target.value)} disabled={Boolean(busy) || activeRunning} />
            </label>
          </div>

          <div className="native-audio-probe-note" data-testid="native-audio-probe">
            {probe
              ? <>
                <Activity size={14} />
                <span>{probe.sampleRates.length
                  ? `Probed rates: ${probe.sampleRates.map(formatRate).join(" · ")}`
                  : "The selected device reported no sample rates for this mode."}
                  {probe.asioBuffer && ` · ASIO buffer range ${probe.asioBuffer.minimum}–${probe.asioBuffer.maximum}, preferred ${probe.asioBuffer.preferred}, step ${probe.asioBuffer.granularity || "driver-defined"}`}
                  {probe.bufferValidation && ` · ${probe.bufferValidation}`}
                </span>
              </>
              : <><Activity size={14} /><span>{selectedDevice ? "Checking actual device capabilities…" : "Select a detected output device to query supported rates."}</span></>}
          </div>

          {selectedDevice?.api === "asio" && status.asioCompiled && <button type="button" className="native-audio-control-panel" onClick={() => void openAsioControlPanel()} disabled={Boolean(busy) || activeRunning} data-testid="native-audio-control-panel">
            <AudioLines size={14} />Open ASIO control panel
          </button>}

          <div className="native-audio-action-row">
            {!ownsStream
              ? <button type="button" className="native-audio-primary" onClick={() => void openDiagnosticStream()} disabled={!canOpen} data-testid="native-audio-open">
                {busy === "Opening diagnostic stream" ? <LoaderCircle className="native-audio-spin" size={15} /> : <Activity size={15} />}
                Open diagnostic stream
              </button>
              : <button type="button" className="native-audio-close" onClick={() => void closeDiagnosticStream()} disabled={Boolean(busy)} data-testid="native-audio-close">Close diagnostic stream</button>}
            <button type="button" className="native-audio-test" onClick={() => void testOutput()} disabled={!ownsStream || Boolean(busy)} data-testid="native-audio-test">
              {busy === "Scheduling output test" ? <LoaderCircle className="native-audio-spin" size={15} /> : <Volume2 size={15} />}
              Test output
            </button>
          </div>

          {busy && <p className="native-audio-busy" role="status"><LoaderCircle className="native-audio-spin" size={13} />{busy}…</p>}
          {error && <div className="native-audio-state native-audio-error" role="alert" data-testid="native-audio-error"><AlertCircle size={15} /><span>{error}</span></div>}
          {message && <div className="native-audio-state native-audio-success" role="status" data-testid="native-audio-message"><Check size={15} /><span>{message}</span></div>}
        </div>}

        {status.active && <section className="native-audio-observed" aria-label="Observed native stream state" data-testid="native-audio-observed">
          <div className="native-audio-section-head">
            <div><span className="native-audio-kicker">LIVE HOST REPORT</span><h4>{status.active.running ? "Stream active" : "Stream stopped"}</h4></div>
            <span className={`native-audio-stream-tag ${status.active.running ? "is-running" : ""}`}>{ownsStream ? "Opened here" : "Reported by host"}</span>
          </div>
          <p className="native-audio-active-device">{status.devices.find((device) => device.id === status.active?.configuration.deviceId)?.name ?? "Device not currently enumerated"} · {modeName(status.active.configuration.mode)}</p>
          <p className="native-audio-active-request">Requested at open: {status.active.configuration.channels} ch · {formatRate(status.active.configuration.sampleRate)} · {status.active.configuration.bufferFrames} frames</p>
          <div className="native-audio-metrics">
            <div><span>Observed rate</span><strong>{status.active.sampleRate ? formatRate(status.active.sampleRate) : "Not reported"}</strong></div>
            <div><span>Output latency</span><strong>{status.active.outputLatencySeconds === null || !Number.isFinite(status.active.outputLatencySeconds) || status.active.outputLatencySeconds < 0
              ? "Not reported" : `${(status.active.outputLatencySeconds * 1000).toFixed(2)} ms`}</strong></div>
            <div><span>Callback frames</span><strong>{status.active.minimumCallbackFrames === null || status.active.maximumCallbackFrames === null
              ? "Not reported" : status.active.minimumCallbackFrames === status.active.maximumCallbackFrames
                ? `${status.active.minimumCallbackFrames}` : `${status.active.minimumCallbackFrames}–${status.active.maximumCallbackFrames}`}</strong></div>
            <div><span>XRuns</span><strong>{status.active.xruns}</strong></div>
          </div>
          <p className="native-audio-metric-caption">Observed callback sizes and latency are host measurements; they are separate from the requested buffer value above.</p>
        </section>}

        <section className="native-audio-saved" data-testid="native-audio-saved">
          <span className="native-audio-kicker">LAST SUCCESSFUL CONFIGURATION</span>
          {status.savedConfiguration
            ? <p>{status.devices.find((device) => device.id === status.savedConfiguration?.deviceId)?.name ?? "Saved device not currently detected"} · {modeName(status.savedConfiguration.mode)} · {status.savedConfiguration.channels} ch · {formatRate(status.savedConfiguration.sampleRate)} · requested {status.savedConfiguration.bufferFrames} frames</p>
            : <p>No successful native device configuration has been saved on this computer.</p>}
        </section>
      </>}
    </div>
  );
}
