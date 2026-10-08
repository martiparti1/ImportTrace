import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow,
  type ColorMode, type Edge,
} from '@xyflow/react';
import type { HostToWeb, MapGraph } from '../shared/messages';
import { FileNode, type FileNodeType, type IncomingEdge, type Side } from './FileNode';
import { fileStore } from './store';
import { adjacency, bfs, layoutAll, NODE_H, NODE_W, placeBeside, type Pos } from './layout';
import { post } from './vscode';

/** Given two node positions, decide which side of `a` faces `b`. */
function bestSide(a: Pos, b: Pos): Side {
  const dx = (b.x + NODE_W / 2) - (a.x + NODE_W / 2);
  const dy = (b.y + NODE_H / 2) - (a.y + NODE_H / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function bestSideHorizontal(a: Pos, b: Pos): Side {
  return (b.x + NODE_W / 2) - (a.x + NODE_W / 2) >= 0 ? 'right' : 'left';
}

const nodeTypes = { file: FileNode };
const MAX_SHOWN = 200;

function useColorMode(): ColorMode {
  const read = (): ColorMode => (document.body.classList.contains('vscode-light') ? 'light' : 'dark');
  const [mode, setMode] = useState<ColorMode>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

function Map_() {
  const [graph, setGraph] = useState<MapGraph | null>(null);
  const [view, setView] = useState<{ focus: string[]; depth: number; mode: 'active' | 'workspace'; targetColor: string }>({ focus: [], depth: 2, mode: 'active', targetColor: '#FFD700' });
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState<'both' | 'in' | 'out'>('both');
  const [transitive, setTransitive] = useState(false);
  const [status, setStatus] = useState('Scanning…');
  const [nodes, setNodes, onNodesChange] = useNodesState<FileNodeType>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const colorMode = useColorMode();
  const rf = useReactFlow();
  const viewKey = useRef('');
  const expandedFrom = useRef<string | null>(null);
  const needsFit = useRef(false);
  const initialized = useNodesInitialized();

  const adj = useMemo(() => (graph ? adjacency(graph.edges.map((e) => ({ from: e.from, to: e.to })), direction) : new Map<string, Set<string>>()), [graph, direction]);
  const ids = useMemo(() => new Set(graph?.nodes.map((n) => n.id) ?? []), [graph]);

  // ---- host messages
  useEffect(() => {
    const onMsg = (ev: MessageEvent<HostToWeb>) => {
      const m = ev.data;
      if (m.type === 'graph') {
        setGraph(m.graph);
        setView({ focus: m.focus, depth: m.depth, mode: m.mode, targetColor: m.targetColor });
        setStatus('');
      } else if (m.type === 'file') fileStore.set(m.id, m.text);
      else if (m.type === 'invalidate') m.ids.forEach((id) => fileStore.invalidate(id, true));
      else if (m.type === 'scanning') setStatus(m.message);
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ---- decide what's on screen: reset when the view changes, keep what the user revealed when it doesn't
  useEffect(() => {
    if (!graph) return;
    const seeds = view.focus.filter((f) => ids.has(f));
    const currentDepth = transitive ? view.depth : 1;
    const key = `${view.mode}|${seeds.join(',')}|${currentDepth}|${direction}`;
    const initial = view.mode === 'workspace'
      ? new Set(graph.nodes.slice(0, MAX_SHOWN).map((n) => n.id))
      : bfs(seeds, adj, currentDepth);
    if (key !== viewKey.current) {
      viewKey.current = key;
      setNodes([]); // forces a fresh layout
      needsFit.current = true;
      setShown(initial);
    } else {
      setShown((prev) => new Set([...prev].filter((id) => ids.has(id))));
    }
  }, [graph, view, adj, ids, setNodes]);

  const expand = useCallback((id: string) => {
    expandedFrom.current = id;
    setShown((prev) => new Set([...prev, ...(adj.get(id) ?? [])].slice(0, MAX_SHOWN)));
  }, [adj]);

  // ---- sync React Flow nodes with `shown`
  useEffect(() => {
    if (!graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const importers = new Map<string, Set<string>>(); // id -> who imports it
    const importLines = new Map<string, Set<number>>();
    for (const e of graph.edges) {
      if (!shown.has(e.from) || !shown.has(e.to)) continue;
      (importLines.get(e.from) ?? importLines.set(e.from, new Set()).get(e.from)!).add(e.line);
    }
    for (const e of graph.edges) (importers.get(e.to) ?? importers.set(e.to, new Set()).get(e.to)!).add(e.from);

    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      const list = [...shown].filter((id) => byId.has(id));
      const fresh = prev.length === 0 ? layoutAll(list, graph.edges) : null;
      const occupied: Pos[] = prev.map((n) => n.position);
      return list.map((id) => {
        const info = byId.get(id)!;
        const isTarget = view.focus.includes(id);
        const data = {
          info,
          isTarget,
          targetColor: view.targetColor,
          importLines: [...(importLines.get(id) ?? [])].sort((a, b) => a - b),
          sourceHandleSides: {} as Record<number, Record<string, Side>>,
          incomingEdges: [] as IncomingEdge[],
          hidden: [...(adj.get(id) ?? [])].filter((n) => !shown.has(n)).length,
          onExpand: expand,
        };
        const existing = old.get(id);
        if (existing) return { ...existing, data };
        let position: Pos;
        if (fresh) position = fresh.get(id)!;
        else {
          const anchorId = expandedFrom.current && adj.get(expandedFrom.current)?.has(id) ? expandedFrom.current : [...(adj.get(id) ?? [])].find((n) => old.has(n));
          const anchor = anchorId ? old.get(anchorId)?.position : undefined;
          // anchor imports `id` -> it belongs on the right; `id` imports anchor -> on the left
          const side = anchorId && importers.get(id)?.has(anchorId) ? 'right' : 'left';
          position = placeBeside(anchor ?? { x: 0, y: 0 }, side, occupied);
          occupied.push(position);
        }
        return { id, type: 'file' as const, position, data, dragHandle: '.cm-title', width: 460, height: 340 };
      });
    });
  }, [graph, shown, adj, expand, setNodes, view.focus, view.targetColor]);

  // ---- keep handle sides in sync with current node positions (reacts to drag)
  const posFingerprint = useMemo(() => nodes.map((n) => `${n.id}:${n.position.x}:${n.position.y}`).join('|'), [nodes]);
  useEffect(() => {
    if (!graph || nodes.length === 0) return;
    const posMap = new Map(nodes.map((n) => [n.id, n.position]));
    const visibleEdges = graph.edges.filter((e) => posMap.has(e.from) && posMap.has(e.to));

    // Build incoming edges (target side) per node
    const incomingByNode = new Map<string, IncomingEdge[]>();
    // Build source handle sides per node
    const sourceSidesByNode = new Map<string, Record<number, Record<string, Side>>>();

    for (const e of visibleEdges) {
      const fromPos = posMap.get(e.from)!;
      const toPos = posMap.get(e.to)!;

      // target handle side: which side of target faces the source
      const targetSide = bestSide(toPos, fromPos);
      const arr = incomingByNode.get(e.to) ?? [];
      // Avoid duplicate handles for the same source
      if (!arr.some((ie) => ie.sourceId === e.from)) {
        arr.push({ sourceId: e.from, side: targetSide });
        incomingByNode.set(e.to, arr);
      }

      // source handle side: which side of source faces the target
      const sourceSide = bestSide(fromPos, toPos);
      const sides = sourceSidesByNode.get(e.from) ?? {};
      const targets = sides[e.line] ?? {};
      targets[e.to] = sourceSide;
      sides[e.line] = targets;
      sourceSidesByNode.set(e.from, sides);
    }

    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const incoming = incomingByNode.get(n.id) ?? [];
        const sourceSides = sourceSidesByNode.get(n.id) ?? {};
        const oldData = n.data;
        // Quick equality check to avoid unnecessary updates
        const incomingChanged = JSON.stringify(incoming) !== JSON.stringify(oldData.incomingEdges);
        const sidesChanged = JSON.stringify(sourceSides) !== JSON.stringify(oldData.sourceHandleSides);
        if (!incomingChanged && !sidesChanged) return n;
        changed = true;
        return { ...n, data: { ...oldData, incomingEdges: incoming, sourceHandleSides: sourceSides } };
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, posFingerprint, setNodes]);

  // Fit once per view, after React Flow has measured the windows.
  useEffect(() => {
    if (initialized && needsFit.current && nodes.length) {
      needsFit.current = false;
      rf.fitView({ padding: 0.12, maxZoom: 1, duration: 0 });
    }
  }, [initialized, nodes.length, rf]);

  const edges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges
      .filter((e) => shown.has(e.from) && shown.has(e.to))
      .map((e) => ({
        id: e.id, source: e.from, target: e.to, sourceHandle: `l${e.line}-${e.to}`, targetHandle: `in-${e.from}`,
        type: 'step',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, markerUnits: 'userSpaceOnUse' },
        className: selected && (e.from === selected || e.to === selected) ? 'cm-edge cm-edge-hot' : 'cm-edge',
        zIndex: selected && (e.from === selected || e.to === selected) ? 10 : 0,
      }));
  }, [graph, shown, selected]);

  const showAll = () => setShown(new Set((graph?.nodes ?? []).slice(0, MAX_SHOWN).map((n) => n.id)));

  if (!graph) return <div className="cm-empty">{status || 'Scanning…'}</div>;
  const noFocus = view.mode === 'active' && shown.size === 0;

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
      colorMode={colorMode} minZoom={0.05} maxZoom={1.5} onlyRenderVisibleElements
      zoomOnScroll panOnScroll={false} proOptions={{ hideAttribution: true }} nodesConnectable={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} />
      <Panel position="top-left" className="cm-panel">
        <span>{shown.size} of {graph.nodes.length} files · {graph.edges.length} links</span>
        <button onClick={() => rf.fitView({ padding: 0.15, maxZoom: 1 })}>Fit</button>
        <button onClick={showAll} disabled={shown.size >= Math.min(graph.nodes.length, MAX_SHOWN)}>Show all</button>
        <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
          <option value="both">Both</option>
          <option value="in">Dependents</option>
          <option value="out">Dependencies</option>
        </select>
        <label><input type="checkbox" checked={transitive} onChange={(e) => setTransitive(e.target.checked)} /> Transitive</label>
        {status && <span className="cm-status">{status}</span>}
      </Panel>
      {noFocus && (
        <Panel position="top-center" className="cm-hint">
          Open a source file, then run “ImportTrace: Show Map for Active File”.
        </Panel>
      )}
      {graph.nodes.length > MAX_SHOWN && shown.size >= MAX_SHOWN && (
        <Panel position="bottom-center" className="cm-hint">Showing the first {MAX_SHOWN} files. Focus on one file to explore the rest.</Panel>
      )}
    </ReactFlow>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <Map_ />
    </ReactFlowProvider>
  );
}
