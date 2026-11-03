// Included after the common SDK helpers in main.cpp.
static void restoreState(IComponent* component, IEditController* controller, const std::string& path) {
  if (path == "-") return;
  const auto load = [](const std::string& file) {
    std::ifstream stream(std::filesystem::u8path(file), std::ios::binary | std::ios::ate);
    require(bool(stream) && stream.tellg() >= 0 && stream.tellg() <= 16*1024*1024, "Missing/oversized VST3 state.");
    std::vector<char> bytes(size_t(stream.tellg())); stream.seekg(0);
    require(bytes.empty() || bool(stream.read(bytes.data(), bytes.size())), "Truncated VST3 state."); return bytes;
  };
  auto bytes = load(path);
  if (!bytes.empty()) {
    MemoryStream state(bytes.data(), bytes.size());
    require(component->setState(&state) == kResultOk, "VST3 component state restoration failed.");
    if (controller) { state.seek(0, IBStream::kIBSeekSet, nullptr); controller->setComponentState(&state); }
  }
  if (controller && std::filesystem::exists(std::filesystem::u8path(path+".controller"))) {
    bytes = load(path+".controller");
    if (!bytes.empty()) { MemoryStream state(bytes.data(), bytes.size()); require(controller->setState(&state) == kResultOk, "VST3 controller state restoration failed."); }
  }
}
static void saveStream(MemoryStream& stream, const std::string& path) {
  require(stream.getSize() <= 16*1024*1024, "Oversized VST3 state.");
  std::ofstream out(std::filesystem::u8path(path), std::ios::binary | std::ios::trunc);
  out.write(stream.getData(), stream.getSize()); require(bool(out), "Cannot save VST3 state.");
}
static void orderProgramChanges(std::vector<Param>& params, IEditController* controller) {
  std::vector<uint32_t> programs;
  if (controller) for (int32 i=0;i<controller->getParameterCount();i++) {
    ParameterInfo p {}; if (controller->getParameterInfo(i,p)==kResultOk && (p.flags & ParameterInfo::kIsProgramChange)) programs.push_back(p.id);
  }
  std::stable_sort(params.begin(),params.end(),[&](const Param& a,const Param& b) {
    const bool aa=std::find(programs.begin(),programs.end(),a.id)!=programs.end();
    const bool bb=std::find(programs.begin(),programs.end(),b.id)!=programs.end(); return aa && !bb;
  });
}
static void parameterJson(IEditController* controller, bool metadata, std::ostream& out = std::cout) {
  out << std::setprecision(17);
  out << (metadata ? "{\"parameters\":[" : "{");
  bool comma = false;
  const auto count = controller ? controller->getParameterCount() : 0;
  require(count >= 0 && count <= 10000, "Unsupported parameter count.");
  for (int32 i=0; i<count; i++) {
    ParameterInfo p {}; require(controller->getParameterInfo(i, p) == kResultOk, "Cannot inspect VST3 parameter.");
    const double value = controller->getParamNormalized(p.id);
    require(std::isfinite(value) && value >= 0 && value <= 1, "Invalid normalized VST3 parameter.");
    if (comma) out << ","; comma = true;
    if (metadata) out << "{\"id\":" << p.id << ",\"name\":" << quote(VST3::StringConvert::convert(std::u16string(p.title)))
      << ",\"unit\":" << quote(VST3::StringConvert::convert(std::u16string(p.units))) << ",\"value\":" << value
      << ",\"steps\":" << p.stepCount << ",\"readOnly\":" << ((p.flags & (ParameterInfo::kIsReadOnly | ParameterInfo::kIsProgramChange)) ? "true" : "false") << "}";
    else out << quote(std::to_string(p.id)) << ":" << value;
  }
  out << (metadata ? "]}\n" : "}\n");
}
#ifdef _WIN32
class EditorFrame : public FObject, public IPlugFrame {
public:
  HWND window = nullptr; IPlugView* view = nullptr; bool closed = false;
  OBJ_METHODS(EditorFrame, FObject)
  DEFINE_INTERFACES
    DEF_INTERFACE(IPlugFrame)
  END_DEFINE_INTERFACES(FObject)
  REFCOUNT_METHODS(FObject)
  tresult PLUGIN_API resizeView(IPlugView* target, ViewRect* rect) override {
    if (!window || target != view || !rect || rect->getWidth() < 1 || rect->getHeight() < 1 ||
      rect->getWidth() > 4096 || rect->getHeight() > 4096) return kInvalidArgument;
    RECT outer {0,0,rect->getWidth(),rect->getHeight()};
    AdjustWindowRect(&outer, WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, FALSE);
    SetWindowPos(window, nullptr, 0, 0, outer.right-outer.left, outer.bottom-outer.top, SWP_NOMOVE | SWP_NOZORDER);
    return view->onSize(rect);
  }
};
static LRESULT CALLBACK editorWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  auto frame = reinterpret_cast<EditorFrame*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (frame && (message == WM_CLOSE || (message == WM_TIMER && wparam == 1))) { frame->closed = true; return 0; }
  if (frame && message == WM_SIZE && frame->view && wparam != SIZE_MINIMIZED) {
    ViewRect rect {0,0,LOWORD(lparam),HIWORD(lparam)}; frame->view->onSize(&rect); return 0;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}
