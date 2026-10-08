import { pluginFor, extOf } from '../languages';
import { ParserService } from './parser';
import {
  ConfigStore, Graph, GraphEdge, GraphNode, RawImport, ResolveContext, SymbolIndex,
} from './types';
import { posix } from './util';

interface ParsedFile {
  lang: string;
  lineCount: number;
  imports: RawImport[];
  declares: string[];
}

export interface BuildOptions {
  roots: string[];
  configs: ConfigStore;
  includeTestFiles: boolean;
  /** An import that resolves to more files than this is dropped (huge namespaces/packages). */
  maxFanout: number;
}

/** Parse results are cached per file; resolution is cheap and re-runs on every build(). */
export class GraphBuilder {
  private parsed = new Map<string, ParsedFile>();
  constructor(private parser: ParserService) {}

  has(path: string) { return this.parsed.has(path); }
  invalidate(path: string) { this.parsed.delete(path); }
  clear() { this.parsed.clear(); }

  async parse(path: string, text: string): Promise<void> {
    const plugin = pluginFor(path);
    if (!plugin) return;
    const ext = extOf(path);
    const lineCount = text.split('\n').length;
    try {
      const tree = await this.parser.parse(text, plugin.grammarOf(ext));
      try {
        const { imports, declares } = plugin.extract(tree.rootNode);
        this.parsed.set(path, { lang: plugin.languageOf(ext), lineCount, imports, declares });
      } finally {
        tree.delete();
      }
    } catch (err) {
      console.error(`[codemap] failed to parse ${path}:`, err);
      this.parsed.set(path, { lang: plugin.languageOf(ext), lineCount, imports: [], declares: [] });
    }
  }

  build(filePaths: string[], opts: BuildOptions): Graph {
    const files = new Set(filePaths.filter((p) => this.parsed.has(p)));
    const filesByDir = new Map<string, string[]>();
    const filesByBase = new Map<string, string[]>();
    const symbols = new SymbolIndex();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const a = m.get(k);
      a ? a.push(v) : m.set(k, [v]);
    };

    for (const f of files) {
      push(filesByDir, posix.dirname(f), f);
      push(filesByBase, posix.basename(f), f);
      const plugin = pluginFor(f)!;
      for (const d of this.parsed.get(f)!.declares) symbols.add(plugin.id, d, f);
    }

    const memoStore = new Map<string, unknown>();
    const memo = <T>(key: string, compute: () => T): T => {
      if (!memoStore.has(key)) memoStore.set(key, compute());
      return memoStore.get(key) as T;
    };

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const stats = { files: files.size, imports: 0, resolved: 0, droppedFanout: 0 };

    for (const f of files) {
      const pf = this.parsed.get(f)!;
      nodes.push({ id: f, lang: pf.lang, lineCount: pf.lineCount });
      const plugin = pluginFor(f)!;
      const ctx: ResolveContext = {
        from: f, roots: opts.roots, files, filesByDir, filesByBase, symbols,
        configs: opts.configs, options: { includeTestFiles: opts.includeTestFiles }, memo,
      };
      const seen = new Set<string>();
      for (const imp of pf.imports) {
        stats.imports++;
        let targets: string[] = [];
        try { targets = plugin.resolve(imp, ctx); } catch (err) { console.error('[codemap] resolve error', f, imp, err); }
        targets = targets.filter((t) => t !== f && files.has(t));
        if (targets.length > opts.maxFanout) { stats.droppedFanout++; continue; }
        if (targets.length) stats.resolved++;
        for (const t of targets) {
          const key = `${imp.line}>${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ id: `${f}:${imp.line}>${t}`, from: f, to: t, line: imp.line, specifier: imp.specifier });
        }
      }
    }
    return { nodes, edges, stats };
  }
}
