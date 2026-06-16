from pydantic_settings import BaseSettings

from ravoc.llm.types import ProviderCapabilities, ProviderConfig

class Settings(BaseSettings):
    lm_studio_url: str = "http://localhost:1234/v1/chat/completions"
    lm_studio_model: str = "qwen2.5-coder-7b-instruct"
    backend_port: int = 7000
    default_provider: str = "local_lm_studio"
    cloud_enabled: bool = False

    openai_url: str = "https://api.openai.com/v1/chat/completions"
    openai_model: str = "gpt-4o-mini"
    anthropic_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_model: str = "claude-3-5-sonnet-latest"
    gemini_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_model: str = "gemini-1.5-pro"
    nvidia_url: str = "https://integrate.api.nvidia.com/v1/chat/completions"
    nvidia_model: str = "nvidia/llama-3.1-nemotron-70b-instruct"

    class Config:
        env_file = ".env"

settings = Settings()


def build_provider_configs(current_settings: Settings = settings) -> dict[str, ProviderConfig]:
    return {
        "local_lm_studio": ProviderConfig(
            provider_id="local_lm_studio",
            display_name="Local LM Studio",
            adapter="local_openai_compatible",
            base_url=current_settings.lm_studio_url,
            default_model=current_settings.lm_studio_model,
            requires_api_key=False,
            api_key_secret_name="ravoc.apiKey.local_lm_studio",
            capabilities=ProviderCapabilities(local=True),
        ),
        "openai": ProviderConfig(
            provider_id="openai",
            display_name="OpenAI",
            adapter="openai_compatible",
            base_url=current_settings.openai_url,
            default_model=current_settings.openai_model,
            requires_api_key=True,
            api_key_secret_name="ravoc.apiKey.openai",
        ),
        "anthropic": ProviderConfig(
            provider_id="anthropic",
            display_name="Anthropic Claude",
            adapter="anthropic",
            base_url=current_settings.anthropic_url,
            default_model=current_settings.anthropic_model,
            requires_api_key=True,
            api_key_secret_name="ravoc.apiKey.anthropic",
        ),
        "gemini": ProviderConfig(
            provider_id="gemini",
            display_name="Google Gemini",
            adapter="gemini",
            base_url=current_settings.gemini_url,
            default_model=current_settings.gemini_model,
            requires_api_key=True,
            api_key_secret_name="ravoc.apiKey.gemini",
        ),
        "nvidia": ProviderConfig(
            provider_id="nvidia",
            display_name="NVIDIA Nemotron",
            adapter="openai_compatible",
            base_url=current_settings.nvidia_url,
            default_model=current_settings.nvidia_model,
            requires_api_key=True,
            api_key_secret_name="ravoc.apiKey.nvidia",
        ),
    }
