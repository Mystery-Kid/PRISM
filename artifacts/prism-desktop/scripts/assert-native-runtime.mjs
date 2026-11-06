import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve("../../generated-artifacts/prism-native-runtime");
for (const name of ["prism-audio-host.exe", "notices/PortAudio-LICENSE.txt", "notices/JSON-LICENSE.txt"]) {
  if (!existsSync(join(root, name))) throw new Error(`Native audio runtime is incomplete: ${name}. Build native/audio-host and retain dependency notices.`);
}
if (!existsSync(join(root,"prism-vst-host.exe")) || !existsSync(join(root,"notices")) ||
    readdirSync(join(root,"notices")).filter(name => name.endsWith("LICENSE.txt")).length < 5)
  throw new Error("Build the Windows x64 native VST3 host and copy its original SDK notices before packaging. See NATIVE-VST3.md. Test plugins must never be copied to the runtime folder.");
