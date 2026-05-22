# 💻 Ravoc

O **Ravoc** é um ecossistema inteligente composto por uma extensão para o Visual Studio Code integrada a um backend robusto de Inteligência Artificial, projetado para atuar como um assistente de desenvolvimento local focado em contexto de código, vetorização e automação.

O projeto encontra-se em **fase inicial de desenvolvimento (Work in Progress)**, evoluindo a arquitetura do sistema e a integração entre a interface visual do editor e os modelos locais de IA.

---

## 🚀 Funcionalidades Planejadas & Em Desenvolvimento

### 🔌 Extensão VS Code (`ravoc-vscode`) CONCLUÍDA
- Interface visual dedicada integrada ao editor.
- Comunicação direta com o backend local via API.
- Captura de contexto de arquivos abertos e trechos de código selecionados.
- Comandos rápidos via palette do VS Code.

### 🧠 Backend & Ecossistema de IA (`Ravoc`)
- **Pipeline de Embeddings:** Processamento, chunking e vetorização de arquivos e repositórios locais.
- **Banco de Dados Relacional:** Estrutura para gerenciamento de metadados, sessões e logs persistentes.
- **Orquestração Inteligente:** Integração com LLMs locais e sistemas de automação de fluxo de dados.
- **Ambiente Isolado:** Configuração baseada em containers para garantir portabilidade e consistência entre ambientes.

---

## 🏗️ Arquitetura do Repositório

O repositório é organizado de forma modular para separar a interface do editor da lógica de processamento pesado:

- `/ravoc-vscode`: Código-fonte da extensão do VS Code, responsável pela UI/UX do usuário, escuta de eventos do editor e comunicação cliente-servidor.
- `/Ravoc`: Código-fonte do core backend, contendo os scripts de banco de dados, motores de IA, Dockerfile e configurações do ambiente.

---

## 🛠️ Tecnologias

### Extensão (Frontend / Client)
- TypeScript
- VS Code Extension API
- Node.js / esbuild

### Backend & Core (Server)
- Python
- Docker & Docker Compose
- Banco de Dados SQL
- Ecossistema de IA (Modelos Locais, Tokenizadores e Embeddings)

---

## 🎯 Objetivo

- Desenvolver uma ferramenta de IA local-first, garantindo total privacidade do código-fonte.
- Consolidar conhecimentos avançados em arquitetura de sistemas, engenharia de IA e RAG (Retrieval-Augmented Generation).
- Construir uma extensão fluida e integrada diretamente ao ecossistema do desenvolvedor.

---

## 📌 Status

🚧 **Em desenvolvimento (WIP - Work in Progress)**

### Próximos Passos
- Finalizar a interface visual base da extensão no VS Code.
- Estruturar os endpoints principais da API do backend.
- Conectar o banco de dados via container Docker.
- Implementar a rotina inicial de processamento e vetorização de texto.

---

## 📄 Licença

MIT License
