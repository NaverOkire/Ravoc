# ravoc/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
import hashlib
from ravoc.db import get_client
from ravoc.embedder import embed, embed_query

app = FastAPI(title="RAVOC API", version="0.1.0")

# ── Schemas ──────────────────────────────────────────────────────────────────

VALID_COLLECTIONS = {"code_context", "notes_context", "session_history"}
VALID_CHUNK_TYPES = {"function", "class", "section", "root_object", "message"}

class IngestRequest(BaseModel):
    collection: str = Field(..., description="Nome da coleção alvo")
    documents: list[str] = Field(..., min_length=1, max_length=50)
    metadatas: list[dict] = Field(..., description="Metadados paralelos aos documentos")

    @field_validator("collection")
    @classmethod
    def valid_collection(cls, v: str) -> str:
        if v not in VALID_COLLECTIONS:
            raise ValueError(f"collection deve ser uma de: {VALID_COLLECTIONS}")
        return v

    @field_validator("metadatas")
    @classmethod
    def validate_metadata_schema(cls, v: list[dict]) -> list[dict]:
        required = {"file_path", "project_id", "language", "chunk_type", "chunk_name", "timestamp"}
        for i, meta in enumerate(v):
            missing = required - meta.keys()
            if missing:
                raise ValueError(f"metadata[{i}] falta: {missing}")
            if meta["chunk_type"] not in VALID_CHUNK_TYPES:
                raise ValueError(f"chunk_type inválido: {meta['chunk_type']}")
        return v

class QueryRequest(BaseModel):
    collection: str
    query: str = Field(..., min_length=1)
    project_id: str
    n_results: int = Field(default=5, ge=1, le=10)
    min_score: float = Field(default=0.65, ge=0.0, le=1.0)

    @field_validator("collection")
    @classmethod
    def valid_collection(cls, v: str) -> str:
        if v not in VALID_COLLECTIONS:
            raise ValueError(f"collection deve ser uma de: {VALID_COLLECTIONS}")
        return v

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/ingest", status_code=201)
async def ingest(req: IngestRequest):
    client = get_client()
    col = client.get_collection(req.collection)

    ids = []
    for i, (doc, meta) in enumerate(zip(req.documents, req.metadatas)):
        content_hash = hashlib.sha256(doc.encode()).hexdigest()
        meta["content_hash"] = content_hash

        # Busca por documento existente com sintaxe ChromaDB 0.5+
        existing = col.get(where={
            "$and": [
                {"file_path": {"$eq": meta["file_path"]}},
                {"chunk_name": {"$eq": meta["chunk_name"]}}
            ]
        })
        
        if existing["ids"]:
            old_hash = existing["metadatas"][0].get("content_hash")
            if old_hash == content_hash:
                ids.append(None)  # skip - conteúdo idêntico
                continue
            col.delete(ids=existing["ids"])  # deleta versão antiga

        ids.append(f"{meta['project_id']}::{meta['file_path']}::{meta['chunk_name']}")

    docs_to_add = [(doc, meta, id_) for doc, meta, id_ in zip(req.documents, req.metadatas, ids) if id_]
    if not docs_to_add:
        return {"inserted": 0, "skipped": len(req.documents)}

    texts, metas, final_ids = zip(*docs_to_add)
    embeddings = embed(list(texts))

    col.add(
        documents=list(texts),
        embeddings=embeddings,
        metadatas=list(metas),
        ids=list(final_ids),
    )
    return {"inserted": len(final_ids), "skipped": len(req.documents) - len(final_ids)}


@app.post("/query")
async def query(req: QueryRequest):
    client = get_client()
    col = client.get_collection(req.collection)

    query_embedding = embed_query(req.query)
    results = col.query(
        query_embeddings=[query_embedding],
        n_results=req.n_results,
        where={"project_id": req.project_id},
        include=["documents", "metadatas", "distances"],
    )

    # Chroma retorna distância cosine [0,2] → converter para score [0,1]
    hits = []
    for doc, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        score = 1 - (dist / 2)
        if score >= req.min_score:
            hits.append({"document": doc, "metadata": meta, "score": round(score, 4)})

    return {"results": hits, "total": len(hits)}


@app.get("/health")
async def health():
    return {"status": "ok"}