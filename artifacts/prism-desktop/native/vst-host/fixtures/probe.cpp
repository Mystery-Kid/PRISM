// MIT License, Copyright (c) 2026 PRISM contributors.
// Test-only plugin: NEVER included in the PRISM production installer.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions: The above copyright notice and this
// permission notice shall be included in all copies or substantial portions of
// the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR
// A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "public.sdk/source/common/pluginview.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/base/ibstream.h"
#include <cstdlib>
#include <cstring>
#include <thread>
#include <chrono>
#ifdef _WIN32
#include <windows.h>
#endif
namespace PrismHostTests {
using namespace Steinberg; using namespace Steinberg::Vst;
static const FUID gainID(0x33505253,0x4D545354,0x8A134AF0,0x8B010001);
static const FUID controllerID(0x33505253,0x4D545354,0x8A134AF0,0x8B010002);
static const FUID crashID(0x33505253,0x4D545354,0x8A134AF0,0x8B010003);
static const FUID delayID(0x33505253,0x4D545354,0x8A134AF0,0x8B010004);
static const FUID waitID(0x33505253,0x4D545354,0x8A134AF0,0x8B010005);
class Gain : public AudioEffect {
  float gain = .75f;
public:
  Gain() { setControllerClass(controllerID); }
  static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new Gain); }
  tresult PLUGIN_API initialize(FUnknown* host) override {
    const auto result = AudioEffect::initialize(host);
    if (result == kResultOk) { addAudioInput(STR16("Input"), SpeakerArr::kStereo); addAudioOutput(STR16("Output"), SpeakerArr::kStereo); }
    return result;
  }
  tresult PLUGIN_API getState(IBStream* stream) override { return stream->write(&gain, sizeof(gain)); }
  tresult PLUGIN_API setState(IBStream* stream) override { return stream->read(&gain, sizeof(gain)); }
  tresult PLUGIN_API process(ProcessData& data) override {
    if (data.inputParameterChanges) for (int32 i=0;i<data.inputParameterChanges->getParameterCount();i++) {
      auto queue=data.inputParameterChanges->getParameterData(i);
      if (queue && queue->getParameterId()==0 && queue->getPointCount()) {
        int32 offset=0; double value=0; queue->getPoint(queue->getPointCount()-1,offset,value); gain=float(value);
      }
    }
    if (data.numInputs && data.numOutputs) for (int32 channel=0;channel<2;channel++)
      for (int32 i=0;i<data.numSamples;i++) data.outputs[0].channelBuffers32[channel][i]=gain*data.inputs[0].channelBuffers32[channel][i];
    return kResultOk;
  }
};
class Crash : public Gain {
public:
  static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new Crash); }
  tresult PLUGIN_API process(ProcessData&) override {
#ifdef _WIN32
    _set_abort_behavior(0,_WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#endif
    std::abort(); return kInternalError;
  }
};
class Delay : public Gain {
  float history[2][64] {}; int32 index=0;
public:
  static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new Delay); }
  uint32 PLUGIN_API getLatencySamples() override { return 64; }
  tresult PLUGIN_API process(ProcessData& data) override {
    auto result=Gain::process(data);
    if(data.numOutputs) for(int32 i=0;i<data.numSamples;i++) {
      for(int32 channel=0;channel<2;channel++) {
        auto& current=data.outputs[0].channelBuffers32[channel][i];
        const float delayed=history[channel][index]; history[channel][index]=current; current=delayed;
      }
      index=(index+1)%64;
    }
    return result;
  }
};
class Wait : public Gain {
public:
  static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new Wait); }
  tresult PLUGIN_API process(ProcessData& data) override {
    std::this_thread::sleep_for(std::chrono::seconds(30)); return Gain::process(data);
  }
};
class Controller;
class View : public CPluginView {
  EditController* controller;
#ifdef _WIN32
  HWND child = nullptr;
#endif
public:
  explicit View(EditController* c) : controller(c) { rect = ViewRect(0,0,320,100); }
  tresult PLUGIN_API isPlatformTypeSupported(FIDString platform) override {
#ifdef _WIN32
    return strcmp(platform,kPlatformTypeHWND)==0 ? kResultTrue : kResultFalse;
#else
    return kResultFalse;
#endif
  }
  tresult PLUGIN_API attached(void* parent,FIDString platform) override {
#ifdef _WIN32
    child=CreateWindowW(L"STATIC",L"PRISM test editor: gain changed to 25%",WS_CHILD|WS_VISIBLE,10,10,300,70,static_cast<HWND>(parent),nullptr,GetModuleHandleW(nullptr),nullptr);
    if (!child) return kInternalError;
    controller->setParamNormalized(0,.25);
    controller->beginEdit(0); controller->performEdit(0,.25); controller->endEdit(0);
    return CPluginView::attached(parent,platform);
#else
    return kNotImplemented;
#endif
  }
  tresult PLUGIN_API removed() override {
#ifdef _WIN32
    if (child) DestroyWindow(child); child=nullptr;
#endif
    return CPluginView::removed();
  }
};
class Controller : public EditController {
public:
  static FUnknown* create(void*) { return static_cast<IEditController*>(new Controller); }
  tresult PLUGIN_API initialize(FUnknown* host) override {
    auto result=EditController::initialize(host);
    if(result==kResultOk) parameters.addParameter(STR16("Gain"),STR16(""),0,.75,ParameterInfo::kCanAutomate,0);
    return result;
  }
  tresult PLUGIN_API setComponentState(IBStream* stream) override {
    float value=0; if(stream->read(&value,sizeof(value))!=kResultOk)return kResultFalse; return setParamNormalized(0,value);
  }
  IPlugView* PLUGIN_API createView(FIDString name) override { return strcmp(name,ViewType::kEditor)==0 ? new View(this) : nullptr; }
};
}
using namespace Steinberg; using namespace Steinberg::Vst;
BEGIN_FACTORY_DEF("PRISM Tests","https://example.invalid","")
DEF_CLASS2(INLINE_UID_FROM_FUID(PrismHostTests::gainID),PClassInfo::kManyInstances,kVstAudioEffectClass,"PRISM Host Test Gain",kDistributable,"Fx|Tools","1.0.0",kVstVersionString,PrismHostTests::Gain::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(PrismHostTests::controllerID),PClassInfo::kManyInstances,kVstComponentControllerClass,"PRISM Host Test Controller",0,"","1.0.0",kVstVersionString,PrismHostTests::Controller::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(PrismHostTests::crashID),PClassInfo::kManyInstances,kVstAudioEffectClass,"PRISM Host Crash Probe",kDistributable,"Fx|Tools","1.0.0",kVstVersionString,PrismHostTests::Crash::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(PrismHostTests::delayID),PClassInfo::kManyInstances,kVstAudioEffectClass,"PRISM Host Delay Probe",kDistributable,"Fx|Tools","1.0.0",kVstVersionString,PrismHostTests::Delay::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(PrismHostTests::waitID),PClassInfo::kManyInstances,kVstAudioEffectClass,"PRISM Host Wait Probe",kDistributable,"Fx|Tools","1.0.0",kVstVersionString,PrismHostTests::Wait::create)
END_FACTORY
