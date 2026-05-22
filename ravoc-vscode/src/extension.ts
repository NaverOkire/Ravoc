import * as vscode from 'vscode';
import { RavocWatcher } from './watcher';
import { RavocClient } from './client';
import { RavocPanel } from './RavocPanel';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext) {
    logger.init(context);
    logger.info('Extensão ativada.');

    const client = new RavocClient('http://localhost:8000');
    const watcher = new RavocWatcher(client, context);
    watcher.register();

    const panelProvider = new RavocPanel(
        context.extensionUri,
        'http://localhost:8000'
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RavocPanel.viewType,
            panelProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // O onDidChangeActiveTextEditor do watcher já loga — aqui só notifica o painel
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.uri.scheme === 'file') {
                panelProvider.notifyActiveFileChanged(
                    vscode.workspace.asRelativePath(editor.document.uri)
                );
            }
        })
    );
}

export function deactivate() {
    logger.info('Extensão desativada.');
}