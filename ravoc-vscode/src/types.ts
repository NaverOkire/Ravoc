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

export interface ChatRequest {
  message:          string;
  history:          ChatMessage[];
  project_id:       string;
  lm_url:           string;
  lm_model:         string;
  lm_api_key?:      string;
  active_file?:     string;   // caminho relativo: "config/db.js"
  active_language?: string;   // languageId do VS Code: "javascript"
  active_file_content?: string;
}

export interface WsFrame {
  type:     'token' | 'done' | 'error';
  content:  string;   // para type=token
  message:  string;   // para type=error
}
