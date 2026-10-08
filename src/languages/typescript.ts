import type { Node } from 'web-tree-sitter';
import { parse as parseJsonc } from 'jsonc-parser';
import type { Extracted, LanguagePlugin, RawImport, ResolveContext } from '../core/types';
import { posix, unquote } from '../core/util';

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

interface TsConfig {
  dir: string;
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; wild: boolean; targets: string[] }>;
}

function loadTsConfig(ctx: ResolveContext): TsConfig | undefined {
  const cfg =
    ctx.configs.nearest('tsconfig.json', ctx.from) ?? ctx.configs.nearest('jsconfig.json', ctx.from);
  if (!cfg) return;
  return ctx.memo(`tsconfig:${cfg.path}`, () => {
    const json = parseJsonc(cfg.text) ?? {};
    const co = json.compilerOptions ?? {};
    const dir = posix.dirname(cfg.path);
    const paths: TsConfig['paths'] = [];
    for (const [pattern, targets] of Object.entries<string[]>(co.paths ?? {})) {
      const star = pattern.indexOf('*');
      paths.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        wild: star >= 0,
        targets,
      });
    }
    return { dir, baseUrl: co.baseUrl, paths } as TsConfig;
  });
}

/** Try `base` as-is, with extensions, as .js->.ts swap (ESM style), and as a directory index. */
function tryFile(base: string, ctx: ResolveContext): string | undefined {
  if (ctx.files.has(base) && EXTS.some((e) => base.endsWith(e))) return base;
  for (const e of EXTS) if (ctx.files.has(base + e)) return base + e;
  const m = /\.(m|c)?jsx?$/.exec(base);
  if (m) {
    const stem = base.slice(0, -m[0].length);
    for (const e of ['.ts', '.tsx', '.mts', '.cts']) if (ctx.files.has(stem + e)) return stem + e;
  }
  for (const e of EXTS) if (ctx.files.has(`${base}/index${e}`)) return `${base}/index${e}`;
  return undefined;
}

export const typescript: LanguagePlugin = {
  id: 'typescript',
  extensions: EXTS,

  grammarOf: (ext) => (ext === '.tsx' ? 'tree-sitter-tsx' : /^\.(m|c)?ts$/.test(ext) ? 'tree-sitter-typescript' : 'tree-sitter-javascript'),
  languageOf: (ext) => (/^\.(m|c)?tsx?$/.test(ext) ? 'typescript' : 'javascript'),

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    const nodes = root.descendantsOfType([
      'import_statement',
      'export_statement',
      'import_require_clause',
      'call_expression',
    ]);
    for (const n of nodes) {
      if (!n) continue;
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function');
        if (fn && (fn.text === 'require' || fn.type === 'import')) {
          const arg = n.childForFieldName('arguments')?.namedChild(0);
          if (arg?.type === 'string') imports.push({ specifier: unquote(arg.text), line: arg.startPosition.row });
        }
        continue;
      }
      const src = n.childForFieldName('source');
      if (src) imports.push({ specifier: unquote(src.text), line: src.startPosition.row });
    }
    return { imports, declares: [] };
  },

  resolve(imp, ctx) {
    const spec = imp.specifier;
    const out: string[] = [];

    if (spec.startsWith('.')) {
      const hit = tryFile(posix.join(posix.dirname(ctx.from), spec), ctx);
      return hit ? [hit] : [];
    }

    const ts = loadTsConfig(ctx);
    if (ts) {
      for (const p of ts.paths) {
        const matches = p.wild ? spec.startsWith(p.prefix) && spec.endsWith(p.suffix) && spec.length >= p.prefix.length + p.suffix.length : spec === p.prefix;
        if (!matches) continue;
        const mid = p.wild ? spec.slice(p.prefix.length, spec.length - p.suffix.length) : '';
        for (const t of p.targets) {
          const target = t.replace('*', mid);
          const hit = tryFile(posix.join(ts.dir, ts.baseUrl ?? '.', target), ctx);
          if (hit) out.push(hit);
        }
        if (out.length) return out;
      }
      if (ts.baseUrl) {
        const hit = tryFile(posix.join(ts.dir, ts.baseUrl, spec), ctx);
        if (hit) return [hit];
      }
    }
    // bare specifiers (react, lodash, node:fs ...) are packages, not workspace files
    return [];
  },
};
