from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    lm_studio_url: str = "http://localhost:1234/v1/chat/completions"
    lm_studio_model: str = "qwen2.5-coder-7b-instruct"
    backend_port: int = 7000

    class Config:
        env_file = ".env"

settings = Settings()