# ravoc/main.py
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator
import hashlib
import json
import re
import httpx
from ravoc.db import get_client
from ravoc.embedder import embed, embed_query

app = FastAPI(title="RAVOC API", version="0.1.0")

PROMPT_VERSION = "ravoc-chat-pipeline-2026-05-29b"
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CONTENT_CHARS = 2000
MAX_ACTIVE_FILE_CONTEXT_CHARS = 12000

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

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/ingest", status_code=201)
async def ingest(req: IngestRequest):
    client = get_client()
    col = client.get_collection(req.collection)

    ids = []
    for i, (doc, meta) in enumerate(zip(req.documents, req.metadatas)):
        content_hash = hashlib.sha256(doc.encode()).hexdigest()
        meta["content_hash"] = content_hash

        existing = col.get(where={
            "$and": [
                {"file_path": {"$eq": meta["file_path"]}},
                {"chunk_name": {"$eq": meta["chunk_name"]}}
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


def looks_corrupted(text: str) -> bool:
    lowered = text.lower()
    suspicious_fragments = (
        "<|im_start|>",
        "<|im_end|>",
        "umaescreu",
        "avavoc",
        "perguntaunta",
        "especificamenteente",
        "ficare em em",
        "você estáu",
    )
    if any(fragment in lowered for fragment in suspicious_fragments):
        return True

    if "````" in text:
        return True

    words = lowered.split()
    if len(words) >= 12:
        repeated = sum(1 for i in range(1, len(words)) if words[i] == words[i - 1])
        if repeated / len(words) > 0.15:
            return True

    return False


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
        r"(-?\d+(?:[,.]\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:[,.]\d+)?)",
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
    elif operator in {"*", "x", "×"}:
        result = left * right
    elif right == 0:
        return "Não é possível dividir por zero."
    else:
        result = left / right

    return (
        f"{format_number(left)} {operator} {format_number(right)} "
        f"= {format_number(result)}."
    )


def question_needs_file_context(message: str) -> bool:
    text = normalized(message)
    file_terms = (
        "arquivo",
        "código",
        "codigo",
        "função",
        "funcao",
        "classe",
        "linguagem",
        "nome dele",
        "nome do",
        "neste",
        "nesse",
        "presente",
    )
    return any(term in text for term in file_terms)


def deterministic_answer(req: ChatRequest) -> str | None:
    text = normalized(req.message)
    math_answer = simple_math_answer(req.message)
    if math_answer:
        return math_answer

    asks_language = "linguagem" in text
    asks_name = "nome" in text and (
        "arquivo" in text
        or "dele" in text
        or "código" in text
        or "codigo" in text
    )

    if req.active_file and (asks_language or asks_name):
        parts = []
        if asks_name:
            parts.append(f"o arquivo ativo é `{req.active_file}`")
        if asks_language:
            parts.append(f"a linguagem detectada é {language_label(req.active_language)}")
        answer = " e ".join(parts)
        return answer[:1].upper() + answer[1:] + "."

    if text in {"olá", "ola", "oi"}:
        return "Olá! Como posso ajudar com o código?"

    if text.replace(" ", "") in {"quantoé2+2", "quantoe2+2", "2+2", "olá,quantoé2+2", "ola,quantoe2+2"}:
        return "2 + 2 = 4."

    return None


def clean_history(history: list[ChatMessage]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for msg in history[-MAX_HISTORY_MESSAGES:]:
        if msg.role not in {"user", "assistant"}:
            continue

        content = msg.content.strip()
        if not content:
            continue

        if msg.role == "assistant" and looks_corrupted(content):
            continue

        cleaned.append({
            "role": msg.role,
            "content": content[:MAX_HISTORY_CONTENT_CHARS],
        })

    return cleaned

# ── WebSocket /chat ───────────────────────────────────────────────────────────

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

            include_file_context = question_needs_file_context(req.message)
            active_file_context = ""
            if req.active_file and include_file_context:
                active_file_context = (
                    "\n\nContexto do editor aberto:"
                    f"\n- arquivo: {req.active_file}"
                    f"\n- linguagem detectada: {req.active_language or 'desconhecida'}"
                )
                if req.active_file_content:
                    active_file_context += (
                        "\n\nConteúdo do arquivo ativo:\n"
                        f"```{req.active_language or ''}\n"
                        f"{req.active_file_content[:MAX_ACTIVE_FILE_CONTEXT_CHARS]}\n"
                        "```"
                    )

            messages = [
                {
                    "role": "system",
                    "content": (
                        f"[{PROMPT_VERSION}]\n"
                        "Você é o RAVOC, um assistente de desenvolvimento local. "
                        "Responda de forma direta, técnica e em português. "
                        "Não invente nomes de arquivos: se houver arquivo ativo, use exatamente o caminho informado. "
                        "Se houver linguagem detectada no contexto, prefira essa informação ao inferir pela conversa. "
                        "Se a pergunta for geral, responda diretamente sem forçar relação com o arquivo aberto. "
                        "Se a pergunta mencionar este arquivo, o código, a linguagem ou o contexto atual, "
                        "use o contexto do editor aberto abaixo. "
                        "Nunca escreva tokens de template como <|im_start|> ou <|im_end|>."
                        + active_file_context
                    )
                },
                *clean_history(req.history),
                {"role": "user", "content": req.message},
            ]

            # Headers dinâmicos — só inclui Authorization se houver API key
            headers = {"Content-Type": "application/json"}
            if req.lm_api_key:
                headers["Authorization"] = f"Bearer {req.lm_api_key}"

            async with httpx.AsyncClient(timeout=120.0) as http:
                async with http.stream(
                    "POST",
                    req.lm_url,                          # ← URL do provider
                    headers=headers,
                    json={
                        "model": req.lm_model,           # ← modelo do provider (None = deixa o servidor decidir)
                        "messages": messages,
                        "stream": True,
                        "temperature": 0.2,
                        "max_tokens": 1024,
                        "stop": ["<|im_start|>", "<|im_end|>"],
                    }
                ) as response:
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:]
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                            token = chunk["choices"][0]["delta"].get("content", "")
                            if token:
                                await websocket.send_text(
                                    json.dumps({"type": "token", "content": token})
                                )
                        except (json.JSONDecodeError, KeyError):
                            continue

            await websocket.send_text(json.dumps({"type": "done"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": str(e)})
            )
        except Exception:
            pass
