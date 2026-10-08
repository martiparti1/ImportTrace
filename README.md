# ImportTrace

See your code as connected windows. Each file is a scrollable window; each `import` / `#include` / `using` is an arrow that starts on the exact line that causes it.

Languages: **TypeScript / JavaScript, Python, C, C++, Java, Go, C#**.

## Run it

```bash
npm install
npm run build
npm run smoke        # parses fixtures/ in all 7 languages and checks every expected edge
```

Press **F5** in VS Code (opens `fixtures/` in an Extension Development Host), then run
`ImportTrace: Show Map for Active File` from the Command Palette.

No VS Code handy? `node esbuild.mjs --core && node scripts/preview.mjs && open dist/preview.html` renders the real UI with a mock host.

## How it works

```
src/core/        no vscode imports, fully testable
  parser.ts        web-tree-sitter + WASM grammars
  graph.ts         parse cache -> shared indexes -> edges
src/languages/   one plugin per language: extract() + resolve()
src/host/        scanner, file watchers, webview panel, license stub
src/webview/     React Flow UI, virtualized code windows, arrow pins
```

| Language | Resolution |
|---|---|
| TS/JS | relative paths, extension + `index` guessing, `.js`->`.ts`, `tsconfig` `paths` / `baseUrl` |
| Python | relative and absolute, `__init__.py`, `from pkg import submodule`, unique-suffix fallback for monorepos |
| C / C++ | relative to file, `c_cpp_properties.json`, `compile_commands.json` (`-I`), unique-suffix fallback |
| Java | package index (declared `package` -> files), wildcard, static, nested classes |
| Go | `go.mod` module path -> package directory -> its files (tests excluded by default) |
| C# | namespace index (block and file-scoped), `using static`, aliases |

## Add a language

1. Create `src/languages/<lang>.ts` implementing `LanguagePlugin`.
2. Add it to `src/languages/index.ts`.
3. Copy its grammar in `esbuild.mjs` (`copyWasm`) and register a highlighter in `src/webview/highlight.ts`.
4. Add a fixture and expected edges to `scripts/smoke.mjs`.

## Known limitations

- Syntax highlighting is per line, so block comments and multi-line strings lose their color. Fix: tokenize the whole file once (Shiki, or tree-sitter highlight queries in the host).
- Imports that resolve to more than 40 files (huge C# namespaces, big Go packages) are dropped. Better: collapse into a single package node.
- C#: types in the *same* namespace need no `using`, so those links are missing. Needs symbol-level indexing.
- Python: `from . import x` also links to `__init__.py` (correct, but noisy).
- C/C++ includes behind build-system-generated paths (UE5 `.Build.cs`) rely on the suffix fallback.
- Only one `tsconfig.json` (nearest ancestor) is consulted per file; `extends` and project references are not followed.
