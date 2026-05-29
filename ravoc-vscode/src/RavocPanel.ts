import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RavocClient } from './client';
import { ChatMessage } from './types';

const MAX_ACTIVE_FILE_CONTEXT_CHARS = 40000;

export class RavocPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ravoc.chatPanel';

  private _view?: vscode.WebviewView;

  // Estado estável do arquivo ativo — atualizado pelo watcher após debounce
  private _activeFile: string = '';
  private _activeLanguage: string = '';
  private _activeFileContent: string = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client: RavocClient,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._client.onToken((token) => {
      this._view?.webview.postMessage({ type: 'responseChunk', chunk: token });
    });

    this._client.onDone(() => {
      this._view?.webview.postMessage({ type: 'response' });
    });

    this._client.onError((message) => {
      this._view?.webview.postMessage({ type: 'error', text: message });
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: {
        type: string;
        text?: string;
        history?: ChatMessage[];
        lmUrl?: string;
        lmModel?: string;
        apiKey?: string;
      }) => {

        if (message.type === 'ready') {
          const config = vscode.workspace.getConfiguration('ravoc');
          const apiKey = await this._context.secrets.get('ravoc.apiKey');
          this._view?.webview.postMessage({
            type: 'configLoaded',
            lmUrl:    config.get<string>('lmUrl',   'http://localhost:1234/v1/chat/completions'),
            lmModel:  config.get<string>('lmModel', 'qwen2.5-coder-7b-instruct'),
            hasApiKey: !!apiKey,
          });
        }

        if (message.type === 'sendMessage' && message.text) {
          const config = vscode.workspace.getConfiguration('ravoc');
          const apiKey = await this._context.secrets.get('ravoc.apiKey');

          // Captura o editor no momento exato do envio para evitar contexto antigo.
          const activeContext = this._getActiveEditorContext();
          if (activeContext) {
            this.notifyActiveFileChanged(
              activeContext.filePath,
              activeContext.language,
              activeContext.content,
            );
          }

          const activeFile = activeContext?.filePath || this._activeFile || undefined;
          const activeLanguage = activeContext?.language || this._activeLanguage || undefined;
          const activeFileContent = activeContext?.content || this._activeFileContent || undefined;

          this._client.sendMessage({
            message:         message.text,
            history:         message.history ?? [],
            project_id:      '',
            lm_url:          config.get<string>('lmUrl',   'http://localhost:1234/v1/chat/completions'),
            lm_model:        config.get<string>('lmModel', 'qwen2.5-coder-7b-instruct'),
            lm_api_key:      apiKey ?? undefined,
            active_file:     activeFile,
            active_language: activeLanguage,
            active_file_content: activeFileContent,
          });
        }

        if (message.type === 'saveConfig') {
          const config = vscode.workspace.getConfiguration('ravoc');

          if (message.lmUrl) {
            await config.update('lmUrl',   message.lmUrl,   vscode.ConfigurationTarget.Global);
          }
          if (message.lmModel) {
            await config.update('lmModel', message.lmModel, vscode.ConfigurationTarget.Global);
          }
          if (message.apiKey) {
            await this._context.secrets.store('ravoc.apiKey', message.apiKey);
          }

          this._view?.webview.postMessage({ type: 'configSaved' });
        }
      }
    );

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  /**
   * Chamado pelo RavocWatcher após debounce de 300ms.
   * Atualiza o estado interno E notifica o webview para exibir o indicador.
   */
  public notifyActiveFileChanged(filePath: string, language: string = '', content: string = ''): void {
    this._activeFile = filePath;
    this._activeLanguage = language;
    this._activeFileContent = content;

    this._view?.webview.postMessage({
      type: 'contextUpdate',
      activeFile: filePath,
      activeLanguage: language,
    });
  }

  private _getActiveEditorContext():
    | { filePath: string; language: string; content: string }
    | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {return undefined;}

    const doc = editor.document;
    if (doc.uri.scheme !== 'file' || doc.isUntitled) {return undefined;}

    const content = doc.getText();

    return {
      filePath: vscode.workspace.asRelativePath(doc.uri, false),
      language: doc.languageId,
      content: content.length > MAX_ACTIVE_FILE_CONTEXT_CHARS
        ? content.slice(0, MAX_ACTIVE_FILE_CONTEXT_CHARS)
        : content,
    };
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css')
    );
    const nonce = crypto.randomBytes(16).toString('hex');

    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data:`,
      `connect-src ws://localhost:7000 http://localhost:7000 https:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>RAVOC</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; overflow: hidden;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root { height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
