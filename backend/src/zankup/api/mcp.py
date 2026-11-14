"""A read-only MCP server (OS-709): the Coach's tools for any AI assistant you use, behind a personal
token created in Settings. Streamable HTTP in its stateless form: JSON-RPC 2.0 requests by POST,
JSON answers, no sessions and no server-sent events. It works without an Anthropic key: the
assistant you connect brings its own model, and it gets the same minimised data as the Coach.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup import __version__
from zankup.ai.tools import TOOLS, ToolError, run_tool
from zankup.api.oauth import www_authenticate
from zankup.auth.deps import AppSettings, DbSession
from zankup.auth.security import token_hash
from zankup.db.models import ApiToken, User

log = logging.getLogger("zankup.mcp")

router = APIRouter(prefix="/api", tags=["mcp"])

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26")
INSTRUCTIONS = (
    "Zankup keeps this person's sports data. The tools answer with aggregated numbers (activities, "
    "fitness, records, sleep, estimates) and never with locations, routes or personal details. "
    "Dates are ISO 8601; distances in metres, times in seconds, speeds in metres per second."
)


def mcp_user(request: Request, db: DbSession, settings: AppSettings) -> User:
    """The token's owner. Bearer `zk_…` tokens, from Settings or OAuth; a revoked token is a 401 that
    says where to authorise (api/oauth.py), so an assistant can connect itself."""

    def refused() -> HTTPException:
        return HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not signed in",
            headers={"WWW-Authenticate": www_authenticate(settings)},
        )

    authorization = request.headers.get("Authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise refused()
    row = db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash(authorization[7:].strip())))
    if row is None or row.revoked_at is not None:
        raise refused()
    user = db.get(User, row.user_id)
    if user is None:
        raise refused()
    row.last_used_at = datetime.now(UTC)
    db.commit()
    return user


McpUser = Annotated[User, Depends(mcp_user)]


def _error(request_id: Any, code: int, message: str, http_status: int = 200) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
        status_code=http_status,
    )


def _result(request_id: Any, result: dict[str, Any]) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})


def tools_list() -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "title": tool.name.replace("_", " ").capitalize(),
            "description": tool.description,
            "inputSchema": tool.schema(),
            "annotations": {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False},
        }
        for tool in TOOLS
    ]


def handle(db: Session, user: User, message: dict[str, Any]) -> Response:
    request_id = message.get("id")
    method = message.get("method")
    params = message.get("params") or {}
    if message.get("jsonrpc") != "2.0" or not isinstance(method, str):
        return _error(request_id, -32600, "invalid request", 400)
    if method.startswith("notifications/"):
        return Response(status_code=202)
    if method == "initialize":
        asked = str(params.get("protocolVersion") or PROTOCOL_VERSIONS[0])
        version = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
        return _result(
            request_id,
            {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "zankup", "title": "Zankup", "version": __version__},
                "instructions": INSTRUCTIONS,
            },
        )
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        return _result(request_id, {"tools": tools_list()})
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _error(request_id, -32602, "name and arguments are required")
        try:
            result = run_tool(db, user.id, name, arguments)
        except ToolError as error:
            if str(error).startswith("unknown tool"):
                return _error(request_id, -32602, str(error))
            return _result(request_id, {"content": [{"type": "text", "text": str(error)}], "isError": True})
        return _result(
            request_id,
            {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                "structuredContent": result,
                "isError": False,
            },
        )
    return _error(request_id, -32601, f"method not found: {method}")


@router.post("/mcp", operation_id="mcp", include_in_schema=False)
async def mcp_endpoint(request: Request, db: DbSession, user: McpUser) -> Response:
    try:
        message = json.loads(await request.body())
    except json.JSONDecodeError:
        return _error(None, -32700, "parse error", 400)
    if isinstance(message, list):  # a batch: answer each request, skip notifications
        answers = [
            json.loads(bytes(r.body).decode())
            for m in message
            if isinstance(m, dict) and (r := handle(db, user, m)).status_code != 202
        ]
        return JSONResponse(answers)
    if not isinstance(message, dict):
        return _error(None, -32600, "invalid request", 400)
    return handle(db, user, message)


@router.get("/mcp", include_in_schema=False)
def mcp_get() -> Response:
    """No server-to-client stream: the server is stateless."""
    return Response(status_code=405, headers={"Allow": "POST"})
