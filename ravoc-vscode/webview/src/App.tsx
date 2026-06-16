import { useState, useEffect, useRef } from 'react';
import { getVsCodeApi } from './vscode';

type ProviderId = 'local_lm_studio' | 'openai' | 'anthropic' | 'gemini' | 'nvidia';

interface MessageToExtension {
  type: 'sendMessage' | 'ready' | 'saveConfig';
  text?: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  providerId?: ProviderId;
  model?: string;
  apiKey?: string;
  cloudEnabled?: boolean;
}

interface MessageFromExtension {
  type: 'response' | 'responseChunk' | 'error' | 'contextUpdate' | 'configLoaded' | 'configSaved';
  text?: string;
  chunk?: string;
  activeFile?: string;
  providerId?: ProviderId;
  model?: string;
  cloudEnabled?: boolean;
  hasApiKey?: boolean;
  localAvailable?: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'local_lm_studio', label: 'Local' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'nvidia', label: 'NVIDIA' },
];

const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  local_lm_studio: 'qwen2.5-coder-7b-instruct',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-1.5-pro',
  nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
};

function normalizeProvider(providerId: ProviderId | undefined): ProviderId {
  return providerId && providerId in PROVIDER_DEFAULT_MODELS
    ? providerId
    : 'local_lm_studio';
}

function shouldEnableCloud(providerId: ProviderId, cloudEnabled: boolean): boolean {
  return providerId === 'local_lm_studio' ? cloudEnabled : true;
}

export default function App() {
  const vscode = getVsCodeApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeFile, setActiveFile] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>('local_lm_studio');
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODELS.local_lm_studio);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [localAvailable, setLocalAvailable] = useState(true);
  const [configStatus, setConfigStatus] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<MessageFromExtension>) => {
      const msg = event.data;

      if (msg.type === 'configLoaded' || msg.type === 'configSaved') {
        const loadedProvider = normalizeProvider(msg.providerId);
        const nextProvider = msg.localAvailable === false && loadedProvider === 'local_lm_studio'
          ? 'openai'
          : loadedProvider;

        setProviderId(nextProvider);
        setModel(
          nextProvider === loadedProvider
            ? msg.model || PROVIDER_DEFAULT_MODELS[nextProvider]
            : PROVIDER_DEFAULT_MODELS[nextProvider]
        );
        setCloudEnabled(msg.cloudEnabled ?? false);
        setHasApiKey(!!msg.hasApiKey);
        setLocalAvailable(msg.localAvailable ?? true);
        setConfigStatus(msg.type === 'configSaved' ? 'Configuração salva' : '');
      }

      if (msg.type === 'responseChunk' && msg.chunk) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + msg.chunk }];
          }
          return [...prev, { role: 'assistant', content: msg.chunk!, streaming: true }];
        });
      }

      if (msg.type === 'response') {
        setIsStreaming(false);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false }];
          }
          if (msg.text) {
            return [...prev, { role: 'assistant', content: msg.text }];
          }
          return prev;
        });
      }

      if (msg.type === 'contextUpdate' && msg.activeFile) {
        setActiveFile(msg.activeFile);
      }

      if (msg.type === 'error') {
        setIsStreaming(false);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Erro: ${msg.text ?? 'Falha na comunicação com o RAVOC backend.'}`,
        }]);
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' } satisfies MessageToExtension);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsStreaming(true);
    const history = messages
      .filter(msg => !msg.streaming)
      .map(({ role, content }) => ({ role, content }));
    vscode.postMessage({
      type: 'sendMessage',
      text,
      history,
      providerId,
      model: model.trim() || PROVIDER_DEFAULT_MODELS[providerId],
      apiKey: apiKey.trim() || undefined,
      cloudEnabled: shouldEnableCloud(providerId, cloudEnabled),
    } satisfies MessageToExtension);
  };

  const saveConfig = () => {
    vscode.postMessage({
      type: 'saveConfig',
      providerId,
      model: model.trim() || PROVIDER_DEFAULT_MODELS[providerId],
      apiKey: apiKey.trim() || undefined,
      cloudEnabled: shouldEnableCloud(providerId, cloudEnabled),
    } satisfies MessageToExtension);
  };

  const handleProviderChange = (nextProvider: ProviderId) => {
    setProviderId(nextProvider);
    setModel(PROVIDER_DEFAULT_MODELS[nextProvider]);
    setApiKey('');
    setConfigStatus('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const showApiKey = providerId !== 'local_lm_studio' || !localAvailable;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {activeFile && (
        <div style={{
          padding: '6px 12px',
          fontSize: '11px',
          color: 'var(--vscode-descriptionForeground)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {activeFile}
        </div>
      )}

      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        display: 'grid',
        gap: '6px',
      }}>
        {!localAvailable && (
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
            IA local não detectada.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <select
            value={providerId}
            onChange={e => handleProviderChange(e.target.value as ProviderId)}
            disabled={isStreaming}
            style={{
              minWidth: 0,
              background: 'var(--vscode-dropdown-background)',
              color: 'var(--vscode-dropdown-foreground)',
              border: '1px solid var(--vscode-dropdown-border)',
              borderRadius: '4px',
              padding: '4px 6px',
              fontSize: '12px',
            }}
          >
            {PROVIDERS.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>

          <input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="Modelo"
            disabled={isStreaming}
            style={{
              minWidth: 0,
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '4px',
              padding: '4px 6px',
              fontSize: '12px',
            }}
          />
        </div>

        {showApiKey && (
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasApiKey ? 'API key configurada' : 'API key'}
            type="password"
            disabled={isStreaming}
            style={{
              width: '100%',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '4px',
              padding: '4px 6px',
              fontSize: '12px',
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={saveConfig}
            disabled={isStreaming}
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: '1px solid var(--vscode-button-border, transparent)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
            }}
          >
            Salvar
          </button>
          {configStatus && (
            <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
              {configStatus}
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {messages.length === 0 && (
          <p style={{
            color: 'var(--vscode-descriptionForeground)',
            fontSize: '13px',
            textAlign: 'center',
            marginTop: '40px',
          }}>
            Ravoc está pronto.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: '12px',
            padding: '8px 12px',
            borderRadius: '6px',
            background: msg.role === 'user'
              ? 'var(--vscode-input-background)'
              : 'var(--vscode-editor-inactiveSelectionBackground)',
            fontSize: '13px',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap',
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--vscode-descriptionForeground)',
              display: 'block',
              marginBottom: '4px',
            }}>
              {msg.role === 'user' ? 'Você' : 'RAVOC'}{msg.streaming ? ' |' : ''}
            </span>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--vscode-panel-border)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre o código..."
          disabled={isStreaming}
          rows={3}
          style={{
            width: '100%',
            resize: 'none',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: '4px',
            padding: '6px 8px',
            fontSize: '13px',
            fontFamily: 'var(--vscode-font-family)',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}
