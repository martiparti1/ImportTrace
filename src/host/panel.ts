import * as vscode from 'vscode';
import { toPosix } from '../core';
import type { HostToWeb, MapGraph, WebToHost } from '../shared/messages';
import type { WorkspaceGraph } from './workspaceGraph';

const decoder = new TextDecoder('utf-8');

/** One webview panel showing the node graph. */
export class MapPanel {
  private static current?: MapPanel;
  private disposables: vscode.Disposable[] = [];
  private mode: 'active' | 'workspace' = 'active';
  private focus: string[] = [];
  private webviewReady = false;

  static show(ctx: vscode.ExtensionContext, wg: WorkspaceGraph, mode: 'active' | 'workspace') {
    const active = vscode.window.activeTextEditor?.document.uri;
    const focus = active?.scheme === 'file' ? [toPosix(active.fsPath)] : [];
    if (MapPanel.current) {
      MapPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      MapPanel.current.setView(mode, focus);
      return;
    }
    const panel = vscode.window.createWebviewPanel('importtrace', 'ImportTrace', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'dist')],
    });
    MapPanel.current = new MapPanel(panel, ctx, wg);
    MapPanel.current.mode = mode;
    MapPanel.current.focus = focus;
  }

  private constructor(private panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext, private wg: WorkspaceGraph) {
    panel.webview.html = this.html(ctx);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((m: WebToHost) => void this.onMessage(m)),
      wg.onDidStartScan.event(() => this.post({ type: 'scanning', message: 'Scanning…' })),
      wg.onDidUpdate.event(({ graph, changed }) => {
        this.sendGraph(graph);
        if (changed.length) this.post({ type: 'invalidate', ids: changed });
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor || editor.document.uri.scheme !== 'file') return;
        if (this.mode === 'active') {
          const active = editor.document.uri;
          const focus = [toPosix(active.fsPath)];
          this.setView('active', focus);
        }
      })
    );
  }

  private setView(mode: 'active' | 'workspace', focus: string[]) {
    this.mode = mode;
    this.focus = focus;
    if (this.wg.graph && this.webviewReady) this.sendGraph(this.wg.graph);
  }

  private post(m: HostToWeb) {
    void this.panel.webview.postMessage(m);
  }

  private sendGraph(g: NonNullable<WorkspaceGraph['graph']>) {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => toPosix(f.uri.fsPath));
    const rel = (p: string) => {
      const r = roots.find((r) => p.startsWith(r + '/'));
      return r ? p.slice(r.length + 1) : p;
    };
    const graph: MapGraph = { ...g, nodes: g.nodes.map((n) => ({ ...n, rel: rel(n.id) })) };
    this.post({
      type: 'graph', graph, focus: this.focus, mode: this.mode,
      depth: vscode.workspace.getConfiguration('importtrace').get<number>('depth') ?? 2,
      targetColor: vscode.workspace.getConfiguration('importtrace').get<string>('targetColor') ?? '#FFD700',
    });
  }

  private async onMessage(m: WebToHost) {
    switch (m.type) {
      case 'ready':
        this.webviewReady = true;
        this.post({ type: 'scanning', message: 'Scanning…' });
        this.sendGraph(await this.wg.ensure());
        break;
      case 'getFile': {
        const uri = vscode.Uri.file(m.id);
        // prefer the live buffer so unsaved edits show up
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        let text = open?.getText();
        if (text === undefined) {
          try { text = decoder.decode(await vscode.workspace.fs.readFile(uri)); }
          catch { text = '// could not read file'; }
        }
        this.post({ type: 'file', id: m.id, text });
        break;
      }
      case 'open': {
        const pos = new vscode.Position(m.line ?? 0, 0);
        await vscode.window.showTextDocument(vscode.Uri.file(m.id), {
          viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos), preserveFocus: false,
        });
        break;
      }
    }
  }

  private html(ctx: vscode.ExtensionContext): string {
    const web = this.panel.webview;
    const uri = (f: string) => web.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'dist', f));
    const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${web.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${web.cspSource}; img-src ${web.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('webview.css')}"><title>ImportTrace</title></head>
<body><div id="root"></div><script nonce="${nonce}" src="${uri('webview.js')}"></script></body></html>`;
  }

  private dispose() {
    MapPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
