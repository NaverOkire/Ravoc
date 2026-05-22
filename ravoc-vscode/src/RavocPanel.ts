import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

export class RavocPanel implements vscode.WebviewViewProvider {
  // Identificador do painel — deve bater com o package.json
  public static readonly viewType = 'ravoc.chatPanel';

  private _view?: vscode.WebviewView;
  private _ws?: WebSocket;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _backendUrl: string,
  ) {}

  // Chamado pelo VS Code quando o painel é exibido pela primeira vez
  // ou quando é restaurado após um reload
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    // Opções de segurança do WebView
    webviewView.webview.options = {
      enableScripts: true,   // Obrigatório para React funcionar
      // Lista branca de URIs locais que o WebView pode carregar
      // Sem isso, o VS Code bloqueia o bundle JS
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Escuta mensagens vindas do React
    webviewView.webview.onDidReceiveMessage(
      (message: { type: string; text?: string }) => {
        if (message.type === 'ready') {
          // WebView carregou — conectar o WebSocket ao backend
          this._connectWebSocket();
        }
        if (message.type === 'sendMessage' && message.text) {
          // Repassa a pergunta do usuário ao backend via WebSocket
          this._ws?.send(JSON.stringify({ query: message.text }));
        }
      }
    );

    // Quando o painel é fechado, limpar o WebSocket
    webviewView.onDidDispose(() => {
      this._ws?.close();
      this._ws = undefined;
    });
  }

  // Atualiza o arquivo ativo visível no painel
  public notifyActiveFileChanged(filePath: string): void {
    this._view?.webview.postMessage({
      type: 'contextUpdate',
      activeFile: filePath,
    });
  }

  private _connectWebSocket(): void {
    const wsUrl = this._backendUrl.replace('http', 'ws') + '/chat';

    try {
      this._ws = new WebSocket(wsUrl);

      this._ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string) as {
          chunk?: string;
          done?: boolean;
          error?: string;
        };

        if (data.chunk) {
          // Chunk de streaming — envia ao React imediatamente
          this._view?.webview.postMessage({ type: 'responseChunk', chunk: data.chunk });
        }
        if (data.done) {
          // Sinal de fim de stream
          this._view?.webview.postMessage({ type: 'response' });
        }
        if (data.error) {
          this._view?.webview.postMessage({ type: 'error', text: data.error });
        }
      };

      this._ws.onerror = () => {
        this._view?.webview.postMessage({
          type: 'error',
          text: 'Não foi possível conectar ao RAVOC backend. Verifique se está rodando na porta 8000.',
        });
      };
    } catch {
      console.error('[RAVOC] Falha ao criar WebSocket');
    }
  }

private _getHtmlContent(webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js')
  );

  // Adicione essa linha para o CSS
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css')
  );

  const nonce = crypto.randomBytes(16).toString('hex');

  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    `connect-src ws://localhost:8000 http://localhost:8000`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>RAVOC</title>
  <!-- CSS do Vite -->
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