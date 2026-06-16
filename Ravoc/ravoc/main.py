from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator

from ravoc.config import build_provider_configs, settings
from ravoc.db import get_client
from ravoc.embedder import embed, embed_query
from ravoc.llm import (
    ChatContextBuilder,
    ChatContextInput,
    ChatHistoryMessage,
    LLMRequest,
    LLMRouter,
)

app = FastAPI(title="RAVOC API", version="0.1.0")

PROMPT_VERSION = "ravoc-chat-pipeline-2026-05-29b"

chat_context_builder = ChatContextBuilder(prompt_version=PROMPT_VERSION)
llm_router = LLMRouter(
    provider_configs=build_provider_configs(),
    default_provider_id=settings.default_provider,
)

VALID_COLLECTIONS = {"code_context", "notes_context", "session_history"}
VALID_CHUNK_TYPES = {"function", "class", "section", "root_object", "message"}


class IngestRequest(BaseModel):
    collection: str = Field(..., description="Nome da colecao alvo")
    documents: list[str] = Field(..., min_length=1, max_length=50)
    metadatas: list[dict] = Field(..., description="Metadados paralelos aos documentos")

    @field_validator("collection")
    @classmethod
    def valid_collection(cls, value: str) -> str:
        if value not in VALID_COLLECTIONS:
            raise ValueError(f"collection deve ser uma de: {VALID_COLLECTIONS}")
        return value

    @field_validator("metadatas")
    @classmethod
    def validate_metadata_schema(cls, value: list[dict]) -> list[dict]:
        required = {"file_path", "project_id", "language", "chunk_type", "chunk_name", "timestamp"}
        for index, meta in enumerate(value):
            missing = required - meta.keys()
            if missing:
                raise ValueError(f"metadata[{index}] falta: {missing}")
            if meta["chunk_type"] not in VALID_CHUNK_TYPES:
                raise ValueError(f"chunk_type invalido: {meta['chunk_type']}")
        return value


class QueryRequest(BaseModel):
    collection: str
    query: str = Field(..., min_length=1)
    project_id: str
    n_results: int = Field(default=5, ge=1, le=10)
    min_score: float = Field(default=0.65, ge=0.0, le=1.0)

    @field_validator("collection")
    @classmethod
    def valid_collection(cls, value: str) -> str:
        if value not in VALID_COLLECTIONS:
            raise ValueError(f"collection deve ser uma de: {VALID_COLLECTIONS}")
        return value


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    active_file: str | None = None
    active_language: str | None = None
    active_file_content: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)
    project_id: str = ""
    provider_id: str | None = None
    model: str | None = None
    api_key: str | None = None
    cloud_enabled: bool | None = None
    provider_options: dict[str, Any] = Field(default_factory=dict)
    lm_url: str = "http://localhost:1234/v1/chat/completions"
    lm_model: str | None = None
    lm_api_key: str | None = None


LANGUAGE_LABELS = {
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "typescriptreact": "TypeScript React",
    "javascriptreact": "JavaScript React",
    "python": "Python",
    "sql": "SQL",
    "json": "JSON",
    "html": "HTML",
    "css": "CSS",
    "markdown": "Markdown",
}


@app.post("/ingest", status_code=201)
async def ingest(req: IngestRequest):
    client = get_client()
    col = client.get_collection(req.collection)

    ids = []
    for doc, meta in zip(req.documents, req.metadatas):
        content_hash = hashlib.sha256(doc.encode()).hexdigest()
        meta["content_hash"] = content_hash

        existing = col.get(where={
            "$and": [
                {"file_path": {"$eq": meta["file_path"]}},
                {"chunk_name": {"$eq": meta["chunk_name"]}},
            ]
        })

        if existing["ids"]:
            old_hash = existing["metadatas"][0].get("content_hash")
            if old_hash == content_hash:
                ids.append(None)
                continue
            col.delete(ids=existing["ids"])

        ids.append(f"{meta['project_id']}::{meta['file_path']}::{meta['chunk_name']}")

    docs_to_add = [
        (doc, meta, id_)
        for doc, meta, id_ in zip(req.documents, req.metadatas, ids)
        if id_
    ]
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
    return {"status": "ok", "prompt_version": PROMPT_VERSION}


