
from sentence_transformers import SentenceTransformer
from functools import lru_cache

@lru_cache(maxsize=1)
def get_embedder() -> SentenceTransformer:
    # nomic requer trust_remote_code — é o modelo oficial deles, não código arbitrário
    return SentenceTransformer(
        "nomic-ai/nomic-embed-text-v1.5",
        trust_remote_code=True,
        device="cpu",
    )

def embed(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    # nomic exige prefixo de tarefa para performance máxima
    prefixed = [f"search_document: {t}" for t in texts]
    return model.encode(prefixed, normalize_embeddings=True).tolist()

def embed_query(query: str) -> list[float]:
    model = get_embedder()
    return model.encode(
        f"search_query: {query}",
        normalize_embeddings=True
    ).tolist()