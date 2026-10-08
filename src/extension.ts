import * as vscode from 'vscode';
import { MapPanel } from './host/panel';
import { WorkspaceGraph } from './host/workspaceGraph';

export function activate(ctx: vscode.ExtensionContext) {
  const wg = new WorkspaceGraph(ctx);
  ctx.subscriptions.push(
    wg,
    vscode.commands.registerCommand('importtrace.open', () => MapPanel.show(ctx, wg, 'active')),
    vscode.commands.registerCommand('importtrace.openWorkspace', () => MapPanel.show(ctx, wg, 'workspace')),
    vscode.commands.registerCommand('importtrace.rescan', () => wg.rescanAll()),
  );
}

export function deactivate() {}
