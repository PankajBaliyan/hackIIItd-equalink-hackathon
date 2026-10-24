"""Customer runner upload -> in-memory fix/validation -> provider PR."""

import asyncio
import json
import secrets
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import AnyHttpUrl, BaseModel, Field, ValidationError
from sqlmodel import Session

from app import git_providers, github, hybrid
from app.config import Settings, get_settings
from app.db import get_session
from app.git_provider import FileChange
from app.models import GithubConnection, RepoSetting
from app.routes_sites import REPO_RE

router = APIRouter(prefix="/api", tags=["hybrid"])


class HybridScanIn(BaseModel):
    url: AnyHttpUrl
    raw_html: str = Field(min_length=1, max_length=hybrid.MAX_HTML_BYTES, repr=False)


async def read_input(request: Request) -> HybridScanIn:
    """Bound the upload and avoid FastAPI validation errors echoing raw HTML."""
    buffer = bytearray()
    payload = {}
    try:
        async for chunk in request.stream():
            if len(buffer) + len(chunk) > hybrid.MAX_HTML_BYTES * 6 + 8192:
                raise HTTPException(413, "Hybrid scan payload is too large.")
            buffer.extend(chunk)
        payload = json.loads(buffer)
        body = HybridScanIn.model_validate(payload)
        if len(body.raw_html.encode("utf-8")) > hybrid.MAX_HTML_BYTES:
            body.raw_html = ""
            raise HTTPException(413, "HTML exceeds the size limit.")
        if not body.raw_html.strip() or urlsplit(str(body.url)).username or urlsplit(str(body.url)).password:
            body.raw_html = ""
            raise HTTPException(422, "Provide an HTTP(S) URL without credentials and non-empty raw_html.")
        return body
    except (ValueError, ValidationError):
        raise HTTPException(422, "Provide a JSON object with a valid url and non-empty raw_html.") from None
    finally:
        buffer.clear()
        if isinstance(payload, dict):
            payload.clear()
        del buffer, payload


@router.post("/hybrid-scan", status_code=201, openapi_extra={
    "requestBody": {"required": True, "content": {"application/json": {"schema": HybridScanIn.model_json_schema()}}},
})
async def hybrid_scan(
    request: Request,
    db: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
):
    if not settings.hybrid_api_token:
        raise HTTPException(503, "Configure HYBRID_API_TOKEN before enabling hybrid scans.")
    if not secrets.compare_digest((authorization or "").encode(), f"Bearer {settings.hybrid_api_token}".encode()):
        raise HTTPException(401, "Invalid hybrid runner credentials.")
    path = PurePosixPath(settings.hybrid_file_path)
    if (not REPO_RE.fullmatch(settings.hybrid_repo) or not settings.hybrid_file_path
            or path.is_absolute() or ".." in path.parts or "\\" in settings.hybrid_file_path
            or path.suffix.lower() not in {".html", ".htm"}):
        raise HTTPException(503, "Configure HYBRID_REPO and a repository-relative HTML HYBRID_FILE_PATH.")
    if not settings.tinyfish_api_key:
        raise HTTPException(503, "TinyFish is not configured.")
    connection = db.get(GithubConnection, 1)
    if not connection:
        raise HTTPException(409, "Connect GitHub before starting a hybrid scan.")
    repo = db.get(RepoSetting, settings.hybrid_repo)
    if not repo or not repo.enabled:
        raise HTTPException(403, "Enable pull requests for the hybrid repository first.")
    body = source = None
    fixed = ""
    changes = []
    try:
        body = await read_input(request)
        async with asyncio.timeout(settings.hybrid_timeout_seconds):
            provider = await git_providers.get_git_provider("github", settings, connection)
            source = await provider.get_source_file(repo=settings.hybrid_repo, path=str(path), ref=settings.hybrid_base_branch)
            fixed = await hybrid.generate_fix(settings, body.raw_html, source.content)
            body.raw_html = ""
            await hybrid.validate_fix(source.content, fixed)
            changes.append(FileChange(path=source.path, content=fixed, expected_sha=source.sha))
            pr = await provider.create_pull_request(
                repo=settings.hybrid_repo, title="fix: validated accessibility improvements",
                head=f"equalink/hybrid-{secrets.token_hex(8)}", base=settings.hybrid_base_branch,
                body="Accessibility markup improvements generated from a local runner upload and rechecked with axe-core (WCAG 2.2 AA).",
                changes=changes,
            )
            return {"pr_url": pr.url}
    except TimeoutError:
        raise HTTPException(504, "Hybrid processing timed out; check provider state before retrying.") from None
    except hybrid.HybridError as exc:
        raise HTTPException(422, str(exc)) from None
    except (github.GitHubError, httpx.HTTPError, ValueError, NotImplementedError):
        raise HTTPException(502, "Hybrid provider processing failed; check provider state before retrying.") from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "Hybrid processing failed.") from None
    finally:
        if body:
            body.raw_html = ""
        if source:
            source.content = ""
        for change in changes:
            change.content = ""
        changes.clear()
        del body, source, fixed, changes
