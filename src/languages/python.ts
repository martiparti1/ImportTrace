import type { Node } from 'web-tree-sitter';
import type { Extracted, LanguagePlugin, RawImport, ResolveContext } from '../core/types';
import { posix, suffixMatch } from '../core/util';

function moduleFiles(p: string, ctx: ResolveContext, allowFile = true): string[] {
  const out: string[] = [];
  if (allowFile && ctx.files.has(p + '.py')) out.push(p + '.py');
  if (ctx.files.has(p + '/__init__.py')) out.push(p + '/__init__.py');
  return out;
}

export const python: LanguagePlugin = {
  id: 'python',
  extensions: ['.py', '.pyi'],
  grammarOf: () => 'tree-sitter-python',
  languageOf: () => 'python',

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    for (const n of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
      if (!n) continue;
      const line = n.startPosition.row;
      if (n.type === 'import_statement') {
        for (const c of n.childrenForFieldName('name')) {
          const dotted = c?.type === 'aliased_import' ? c.childForFieldName('name') : c;
          if (dotted) imports.push({ specifier: dotted.text, line });
        }
      } else {
        const mod = n.childForFieldName('module_name');
        if (!mod) continue;
        const names: string[] = [];
        for (const c of n.childrenForFieldName('name')) {
          const id = c?.type === 'aliased_import' ? c.childForFieldName('name') : c;
          if (id) names.push(id.text);
        }
        imports.push({ specifier: mod.text, line, names });
      }
    }
    return { imports, declares: [] };
  },

  resolve(imp, ctx) {
    const m = /^(\.*)(.*)$/.exec(imp.specifier)!;
    const dots = m[1].length;
    const parts = m[2] ? m[2].split('.') : [];
    const out = new Set<string>();

    const bases: string[] = [];
    if (dots > 0) {
      let d = posix.dirname(ctx.from);
      for (let i = 1; i < dots; i++) d = posix.dirname(d);
      bases.push(d);
    } else {
      for (const r of ctx.roots) bases.push(r, posix.join(r, 'src'));
      bases.push(posix.dirname(ctx.from)); // script-style sibling imports
    }

    for (const base of bases) {
      const target = posix.join(base, ...parts);
      if (!(dots > 0 && parts.length === 0 && (imp.names?.length ?? 0) > 0)) {
        for (const f of moduleFiles(target, ctx, parts.length > 0)) out.add(f);
      }
      // `from pkg import submodule`
      for (const name of imp.names ?? []) for (const f of moduleFiles(posix.join(target, name), ctx)) out.add(f);
    }

    // Monorepo fallback: package root isn't the workspace root. Accept a unique suffix match only.
    if (out.size === 0 && dots === 0 && parts.length) {
      const rel = parts.join('/');
      const hits = suffixMatch(`${rel}.py`, ctx.from, ctx.filesByBase);
      const pkg = suffixMatch(`${rel}/__init__.py`, ctx.from, ctx.filesByBase);
      for (const f of [...hits, ...pkg]) out.add(f);
    }
    return [...out];
  },
};
