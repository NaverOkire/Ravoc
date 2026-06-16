from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx

from ravoc.llm.types import LLMMessage, LLMRequest, LLMStreamEvent, ProviderConfig

HttpClientFactory = Callable[..., httpx.AsyncClient]


class GeminiAdapter:
    def __init__(
        self,
        config: ProviderConfig,
        client_factory: HttpClientFactory = httpx.AsyncClient,
    ) -> None:
        self.config = config
        self._client_factory = client_factory

    async def stream_chat(self, request: LLMRequest) -> AsyncIterator[LLMStreamEvent]:
        headers = {"Content-Type": "application/json", **self.config.headers}
        params = {"alt": "sse"}
        if request.api_key:
            params["key"] = request.api_key

        async with self._client_factory(timeout=120.0) as http:
            async with http.stream(
                "POST",
                self._endpoint_url(request),
                headers=headers,
                params=params,
                json=self._payload(request),
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    token = self._token_from_sse_line(line)
                    if token:
                        yield LLMStreamEvent.token(token)
        yield LLMStreamEvent.done()

    def _endpoint_url(self, request: LLMRequest) -> str:
        model = request.model or self.config.default_model
        base_url = self.config.base_url.rstrip("/")
        return f"{base_url}/models/{model}:streamGenerateContent"

    def _payload(self, request: LLMRequest) -> dict[str, Any]:
        system_messages: list[str] = []
        conversation: list[LLMMessage] = []
        for message in request.messages:
            if message.role == "system":
                system_messages.append(message.content)
            else:
                conversation.append(message)

        payload: dict[str, Any] = {
            "contents": [self._content(message) for message in conversation],
            "generationConfig": {
                "temperature": request.temperature,
                "maxOutputTokens": request.max_tokens,
            },
        }
        if system_messages:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n\n".join(system_messages)}],
            }
        if request.stop:
            payload["generationConfig"]["stopSequences"] = request.stop
        payload.update(request.provider_options)
        return payload

    @staticmethod
    def _content(message: LLMMessage) -> dict[str, Any]:
        role = "model" if message.role == "assistant" else "user"
        return {"role": role, "parts": [{"text": message.content}]}

    @staticmethod
    def _token_from_sse_line(line: str) -> str:
        if not line.startswith("data: "):
            return ""

        try:
            chunk = json.loads(line[6:])
        except json.JSONDecodeError:
            return ""

        candidates = chunk.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return ""

        content = candidates[0].get("content")
        if not isinstance(content, dict):
            return ""

        parts = content.get("parts")
        if not isinstance(parts, list):
            return ""

        return "".join(
            part.get("text", "")
            for part in parts
            if isinstance(part, dict)
        )
