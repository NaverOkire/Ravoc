from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx

from ravoc.llm.types import LLMMessage, LLMRequest, LLMStreamEvent, ProviderConfig

HttpClientFactory = Callable[..., httpx.AsyncClient]


class AnthropicAdapter:
    def __init__(
        self,
        config: ProviderConfig,
        client_factory: HttpClientFactory = httpx.AsyncClient,
    ) -> None:
        self.config = config
        self._client_factory = client_factory

    async def stream_chat(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        headers = self._headers(request)
        payload = self._payload(request)

        async with self._client_factory(timeout=120.0) as http:
            async with http.stream(
                "POST",
                self.config.base_url,
                headers=headers,
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if self._is_done_sse_line(line):
                        break
                    token = self._token_from_sse_line(line)
                    if token:
                        yield LLMStreamEvent.token(token)
        yield LLMStreamEvent.done()

    def _headers(self, request: LLMRequest) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            **self.config.headers,
        }
        if request.api_key:
            headers["x-api-key"] = request.api_key
        return headers

    def _payload(self, request: LLMRequest) -> dict[str, Any]:
        system_messages: list[str] = []
        conversation: list[LLMMessage] = []
        for message in request.messages:
            if message.role == "system":
                system_messages.append(message.content)
            else:
                conversation.append(message)

        payload: dict[str, Any] = {
            "model": request.model or self.config.default_model,
            "messages": [self._message(message) for message in conversation],
            "stream": True,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        if system_messages:
            payload["system"] = "\n\n".join(system_messages)
        if request.stop:
            payload["stop_sequences"] = request.stop
        payload.update(request.provider_options)
        return payload

    @staticmethod
    def _message(message: LLMMessage) -> dict[str, str]:
        role = "assistant" if message.role == "assistant" else "user"
        return {"role": role, "content": message.content}

    @staticmethod
    def _token_from_sse_line(line: str) -> str:
        if not line.startswith("data: "):
            return ""

        try:
            chunk = json.loads(line[6:])
        except json.JSONDecodeError:
            return ""

        if chunk.get("type") != "content_block_delta":
            return ""

        delta = chunk.get("delta")
        if not isinstance(delta, dict):
            return ""

        return delta.get("text", "") or ""

    @staticmethod
    def _is_done_sse_line(line: str) -> bool:
        if not line.startswith("data: "):
            return False

        try:
            chunk = json.loads(line[6:])
        except json.JSONDecodeError:
            return False

        return chunk.get("type") == "message_stop"
