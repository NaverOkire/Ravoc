import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Configuração centralizada — altere aqui, não espalhado pelo código
// ---------------------------------------------------------------------------

const BLOCKED_DIRECTORIES = new Set([
    'node_modules', '.git', 'dist', 'build', 'out',
    '.next', '.nuxt', '.turbo', '.cache', '__pycache__',
    '.pytest_cache', '.mypy_cache', 'venv', '.venv',
    'coverage', '.nyc_output', '.tox',
]);

const BLOCKED_FILENAMES = new Set([
    // Lockfiles — grandes e sem semântica útil para RAG
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'poetry.lock', 'Cargo.lock', 'Gemfile.lock',
    // Configs de ambiente
    '.env', '.env.local', '.env.production',
    // Artefatos de compilação
    '.DS_Store', 'thumbs.db',
]);

const ALLOWED_EXTENSIONS = new Set([
    // Linguagens de programação
    '.py', '.ts', '.tsx', '.js', '.jsx', '.go',
    '.rs', '.java', '.kt', '.swift', '.c', '.cpp',
    '.cs', '.rb', '.php', '.scala', '.ex', '.exs',
    // Config e dados estruturados (úteis para contexto)
    '.json', '.yaml', '.yml', '.toml', '.xml',
    // Documentação
    '.md', '.mdx', '.txt', '.rst',
    // Queries
    '.sql', '.graphql', '.gql',
    // Shell
    '.sh', '.bash', '.zsh', '.fish',
    // Web
    '.html', '.css', '.scss', '.less',
    // Infra
    '.tf', '.hcl', '.dockerfile',
]);

// 500 KB — arquivos maiores que isso são gerados, não escritos à mão
const MAX_FILE_SIZE_BYTES = 500 * 1024;

// ---------------------------------------------------------------------------
// Resultado tipado — o caller sabe exatamente por que foi rejeitado
// ---------------------------------------------------------------------------

export type FilterResult =
    | { allowed: true; language: string }
    | { allowed: false; reason: FilterRejectionReason };

export type FilterRejectionReason =
    | 'blocked_directory'
    | 'blocked_filename'
    | 'extension_not_allowed'
    | 'file_too_large'
    | 'no_workspace_folder';

// ---------------------------------------------------------------------------
// Classe principal
// ---------------------------------------------------------------------------

export class RavocFilter {

    /**
     * Ponto de entrada único. Retorna se o documento pode ser ingerido
     * e, em caso positivo, qual é a linguagem detectada.
     */
    evaluate(document: vscode.TextDocument): FilterResult {
        const filePath = document.uri.fsPath;

        // Camada 1: verifica se algum segmento do path é um diretório bloqueado
        const dirCheck = this.checkBlockedDirectory(filePath);
        if (!dirCheck.passed) {
            return { allowed: false, reason: 'blocked_directory' };
        }

        // Camada 2: verifica o nome exato do arquivo
        const filename = path.basename(filePath);
        if (BLOCKED_FILENAMES.has(filename)) {
            return { allowed: false, reason: 'blocked_filename' };
        }

        // Camada 3: verifica a extensão contra a allowlist
        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return { allowed: false, reason: 'extension_not_allowed' };
        }

        // Camada 4: verifica o tamanho do arquivo em disco
        // (document.getText().length seria em chars — preferimos bytes reais)
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > MAX_FILE_SIZE_BYTES) {
                return { allowed: false, reason: 'file_too_large' };
            }
        } catch {
            // Arquivo pode não existir em disco ainda (untitled) — permitir
        }

        // Passou em todas as camadas — detectar linguagem para metadados
        const language = this.detectLanguage(document, ext);
        return { allowed: true, language };
    }

    /**
     * Verifica se qualquer segmento do caminho absoluto é um diretório bloqueado.
     * Ex: "/projects/app/node_modules/lodash/index.ts" → bloqueado
     */
    private checkBlockedDirectory(filePath: string): { passed: boolean } {
        // Divide o path em segmentos e verifica cada um
        const segments = filePath.split(path.sep);
        for (const segment of segments) {
            if (BLOCKED_DIRECTORIES.has(segment)) {
                return { passed: false };
            }
        }
        return { passed: true };
    }

    /**
     * Detecta a linguagem de programação para os metadados do Chroma.
     * Usa o languageId do VS Code quando disponível — é mais confiável que
     * inferir só pela extensão (ex: .ts pode ser TypeScript ou Deno).
     */
    private detectLanguage(document: vscode.TextDocument, ext: string): string {
        // O VS Code já resolve isso corretamente na maioria dos casos
        if (document.languageId && document.languageId !== 'plaintext') {
            return document.languageId;
        }

        // Fallback por extensão para casos edge
        const extToLanguage: Record<string, string> = {
            '.py': 'python', '.ts': 'typescript', '.tsx': 'typescriptreact',
            '.js': 'javascript', '.jsx': 'javascriptreact', '.go': 'go',
            '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
            '.md': 'markdown', '.sql': 'sql', '.sh': 'shellscript',
            '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json',
            '.tf': 'terraform', '.graphql': 'graphql',
        };

        return extToLanguage[ext] ?? 'unknown';
    }
}