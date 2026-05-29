import * as vscode from 'vscode';
import { RavocClient } from './client';
import { RavocPanel } from './RavocPanel';
import { RavocFilter } from './filter';
import { logger } from './logger';

const MAX_ACTIVE_FILE_CONTEXT_CHARS = 40000;

export class RavocWatcher {
  private readonly filter: RavocFilter;
  private saveDebounce: NodeJS.Timeout | undefined;
  private editorDebounce: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: RavocClient,
    private readonly panel: RavocPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.filter = new RavocFilter();
  }

  register(): void {
    // Captura imediata do editor já aberto ao registrar
    this.captureActiveEditor(vscode.window.activeTextEditor);

    this.context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        clearTimeout(this.saveDebounce);
        this.saveDebounce = setTimeout(() => this.handleSave(doc), 500);
      })
    );

    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        // Debounce de 300ms — aguarda a aba estabilizar antes de capturar
        clearTimeout(this.editorDebounce);
        this.editorDebounce = setTimeout(() => {
          this.captureActiveEditor(editor);
        }, 300);
      })
    );
  }

  private captureActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor) {return;}

    const doc = editor.document;

    // Ignorar schemes não-arquivo (output, git, extensão interna)
    if (doc.uri.scheme !== 'file') {return;}

    // Ignorar arquivos não-salvos
    if (doc.isUntitled) {return;}

    // API oficial do VS Code — lida com múltiplos workspaces e separadores no Windows
    const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

    logger.info(`Arquivo ativo capturado: ${relativePath} (${doc.languageId})`);

    const content = doc.getText();
    const boundedContent = content.length > MAX_ACTIVE_FILE_CONTEXT_CHARS
      ? content.slice(0, MAX_ACTIVE_FILE_CONTEXT_CHARS)
      : content;

    this.panel.notifyActiveFileChanged(relativePath, doc.languageId, boundedContent);
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
