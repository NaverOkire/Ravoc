import * as vscode from 'vscode';
import { RavocWatcher } from './watcher';
import { RavocClient } from './client';
import { RavocPanel } from './RavocPanel';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext) {
    logger.init(context);
    logger.info('Extensão ativada.');

    const config = vscode.workspace.getConfiguration('ravoc');
    const backendUrl = config.get<string>('backend.url', 'http://localhost:7000');
    const client = new RavocClient(backendUrl);
    client.connect();

    context.subscriptions.push({
        dispose: () => client.disconnect()
    });

    const panelProvider = new RavocPanel(context.extensionUri, client, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RavocPanel.viewType,
            panelProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );


    const watcher = new RavocWatcher(client, panelProvider, context);
    watcher.register();
}

export function deactivate() {
    logger.info('Extensão desativada.');
}
