import type { GraphEdge, GraphNode } from '../core/types';

export interface MapNode extends GraphNode {
  /** Path relative to the workspace folder, for display. */
  rel: string;
}
export interface MapGraph {
  nodes: MapNode[];
  edges: GraphEdge[];
  stats: { files: number; imports: number; resolved: number; droppedFanout: number };
}

export type HostToWeb =
  | { type: 'graph'; graph: MapGraph; focus: string[]; depth: number; mode: 'active' | 'workspace'; targetColor: string }
  | { type: 'file'; id: string; text: string }
  | { type: 'invalidate'; ids: string[] }
  | { type: 'scanning'; message: string };

export type WebToHost =
  | { type: 'ready' }
  | { type: 'getFile'; id: string }
  | { type: 'open'; id: string; line?: number };
