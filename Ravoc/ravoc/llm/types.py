from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

ProviderAdapterKind = Literal[
    "local_openai_compatible",
    "openai_compatible",
    "anthropic",
    "gemini",
]

LLMRole = Literal["system", "user", "assistant"]
LLMStreamEventType = Literal["token", "done"]


@dataclass(frozen=True)
class LLMMessage:
    role: LLMRole
    content: str


@dataclass(frozen=True)
class LLMStreamEvent:
    type: LLMStreamEventType
    content: str = ""

    @classmethod
    def token(cls, content: str) -> "LLMStreamEvent":
        return cls(type="token", content=content)

    @classmethod
    def done(cls) -> "LLMStreamEvent":
        return cls(type="done")


@dataclass(frozen=True)
class LLMRequest:
    messages: list[LLMMessage]
    model: str | None
    api_key: str | None = None
    endpoint_url: str | None = None
    temperature: float = 0.2
    max_tokens: int = 1024
    stop: list[str] = field(default_factory=lambda: ["<|im_start|>", "<|im_end|>"])
    provider_options: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderCapabilities:
    supports_streaming: bool = True
    supports_system_messages: bool = True
    supports_stop: bool = True
    local: bool = False


@dataclass(frozen=True)
class ProviderConfig:
    provider_id: str
    display_name: str
    adapter: ProviderAdapterKind
    base_url: str
    default_model: str | None
    requires_api_key: bool
    api_key_secret_name: str
    capabilities: ProviderCapabilities = field(default_factory=ProviderCapabilities)
    headers: Mapping[str, str] = field(default_factory=dict)

    def public_dict(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "display_name": self.display_name,
            "adapter": self.adapter,
            "default_model": self.default_model,
            "requires_api_key": self.requires_api_key,
            "api_key_secret_name": self.api_key_secret_name,
            "capabilities": {
                "supports_streaming": self.capabilities.supports_streaming,
                "supports_system_messages": self.capabilities.supports_system_messages,
                "supports_stop": self.capabilities.supports_stop,
                "local": self.capabilities.local,
            },
        }


class ChatProvider(Protocol):
    config: ProviderConfig

    async def stream_chat(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        ...
