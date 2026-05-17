import * as vscode from 'vscode';
import { RavocWatcher } from './watcher';
import { RavocClient } from './client';

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('RAVOC');
    context.subscriptions.push(outputChannel);

    outputChannel.appendLine('[RAVOC] Extensão ativada.');

    const backendUrl = vscode.workspace
        .getConfiguration('ravoc')
        .get<string>('backendUrl', 'http://localhost:8000');

    const client = new RavocClient(backendUrl);
    const watcher = new RavocWatcher(client, context, outputChannel);
    watcher.register();

    const openPanel = vscode.commands.registerCommand(
        'ravoc.openPanel',
        () => vscode.window.showInformationMessage('[RAVOC] Painel em construção no M2.4.')
    );

    context.subscriptions.push(openPanel);
}

export function deactivate(): void {
    console.log('[RAVOC] Extensão desativada.');
}