import * as vscode from 'vscode';

export interface IngestPayload {
    filePath: string;
    projectId: string;
    content: string;
    language: string;
}

export interface ActiveContextPayload {
    filePath: string;
    projectId: string;
    language: string;
}

export class RavocClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async ingest(payload: IngestPayload): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                console.error(`[RAVOC] Falha no /ingest: ${response.status}`);
            }
        } catch {
            console.warn('[RAVOC] Backend inacessível. Ingestão ignorada.');
        }
    }

    async updateActiveContext(payload: ActiveContextPayload): Promise<void> {
        try {
            await fetch(`${this.baseUrl}/context/active`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch {
            // Contexto ativo é sinal auxiliar — falha silenciosa intencional.
        }
    }
}