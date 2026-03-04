import type { MeshNode } from '../hooks/useNodes.js';
import type { NodeCoverage } from '../hooks/useCoverage.js';

const MAX_BETA_HOPS = 15;
export const MIN_LINK_OBSERVATIONS = 5; // must match backend db/index.ts

export type LinkMetrics = {
  observed_count: number;
  itm_viable?: boolean | null;
  itm_path_loss_db?: number | null;
  count_a_to_b?: number;
  count_b_to_a?: number;
};

export type PathLearningModel = {
  prefixProbabilities: Map<string, number>;
  transitionProbabilities: Map<string, number>;
  confidenceScale: number;
  recommendedThreshold: number;
};

export function linkKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function hasCoords(node: MeshNode | null | undefined): node is MeshNode & { lat: number; lon: number } {
  return typeof node?.lat === 'number' && typeof node?.lon === 'number';
}

function distKm(a: MeshNode, b: MeshNode): number {
  const midLat = ((a.lat! + b.lat!) / 2) * (Math.PI / 180);
  const dlat   = (a.lat! - b.lat!) * 111;
  const dlon   = (a.lon! - b.lon!) * 111 * Math.cos(midLat);
  return Math.hypot(dlat, dlon);
}

const R_EFF_M = 6_371_000 / (1 - 0.25); // ~8,495,000 m effective Earth radius

function hasLoS(a: MeshNode, b: MeshNode): boolean {
  const hA = (a.elevation_m ?? 0) + 5; // metres ASL at antenna
  const hB = (b.elevation_m ?? 0) + 5;
  const d  = distKm(a, b) * 1000;      // metres
  if (d < 1) return true;
  for (let i = 1; i < 20; i++) {
    const t     = i / 20;
    const x     = t * d;
    const los   = hA + (hB - hA) * t;
    const bulge = x * (d - x) / (2 * R_EFF_M);
    if (los < bulge) return false;
  }
  return true;
}

function nodeRange(nodeId: string, coverage: NodeCoverage[]): number {
  const cov = coverage.find((c) => c.node_id === nodeId);
  if (!cov?.radius_m) return 50;
  return Math.min(80, Math.max(50, cov.radius_m / 1000));
}

function canReach(a: MeshNode, b: MeshNode, coverage: NodeCoverage[]): boolean {
  const threshold = Math.max(nodeRange(a.node_id, coverage), nodeRange(b.node_id, coverage));
  return distKm(a, b) < threshold;
}

export function resolvePathWaypoints(
  pathHashes: string[],
  src: MeshNode | null,
  rx: MeshNode,
  allNodes: Map<string, MeshNode>,
): [number, number][] {
  const waypoints: [number, number][] = src ? [[src.lat!, src.lon!]] : [];
  const N = pathHashes.length;

  for (let i = 0; i < N; i++) {
    const prefix = pathHashes[i]!.toUpperCase();
    const candidates = Array.from(allNodes.values()).filter(
      (n) => hasCoords(n) && !n.name?.includes('🚫') && n.node_id.toUpperCase().startsWith(prefix),
    );
    if (candidates.length === 0) continue;

    let best = candidates[0]!;
    if (candidates.length > 1) {
      if (src) {
        const t      = (i + 1) / (N + 1);
        const expLat = src.lat! + t * (rx.lat! - src.lat!);
        const expLon = src.lon! + t * (rx.lon! - src.lon!);
        best = candidates.reduce((a, b) => {
          const da = Math.hypot(a.lat! - expLat, a.lon! - expLon);
          const db = Math.hypot(b.lat! - expLat, b.lon! - expLon);
          return da <= db ? a : b;
        });
      } else {
        const [anchorLat, anchorLon] = waypoints.length > 0
          ? waypoints[waypoints.length - 1]!
          : [rx.lat!, rx.lon!];
        best = candidates.reduce((a, b) => {
          const da = Math.hypot(a.lat! - anchorLat, a.lon! - anchorLon);
          const db = Math.hypot(b.lat! - anchorLat, b.lon! - anchorLon);
          return da <= db ? a : b;
        });
      }
    }
    waypoints.push([best.lat!, best.lon!]);
  }

  waypoints.push([rx.lat!, rx.lon!]);
  return waypoints;
}

