import type { Node } from 'web-tree-sitter';
import type { Extracted, LanguagePlugin, RawImport, ResolveContext } from '../core/types';
import { posix, unquote } from '../core/util';

interface Mod { dir: string; module: string }

function modules(ctx: ResolveContext): Mod[] {
  return ctx.memo('go:modules', () =>
    ctx.configs.all('go.mod').flatMap(({ path, text }) => {
      const m = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text);
      return m ? [{ dir: posix.dirname(path), module: m[2] }] : [];
    }).sort((a, b) => b.module.length - a.module.length)
  );
}

export const go: LanguagePlugin = {
  id: 'go',
  extensions: ['.go'],
  grammarOf: () => 'tree-sitter-go',
  languageOf: () => 'go',

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    for (const n of root.descendantsOfType('import_spec')) {
      const p = n?.childForFieldName('path');
      if (n && p) imports.push({ specifier: unquote(p.text), line: n.startPosition.row });
    }
    return { imports, declares: [] };
  },

  /**
   * Go imports name a *package* (a directory). We link to every non-test file in it.
   * The graph builder caps fan-out; collapsing a package into one node is a natural next step.
   */
  resolve(imp, ctx) {
    for (const m of modules(ctx)) {
      if (imp.specifier !== m.module && !imp.specifier.startsWith(m.module + '/')) continue;
      const dir = posix.join(m.dir, imp.specifier.slice(m.module.length));
      return (ctx.filesByDir.get(dir) ?? []).filter(
        (f) => f.endsWith('.go') && (ctx.options.includeTestFiles || !f.endsWith('_test.go'))
      );
    }
    return []; // stdlib or third-party
  },
};
