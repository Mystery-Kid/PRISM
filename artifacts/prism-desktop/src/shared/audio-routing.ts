import type { AudioBus, BusSend, Track } from "./types";

export const maxAudioBuses = 32;
export const maxSendsPerSource = 16;
export const maxRoutingGain = 1.5;

type RoutingNode = `track:${string}` | `bus:${string}` | "master";

function nodeForTrack(id: string): RoutingNode {
  return `track:${id}`;
}

function nodeForBus(id: string): RoutingNode {
  return `bus:${id}`;
}

function addRoutingEdges(
  edges: Map<RoutingNode, RoutingNode[]>,
  tracks: Track[],
  buses: AudioBus[],
): void {
  const busIds = new Set(buses.map((bus) => bus.id));
  const append = (source: RoutingNode, target: RoutingNode) => {
    edges.get(source)?.push(target);
  };
  const addSends = (source: RoutingNode, sends: BusSend[] | undefined) => {
    for (const send of sends ?? []) append(source, nodeForBus(send.busId));
  };

  for (const track of tracks) {
    const source = nodeForTrack(track.id);
    const target = track.outputBusId && busIds.has(track.outputBusId)
      ? nodeForBus(track.outputBusId)
      : "master";
    append(source, target);
    addSends(source, track.sends);
  }
  for (const bus of buses) {
    const source = nodeForBus(bus.id);
    const target = bus.outputBusId && busIds.has(bus.outputBusId)
      ? nodeForBus(bus.outputBusId)
      : "master";
    append(source, target);
    addSends(source, bus.sends);
  }
}

function buildEdges(tracks: Track[], buses: AudioBus[]): Map<RoutingNode, RoutingNode[]> {
  const edges = new Map<RoutingNode, RoutingNode[]>();
  tracks.forEach((track) => edges.set(nodeForTrack(track.id), []));
  buses.forEach((bus) => edges.set(nodeForBus(bus.id), []));
  edges.set("master", []);
  addRoutingEdges(edges, tracks, buses);
  return edges;
}

function validateSends(sourceId: string, sends: BusSend[] | undefined, busIds: Set<string>): void {
  if (sends === undefined) return;
  if (!Array.isArray(sends) || sends.length > maxSendsPerSource) {
    throw new Error(`A track or bus can have at most ${maxSendsPerSource} sends.`);
  }
  const ids = new Set<string>();
  for (const send of sends) {
    if (
      !send ||
      typeof send.id !== "string" ||
      !send.id.trim() ||
      send.id.length > 128 ||
      ids.has(send.id) ||
      typeof send.busId !== "string" ||
      !busIds.has(send.busId) ||
      !Number.isFinite(send.level) ||
      send.level < 0 ||
      send.level > maxRoutingGain ||
      (send.placement !== "pre" && send.placement !== "post")
    ) {
      throw new Error(`A send on "${sourceId}" has an invalid destination, level, or mode.`);
    }
    ids.add(send.id);
  }
}

function assertAcyclic(edges: Map<RoutingNode, RoutingNode[]>): void {
  const visiting = new Set<RoutingNode>();
  const visited = new Set<RoutingNode>();
  const visit = (node: RoutingNode): void => {
    if (visiting.has(node)) throw new Error("Audio routing cannot contain a cycle.");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of edges.get(node) ?? []) visit(target);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
}

