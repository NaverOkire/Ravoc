import * as vscode from 'vscode';

// Singleton — uma instância para toda a extensão
class RavocLogger {
    private channel?: vscode.OutputChannel;

    // Chamado UMA vez no activate() para inicializar
    init(context: vscode.ExtensionContext): void {
        this.channel = vscode.window.createOutputChannel('RAVOC');
        context.subscriptions.push(this.channel);
    }

    info(message: string): void {
        this.log('INFO', message);
    }

    warn(message: string): void {
        this.log('WARN', message);
    }

    error(message: string, err?: unknown): void {
        const detail = err instanceof Error ? ` — ${err.message}` : '';
        this.log('ERROR', message + detail);
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        this.channel?.appendLine(`[${timestamp}] [${level}] ${message}`);
    }
}

// Exporta a instância — não a classe
export const logger = new RavocLogger();