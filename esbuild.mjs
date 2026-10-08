import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

// web-tree-sitter's ESM build uses import.meta.url, which breaks when bundled to CJS. Use its CJS build.
const TS_CJS = { 'web-tree-sitter': './node_modules/web-tree-sitter/tree-sitter.cjs' };

const watch = process.argv.includes('--watch');
const coreOnly = process.argv.includes('--core');

// Test bundle: parsing + resolution only, no vscode. Used by `npm run smoke`.
if (coreOnly) {
  await esbuild.build({
    entryPoints: ['src/core/index.ts'], bundle: true, platform: 'node', format: 'cjs',
    outfile: 'dist-core/core.cjs', logLevel: 'warning', mainFields: ['module', 'main'], alias: TS_CJS,
  });
  copyWasm('dist-core');
  process.exit(0);
}

function copyWasm(dir) {
  mkdirSync(`${dir}/grammars`, { recursive: true });
  cpSync('node_modules/web-tree-sitter/tree-sitter.wasm', `${dir}/tree-sitter.wasm`);
  const wanted = ['c', 'cpp', 'c_sharp', 'javascript', 'typescript', 'tsx', 'python', 'java', 'go'];
  for (const g of wanted) cpSync(`node_modules/tree-sitter-wasms/out/tree-sitter-${g}.wasm`, `${dir}/grammars/tree-sitter-${g}.wasm`);
}

const common = { mainFields: ['module', 'main'], bundle: true, sourcemap: true, logLevel: 'info', minify: !watch };

const builds = [
  // extension host (node)
  { ...common, entryPoints: ['src/extension.ts'], platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js', alias: TS_CJS },
  // webview (browser)
  {
    ...common, entryPoints: ['src/webview/main.tsx'], platform: 'browser', format: 'iife', outfile: 'dist/webview.js',
    loader: { '.css': 'css' }, jsx: 'automatic', define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  },
];

copyWasm('dist');
if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('watching...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
