import * as vscode from 'vscode';
import { ConfigStore, GraphBuilder, ParserService, allExtensions, toPosix } from '../core';
import type { Graph } from '../core';

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json', 'go.mod', 'compile_commands.json', 'c_cpp_properties.json'];
const CONFIG_GLOB = `**/{${CONFIG_NAMES.join(',')}}`;
const SOURCE_GLOB = `**/*.{${allExtensions.map((e) => e.slice(1)).join(',')}}`;
const decoder = new TextDecoder('utf-8');

/** Scans the workspace, keeps parse results cached, and rebuilds the graph when files change. */
export class WorkspaceGraph implements vscode.Disposable {
  private builder: GraphBuilder;
  private configText = new Map<string, string>();
  private disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private pendingChanged = new Set<string>();
  private running?: Promise<Graph>;

  graph?: Graph;
  readonly onDidUpdate = new vscode.EventEmitter<{ graph: Graph; changed: string[] }>();
  readonly onDidStartScan = new vscode.EventEmitter<void>();

  constructor(ctx: vscode.ExtensionContext) {
    this.builder = new GraphBuilder(new ParserService(ctx.asAbsolutePath('dist')));

    const src = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    const cfg = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
    const isIgnored = (p: string) => /\/(node_modules|\.git|dist|build|out|bin|obj|target|vendor|__pycache__|\.venv|venv)\//.test(p);
    const touch = (uri: vscode.Uri) => {
      const p = toPosix(uri.fsPath);
      if (isIgnored(p)) return;
      this.builder.invalidate(p);
      this.pendingChanged.add(p);
      this.schedule();
    };
    const touchCfg = (uri: vscode.Uri) => {
      const p = toPosix(uri.fsPath);
      if (isIgnored(p)) return;
      this.configText.delete(p);
      this.schedule();
    };
    this.disposables.push(src, cfg, src.onDidCreate(touch), src.onDidChange(touch), src.onDidDelete(touch),
      cfg.onDidCreate(touchCfg), cfg.onDidChange(touchCfg), cfg.onDidDelete(touchCfg),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('importtrace') && this.schedule()));
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 400);
  }

  rescanAll() {
    this.builder.clear();
    this.configText.clear();
    return this.refresh();
  }

  refresh(): Promise<Graph> {
    // Serialize scans; a change during a scan triggers another one afterwards.
    const run = (this.running ?? Promise.resolve(undefined as unknown as Graph)).then(() => this.scan());
    this.running = run.catch(() => undefined as unknown as Graph);
    return run;
  }

  private async scan(): Promise<Graph> {
    const cfg = vscode.workspace.getConfiguration('importtrace');
    const excludeArr = cfg.get<string[]>('exclude') ?? [];
    const exclude = excludeArr.length === 0 ? null : (excludeArr.length === 1 ? excludeArr[0] : `{${excludeArr.join(',')}}`);
    const maxBytes = (cfg.get<number>('maxFileSizeKB') ?? 1024) * 1024;
    const folders = vscode.workspace.workspaceFolders ?? [];
    this.onDidStartScan.fire();

    const [sourceUris, configUris] = await Promise.all([
      vscode.workspace.findFiles(SOURCE_GLOB, exclude),
      vscode.workspace.findFiles(CONFIG_GLOB, exclude),
    ]);

    // config files (cached until the watcher says they changed)
    const configs = new ConfigStore();
    await Promise.all(configUris.map(async (uri) => {
      const p = toPosix(uri.fsPath);
      let text = this.configText.get(p);
      if (text === undefined) {
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 50 * 1024 * 1024) return;
          text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        } catch { return; }
        this.configText.set(p, text);
      }
      configs.set(p, text);
    }));

    // parse only files we haven't parsed yet
    const paths = sourceUris.map((u) => toPosix(u.fsPath));
    const todo = sourceUris.filter((u) => !this.builder.has(toPosix(u.fsPath)));
    const parseOne = async (uri: vscode.Uri) => {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > maxBytes) return;
        const bytes = await vscode.workspace.fs.readFile(uri);
        await this.builder.parse(toPosix(uri.fsPath), decoder.decode(bytes));
      } catch { /* unreadable file: skip */ }
    };
    const run = async () => {
      for (let i = 0; i < todo.length; i += 32) await Promise.all(todo.slice(i, i + 32).map(parseOne));
    };
    if (todo.length > 200) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `ImportTrace: scanning ${todo.length} files` }, run);
    } else {
      await run();
    }

    const graph = this.builder.build(paths, {
      roots: folders.map((f) => toPosix(f.uri.fsPath)),
      configs,
      includeTestFiles: cfg.get<boolean>('includeTestFiles') ?? false,
      maxFanout: 40,
    });
    this.graph = graph;
    const changed = [...this.pendingChanged];
    this.pendingChanged.clear();
    this.onDidUpdate.fire({ graph, changed });
    return graph;
  }

  async ensure(): Promise<Graph> {
    return this.graph ?? this.refresh();
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.onDidUpdate.dispose();
    this.onDidStartScan.dispose();
  }
}
