import * as vscode from 'vscode';
import { RavocClient } from './client';
import { RavocFilter } from './filter';

export class RavocWatcher {
    private readonly client: RavocClient;
    private readonly filter: RavocFilter;
    private readonly context: vscode.ExtensionContext;
    private readonly outputChannel: vscode.OutputChannel;

   constructor(
    client: RavocClient,
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
) {
    this.client = client;
    this.filter = new RavocFilter();
    this.context = context;
    this.outputChannel = outputChannel;
}

    register(): void {
        const saveListener = vscode.workspace.onDidSaveTextDocument(
            (document) => this.handleSave(document)
        );
        this.context.subscriptions.push(saveListener);
    }

    private async handleSave(document: vscode.TextDocument): Promise<void> {
        const result = this.filter.evaluate(document);

        if (!result.allowed) {
            this.outputChannel.appendLine(
                `[RAVOC] Ignorado (${result.reason}): ${document.uri.fsPath}`
            );
            return; // ← esse return faltava — sem ele o TS não estreita a union type
        }

        // Aqui o TS sabe que result.allowed === true e result.language existe
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) { return; }

        await this.client.ingest({
            filePath: document.uri.fsPath,
            projectId: workspaceFolder.uri.toString(),
            content: document.getText(),
            language: result.language,
        });
    }
}