class EditorHandler : public FObject, public IComponentHandler {
public:
  OBJ_METHODS(EditorHandler, FObject)
  DEFINE_INTERFACES
    DEF_INTERFACE(IComponentHandler)
  END_DEFINE_INTERFACES(FObject)
  REFCOUNT_METHODS(FObject)
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID, ParamValue) override { return kResultOk; }
  tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API restartComponent(int32) override { return kNotImplemented; }
};
#endif
static void pluginTools(VST3::Hosting::Module& module, const std::string& id, bool editor, const std::string& statePath, const std::string& outputPath, unsigned closeAfter = 0) {
  const auto& classes = module.getFactory().classInfos();
  const auto found = std::find_if(classes.begin(), classes.end(), [&](const auto& c) { return c.ID().toString() == id && c.category() == kVstAudioEffectClass; });
  require(found != classes.end(), "Missing VST3 class.");
  HostApplication host;
  PluginContextFactory::instance().setPluginContext(&host);
  PlugProvider provider(module.getFactory(), *found, true);
  require(provider.initialize(), "VST3 initialization failed.");
  auto component = provider.getComponentPtr(); auto controller = provider.getControllerPtr();
  if (!editor) { parameterJson(controller, true); return; }
  require(bool(controller), "This plugin has no edit controller. Native editor is unavailable.");
  restoreState(component, controller, statePath);
  std::ifstream parameterFile(std::filesystem::u8path(statePath+".parameters"), std::ios::binary);
  const auto count = read<uint32_t>(parameterFile); require(count <= 10000, "Too many editor parameters.");
  for (uint32_t i=0; i<count; i++) {
    auto id = read<uint32_t>(parameterFile); auto value = read<double>(parameterFile);
    require(std::isfinite(value) && value >= 0 && value <= 1, "Invalid editor parameter.");
    controller->setParamNormalized(id, value);
  }
#ifdef _WIN32
  auto handler = owned(new EditorHandler);
  controller->setComponentHandler(handler);
  auto view = owned(controller->createView(ViewType::kEditor));
  require(bool(view) && view->isPlatformTypeSupported(kPlatformTypeHWND) == kResultTrue,
    "This plugin does not provide a Windows native editor. Use its generic parameter controls.");
  auto frame = owned(new EditorFrame); frame->view = view;
  WNDCLASSW wc {}; wc.lpfnWndProc = editorWindowProc; wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"PRISM-VST3-Editor"; wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassW(&wc);
  frame->window = CreateWindowExW(0, wc.lpszClassName, L"PRISM - Native VST3 editor", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
    CW_USEDEFAULT, CW_USEDEFAULT, 640, 480, nullptr, nullptr, wc.hInstance, nullptr);
  require(frame->window != nullptr, "Cannot create native editor window.");
  SetWindowLongPtrW(frame->window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(frame.get()));
  view->setFrame(frame);
  ViewRect rect {}; require(view->getSize(&rect) == kResultOk, "Editor did not report its size.");
  frame->resizeView(view, &rect);
  require(view->attached(frame->window, kPlatformTypeHWND) == kResultOk, "Native editor attachment failed.");
  ShowWindow(frame->window, SW_SHOW);
  if (closeAfter) SetTimer(frame->window,1,std::min(5000u,std::max(100u,closeAfter)),nullptr);
  MSG message {};
  while (!frame->closed && GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  view->removed(); view->setFrame(nullptr); frame->view = nullptr; DestroyWindow(frame->window);
  controller->setComponentHandler(nullptr);
#else
  throw std::runtime_error("Native editor windows are supported only on Windows.");
#endif
  // Flush controller edits into the processor before capturing component state.
  FUnknownPtr<IAudioProcessor> processor(component);
  require(bool(processor), "No audio processor for editor state synchronization.");
  ProcessSetup setup { kOffline, kSample32, 256, 48000 };
  require(processor->setupProcessing(setup) == kResultOk && component->setActive(true) == kResultOk, "Cannot synchronize edited plugin state.");
  processor->setProcessing(true);
  HostProcessData data; require(data.prepare(*component, 256, kSample32), "Cannot allocate editor state buffers.");
  ParameterChanges changes; data.inputParameterChanges = &changes; data.processMode = kOffline; data.numSamples = 0;
  std::vector<Param> edited;
  for (int32 i=0; i<controller->getParameterCount(); i++) {
    ParameterInfo p {}; controller->getParameterInfo(i, p);
    if (p.flags & ParameterInfo::kIsReadOnly) continue;
    edited.push_back({p.id,controller->getParamNormalized(p.id)});
  }
  orderProgramChanges(edited,controller);
  for(const auto& p:edited) { int32 queueIndex=0,point=0; changes.addParameterData(p.id,queueIndex)->addPoint(0,p.value,point); }
  require(processor->process(data) == kResultOk, "Cannot apply editor changes to the processor.");
  processor->setProcessing(false); component->setActive(false);
  MemoryStream componentState, controllerState;
  require(component->getState(&componentState) == kResultOk, "Cannot save edited component state.");
  saveStream(componentState, outputPath);
  auto result = controller->getState(&controllerState);
  require(result == kResultOk || result == kNotImplemented, "Cannot save edited controller state.");
  saveStream(controllerState, outputPath+".controller");
  std::ofstream parameters(std::filesystem::u8path(outputPath+".parameters"), std::ios::binary);
  parameterJson(controller, false, parameters);
  require(bool(parameters), "Cannot save edited parameter values.");
  std::cout << "{\"ok\":true}\n";
}
