from __future__ import annotations

from ravoc.llm.adapters import (
    AnthropicAdapter,
    GeminiAdapter,
    LocalOpenAICompatibleAdapter,
    OpenAICompatibleAdapter,
)
from ravoc.llm.types import ChatProvider, ProviderConfig


class LLMRouter:
    def __init__(
        self,
        provider_configs: dict[str, ProviderConfig],
        default_provider_id: str = "local_lm_studio",
    ) -> None:
        self._configs = provider_configs
        self._default_provider_id = default_provider_id
        self._providers = self._build_providers(provider_configs)

    @property
    def provider_configs(self) -> dict[str, ProviderConfig]:
        return self._configs

    @property
    def default_provider_id(self) -> str:
        return self._default_provider_id

    def get_provider(
        self,
        provider_id: str | None,
        allow_cloud: bool = False,
    ) -> ChatProvider:
        selected_id = provider_id or self._default_provider_id
        provider = self._providers.get(selected_id)
        if provider is None:
            raise ValueError(f"Provider desconhecido: {selected_id}")

        if not provider.config.capabilities.local and not allow_cloud:
            raise ValueError(
                "Provedores de nuvem estao desativados. Habilite cloud_enabled para usar este provider."
            )

        return provider

    def list_public_providers(self) -> list[dict]:
        return [
            config.public_dict()
            for config in self._configs.values()
        ]

    @staticmethod
    def _build_providers(
        provider_configs: dict[str, ProviderConfig],
    ) -> dict[str, ChatProvider]:
        providers: dict[str, ChatProvider] = {}
        for provider_id, config in provider_configs.items():
            if config.adapter == "local_openai_compatible":
                providers[provider_id] = LocalOpenAICompatibleAdapter(config)
            elif config.adapter == "openai_compatible":
                providers[provider_id] = OpenAICompatibleAdapter(config)
            elif config.adapter == "anthropic":
                providers[provider_id] = AnthropicAdapter(config)
            elif config.adapter == "gemini":
                providers[provider_id] = GeminiAdapter(config)
            else:
                raise ValueError(f"Adapter desconhecido: {config.adapter}")
        return providers