export function resolveBetaPath(
  pathHashes: string[],
  src: MeshNode | null,
  rx: MeshNode,
  allNodes: Map<string, MeshNode>,
  coverage: NodeCoverage[],
  linkPairs: Set<string>,
  linkMetrics: Map<string, LinkMetrics>,
  learningModel?: PathLearningModel | null,
): { path: [number, number][]; confidence: number } | null {
  if (!hasCoords(rx) || pathHashes.length === 0) return null;
  if (pathHashes.length >= MAX_BETA_HOPS) return null;
  const rxLat = rx.lat;
  const rxLon = rx.lon;

  type HopResult = { node: MeshNode; conf: number } | null;
  const candidatesPool = Array.from(allNodes.values()).filter(
    (n) => hasCoords(n) && (n.role === undefined || n.role === 2) && !n.name?.includes('🚫'),
  );
  const prefixCounts = new Map<string, number>();
  for (const n of candidatesPool) {
    const p = n.node_id.slice(0, 2).toUpperCase();
    prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
  }

  const totalDist = hasCoords(src) ? distKm(src, rx) : 0;
  const corridorMaxKm = Math.max(8, Math.min(35, totalDist * 0.25));
  const receiverRegion = rx.iata ?? 'unknown';

  function prefixPrior(prefix: string, prevPrefix: string, nodeId: string): number {
    if (!learningModel) return 0;
    const exactKey = `${receiverRegion}|${prefix}|${prevPrefix}|${nodeId}`;
    const regionOnlyKey = `unknown|${prefix}|${prevPrefix}|${nodeId}`;
    const noPrevKey = `${receiverRegion}|${prefix}||${nodeId}`;
    const noPrevFallbackKey = `unknown|${prefix}||${nodeId}`;
    return learningModel.prefixProbabilities.get(exactKey)
      ?? learningModel.prefixProbabilities.get(regionOnlyKey)
      ?? learningModel.prefixProbabilities.get(noPrevKey)
      ?? learningModel.prefixProbabilities.get(noPrevFallbackKey)
      ?? 0;
  }

  function transitionPrior(fromId: string, toId: string): number {
    if (!learningModel) return 0;
    const key = `${receiverRegion}|${fromId}|${toId}`;
    const fallback = `unknown|${fromId}|${toId}`;
    return learningModel.transitionProbabilities.get(key)
      ?? learningModel.transitionProbabilities.get(fallback)
      ?? 0;
  }

  function distanceElevationPrior(a: MeshNode, b: MeshNode): number {
    const d = distKm(a, b);
    const distScore = Math.exp(-d / 22);
    const elevA = a.elevation_m ?? 0;
    const elevB = b.elevation_m ?? 0;
    const elevScore = Math.min(1, Math.max(0, (Math.min(elevA, elevB) + 60) / 320));
    return 0.65 * distScore + 0.35 * elevScore;
  }

  function inCorridor(candidate: MeshNode, prevNode: MeshNode): boolean {
    if (!hasCoords(src)) return true;

    const bx = src.lon - rxLon;
    const by = src.lat - rxLat;
    const segLen2 = bx * bx + by * by;
    if (segLen2 < 1e-9) return true;

    const px = candidate.lon! - rxLon;
    const py = candidate.lat! - rxLat;
    const t = (px * bx + py * by) / segLen2;
    if (t < -0.15 || t > 1.15) return false;

    const projx = rxLon + t * bx;
    const projy = rxLat + t * by;
    const midLat = ((candidate.lat! + projy) / 2) * (Math.PI / 180);
    const kmPerLon = 111 * Math.cos(midLat);
    const dxKm = (candidate.lon! - projx) * kmPerLon;
    const dyKm = (candidate.lat! - projy) * 111;
    const crossTrackKm = Math.hypot(dxKm, dyKm);
    if (crossTrackKm > corridorMaxKm) return false;

    return distKm(candidate, src) <= distKm(prevNode, src) + 8;
  }

  function directionalSupport(meta: LinkMetrics | undefined, fromId: string, toId: string): number {
    if (!meta || meta.count_a_to_b == null || meta.count_b_to_a == null) return 0.5;
    const a = fromId < toId ? fromId : toId;
    const forward = fromId === a ? meta.count_a_to_b : meta.count_b_to_a;
    const reverse = fromId === a ? meta.count_b_to_a : meta.count_a_to_b;
    const total = forward + reverse;
    if (total <= 0) return 0.5;
    return forward / total;
  }

  function confirmedConfidence(meta: LinkMetrics | undefined, fromId: string, toId: string, prefixBoost: number, transitionBoost: number): number {
    const observed = meta?.observed_count ?? MIN_LINK_OBSERVATIONS;
    const obsBoost = Math.min(0.18, Math.log10(1 + observed) * 0.12);
    const pathLoss = meta?.itm_path_loss_db;
    const plPenalty = pathLoss == null ? 0 : Math.min(0.12, Math.max(0, (pathLoss - 130) / 120));
    const dirBoost = (directionalSupport(meta, fromId, toId) - 0.5) * 0.12;
    const viableBoost = meta?.itm_viable === false ? -0.1 : 0.05;
    const conf = 0.68 + obsBoost + dirBoost + viableBoost - plPenalty + prefixBoost + transitionBoost;
    return Math.max(0.45, Math.min(0.98, conf));
  }

  function getCandidates(prefix: string, prevPrefix: string, prevNode: MeshNode): Array<{ node: MeshNode; conf: number }> {
    const all = candidatesPool.filter((n) => n.node_id.toUpperCase().startsWith(prefix));
    if (all.length === 0) return [];

    function align(c: MeshNode): number {
      if (!hasCoords(src)) return 0;
      const dLat = src.lat! - prevNode.lat!;
      const dLon = src.lon! - prevNode.lon!;
      const cLat = c.lat! - prevNode.lat!;
      const cLon = c.lon! - prevNode.lon!;
      const dot  = dLat * cLat + dLon * cLon;
      const mag  = Math.hypot(dLat, dLon) * Math.hypot(cLat, cLon);
      return mag > 0 ? dot / mag : 0;
    }

    function sortScore(c: MeshNode): number {
      const corridorBonus = inCorridor(c, prevNode) ? 0.25 : -0.6;
      return align(c) - distKm(c, prevNode) / 50 + corridorBonus;
    }

    const usedIds = new Set<string>();

    const confirmed = all
      .filter((c) => {
        const key = linkKey(c.node_id, prevNode.node_id);
        if (!linkPairs.has(key)) return false;
        const meta = linkMetrics.get(key);
        if (!meta || meta.count_a_to_b == null || meta.count_b_to_a == null) return true;
        const dir = directionalSupport(meta, c.node_id, prevNode.node_id);
        const observed = meta.observed_count ?? 0;
        const minDirectionalSupport = observed >= 50 ? 0.12 : 0.02;
        return dir >= minDirectionalSupport;
      })
      .sort((a, b) => sortScore(b) - sortScore(a))
      .slice(0, 4)
      .map((c) => {
        usedIds.add(c.node_id);
        const meta = linkMetrics.get(linkKey(c.node_id, prevNode.node_id));
        const priorBoost = prefixPrior(prefix, prevPrefix, c.node_id) * 0.2;
        const transitionBoost = transitionPrior(c.node_id, prevNode.node_id) * 0.24;
        return { node: c, conf: confirmedConfidence(meta, c.node_id, prevNode.node_id, priorBoost, transitionBoost) };
      });

    const reachable = all
      .filter((c) => !usedIds.has(c.node_id) && inCorridor(c, prevNode) && canReach(c, prevNode, coverage) && hasLoS(c, prevNode))
      .sort((a, b) => sortScore(b) - sortScore(a))
      .slice(0, 3)
      .map((c) => {
        usedIds.add(c.node_id);
        const distancePenalty = Math.min(0.12, distKm(c, prevNode) / 120);
        const prior = distanceElevationPrior(c, prevNode);
        const prefixBoost = prefixPrior(prefix, prevPrefix, c.node_id) * 0.22;
        const transitionBoost = transitionPrior(c.node_id, prevNode.node_id) * 0.25;
        return {
          node: c,
          conf: Math.max(0.08, 0.22 + prior * 0.36 + prefixBoost + transitionBoost - distancePenalty - (all.length - 1) * 0.01),
        };
      });

    const fallback = all
      .filter((c) => !usedIds.has(c.node_id) && inCorridor(c, prevNode) && distKm(c, prevNode) < 50 && hasLoS(c, prevNode))
      .sort((a, b) => sortScore(b) - sortScore(a))
      .slice(0, 1)
      .map((c) => {
        const prior = distanceElevationPrior(c, prevNode);
        const prefixBoost = prefixPrior(prefix, prevPrefix, c.node_id) * 0.16;
        const transitionBoost = transitionPrior(c.node_id, prevNode.node_id) * 0.16;
        return { node: c, conf: Math.max(0.03, 0.04 + prior * 0.2 + prefixBoost + transitionBoost) / Math.max(1, all.length) };
      });

    return [...confirmed, ...reachable, ...fallback];
  }

  const maxSkips = Math.min(2, Math.floor(pathHashes.length / 3));
  const ambiguity = pathHashes.reduce(
    (sum, h) => sum + (prefixCounts.get(h.slice(0, 2).toUpperCase()) ?? 0),
    0,
  );
  let budget = Math.max(180, Math.min(1600, 90 + pathHashes.length * 30 + ambiguity * 18));

  function solve(hopIdx: number, prevNode: MeshNode, skipsLeft: number, visited: Set<string>): HopResult[] | null {
    if (hopIdx < 0) return [];
    if (--budget <= 0) return null;

    const prefix = pathHashes[hopIdx]!.slice(0, 2).toUpperCase();
    const prevPrefix = hopIdx > 0 ? pathHashes[hopIdx - 1]!.slice(0, 2).toUpperCase() : '';
    const options = getCandidates(prefix, prevPrefix, prevNode).filter((o) => !visited.has(o.node.node_id));

    for (const opt of options) {
      const nextVisited = new Set(visited);
      nextVisited.add(opt.node.node_id);
      const rest = solve(hopIdx - 1, opt.node, skipsLeft, nextVisited);
      if (rest !== null) return [opt, ...rest];
    }

    if (skipsLeft > 0) {
      const rest = solve(hopIdx - 1, prevNode, skipsLeft - 1, visited);
      if (rest !== null) return [null, ...rest];
    }

    return null;
  }

  const raw = solve(pathHashes.length - 1, rx, maxSkips, new Set([rx.node_id]));
  if (!raw) return null;

  const hops = [...raw].reverse().filter((r): r is { node: MeshNode; conf: number } => r !== null);
  if (hops.length === 0) return null;

  const totalHops = raw.length;
  const skipped = totalHops - hops.length;
  const meanHopConfidence = hops.reduce((sum, h) => sum + h.conf, 0) / hops.length;
  const resolvedRatio = hops.length / totalHops;
  const skipPenalty = Math.max(0.2, 1 - skipped * 0.28);
  const scaledConfidence = meanHopConfidence * resolvedRatio * skipPenalty * (learningModel?.confidenceScale ?? 1);
  const confidence = Math.max(0, Math.min(1, scaledConfidence));

  const pathNodes: MeshNode[] = [
    ...(hasCoords(src) ? [src] : []),
    ...hops.map((h) => h.node),
    rx,
  ];
  if (pathNodes.length < 2) return null;

  return { path: pathNodes.map((n) => [n.lat!, n.lon!]), confidence };
}
