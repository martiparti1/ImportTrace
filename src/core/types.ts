import type { Node } from 'web-tree-sitter';

/** One import/include found in a file. `line` is 0-based. */
export interface RawImport {
  /** The thing being imported, as written: "./a", "a.b", "com.foo.Bar", "foo.h" ... */
  specifier: string;
  line: number;
  /** C/C++ `<angle>` includes. */
  system?: boolean;
  /** Python `from x import a, b` -> ["a", "b"] */
  names?: string[];
  /** Java `import a.b.*` */
  wildcard?: boolean;
  /** Java / C# `import static` / `using static` */
  isStatic?: boolean;
  /** The specifier may name a type rather than a namespace (C# `using Alias = Ns.Type;`). */
  maybeType?: boolean;
}

export interface Extracted {
  imports: RawImport[];
  /** Namespaces / packages this file declares. Feeds the shared symbol index. */
  declares: string[];
}

/** namespace/package -> files that declare it. Scoped per plugin so languages don't collide. */
export class SymbolIndex {
  private map = new Map<string, Set<string>>();
  add(scope: string, name: string, file: string) {
    const key = `${scope}\0${name}`;
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(file);
  }
  get(scope: string, name: string): string[] {
    return [...(this.map.get(`${scope}\0${name}`) ?? [])];
  }
}

/** Config files (tsconfig.json, go.mod, ...) that the host read for us. */
export class ConfigStore {
  private byName = new Map<string, Map<string, string>>();
  set(path: string, text: string) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    let m = this.byName.get(name);
    if (!m) this.byName.set(name, (m = new Map()));
    m.set(path, text);
  }
  all(name: string): Array<{ path: string; text: string }> {
    return [...(this.byName.get(name) ?? [])].map(([path, text]) => ({ path, text }));
  }
  /** Closest config with this file name in an ancestor directory of `from`. */
  nearest(name: string, from: string): { path: string; text: string } | undefined {
    const m = this.byName.get(name);
    if (!m) return;
    let dir = from;
    while (true) {
      const i = dir.lastIndexOf('/');
      if (i < 0) return;
      dir = i === 0 ? '/' : dir.slice(0, i);
      const hit = m.get(`${dir}/${name}`);
      if (hit !== undefined) return { path: `${dir}/${name}`, text: hit };
    }
  }
}

export interface ResolveContext {
  /** Absolute posix path of the importing file. */
  from: string;
  roots: string[];
  files: ReadonlySet<string>;
  filesByDir: ReadonlyMap<string, string[]>;
  filesByBase: ReadonlyMap<string, string[]>;
  symbols: SymbolIndex;
  configs: ConfigStore;
  options: { includeTestFiles: boolean };
  /** Compute-once cache shared by all files in a build. Use for parsed configs. */
  memo<T>(key: string, compute: () => T): T;
}

/**
 * A language plugin does two jobs:
 *  1. extract(): pull imports (and declared namespaces) out of a syntax tree
 *  2. resolve(): turn one import into absolute file paths in the workspace
 */
export interface LanguagePlugin {
  id: string;
  extensions: string[];
  /** wasm grammar basename in tree-sitter-wasms, e.g. "tree-sitter-tsx" */
  grammarOf(ext: string): string;
  /** language id used by the webview highlighter */
  languageOf(ext: string): string;
  extract(root: Node): Extracted;
  resolve(imp: RawImport, ctx: ResolveContext): string[];
}

export interface GraphNode {
  id: string; // absolute posix path
  lang: string;
  lineCount: number;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** 0-based line of the import inside `from`; the arrow pins here. */
  line: number;
  specifier: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { files: number; imports: number; resolved: number; droppedFanout: number };
}
