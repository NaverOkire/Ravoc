import unittest

from ravoc.llm.adapters.anthropic import AnthropicAdapter
from ravoc.llm.adapters.gemini import GeminiAdapter
from ravoc.llm.adapters.openai_compatible import OpenAICompatibleAdapter
from ravoc.llm.types import LLMMessage, LLMRequest, ProviderConfig


def provider_config(adapter: str) -> ProviderConfig:
    return ProviderConfig(
        provider_id="test",
        display_name="Test",
        adapter=adapter,  # type: ignore[arg-type]
        base_url="https://example.test",
        default_model="test-model",
        requires_api_key=False,
        api_key_secret_name="test.secret",
    )


class OpenAICompatibleAdapterTests(unittest.TestCase):
    def test_extracts_openai_compatible_token(self) -> None:
        line = 'data: {"choices":[{"delta":{"content":"ola"}}]}'

        token = OpenAICompatibleAdapter._token_from_sse_line(line)

        self.assertEqual(token, "ola")

    def test_detects_openai_done_frame(self) -> None:
        self.assertTrue(OpenAICompatibleAdapter._is_done_sse_line("data: [DONE]"))

    def test_builds_openai_compatible_payload(self) -> None:
        adapter = OpenAICompatibleAdapter(provider_config("openai_compatible"))
        request = LLMRequest(
            messages=[LLMMessage(role="system", content="s"), LLMMessage(role="user", content="u")],
            model=None,
        )

        payload = adapter._payload(request)

        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "s"})
        self.assertTrue(payload["stream"])


class AnthropicAdapterTests(unittest.TestCase):
    def test_extracts_anthropic_token(self) -> None:
        line = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ola"}}'

        token = AnthropicAdapter._token_from_sse_line(line)

        self.assertEqual(token, "ola")

    def test_detects_anthropic_stop_event(self) -> None:
        self.assertTrue(AnthropicAdapter._is_done_sse_line('data: {"type":"message_stop"}'))

    def test_moves_system_messages_to_system_field(self) -> None:
        adapter = AnthropicAdapter(provider_config("anthropic"))
        request = LLMRequest(
            messages=[LLMMessage(role="system", content="s"), LLMMessage(role="user", content="u")],
            model="claude-test",
        )

        payload = adapter._payload(request)

        self.assertEqual(payload["model"], "claude-test")
        self.assertEqual(payload["system"], "s")
        self.assertEqual(payload["messages"], [{"role": "user", "content": "u"}])


class GeminiAdapterTests(unittest.TestCase):
    def test_extracts_gemini_token_parts(self) -> None:
        line = 'data: {"candidates":[{"content":{"parts":[{"text":"ola"},{"text":" mundo"}]}}]}'

        token = GeminiAdapter._token_from_sse_line(line)

        self.assertEqual(token, "ola mundo")

    def test_builds_gemini_system_instruction(self) -> None:
        adapter = GeminiAdapter(provider_config("gemini"))
        request = LLMRequest(
            messages=[LLMMessage(role="system", content="s"), LLMMessage(role="assistant", content="a")],
            model="gemini-test",
        )

        payload = adapter._payload(request)

        self.assertEqual(payload["systemInstruction"], {"parts": [{"text": "s"}]})
        self.assertEqual(payload["contents"], [{"role": "model", "parts": [{"text": "a"}]}])


if __name__ == "__main__":
    unittest.main()