export function validateAudioRouting(tracks: Track[], buses: AudioBus[]): void {
  if (!Array.isArray(tracks) || !Array.isArray(buses) || buses.length > maxAudioBuses) {
    throw new Error(`A session can have at most ${maxAudioBuses} audio buses.`);
  }
  const trackIds = new Set<string>();
  for (const track of tracks) {
    if (!track || typeof track.id !== "string" || !track.id.trim() || track.id.length > 128 || trackIds.has(track.id)) {
      throw new Error("Audio routing needs unique, valid track IDs.");
    }
    trackIds.add(track.id);
  }
  const busIds = new Set<string>();
  const busNames = new Set<string>();
  for (const bus of buses) {
    const normalizedName = typeof bus?.name === "string" ? bus.name.trim().toLocaleLowerCase() : "";
    if (
      !bus ||
      typeof bus.id !== "string" ||
      !bus.id.trim() ||
      bus.id.length > 128 ||
      busIds.has(bus.id) ||
      typeof bus.name !== "string" ||
      !normalizedName ||
      normalizedName.length > 80 ||
      busNames.has(normalizedName) ||
      !Number.isFinite(bus.level) ||
      bus.level < 0 ||
      bus.level > maxRoutingGain ||
      typeof bus.muted !== "boolean" ||
      typeof bus.solo !== "boolean"
    ) {
      throw new Error("Every audio bus needs a unique ID, a name, and a valid level.");
    }
    busIds.add(bus.id);
    busNames.add(normalizedName);
  }

  for (const track of tracks) {
    const target = track.outputBusId;
    if (target !== undefined && target !== null && (typeof target !== "string" || !busIds.has(target))) {
      throw new Error(`Track "${track.name}" routes to a bus that does not exist.`);
    }
    validateSends(track.name, track.sends, busIds);
  }
  for (const bus of buses) {
    const target = bus.outputBusId;
    if (
      target !== undefined &&
      target !== null &&
      (typeof target !== "string" || !busIds.has(target) || target === bus.id)
    ) {
      throw new Error(`Bus "${bus.name}" routes to an invalid output.`);
    }
    validateSends(bus.name, bus.sends, busIds);
  }
  assertAcyclic(buildEdges(tracks, buses));
}

export function getAllowedBusTargets(
  tracks: Track[],
  buses: AudioBus[],
  sourceBusId: string,
): string[] {
  const source = buses.find((bus) => bus.id === sourceBusId);
  if (!source) return [];
  return buses.flatMap((candidate) => {
    if (candidate.id === sourceBusId) return [];
    const edges = buildEdges(tracks, buses);
    edges.get(nodeForBus(sourceBusId))?.push(nodeForBus(candidate.id));
    try {
      assertAcyclic(edges);
      return [candidate.id];
    } catch {
      return [];
    }
  });
}

export type RoutingAudibility = {
  tracks: Map<string, boolean>;
  buses: Map<string, boolean>;
};

export function deriveRoutingAudibility(tracks: Track[], buses: AudioBus[]): RoutingAudibility {
  const trackAudibility = new Map<string, boolean>();
  const busAudibility = new Map<string, boolean>();
  const hasSolo = tracks.some((track) => track.solo) || buses.some((bus) => bus.solo);
  if (!hasSolo) {
    tracks.forEach((track) => trackAudibility.set(track.id, !track.muted));
    buses.forEach((bus) => busAudibility.set(bus.id, !bus.muted));
    return { tracks: trackAudibility, buses: busAudibility };
  }

  const edges = buildEdges(tracks, buses);
  const incoming = new Map<RoutingNode, RoutingNode[]>();
  for (const [source, targets] of edges) {
    for (const target of targets) incoming.set(target, [...(incoming.get(target) ?? []), source]);
  }
  const muted = new Set<RoutingNode>([
    ...tracks.filter((track) => track.muted).map((track) => nodeForTrack(track.id)),
    ...buses.filter((bus) => bus.muted).map((bus) => nodeForBus(bus.id)),
  ]);
  const active = new Set<RoutingNode>();
  const visit = (
    start: RoutingNode,
    graph: Map<RoutingNode, RoutingNode[]>,
  ) => {
    const visited = new Set<RoutingNode>();
    const queue = [start];
    while (queue.length) {
      const node = queue.pop()!;
      if (node === "master" || muted.has(node) || visited.has(node)) continue;
      visited.add(node);
      active.add(node);
      queue.push(...(graph.get(node) ?? []));
    }
  };

  for (const track of tracks.filter((item) => item.solo)) {
    visit(nodeForTrack(track.id), edges);
  }
  for (const bus of buses.filter((item) => item.solo)) {
    const node = nodeForBus(bus.id);
    visit(node, incoming);
    visit(node, edges);
  }
  tracks.forEach((track) => trackAudibility.set(track.id, active.has(nodeForTrack(track.id))));
  buses.forEach((bus) => busAudibility.set(bus.id, active.has(nodeForBus(bus.id))));
  return { tracks: trackAudibility, buses: busAudibility };
}
