from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx

from ravoc.llm.types import LLMMessage, LLMRequest, LLMStreamEvent, ProviderConfig

HttpClientFactory = Callable[..., httpx.AsyncClient]


class OpenAICompatibleAdapter:
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
        endpoint_url = request.endpoint_url or self.config.base_url

        async with self._client_factory(timeout=120.0) as http:
            async with http.stream(
                "POST",
                endpoint_url,
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
        headers = {"Content-Type": "application/json", **self.config.headers}
        if request.api_key:
            headers["Authorization"] = f"Bearer {request.api_key}"
        return headers

    def _payload(self, request: LLMRequest) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": request.model or self.config.default_model,
            "messages": [self._message(message) for message in request.messages],
            "stream": True,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        if self.config.capabilities.supports_stop and request.stop:
            payload["stop"] = request.stop
        payload.update(request.provider_options)
        return payload

    @staticmethod
    def _message(message: LLMMessage) -> dict[str, str]:
        return {"role": message.role, "content": message.content}

    @staticmethod
    def _token_from_sse_line(line: str) -> str:
        if not line.startswith("data: "):
            return ""

        payload = line[6:]
        try:
            chunk = json.loads(payload)
        except json.JSONDecodeError:
            return ""

        try:
            return chunk["choices"][0]["delta"].get("content", "") or ""
        except (KeyError, IndexError, TypeError, AttributeError):
            return ""

    @staticmethod
    def _is_done_sse_line(line: str) -> bool:
        return line.strip() == "data: [DONE]"


class LocalOpenAICompatibleAdapter(OpenAICompatibleAdapter):
    pass
