import type { Node } from 'web-tree-sitter';
import type { Extracted, LanguagePlugin, RawImport } from '../core/types';
import { posix, stripComments } from '../core/util';

const SCOPE = 'java';

export const java: LanguagePlugin = {
  id: SCOPE,
  extensions: ['.java'],
  grammarOf: () => 'tree-sitter-java',
  languageOf: () => 'java',

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    const declares: string[] = [];
    for (const n of root.descendantsOfType(['import_declaration', 'package_declaration'])) {
      if (!n) continue;
      const text = stripComments(n.text);
      if (n.type === 'package_declaration') {
        const m = /package\s+([\w.]+)\s*;/.exec(text);
        if (m) declares.push(m[1]);
        continue;
      }
      const m = /import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/.exec(text);
      if (m) imports.push({ specifier: m[2], line: n.startPosition.row, isStatic: !!m[1], wildcard: !!m[3] });
    }
    return { imports, declares };
  },

  resolve(imp, ctx) {
    if (imp.wildcard && !imp.isStatic) return ctx.symbols.get(SCOPE, imp.specifier);

    // `com.foo.Bar`, `com.foo.Outer.Inner`, `static com.foo.Bar.method`:
    // peel segments off the end until `<package>/<Class>.java` exists.
    const seg = imp.specifier.split('.');
    for (let cut = seg.length - 1; cut >= 1; cut--) {
      const pkg = seg.slice(0, cut).join('.');
      const cls = seg[cut];
      const hits = ctx.symbols.get(SCOPE, pkg).filter((f) => posix.basename(f) === `${cls}.java`);
      if (hits.length) return hits;
    }
    // static wildcard: import static com.foo.Bar.*
    if (imp.wildcard && imp.isStatic) {
      for (let cut = seg.length - 1; cut >= 1; cut--) {
        const pkg = seg.slice(0, cut).join('.');
        const cls = seg[cut];
        const hits = ctx.symbols.get(SCOPE, pkg).filter((f) => posix.basename(f) === `${cls}.java`);
        if (hits.length) return hits;
      }
    }
    return [];
  },
};
