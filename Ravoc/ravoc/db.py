import chromadb
from chromadb.config import Settings

def get_client() -> chromadb.HttpClient:
    return chromadb.HttpClient(
        host="localhost",
        port=8000,
        # sem headers de auth
    )

COLLECTIONS = ["code_context", "notes_context", "session_history"]

def init_collections() -> None:
    client = get_client()
    for name in COLLECTIONS:
        client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},  # só isso no metadata
        )
        print(f"✓ {name}")

if __name__ == "__main__":
    init_collections()