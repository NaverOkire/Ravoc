import { IngestPayload, ChatRequest, WsFrame } from './types';

export class RavocClient {
  private readonly baseUrl: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onTokenCallback: ((token: string) => void) | null = null;
  private onDoneCallback: (() => void) | null = null;
  private onErrorCallback: ((msg: string) => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // ─── REST ─────────────────────────────────────────────────────────────────

  async ingest(payload: IngestPayload): Promise<void> {
    const body = {
      collection: 'code_context',
      documents: [payload.content],
      metadatas: [{
        file_path: payload.filePath,
        project_id: payload.projectId,
        language: payload.language,
        chunk_type: 'root_object',
        chunk_name: 'full_file',
        timestamp: new Date().toISOString(),
      }],
    };

    try {
      const res = await fetch(`${this.baseUrl}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify(body),
      });
      if (res.status !== 201 && res.status !== 200) {
        console.warn(`[RAVOC] /ingest retornou ${res.status}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        console.warn('[RAVOC] /ingest timeout');
      } else {
        console.warn('[RAVOC] Backend inacessível para ingestão.');
      }
    }
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  onToken(cb: (token: string) => void)  { this.onTokenCallback = cb; }
  onDone(cb: () => void)                { this.onDoneCallback = cb; }
  onError(cb: (msg: string) => void)    { this.onErrorCallback = cb; }

  connect(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/chat';
    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      console.error('[RAVOC] Falha ao criar WebSocket');
      return;
    }

    this.ws.onopen = () => {
      console.log('[RAVOC] WebSocket conectado.');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(event.data as string);
      } catch {
        console.error('[RAVOC] Frame inválido:', event.data);
        return;
      }
      switch (frame.type) {
        case 'token': this.onTokenCallback?.(frame.content); break;
        case 'done':  this.onDoneCallback?.();               break;
        case 'error': this.onErrorCallback?.(frame.message); break;
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.warn(`[RAVOC] WebSocket fechado. Código: ${event.code}`);
      this.ws = null;
      if (event.code !== 1000) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      console.error('[RAVOC] Erro no WebSocket');
    };
  }

  sendMessage(request: ChatRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[RAVOC] WebSocket não está aberto. Reconectando...');
      this.connect();
      setTimeout(() => this.sendMessage(request), 500);
      return;
    }
    this.ws.send(JSON.stringify(request));
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); }
    this.ws?.close(1000, 'Extension deactivated');
    this.ws = null;
  }
}
