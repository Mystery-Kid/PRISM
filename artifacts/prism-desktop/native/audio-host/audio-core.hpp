#pragma once
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <algorithm>

namespace prism {
struct NoteEvent { uint64_t frame = 0; int note = 60; float velocity = 0; };

// One non-realtime producer, one callback consumer. Overflow is explicit.
template <size_t N> class EventQueue {
  std::array<NoteEvent, N> events{};
  std::atomic<uint32_t> read{0}, write{0};
public:
  bool push(NoteEvent event) noexcept {
    const auto w = write.load(std::memory_order_relaxed);
    const auto next = (w + 1) % N;
    if (next == read.load(std::memory_order_acquire)) return false;
    events[w] = event; write.store(next, std::memory_order_release); return true;
  }
  bool peek(NoteEvent& event) noexcept {
    const auto r = read.load(std::memory_order_relaxed);
    if (r == write.load(std::memory_order_acquire)) return false;
    event = events[r]; return true;
  }
  void pop() noexcept { read.store((read.load(std::memory_order_relaxed) + 1) % N, std::memory_order_release); }
};

// A bounded diagnostic voice, not a replacement for any saved PRISM instrument.
// This core intentionally owns no file handles, IPC, locks, or dynamic containers.
class AudioCore {
  struct Voice { double phase = 0, step = 0; float amplitude = 0, target = 0; int note = -1; };
  std::array<Voice, 32> voices{};
  EventQueue<256> events;
  uint64_t frame = 0;
  double rate = 48000;
  unsigned channels = 2;
public:
  std::atomic<uint64_t> clock{0};
  std::atomic<unsigned> minimumBlock{0}, maximumBlock{0}, xruns{0};
  static_assert(std::atomic<uint64_t>::is_always_lock_free, "Callback clock must be lock free");
  void configure(double sampleRate, unsigned outputChannels) noexcept {
    rate = sampleRate; channels = outputChannels;
  }
  bool enqueue(NoteEvent event) noexcept { return events.push(event); }
  void render(float* output, unsigned frames) noexcept {
    const auto minimum = minimumBlock.load(std::memory_order_relaxed);
    if (!minimum || frames < minimum) minimumBlock.store(frames, std::memory_order_relaxed);
    if (frames > maximumBlock.load(std::memory_order_relaxed)) maximumBlock.store(frames, std::memory_order_relaxed);
    for (unsigned f = 0; f < frames; ++f, ++frame) {
      NoteEvent event;
      // Queue length is statically bounded; commands arrive in frame order.
      for (unsigned count = 0; count < 255 && events.peek(event) && event.frame <= frame; ++count) {
        events.pop();
        if (event.velocity > 0) {
          for (auto& voice : voices) if (voice.note == -1) {
            voice = {}; voice.note = event.note;
            voice.step = 440.0 * std::pow(2.0, (event.note - 69) / 12.0) / rate;
            voice.target = std::clamp(event.velocity, 0.0f, 1.0f) * .12f; break;
          }
        } else for (auto& voice : voices) if (voice.note == event.note) voice.target = 0;
      }
      float value = 0;
      for (auto& voice : voices) if (voice.note != -1) {
        const float coefficient = static_cast<float>(1.0 / (rate * (voice.target > 0 ? .005 : .025)));
        voice.amplitude += (voice.target - voice.amplitude) * coefficient;
        value += static_cast<float>(std::sin(voice.phase * 6.283185307179586)) * voice.amplitude;
        voice.phase += voice.step; voice.phase -= std::floor(voice.phase);
        if (voice.target == 0 && voice.amplitude < .00001f) voice.note = -1;
      }
      value = std::clamp(value, -.8f, .8f);
      for (unsigned channel = 0; channel < channels; ++channel) output[f * channels + channel] = value;
    }
    clock.store(frame, std::memory_order_release);
  }
};
}
