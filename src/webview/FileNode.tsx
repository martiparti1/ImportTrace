import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { MapNode } from '../shared/messages';
import { fileStore, useFileText } from './store';
import { highlightLine } from './highlight';
import { NODE_H, NODE_W } from './layout';
import { post } from './vscode';

export type Side = 'left' | 'right' | 'top' | 'bottom';

const SIDE_POS: Record<Side, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export interface IncomingEdge {
  sourceId: string;
  side: Side;
}

export const TITLE_H = 34;
export const LINE_H = 18;
const PAD_TOP = 6;
const OVERSCAN = 12;

export interface FileNodeData extends Record<string, unknown> {
  info: MapNode;
  isTarget?: boolean;
  targetColor?: string;
  /** 0-based lines in this file that hold an import (each gets an arrow pin). */
  importLines: number[];
  /** Per-import-line, which side the source handle should be on. */
  sourceHandleSides: Record<number, Record<string, Side>>;
  /** One entry per incoming edge, giving us the side to place the target handle. */
  incomingEdges: IncomingEdge[];
  /** Neighbours that exist in the graph but aren't on screen. */
  hidden: number;
  onExpand: (id: string) => void;
}
export type FileNodeType = Node<FileNodeData, 'file'>;

/** Accent per language. Hue encodes language, nothing else. */
const LANG_COLOR: Record<string, string> = {
  typescript: '#3b82c4', javascript: '#d4b02a', python: '#4b9a6b', c: '#7a8aa0',
  cpp: '#5b6fc9', java: '#d0793a', go: '#2fb4c4', csharp: '#8f5fc7',
};

const Line = memo(function Line({ n, text, lang, pinned }: { n: number; text: string; lang: string; pinned: boolean }) {
  const html = useMemo(() => highlightLine(text, lang), [text, lang]);
  return (
    <div className={pinned ? 'cm-line cm-line-import' : 'cm-line'}>
      <span className="cm-ln">{n + 1}</span>
      <span className="cm-tx" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
    </div>
  );
});

function FileNodeImpl({ id, data, selected }: NodeProps<FileNodeType>) {
  const { info, importLines, sourceHandleSides, incomingEdges, hidden, onExpand } = data;
  const text = useFileText(id);
  const lines = useMemo(() => (text === undefined ? [] : text.split('\n')), [text]);
  const importSet = useMemo(() => new Set(importLines), [importLines]);
  const updateInternals = useUpdateNodeInternals();

  const bodyRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const viewH = NODE_H - TITLE_H;

  useEffect(() => { fileStore.request(id); }, [id]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Arrow pins follow their import line as the window scrolls, and stick to the edge when off-screen.
  // React Flow measures handles from the DOM, so tell it after every position change.
  useLayoutEffect(() => { updateInternals(id); }, [scrollTop, importLines, sourceHandleSides, incomingEdges, id, updateInternals]);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollTop(bodyRef.current?.scrollTop ?? 0));
  };

  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, first + Math.ceil(viewH / LINE_H) + OVERSCAN * 2);

  const pinTop = (line: number) => {
    const y = TITLE_H + PAD_TOP + line * LINE_H + LINE_H / 2 - scrollTop;
    const lo = TITLE_H + LINE_H / 2;
    const hi = NODE_H - LINE_H / 2 - 10;
    return { top: Math.min(hi, Math.max(lo, y)), off: y < lo || y > hi };
  };

  const slash = info.rel.lastIndexOf('/');
  const name = info.rel.slice(slash + 1);
  const dir = slash < 0 ? '' : info.rel.slice(0, slash);

  const style: React.CSSProperties = { height: NODE_H, ['--accent' as any]: LANG_COLOR[info.lang] ?? '#888' };
  if (data.isTarget && data.targetColor) (style as any)['--target-color'] = data.targetColor;

  return (
    <div className={selected ? 'cm-win cm-win-selected' : data.isTarget ? 'cm-win cm-win-target' : 'cm-win'} style={style}>
      {/* target handles: distribute them along the chosen side so they don't overlap */}
      {(['left', 'right', 'top', 'bottom'] as Side[]).flatMap((side) => {
        const arr = incomingEdges.filter(ie => ie.side === side);
        return arr.map((ie, i) => {
          const pos = SIDE_POS[side];
          const style: React.CSSProperties = {};
          if (side === 'left' || side === 'right') {
            style.top = TITLE_H + ((NODE_H - TITLE_H) / (arr.length + 1)) * (i + 1);
            if (side === 'left') style.left = -5;
            else style.right = -5;
          } else {
            style.left = (NODE_W / (arr.length + 1)) * (i + 1);
            if (side === 'top') style.top = -5;
            else style.bottom = -5;
          }
          return <Handle key={`in-${ie.sourceId}`} type="target" position={pos} id={`in-${ie.sourceId}`} style={style} />;
        });
      })}

      <div className="cm-title" title={info.rel}>
        <span className="cm-name">{name}</span>
        <span className="cm-dir">{dir}</span>
        <span className="cm-spacer" />
        {hidden > 0 && (
          <button className="cm-btn nodrag" title={`Show ${hidden} connected file${hidden > 1 ? 's' : ''}`} onClick={() => onExpand(id)}>
            +{hidden}
          </button>
        )}
        <button className="cm-btn nodrag" title="Open in editor" aria-label="Open in editor" onClick={() => post({ type: 'open', id })}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" />
          </svg>
        </button>
      </div>

      <div ref={bodyRef} className="cm-body nowheel nodrag nopan" onScroll={onScroll} tabIndex={0}>
        {text === undefined ? (
          <div className="cm-loading">Loading…</div>
        ) : (
          <div className="cm-code" style={{ paddingTop: PAD_TOP + first * LINE_H, paddingBottom: (lines.length - last) * LINE_H }}>
            {lines.slice(first, last).map((l, i) => (
              <div key={first + i} onDoubleClick={() => {
                if (window.getSelection()?.toString().trim()) return;
                post({ type: 'open', id, line: first + i });
              }}>
                <Line n={first + i} text={l} lang={info.lang} pinned={importSet.has(first + i)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {importLines.flatMap((line) => {
        const { top, off } = pinTop(line);
        const targets = sourceHandleSides[line] ?? {};
        return Object.entries(targets).map(([targetId, side]) => {
          const pos = SIDE_POS[side];
          const style: React.CSSProperties =
            side === 'left'  ? { top } :
            side === 'right' ? { top } :
            side === 'top'   ? { left: NODE_W / 2, top: -5 } :
                               { left: NODE_W / 2, bottom: -5 };
          return <Handle key={`${line}-${targetId}`} type="source" position={pos} id={`l${line}-${targetId}`} className={off ? 'cm-pin cm-pin-off' : 'cm-pin'} style={style} />;
        });
      })}
    </div>
  );
}

export const FileNode = memo(FileNodeImpl);
