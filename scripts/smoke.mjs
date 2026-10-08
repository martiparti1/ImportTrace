// Runs the real parsing + resolution core over fixtures/ and checks the edges.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { ParserService, GraphBuilder, ConfigStore, allExtensions, toPosix } = require('../dist-core/core.cjs');

// The core works on forward-slash paths (the extension does the same via toPosix), also on Windows.
const root = toPosix(resolve('fixtures'));
const CONFIGS = new Set(['tsconfig.json', 'jsconfig.json', 'go.mod', 'compile_commands.json', 'c_cpp_properties.json']);
const files = [], configs = new ConfigStore();
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = toPosix(join(d, n));
    if (statSync(p).isDirectory()) walk(p);
    else if (CONFIGS.has(n)) configs.set(p, readFileSync(p, 'utf8'));
    else if (allExtensions.some((e) => n.toLowerCase().endsWith(e))) files.push(p);
  }
})(root);

const gb = new GraphBuilder(new ParserService(resolve('dist-core')));
for (const f of files) await gb.parse(f, readFileSync(f, 'utf8'));
const g = gb.build(files, { roots: [root, root + '/py'], configs, includeTestFiles: false, maxFanout: 40 });

const rel = (p) => p.slice(root.length + 1);
const got = new Set(g.edges.map((e) => `${rel(e.from)} -> ${rel(e.to)} @${e.line + 1}`));

const expect = [
  // TS/JS
  'ts/src/a.ts -> ts/src/b.ts @2', 'ts/src/a.ts -> ts/src/util/strings.ts @3', 'ts/src/a.ts -> ts/src/util/index.ts @4',
  'ts/src/a.ts -> ts/src/d.ts @5', 'ts/src/a.ts -> ts/src/b.ts @6', 'ts/src/a.ts -> ts/src/b.ts @7', 'ts/src/a.ts -> ts/src/c.js @8',
  // Python
  'py/pkg/main.py -> py/pkg/utils.py @2', 'py/pkg/main.py -> py/pkg/helpers.py @3', 'py/pkg/main.py -> py/pkg/models.py @4', 'py/pkg/main.py -> py/pkg/models.py @6',
  // C / C++
  'cpp/src/main.cpp -> cpp/src/local.h @2', 'cpp/src/main.cpp -> cpp/include/engine/core.h @3',
  'cpp/src/main.cpp -> cpp/include/engine/render.h @4', 'cpp/src/main.cpp -> cpp/src/util.h @5',
  'cpp/include/engine/core.h -> cpp/include/engine/types.h @2', 'cpp/src/util.c -> cpp/src/util.h @1',
  // Java
  'java/src/main/java/com/foo/App.java -> java/src/main/java/com/foo/util/Helper.java @4',
  'java/src/main/java/com/foo/App.java -> java/src/main/java/com/foo/model/User.java @5',
  'java/src/main/java/com/foo/App.java -> java/src/main/java/com/foo/model/Order.java @5',
  'java/src/main/java/com/foo/App.java -> java/src/main/java/com/foo/util/Helper.java @6',
  // Go
  'go/main.go -> go/internal/util/a.go @5', 'go/main.go -> go/internal/util/b.go @5',
  // C#
  'cs/Program.cs -> cs/Models/User.cs @2', 'cs/Program.cs -> cs/Models/Order.cs @2',
  'cs/Program.cs -> cs/Services/Svc.cs @3', 'cs/Program.cs -> cs/Models/Order.cs @4',
];
const forbid = [
  'go/main.go -> go/internal/util/a_test.go @5', // tests excluded by default
  'ts/src/a.ts -> ts/src/a.ts',
];

let bad = 0;
for (const e of expect) if (!got.has(e)) { console.log('MISSING ', e); bad++; }
for (const e of forbid) if ([...got].some((x) => x.startsWith(e))) { console.log('UNEXPECTED', e); bad++; }
console.log(`\nfiles=${g.stats.files} imports=${g.stats.imports} resolved=${g.stats.resolved} edges=${g.edges.length}`);
if (bad) { console.log('\nGot:\n' + [...got].sort().join('\n')); console.log(`\n${bad} FAILED`); process.exit(1); }
console.log(`all ${expect.length} expected edges found - OK`);
