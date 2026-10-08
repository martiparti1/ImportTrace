import type { Node } from 'web-tree-sitter';
import { parse as parseJsonc } from 'jsonc-parser';
import type { Extracted, LanguagePlugin, RawImport, ResolveContext } from '../core/types';
import { posix, suffixMatch, toPosix, unquote } from '../core/util';

const C_EXT = ['.c'];
const CPP_EXT = ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.inl', '.ipp', '.tpp'];
const HEADER = ['.h']; // ambiguous: parsed with the C++ grammar, which is a superset for our purposes

/** Include dirs from .vscode/c_cpp_properties.json and compile_commands.json. */
function includeDirs(ctx: ResolveContext): string[] {
  return ctx.memo('cfamily:includeDirs', () => {
    const dirs = new Set<string>();
    const add = (d: string, base: string) => {
      d = toPosix(d).replace(/[\/\\]\*\*?$/, '');
      if (!d) return;
      dirs.add(d.startsWith('/') || /^[a-zA-Z]:[\/\\]/.test(d) ? d : posix.join(base, d));
    };

    for (const { path, text } of ctx.configs.all('c_cpp_properties.json')) {
      const ws = posix.dirname(posix.dirname(path)); // .vscode/.. = workspace folder
      const json = parseJsonc(text) ?? {};
      for (const c of json.configurations ?? [])
        for (const p of c.includePath ?? []) add(String(p).replace(/\$\{(workspaceFolder|workspaceRoot)\}/g, ws), ws);
    }

    for (const { path, text } of ctx.configs.all('compile_commands.json')) {
      let entries: any[] = [];
      try { entries = JSON.parse(text); } catch { /* ignore broken file */ }
      for (const e of entries) {
        const dir = toPosix(e.directory ?? posix.dirname(path));
        if (e.arguments) {
          for (let i = 0; i < e.arguments.length; i++) {
            const m = /^(?:-I|-isystem|-iquote|\/I)(.*)$/.exec(e.arguments[i]);
            if (!m) continue;
            add(m[1] || e.arguments[++i] || '', dir);
          }
        } else {
          const re = /(-I|-isystem|-iquote|\/I)\s*("[^"]+"|'[^']+'|[^\s"]+)/g;
          for (const m of String(e.command ?? '').matchAll(re)) {
            add(unquote(m[2]), dir);
          }
        }
      }
    }
    return [...dirs];
  });
}

export const cfamily: LanguagePlugin = {
  id: 'cfamily',
  extensions: [...C_EXT, ...CPP_EXT, ...HEADER],
  grammarOf: (ext) => (C_EXT.includes(ext) ? 'tree-sitter-c' : 'tree-sitter-cpp'),
  languageOf: (ext) => (C_EXT.includes(ext) ? 'c' : 'cpp'),

  extract(root: Node): Extracted {
    const imports: RawImport[] = [];
    for (const n of root.descendantsOfType('preproc_include')) {
      const p = n?.childForFieldName('path');
      if (!n || !p) continue;
      if (p.type === 'string_literal') imports.push({ specifier: p.text.slice(1, -1), line: n.startPosition.row });
      else if (p.type === 'system_lib_string') imports.push({ specifier: p.text.slice(1, -1), line: n.startPosition.row, system: true });
    }
    return { imports, declares: [] };
  },

  resolve(imp, ctx) {
    const spec = toPosix(imp.specifier);
    if (!imp.system) {
      const rel = posix.join(posix.dirname(ctx.from), spec);
      if (ctx.files.has(rel)) return [rel];
    }
    for (const d of includeDirs(ctx)) {
      const p = posix.join(d, spec);
      if (ctx.files.has(p)) return [p];
    }
    // Fallback for engines like UE5 where include paths come from build rules, not config files.
    // <vector>, <stdio.h> etc. never match because they aren't in the workspace.
    return suffixMatch(spec, ctx.from, ctx.filesByBase);
  },
};
