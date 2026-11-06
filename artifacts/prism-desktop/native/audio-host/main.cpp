#include "audio-core.hpp"
#include <portaudio.h>
#include <pa_win_wasapi.h>
#if PRISM_WITH_ASIO
#include <pa_asio.h>
#endif
#include <nlohmann/json.hpp>
#include <windows.h>
#include <mmdeviceapi.h>
#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>
#include <chrono>

using json = nlohmann::json;
struct Device { int index; std::string id, name, api; int inputs, outputs; double rate; };

static void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
static void paCheck(PaError error) { if (error < paNoError) throw std::runtime_error(Pa_GetErrorText(error)); }
static int integer(const json& value, const char* field, int low, int high) {
  require(value.contains(field) && value[field].is_number_integer(), "Expected an integer field");
  const auto result = value[field].get<int64_t>();
  require(result >= low && result <= high, "Integer outside supported bounds");
  return static_cast<int>(result);
}
static std::string utf8(const wchar_t* text) {
  const int length = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
  if (length <= 1) return "";
  std::string result(length, '\0');
  WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), length, nullptr, nullptr);
  result.pop_back(); return result;
}
class DeviceHost {
  std::vector<Device> devices;
  std::unique_ptr<prism::AudioCore> core;
  PaStream* stream = nullptr;
  json configuration = nullptr;
  bool initialized = false;
  std::string lastError;
  uint64_t lastEventFrame = 0;
  uint64_t observedClock = 0;
  std::chrono::steady_clock::time_point clockAdvanced = std::chrono::steady_clock::now();
  static int callback(const void*, void* output, unsigned long frames,
                      const PaStreamCallbackTimeInfo*, PaStreamCallbackFlags flags, void* data) noexcept {
    auto* audio = static_cast<prism::AudioCore*>(data);
    if (flags & (paInputOverflow | paOutputUnderflow)) audio->xruns.fetch_add(1, std::memory_order_relaxed);
    audio->render(static_cast<float*>(output), static_cast<unsigned>(frames));
    return paContinue;
  }
  const Device& device(const json& command) {
    require(command.contains("deviceId") && command["deviceId"].is_string(), "Select a native output device");
    const auto id = command["deviceId"].get<std::string>();
    for (const auto& value : devices) if (value.id == id) return value;
    throw std::runtime_error("Device is no longer available; refresh devices explicitly");
  }
  PaStreamParameters parameters(const Device& value, const json& command, PaWasapiStreamInfo& wasapi) {
    const int channels = integer(command, "channels", 1, std::min(64, value.outputs));
    require(command.contains("mode") && command["mode"].is_string(), "Choose a driver mode");
    const auto mode = command["mode"].get<std::string>();
    PaStreamParameters result{};
    result.device = value.index; result.channelCount = channels; result.sampleFormat = paFloat32;
    const auto* info = Pa_GetDeviceInfo(value.index);
    require(info != nullptr, "Device disconnected");
    result.suggestedLatency = info->defaultLowOutputLatency;
    if (value.api == "wasapi") {
      require(mode == "wasapi-shared" || mode == "wasapi-exclusive", "Mode does not match WASAPI device");
      wasapi.size = sizeof(wasapi); wasapi.hostApiType = paWASAPI; wasapi.version = 1;
      // Do not silently enable sample-rate conversion or fall back to shared mode.
      wasapi.flags = mode == "wasapi-exclusive" ? paWinWasapiExclusive : 0;
      result.hostApiSpecificStreamInfo = &wasapi;
    } else require(mode == "asio" && value.api == "asio", "Mode does not match ASIO device");
    return result;
  }
public:
  DeviceHost() {
    const auto error = Pa_Initialize();
    initialized = error == paNoError;
    if (!initialized) lastError = Pa_GetErrorText(error);
    else enumerate();
  }
  ~DeviceHost() { close(); if (initialized) Pa_Terminate(); }
  void enumerate() {
    require(initialized, "PortAudio initialization failed");
    require(!stream, "Stop the native stream before refreshing hardware");
    devices.clear();
    const auto count = Pa_GetDeviceCount(); paCheck(count);
    for (int index = 0; index < count; ++index) {
      const auto* info = Pa_GetDeviceInfo(index);
      if (!info) continue;
      const auto* api = Pa_GetHostApiInfo(info->hostApi);
      if (!api || (api->type != paWASAPI && api->type != paASIO)) continue;
      Device value{index, "", info->name, api->type == paWASAPI ? "wasapi" : "asio",
                   info->maxInputChannels, info->maxOutputChannels, info->defaultSampleRate};
      if (api->type == paWASAPI) {
        void* endpoint = nullptr;
        if (PaWasapi_GetIMMDevice(index, &endpoint) == paNoError && endpoint) {
          wchar_t* id = nullptr;
          if (SUCCEEDED(static_cast<IMMDevice*>(endpoint)->GetId(&id))) {
            value.id = "wasapi:" + utf8(id); CoTaskMemFree(id);
          }
        }
        // No unstable index-based identity is persisted as a device selection.
        if (value.id.empty()) continue;
      } else value.id = "asio:" + value.name;
      devices.push_back(value);
    }
  }
  json status() {
    json list = json::array();
    for (const auto& value : devices) list.push_back({
      {"id",value.id},{"name",value.name},{"api",value.api},{"inputChannels",value.inputs},
      {"outputChannels",value.outputs},{"defaultSampleRate",value.rate}});
    json active = nullptr;
    if (stream) {
      const auto running = Pa_IsStreamActive(stream);
      const auto clock = core->clock.load(std::memory_order_acquire);
      if (clock != observedClock) { observedClock = clock; clockAdvanced = std::chrono::steady_clock::now(); }
      const bool stalled = std::chrono::steady_clock::now() - clockAdvanced > std::chrono::seconds(3);
      if (running <= 0 || stalled) {
        lastError = running < 0 ? Pa_GetErrorText(running) :
          stalled ? "Native device callback stopped advancing; close and refresh devices" :
          "Native stream stopped unexpectedly; refresh devices explicitly";
        close(); return status();
      }
      const auto* info = Pa_GetStreamInfo(stream);
      active = {{"configuration",configuration},{"running",running == 1},
        {"sampleRate",info ? json(info->sampleRate) : json(nullptr)},
        {"outputLatencySeconds",info ? json(info->outputLatency) : json(nullptr)},
        {"clockFrames",core->clock.load(std::memory_order_acquire)},
        {"minimumCallbackFrames",core->minimumBlock.load() ? json(core->minimumBlock.load()) : json(nullptr)},
        {"maximumCallbackFrames",core->maximumBlock.load() ? json(core->maximumBlock.load()) : json(nullptr)},
        {"xruns",core->xruns.load()}};
    }
    return {{"protocolVersion",1},{"available",initialized},{"asioCompiled",PRISM_WITH_ASIO != 0},
      {"devices",list},{"active",active},{"error",lastError.empty() ? json(nullptr) : json(lastError)}};
  }
  json probe(const json& command) {
    require(!stream, "Stop stream before probing formats");
    const auto& value = device(command);
    PaWasapiStreamInfo wasapi{}; const auto params = parameters(value, command, wasapi);
    json rates = json::array();
    for (const double rate : {44100.,48000.,88200.,96000.,176400.,192000.,352800.,384000.})
      if (Pa_IsFormatSupported(nullptr,&params,rate) == paFormatIsSupported) rates.push_back(rate);
    if (std::find(rates.begin(),rates.end(),value.rate) == rates.end() &&
        Pa_IsFormatSupported(nullptr,&params,value.rate) == paFormatIsSupported) rates.push_back(value.rate);
    json asio = nullptr;
#if PRISM_WITH_ASIO
    if (value.api == "asio") {
      long minimum = 0, maximum = 0, preferred = 0, granularity = 0;
      paCheck(PaAsio_GetAvailableBufferSizes(value.index,&minimum,&maximum,&preferred,&granularity));
      asio = {{"minimum",minimum},{"maximum",maximum},{"preferred",preferred},{"granularity",granularity}};
    }
#endif
    return {{"sampleRates",rates},{"asioBuffer",asio},{"bufferValidation","Requested buffers are verified by opening the stream; callback sizes and latency are reported from the active stream."}};
  }
  json open(const json& command) {
    require(!stream, "Close the native stream before changing settings");
    const auto& value = device(command);
    const int rate = integer(command,"sampleRate",8000,384000);
    const int frames = integer(command,"bufferFrames",16,8192);
    PaWasapiStreamInfo wasapi{}; const auto params = parameters(value,command,wasapi);
    paCheck(Pa_IsFormatSupported(nullptr,&params,rate));
    core = std::make_unique<prism::AudioCore>();
    core->configure(rate,params.channelCount);
    PaStream* candidate = nullptr;
    paCheck(Pa_OpenStream(&candidate,nullptr,&params,rate,frames,paClipOff,callback,core.get()));
    const auto error = Pa_StartStream(candidate);
    if (error < 0) { Pa_CloseStream(candidate); core.reset(); paCheck(error); }
    stream = candidate; configuration = command; configuration.erase("id"); configuration.erase("command"); configuration.erase("protocolVersion");
    lastError.clear(); lastEventFrame = 0; observedClock = 0; clockAdvanced = std::chrono::steady_clock::now();
    return status();
  }
  void close() noexcept {
    if (stream) { Pa_AbortStream(stream); Pa_CloseStream(stream); stream = nullptr; }
    core.reset(); configuration = nullptr; lastEventFrame = 0;
  }
  json execute(const json& command) {
    require(command.is_object() && command.value("protocolVersion",0) == 1, "Unsupported native audio protocol");
    const auto action = command.value("command", "");
    if (action == "status") return status();
    if (action == "refresh") { enumerate(); return status(); }
    if (action == "probe") return probe(command);
    if (action == "open") return open(command);
    if (action == "close") { close(); lastError.clear(); return status(); }
    if (action == "test-tone") {
      require(stream && Pa_IsStreamActive(stream) == 1, "Open a native stream before testing output");
      const auto now = core->clock.load(std::memory_order_acquire);
      require(now >= lastEventFrame, "Wait for the previous diagnostic tone to finish");
      const auto rate = configuration["sampleRate"].get<unsigned>();
      const auto start = now + rate / 20, end = start + rate / 3;
      require(core->enqueue({start,69,.5f}) && core->enqueue({end,69,0}), "Native event queue full");
      lastEventFrame = end + rate / 2; return {{"scheduled",true},{"durationMs",334}};
    }
#if PRISM_WITH_ASIO
    if (action == "control-panel") {
      const auto& value = device(command);
      require(value.api == "asio", "Control panel is available only for ASIO devices");
      require(!stream,"Stop stream before opening driver control panel");
      paCheck(PaAsio_ShowControlPanel(value.index,nullptr)); return status();
    }
#endif
    throw std::runtime_error("Unsupported native audio command");
  }
};
int main() {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  try {
    DeviceHost host;
    std::string line; line.reserve(65536);
    // Bound every line before parsing; do not let getline allocate without limit.
    while (std::cin.good()) {
      line.clear(); char c = 0;
      while (std::cin.get(c) && c != '\n') {
        if (line.size() >= 65536) throw std::runtime_error("Native audio command exceeds size limit");
        line.push_back(c);
      }
      if (line.empty()) continue;
      json id = nullptr;
      try {
        const auto input = json::parse(line);
        if (input.contains("id")) id = input["id"];
        require(id.is_number_integer(), "Request id is required");
        const auto result = host.execute(input);
        std::cout << json({{"id",id},{"ok",true},{"result",result}}).dump() << std::endl;
      } catch (const std::exception& error) {
        std::cout << json({{"id",id},{"ok",false},{"error",error.what()}}).dump() << std::endl;
      }
    }
  } catch (const std::exception& error) { std::cerr << error.what() << std::endl; return 1; }
  CoUninitialize(); return 0;
}
