export interface IngestPayload {
  filePath:  string;
  projectId: string;
  content:   string;
  language:  string;
}

export interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

export type ProviderId =
  | 'local_lm_studio'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'nvidia';

export interface ChatRequest {
  message:          string;
  history:          ChatMessage[];
  project_id:       string;
  provider_id?:     ProviderId;
  model?:           string;
  api_key?:         string;
  cloud_enabled?:   boolean;
  lm_url:           string;
  lm_model:         string;
  lm_api_key?:      string;
  active_file?:     string;   // caminho relativo: "config/db.js"
  active_language?: string;   // languageId do VS Code: "javascript"
  active_file_content?: string;
}

export type WsFrame =
  | { type: 'token'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
