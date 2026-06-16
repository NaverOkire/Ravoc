import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RavocClient } from './client';
import { ChatMessage, ProviderId } from './types';

const MAX_ACTIVE_FILE_CONTEXT_CHARS = 40000;
const DEFAULT_LOCAL_URL = 'http://localhost:1234/v1/chat/completions';
const DEFAULT_LOCAL_MODEL = 'qwen2.5-coder-7b-instruct';

const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  local_lm_studio: DEFAULT_LOCAL_MODEL,
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-1.5-pro',
  nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
};

interface WebviewMessage {
  type: string;
  text?: string;
  history?: ChatMessage[];
  providerId?: string;
  model?: string;
  apiKey?: string;
  cloudEnabled?: boolean;
  lmUrl?: string;
}

interface ProviderState {
  providerId: ProviderId;
  model: string;
  lmUrl: string;
  cloudEnabled: boolean;
  hasApiKey: boolean;
  localAvailable: boolean;
}

export class RavocPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ravoc.chatPanel';

  private _view?: vscode.WebviewView;
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
      async (message: WebviewMessage) => {
        if (message.type === 'ready') {
          this._view?.webview.postMessage({
            type: 'configLoaded',
            ...(await this._loadProviderState()),
          });
        }

        if (message.type === 'sendMessage' && message.text) {
          await this._sendChatMessage(message);
        }

        if (message.type === 'saveConfig') {
          await this._saveProviderConfig(message);
          this._view?.webview.postMessage({
            type: 'configSaved',
            ...(await this._loadProviderState()),
          });
        }
      }
    );

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

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

  private async _sendChatMessage(message: WebviewMessage): Promise<void> {
    const text = message.text?.trim();
    if (!text) {
      return;
    }

    const config = vscode.workspace.getConfiguration('ravoc');
    const providerId = this._readProviderId(
      message.providerId ?? config.get<string>('provider.default', 'local_lm_studio')
    );
    const model = this._readModel(providerId, message.model);
    const cloudEnabled = message.cloudEnabled ?? config.get<boolean>('cloud.enabled', false);
    const apiKey = await this._readApiKey(providerId, message.apiKey);
    const lmUrl = config.get<string>('lmUrl', DEFAULT_LOCAL_URL);

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
      message: text,
      history: message.history ?? [],
      project_id: '',
      provider_id: providerId,
      model,
      api_key: apiKey,
      cloud_enabled: cloudEnabled,
      lm_url: lmUrl,
      lm_model: model,
      lm_api_key: apiKey,
      active_file: activeFile,
      active_language: activeLanguage,
      active_file_content: activeFileContent,
    });
  }

  private async _loadProviderState(): Promise<ProviderState> {
    const config = vscode.workspace.getConfiguration('ravoc');
    const providerId = this._readProviderId(config.get<string>('provider.default', 'local_lm_studio'));
    const model = this._readModel(providerId);
    const lmUrl = config.get<string>('lmUrl', DEFAULT_LOCAL_URL);
    const localAvailable = await this._isLocalProviderAvailable(lmUrl);
    const hasApiKey = !!(await this._readApiKey(providerId));

    return {
      providerId,
      model,
      lmUrl,
      cloudEnabled: config.get<boolean>('cloud.enabled', false),
      hasApiKey,
      localAvailable,
    };
  }

  private async _saveProviderConfig(message: WebviewMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration('ravoc');
    const providerId = this._readProviderId(message.providerId);
    const model = (message.model ?? '').trim() || PROVIDER_DEFAULT_MODELS[providerId];
    const cloudEnabled = message.cloudEnabled ?? this._isCloudProvider(providerId);

    await config.update('provider.default', providerId, vscode.ConfigurationTarget.Global);
    await config.update('model.default', model, vscode.ConfigurationTarget.Global);
    await config.update('cloud.enabled', cloudEnabled, vscode.ConfigurationTarget.Global);

    if (message.lmUrl?.trim()) {
      await config.update('lmUrl', message.lmUrl.trim(), vscode.ConfigurationTarget.Global);
    }
    if (providerId === 'local_lm_studio') {
      await config.update('lmModel', model, vscode.ConfigurationTarget.Global);
    }
    if (message.apiKey?.trim()) {
      await this._context.secrets.store(this._secretKeyFor(providerId), message.apiKey.trim());
    }
  }

  private _readProviderId(value: string | undefined): ProviderId {
    if (value && value in PROVIDER_DEFAULT_MODELS) {
      return value as ProviderId;
    }
    return 'local_lm_studio';
  }

  private _readModel(providerId: ProviderId, override?: string): string {
    const config = vscode.workspace.getConfiguration('ravoc');
    const configured = config.get<string>(
      'model.default',
      config.get<string>('lmModel', PROVIDER_DEFAULT_MODELS[providerId])
    );
    return (override ?? configured ?? PROVIDER_DEFAULT_MODELS[providerId]).trim()
      || PROVIDER_DEFAULT_MODELS[providerId];
  }

  private async _readApiKey(providerId: ProviderId, override?: string): Promise<string | undefined> {
    if (override?.trim()) {
      return override.trim();
    }

    const segmented = await this._context.secrets.get(this._secretKeyFor(providerId));
    if (segmented) {
      return segmented;
    }

    if (providerId === 'local_lm_studio') {
      return this._context.secrets.get('ravoc.apiKey');
    }

    return undefined;
  }

  private _secretKeyFor(providerId: ProviderId): string {
    return `ravoc.apiKey.${providerId}`;
  }

  private _isCloudProvider(providerId: ProviderId): boolean {
    return providerId !== 'local_lm_studio';
  }

  private async _isLocalProviderAvailable(lmUrl: string): Promise<boolean> {
    if (!this._isLocalUrl(lmUrl)) {
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(this._modelsUrlFor(lmUrl), {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private _isLocalUrl(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl);
      return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  private _modelsUrlFor(rawUrl: string): string {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/\/$/, '');
    if (path.endsWith('/chat/completions')) {
      url.pathname = path.slice(0, -'/chat/completions'.length) + '/models';
    } else {
      url.pathname = '/v1/models';
    }
    url.search = '';
    return url.toString();
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
