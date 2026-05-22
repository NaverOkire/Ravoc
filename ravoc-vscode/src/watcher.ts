import * as vscode from 'vscode';
import { RavocClient } from './client';
import { RavocFilter } from './filter';
import { logger } from './logger';

export class RavocWatcher {
    private readonly filter: RavocFilter;
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly client: RavocClient,
        private readonly context: vscode.ExtensionContext,
    ) {
        this.filter = new RavocFilter();
    }

    register(): void {
        this.context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                // Debounce de 500ms — evita múltiplos saves em sequência
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.handleSave(doc);
                }, 500);
            })
        );

        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor?.document.uri.scheme === 'file') {
                    logger.info(`Arquivo ativo: ${editor.document.uri.fsPath}`);
                }
            })
        );
    }

    private async handleSave(document: vscode.TextDocument): Promise<void> {
        const result = this.filter.evaluate(document);

        if (!result.allowed) {
            logger.warn(`Ignorado (${result.reason}): ${document.uri.fsPath}`);
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            logger.warn(`Sem workspace para: ${document.uri.fsPath}`);
            return;
        }

        logger.info(`Ingerindo: ${document.uri.fsPath}`);

        await this.client.ingest({
            filePath: document.uri.fsPath,
            projectId: workspaceFolder.uri.toString(),
            content: document.getText(),
            language: result.language,
        });
    }
}