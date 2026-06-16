from __future__ import annotations

from dataclasses import dataclass, field

from ravoc.llm.types import LLMMessage

MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CONTENT_CHARS = 2000
MAX_ACTIVE_FILE_CONTEXT_CHARS = 12000


@dataclass(frozen=True)
class ChatHistoryMessage:
    role: str
    content: str


@dataclass(frozen=True)
class ChatContextInput:
    message: str
    active_file: str | None = None
    active_language: str | None = None
    active_file_content: str | None = None
    history: list[ChatHistoryMessage] = field(default_factory=list)


class ChatContextBuilder:
    def __init__(self, prompt_version: str) -> None:
        self.prompt_version = prompt_version

    def build(self, chat: ChatContextInput) -> list[LLMMessage]:
        active_file_context = self._active_file_context(chat)
        system_prompt = (
            f"[{self.prompt_version}]\n"
            "Você é o RAVOC, um assistente de desenvolvimento local. "
            "Responda de forma direta, técnica e em português. "
            "Não invente nomes de arquivos: se houver arquivo ativo, use exatamente o caminho informado. "
            "Se houver linguagem detectada no contexto, prefira essa informação ao inferir pela conversa. "
            "Se a pergunta for geral, responda diretamente sem forçar relação com o arquivo aberto. "
            "Se a pergunta mencionar este arquivo, o código, a linguagem ou o contexto atual, "
            "use o contexto do editor aberto abaixo. "
            "Nunca escreva tokens de template como <|im_start|> ou <|im_end|>."
            + active_file_context
        )

        return [
            LLMMessage(role="system", content=system_prompt),
            *self.clean_history(chat.history),
            LLMMessage(role="user", content=chat.message),
        ]

    def clean_history(self, history: list[ChatHistoryMessage]) -> list[LLMMessage]:
        cleaned: list[LLMMessage] = []
        for msg in history[-MAX_HISTORY_MESSAGES:]:
            if msg.role not in {"user", "assistant"}:
                continue

            content = msg.content.strip()
            if not content:
                continue

            if msg.role == "assistant" and self.looks_corrupted(content):
                continue

            cleaned.append(
                LLMMessage(
                    role=msg.role,  # type: ignore[arg-type]
                    content=content[:MAX_HISTORY_CONTENT_CHARS],
                )
            )

        return cleaned

    def _active_file_context(self, chat: ChatContextInput) -> str:
        if not chat.active_file or not self.question_needs_file_context(chat.message):
            return ""

        context = (
            "\n\nContexto do editor aberto:"
            f"\n- arquivo: {chat.active_file}"
            f"\n- linguagem detectada: {chat.active_language or 'desconhecida'}"
        )
        if chat.active_file_content:
            context += (
                "\n\nConteúdo do arquivo ativo:\n"
                f"```{chat.active_language or ''}\n"
                f"{chat.active_file_content[:MAX_ACTIVE_FILE_CONTEXT_CHARS]}\n"
                "```"
            )

        return context

    @staticmethod
    def looks_corrupted(text: str) -> bool:
        lowered = text.lower()
        suspicious_fragments = (
            "<|im_start|>",
            "<|im_end|>",
            "umaescreu",
            "avavoc",
            "perguntaunta",
            "especificamenteente",
            "ficare em em",
            "voce estau",
            "voc\u00ea est\u00e1u",
        )
        if any(fragment in lowered for fragment in suspicious_fragments):
            return True

        if "````" in text:
            return True

        words = lowered.split()
        if len(words) >= 12:
            repeated = sum(1 for i in range(1, len(words)) if words[i] == words[i - 1])
            if repeated / len(words) > 0.15:
                return True

        return False

    @staticmethod
    def question_needs_file_context(message: str) -> bool:
        text = message.lower().strip()
        file_terms = (
            "arquivo",
            "codigo",
            "c\u00f3digo",
            "funcao",
            "fun\u00e7\u00e3o",
            "classe",
            "linguagem",
            "nome dele",
            "nome do",
            "neste",
            "nesse",
            "presente",
        )
        return any(term in text for term in file_terms)