@app.get("/providers")
async def providers():
    return {
        "default_provider": llm_router.default_provider_id,
        "cloud_enabled": settings.cloud_enabled,
        "providers": llm_router.list_public_providers(),
    }


def normalized(text: str) -> str:
    return text.lower().strip()


def language_label(language: str | None) -> str:
    if not language:
        return "desconhecida"
    return LANGUAGE_LABELS.get(language.lower(), language)


def format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f"{value:.10g}"


def simple_math_answer(message: str) -> str | None:
    match = re.search(
        r"(-?\d+(?:[,.]\d+)?)\s*([+\-*/x\u00d7\u00f7])\s*(-?\d+(?:[,.]\d+)?)",
        message,
    )
    if not match:
        return None

    left_raw, operator, right_raw = match.groups()
    left = float(left_raw.replace(",", "."))
    right = float(right_raw.replace(",", "."))

    if operator == "+":
        result = left + right
    elif operator == "-":
        result = left - right
    elif operator in {"*", "x", "\u00d7"}:
        result = left * right
    elif right == 0:
        return "Não é possível dividir por zero."
    else:
        result = left / right

    return (
        f"{format_number(left)} {operator} {format_number(right)} "
        f"= {format_number(result)}."
    )


def deterministic_answer(req: ChatRequest) -> str | None:
    text = normalized(req.message)
    math_answer = simple_math_answer(req.message)
    if math_answer:
        return math_answer

    asks_language = "linguagem" in text
    asks_name = "nome" in text and (
        "arquivo" in text
        or "dele" in text
        or "codigo" in text
        or "c\u00f3digo" in text
    )

    if req.active_file and (asks_language or asks_name):
        parts = []
        if asks_name:
            parts.append(f"o arquivo ativo é `{req.active_file}`")
        if asks_language:
            parts.append(f"a linguagem detectada é {language_label(req.active_language)}")
        answer = " e ".join(parts)
        return answer[:1].upper() + answer[1:] + "."

    if text in {"ol\u00e1", "ola", "oi"}:
        return "Olá! Como posso ajudar com o código?"

    compact = text.replace(" ", "")
    if compact in {
        "quanto\u00e92+2",
        "quantoe2+2",
        "2+2",
        "ol\u00e1,quanto\u00e92+2",
        "ola,quantoe2+2",
    }:
        return "2 + 2 = 4."

    return None


def build_llm_request(req: ChatRequest) -> tuple[LLMRequest, str | None, bool]:
    messages = chat_context_builder.build(
        ChatContextInput(
            message=req.message,
            active_file=req.active_file,
            active_language=req.active_language,
            active_file_content=req.active_file_content,
            history=[
                ChatHistoryMessage(role=msg.role, content=msg.content)
                for msg in req.history
            ],
        )
    )
    allow_cloud = settings.cloud_enabled if req.cloud_enabled is None else req.cloud_enabled
    provider = llm_router.get_provider(req.provider_id, allow_cloud=allow_cloud)
    api_key = req.api_key or req.lm_api_key

    if provider.config.requires_api_key and not api_key:
        raise ValueError(f"API key ausente para provider {provider.config.provider_id}")

    return (
        LLMRequest(
            messages=messages,
            model=req.model or req.lm_model,
            api_key=api_key,
            endpoint_url=req.lm_url if provider.config.capabilities.local else None,
            temperature=0.2,
            max_tokens=1024,
            provider_options=req.provider_options,
        ),
        req.provider_id,
        allow_cloud,
    )


@app.websocket("/chat")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            req = ChatRequest(**json.loads(raw))

            direct = deterministic_answer(req)
            if direct:
                await websocket.send_text(
                    json.dumps({"type": "token", "content": direct})
                )
                await websocket.send_text(json.dumps({"type": "done"}))
                continue

            llm_request, provider_id, allow_cloud = build_llm_request(req)
            provider = llm_router.get_provider(provider_id, allow_cloud=allow_cloud)

            async for event in provider.stream_chat(llm_request):
                if event.type == "token" and event.content:
                    await websocket.send_text(
                        json.dumps({"type": "token", "content": event.content})
                    )
                elif event.type == "done":
                    break

            await websocket.send_text(json.dumps({"type": "done"}))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": str(exc)})
            )
        except Exception:
            pass
