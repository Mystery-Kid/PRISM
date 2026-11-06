#include "audio-core.hpp"
#include <iostream>
#include <vector>
#include <stdexcept>

void check(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
int main() {
  prism::AudioCore core;
  core.configure(48000, 2);
  check(core.enqueue({480, 69, 1}), "enqueue note");
  check(core.enqueue({960, 69, 0}), "enqueue release");
  std::vector<float> pcm(48000 * 2);
  for (unsigned i = 0; i < 48000; i += 96) core.render(pcm.data() + i * 2, 96);
  float peak = 0;
  for (unsigned i = 0; i < 48000; ++i) {
    check(pcm[i * 2] == pcm[i * 2 + 1], "channel alignment");
    if (i < 480) check(pcm[i * 2] == 0, "note must not start before event clock");
    if (i > 16000) check(pcm[i * 2] == 0, "release must reach silence");
    peak = std::max(peak, std::abs(pcm[i * 2]));
  }
  check(peak > .05 && peak <= .12, "real nonzero bounded signal");
  check(core.clock.load() == 48000, "sample clock");
  check(core.minimumBlock == 96 && core.maximumBlock == 96, "observed callback dimensions");
  prism::EventQueue<4> queue;
  check(queue.push({}) && queue.push({}) && queue.push({}) && !queue.push({}), "bounded queue overflow");
  prism::NoteEvent event;
  check(queue.peek(event), "queue ready"); queue.pop(); check(queue.push({}), "queue recovery");
  std::cout << "Native core: sample-accurate onset after silence, bounded voices/release, channels, clock and overflow passed.\n";
}
