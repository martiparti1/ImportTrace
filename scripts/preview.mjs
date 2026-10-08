// Dev tool: renders the real webview bundle in a plain browser with a mock VS Code host.
//   npm run build && node esbuild.mjs --core && node scripts/preview.mjs [focus-file]
// Then open dist/preview.html.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
const require = createRequire(import.meta.url);
const { ParserService, GraphBuilder, ConfigStore, allExtensions, toPosix } = require('../dist-core/core.cjs');

const root = resolve('fixtures');
const CONFIGS = new Set(['tsconfig.json', 'jsconfig.json', 'go.mod', 'compile_commands.json', 'c_cpp_properties.json']);
const files = [], configs = new ConfigStore(), texts = {};
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (CONFIGS.has(n)) configs.set(toPosix(p), readFileSync(p, 'utf8'));
    else if (allExtensions.some((e) => n.toLowerCase().endsWith(e))) files.push(toPosix(p));
  }
})(root);
const gb = new GraphBuilder(new ParserService(resolve('dist-core')));
for (const f of files) { texts[f] = readFileSync(f, 'utf8'); await gb.parse(f, texts[f]); }
const g = gb.build(files, { roots: [toPosix(root)], configs, includeTestFiles: false, maxFanout: 40 });
const graph = { ...g, nodes: g.nodes.map((n) => ({ ...n, rel: relative(root, n.id).replace(/\\/g, '/') })) };
const focus = toPosix(resolve(process.argv[2] ?? 'fixtures/ts/src/long.ts'));

writeFileSync('dist/preview.html', `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="webview.css">
<style>:root{--vscode-editor-background:#1e1e1e;--vscode-editor-foreground:#d4d4d4;--vscode-font-family:system-ui,sans-serif;--vscode-editor-font-family:Menlo,Consolas,monospace;
--vscode-editorWidget-background:#252526;--vscode-editorWidget-border:#454545;--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff;
--vscode-editorLineNumber-foreground:#858585;--vscode-descriptionForeground:#9d9d9d;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#45494e;--vscode-toolbar-hoverBackground:#5a5d5e50}</style></head>
<body class="vscode-dark"><div id="root"></div>
<script>
const DATA = ${JSON.stringify({ graph, texts, focus })};
window.acquireVsCodeApi = () => ({ postMessage(m) {
  if (m.type === 'ready') setTimeout(() => window.postMessage({ type: 'graph', graph: DATA.graph, focus: [DATA.focus], depth: 2, mode: 'active', premium: false }, '*'), 50);
  if (m.type === 'getFile') setTimeout(() => window.postMessage({ type: 'file', id: m.id, text: DATA.texts[m.id] ?? '' }, '*'), 10);
  if (m.type === 'open') console.log('open', m.id, m.line);
} });
</script><script src="webview.js"></script></body></html>`);
console.log('wrote dist/preview.html, focus =', focus);
