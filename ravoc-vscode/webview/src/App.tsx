import { useState, useEffect, useRef } from 'react';
import { getVsCodeApi } from './vscode';

interface MessageToExtension {
  type: 'sendMessage' | 'ready';
  text?: string;
}

interface MessageFromExtension {
  type: 'response' | 'responseChunk' | 'error' | 'contextUpdate';
  text?: string;
  chunk?: string;
  activeFile?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export default function App() {
  const vscode = getVsCodeApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeFile, setActiveFile] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<MessageFromExtension>) => {
      const msg = event.data;

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
          content: `⚠ Erro: ${msg.text ?? 'Falha na comunicação com o RAVOC backend.'}`,
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
    vscode.postMessage({ type: 'sendMessage', text } satisfies MessageToExtension);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
          📄 {activeFile}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {messages.length === 0 && (
          <p style={{
            color: 'var(--vscode-descriptionForeground)',
            fontSize: '13px',
            textAlign: 'center',
            marginTop: '40px',
          }}>
            JARVIS está pronto. Pergunte sobre o seu código.
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
              {msg.role === 'user' ? 'Você' : 'JARVIS'}{msg.streaming ? ' ▌' : ''}
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
          placeholder="Pergunte sobre o código... (Enter para enviar)"
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