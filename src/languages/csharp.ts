import type { Node } from 'web-tree-sitter';
import type { Extracted, LanguagePlugin, RawImport } from '../core/types';
import { posix, stripComments } from '../core/util';

const SCOPE = 'csharp';

/** Full namespace of a declaration, including enclosing block-scoped namespaces. */
function fullNamespace(n: Node): string | undefined {
  const name = n.childForFieldName('name')?.text;
  if (!name) return;
  const parts = [name];
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'namespace_declaration') {
      const outer = p.childForFieldName('name')?.text;
      if (outer) parts.unshift(outer);
    }
  }
  return parts.join('.');
}

export const csharp: LanguagePlugin = {
  id: SCOPE,
  extensions: ['.cs'],
  grammarOf: () => 'tree-sitter-c_sharp',
  languageOf: () => 'csharp',

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    const declares: string[] = [];
    const nodes = root.descendantsOfType(['using_directive', 'namespace_declaration', 'file_scoped_namespace_declaration']);
    for (const n of nodes) {
      if (!n) continue;
      if (n.type === 'using_directive') {
        // using X; | global using X; | using static X.Y; | using Alias = X.Y;
        const m = /using\s+(static\s+)?(\w+\s*=\s*)?([\w.]+)\s*;/.exec(stripComments(n.text));
        if (m) imports.push({ specifier: m[3], line: n.startPosition.row, isStatic: !!m[1], maybeType: !!m[2] });
      } else {
        const ns = fullNamespace(n);
        if (ns) declares.push(ns);
      }
    }
    return { imports, declares };
  },

  resolve(imp, ctx) {
    const direct = ctx.symbols.get(SCOPE, imp.specifier);
    if (direct.length || !(imp.isStatic || imp.maybeType)) return direct;
    // `using static Ns.Type;` and `using A = Ns.Type;` name a type. Look in its namespace,
    // and prefer the file named after the type (Type.cs) when there is one.
    const dot = imp.specifier.lastIndexOf('.');
    const type = imp.specifier.slice(dot + 1);
    const inNs = ctx.symbols.get(SCOPE, imp.specifier.slice(0, dot));
    const exact = inNs.filter((f) => posix.basename(f) === `${type}.cs`);
    return exact.length ? exact : inNs;
  },
};
