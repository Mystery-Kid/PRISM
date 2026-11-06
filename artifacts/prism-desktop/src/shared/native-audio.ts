export type NativeAudioMode = "wasapi-shared" | "wasapi-exclusive" | "asio";
export type NativeAudioDevice = {
  id: string; name: string; api: "wasapi" | "asio";
  inputChannels: number; outputChannels: number; defaultSampleRate: number;
};
export type NativeAudioConfiguration = {
  deviceId: string; mode: NativeAudioMode; channels: number; sampleRate: number; bufferFrames: number;
};
export type NativeAudioStatus = {
  protocolVersion: 1;
  available: boolean;
  asioCompiled: boolean;
  devices: NativeAudioDevice[];
  active: null | {
    configuration: NativeAudioConfiguration; running: boolean;
    sampleRate: number | null; outputLatencySeconds: number | null;
    clockFrames: number; minimumCallbackFrames: number | null; maximumCallbackFrames: number | null; xruns: number;
  };
  error: string | null;
  savedConfiguration: NativeAudioConfiguration | null;
  stage: "device-host";
};
export type NativeAudioProbe = {
  sampleRates: number[];
  asioBuffer: null | { minimum: number; maximum: number; preferred: number; granularity: number };
  bufferValidation: string;
};
export type NativeAudioBridge = {
  nativeAudioStatus: (refresh?: boolean) => Promise<NativeAudioStatus>;
  nativeAudioProbe: (configuration: Pick<NativeAudioConfiguration, "deviceId" | "mode" | "channels">) => Promise<NativeAudioProbe>;
  nativeAudioOpen: (configuration: NativeAudioConfiguration) => Promise<NativeAudioStatus>;
  nativeAudioClose: () => Promise<NativeAudioStatus>;
  nativeAudioTestTone: () => Promise<{ scheduled: boolean; durationMs: number }>;
  nativeAudioControlPanel: (deviceId: string) => Promise<NativeAudioStatus>;
};

export function validateNativeAudioConfiguration(value: unknown): NativeAudioConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native audio configuration.");
  const input = value as Record<string, unknown>;
  if (typeof input.deviceId !== "string" || !input.deviceId.length || input.deviceId.length > 2048 ||
    !["wasapi-shared", "wasapi-exclusive", "asio"].includes(String(input.mode))) throw new Error("Select a supported native device and driver mode.");
  const boundedInteger = (key: string, minimum: number, maximum: number) => {
    const field = input[key];
    if (typeof field !== "number" || !Number.isInteger(field) || field < minimum || field > maximum) throw new Error(`Invalid native audio ${key}.`);
    return field;
  };
  return {
    deviceId: input.deviceId, mode: input.mode as NativeAudioMode,
    channels: boundedInteger("channels", 1, 64),
    sampleRate: boundedInteger("sampleRate", 8000, 384000),
    bufferFrames: boundedInteger("bufferFrames", 16, 8192),
  };
}
