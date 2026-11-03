// PRISM native VST3 feasibility processor. SDK is separately fetched under MIT.
// Plugins execute in this disposable child, never inside React or Electron main.
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/common/memorystream.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <objbase.h>
#endif

using namespace Steinberg;
using namespace Steinberg::Vst;
static void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
static std::string quote(const std::string& text) {
  std::string out = "\"";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') { out += '\\'; out += char(c); }
    else if (c < 32) out += ' ';
    else out += char(c);
  }
  return out + '"';
}
template<class T> static T read(std::istream& in) {
  T value {};
  require(bool(in.read(reinterpret_cast<char*>(&value), sizeof(T))), "Truncated native request.");
  return value;
}
template<class T> static void write(std::ostream& out, T value) {
  out.write(reinterpret_cast<const char*>(&value), sizeof(T));
  require(bool(out), "Native output write failed.");
}
struct Midi { uint32_t frame; int32_t pitch; float velocity; uint32_t on; int32_t id; };
struct Param { uint32_t id; double value; };
static void render(VST3::Hosting::Module& module, const std::string& id,
                   const std::string& requestPath, const std::string& outputPath, const std::string& statePath) {
  std::ifstream request(requestPath, std::ios::binary);
  require(read<uint32_t>(request) == 0x54535650 && read<uint32_t>(request) == 1, "Invalid PVST request version.");
  const auto rate = read<uint32_t>(request), block = read<uint32_t>(request), frames = read<uint32_t>(request);
  const auto noteCount = read<uint32_t>(request), paramCount = read<uint32_t>(request), inputs = read<uint32_t>(request);
  const auto tempo = read<double>(request);
  const auto numerator = read<uint32_t>(request), denominator = read<uint32_t>(request);
  require(rate >= 8000 && rate <= 192000 && block >= 32 && block <= 2048 &&
    frames && frames <= rate*30 && noteCount <= 100000 && paramCount <= 10000 && inputs <= 2 &&
    std::isfinite(tempo) && tempo >= 20 && tempo <= 300 && numerator >= 1 && numerator <= 32 &&
    (denominator == 2 || denominator == 4 || denominator == 8 || denominator == 16), "Unsupported native processing contract.");
  std::vector<float> input(size_t(frames)*inputs);
  for (auto& sample : input) { sample = read<float>(request); require(std::isfinite(sample), "Non-finite input audio."); }
  std::vector<Midi> notes;
  for (uint32_t i = 0; i < noteCount; ++i) {
    Midi n { read<uint32_t>(request), read<int32_t>(request), read<float>(request), read<uint32_t>(request), read<int32_t>(request) };
    require(n.frame < frames && n.pitch >= 0 && n.pitch < 128 && std::isfinite(n.velocity) &&
      n.velocity >= 0 && n.velocity <= 1 && n.on <= 1, "Invalid MIDI event.");
    notes.push_back(n);
  }
  std::sort(notes.begin(), notes.end(), [](const auto& a, const auto& b) {
    return a.frame != b.frame ? a.frame < b.frame : a.on < b.on;
  });
  std::vector<Param> params;
  for (uint32_t i = 0; i < paramCount; ++i) {
    Param p { read<uint32_t>(request), read<double>(request) };
    require(std::isfinite(p.value) && p.value >= 0 && p.value <= 1, "Invalid normalized parameter.");
    params.push_back(p);
  }
  require(request.peek() == std::char_traits<char>::eof(), "Unexpected native request payload.");
  const auto& classes = module.getFactory().classInfos();
  const auto found = std::find_if(classes.begin(), classes.end(), [&](const auto& info) { return info.ID().toString() == id; });
  require(found != classes.end() && found->category() == kVstAudioEffectClass, "Plugin class identity is missing or incompatible.");
  HostApplication host;
  PluginContextFactory::instance().setPluginContext(&host);
  PlugProvider provider(module.getFactory(), *found);
  require(provider.initialize(), "Plugin initialization failed.");
  auto component = provider.getComponentPtr();
  auto controller = provider.getControllerPtr();
  FUnknownPtr<IAudioProcessor> processor(component);
  require(bool(processor) && processor->canProcessSampleSize(kSample32) == kResultOk, "Plugin does not support 32-bit float processing.");
  if (statePath != "-") {
    std::ifstream file(statePath, std::ios::binary | std::ios::ate);
    require(bool(file) && file.tellg() <= 16*1024*1024 && file.tellg() >= 0, "Plugin state file is missing or oversized.");
    std::vector<char> bytes(static_cast<size_t>(file.tellg())); file.seekg(0); file.read(bytes.data(), bytes.size());
    MemoryStream state(bytes.data(), bytes.size());
    require(component->setState(&state) == kResultOk, "Plugin state restoration failed.");
    if (controller) { state.seek(0, IBStream::kIBSeekSet, nullptr); controller->setComponentState(&state); }
  }
  const int32 inputBuses = component->getBusCount(kAudio, kInput), outputBuses = component->getBusCount(kAudio, kOutput);
  SpeakerArrangement stereo = SpeakerArr::kStereo;
  require(outputBuses == 1 && inputBuses <= 1 &&
    processor->setBusArrangements(inputBuses ? &stereo : nullptr, inputBuses, &stereo, 1) == kResultOk,
    "This feasibility processor supports one stereo main output and at most one stereo input; no sidechains.");
  for (int32 i = 0; i < inputBuses; ++i) require(component->activateBus(kAudio, kInput, i, true) == kResultOk, "Audio input activation failed.");
  require(component->activateBus(kAudio, kOutput, 0, true) == kResultOk, "Audio output activation failed.");
  if (component->getBusCount(kEvent, kInput))
    require(component->activateBus(kEvent, kInput, 0, true) == kResultOk, "MIDI input activation failed.");
  ProcessSetup setup { kOffline, kSample32, int32(block), double(rate) };
  require(processor->setupProcessing(setup) == kResultOk && component->setActive(true) == kResultOk,
    "Plugin processing activation failed.");
  const auto processingState = processor->setProcessing(true);
  // The SDK AudioEffect base returns kNotImplemented for this optional hint.
  require(processingState == kResultOk || processingState == kNotImplemented, "Plugin rejected its processing state.");
  HostProcessData data;
  require(data.prepare(*component, int32(block), kSample32), "Audio buffer preparation failed.");
  ProcessContext transport {};
  transport.sampleRate = rate; transport.tempo = tempo; transport.timeSigNumerator = numerator;
  transport.timeSigDenominator = denominator;
  transport.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid |
    ProcessContext::kProjectTimeMusicValid | ProcessContext::kBarPositionValid | ProcessContext::kContTimeValid;
  data.processContext = &transport; data.processMode = kOffline;
  EventList events, outputEvents;
  ParameterChanges changes, outputChanges;
  data.inputEvents = &events; data.outputEvents = &outputEvents;
  data.inputParameterChanges = &changes; data.outputParameterChanges = &outputChanges;
  std::ofstream out(outputPath, std::ios::binary | std::ios::trunc);
  require(bool(out), "Cannot create native output.");
  write<uint32_t>(out, 0x4f535650); write<uint32_t>(out, 1); write(out, rate); write(out, frames);
  write<uint32_t>(out, processor->getLatencySamples()); write<uint32_t>(out, processor->getTailSamples());
  size_t nextNote = 0;
  for (uint32_t start = 0; start < frames;) {
    auto count = std::min(block, frames-start);
    // VST3 permits variable sizes up to maxSamplesPerBlock. Split at MIDI
    // boundaries, keeping exact project timing without relying on a plugin's
    // handling of positive sample offsets within an otherwise silent block.
    if (nextNote < notes.size() && notes[nextNote].frame > start)
      count = std::min(count, notes[nextNote].frame-start);
    data.numSamples = int32(count);
    events.clear(); outputEvents.clear(); changes.clearQueue(); outputChanges.clearQueue();
    transport.projectTimeSamples = start; transport.continousTimeSamples = start;
    transport.projectTimeMusic = double(start)/rate*tempo/60;
    const double barLength = numerator*4.0/denominator;
    transport.barPositionMusic = std::floor(transport.projectTimeMusic/barLength)*barLength;
    for (int32 bus = 0; bus < data.numInputs; ++bus) {
      data.inputs[bus].silenceFlags = inputs ? 0 : ~uint64(0);
      for (int32 channel = 0; channel < data.inputs[bus].numChannels; ++channel)
        for (uint32_t i = 0; i < count; ++i)
          data.inputs[bus].channelBuffers32[channel][i] = inputs ? input[(start+i)*inputs+std::min(uint32_t(channel), inputs-1)] : 0;
    }
    for (int32 bus = 0; bus < data.numOutputs; ++bus) {
      data.outputs[bus].silenceFlags = 0;
      for (int32 channel = 0; channel < data.outputs[bus].numChannels; ++channel)
        std::fill_n(data.outputs[bus].channelBuffers32[channel], block, 0.f);
    }
    if (!start) for (const auto& param : params) {
      int32 index = 0; auto* queue = changes.addParameterData(param.id, index);
      require(queue != nullptr, "Plugin parameter queue creation failed.");
      queue->addPoint(0, param.value, index);
      if (controller) controller->setParamNormalized(param.id, param.value);
    }
    while (nextNote < notes.size() && notes[nextNote].frame < start+count) {
      const auto& note = notes[nextNote++];
      Event event {}; event.busIndex = 0; event.sampleOffset = int32(note.frame-start);
      event.ppqPosition = double(note.frame)/rate*tempo/60;
      event.type = note.on ? Event::kNoteOnEvent : Event::kNoteOffEvent;
      if (note.on) { event.noteOn.channel = 0; event.noteOn.pitch = int16(note.pitch); event.noteOn.velocity = note.velocity; event.noteOn.noteId = note.id; }
      else { event.noteOff.channel = 0; event.noteOff.pitch = int16(note.pitch); event.noteOff.velocity = note.velocity; event.noteOff.noteId = note.id; }
      require(events.addEvent(event) == kResultOk, "Native MIDI event queue is full.");
    }
    require(processor->process(data) == kResultOk, "Plugin process() failed.");
    require(data.outputs[0].numChannels >= 1, "Plugin returned no output channels.");
    for (uint32_t i = 0; i < count; ++i) for (int32 channel = 0; channel < 2; ++channel) {
      const float sample = data.outputs[0].channelBuffers32[std::min(channel, data.outputs[0].numChannels-1)][i];
      require(std::isfinite(sample) && std::abs(sample) < 1000, "Plugin returned invalid or unsafe audio.");
      write(out, sample);
    }
    start += count;
  }
  processor->setProcessing(false); component->setActive(false);
  MemoryStream state;
  require(component->getState(&state) == kResultOk && state.getSize() <= 16*1024*1024, "Plugin state capture failed.");
  std::ofstream stateFile(outputPath+".state", std::ios::binary | std::ios::trunc);
  stateFile.write(state.getData(), state.getSize()); require(bool(stateFile), "Plugin state write failed.");
  std::cout << "{\"ok\":true,\"frames\":" << frames << ",\"sampleRate\":" << rate << "}\n";
}
int main(int argc, char** argv) {
#ifdef _WIN32
  const auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(com)) return 3;
#endif
  try {
    require(argc >= 3, "Usage: --scan module | --render module classID request output state-or-dash");
    std::string error;
    auto module = VST3::Hosting::Module::create(argv[2], error);
    if (!module) throw std::runtime_error("Cannot load VST3 module: "+error);
    if (std::string(argv[1]) == "--scan") {
      std::cout << "[";
      bool comma = false;
      for (const auto& info : module->getFactory().classInfos()) {
        if (info.category() != kVstAudioEffectClass) continue;
        if (comma) std::cout << ","; comma = true;
        std::cout << "{\"id\":" << quote(info.ID().toString()) << ",\"name\":" << quote(info.name())
          << ",\"vendor\":" << quote(info.vendor()) << ",\"version\":" << quote(info.version())
          << ",\"categories\":" << quote(info.subCategoriesString()) << "}";
      }
      std::cout << "]\n";
    } else {
      require(std::string(argv[1]) == "--render" && argc == 7, "Invalid native host arguments.");
      render(*module, argv[3], argv[4], argv[5], argv[6]);
    }
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << "\n"; return 1; }
}
