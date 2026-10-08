import dagre from '@dagrejs/dagre';

export const NODE_W = 460;
export const NODE_H = 340;
export const GAP = 70;

export interface Pos { x: number; y: number }
interface E { from: string; to: string }

/** Layered left-to-right layout: importers on the left, what they import on the right. */
export function layoutAll(ids: string[], edges: E[]): Map<string, Pos> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: GAP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) g.setNode(id, { width: NODE_W, height: NODE_H });
  const set = new Set(ids);
  for (const e of edges) if (set.has(e.from) && set.has(e.to)) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out = new Map<string, Pos>();
  for (const id of ids) {
    const n = g.node(id);
    out.set(id, { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 });
  }
  return out;
}

/** Place a newly revealed node beside its neighbour without overlapping existing windows. */
export function placeBeside(anchor: Pos, side: 'left' | 'right', occupied: Pos[]): Pos {
  const x = anchor.x + (side === 'right' ? NODE_W + GAP : -(NODE_W + GAP));
  let y = anchor.y;
  const hit = (p: Pos) => Math.abs(p.x - x) < NODE_W && Math.abs(p.y - y) < NODE_H + 20;
  while (occupied.some(hit)) y += NODE_H + 30;
  return { x, y };
}

export function adjacency(edges: E[], dir: 'both' | 'in' | 'out' = 'both'): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of edges) {
    if (dir === 'both' || dir === 'out') add(e.from, e.to);
    if (dir === 'both' || dir === 'in') add(e.to, e.from);
  }
  return adj;
}

export function bfs(seeds: string[], adj: Map<string, Set<string>>, depth: number): Set<string> {
  const seen = new Set(seeds);
  let frontier = seeds;
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}
