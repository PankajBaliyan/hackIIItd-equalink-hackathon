"""Explicit PR creation for existing branches, independent of scan shipping."""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app import github, git_providers
from app.config import Settings, get_settings
from app.db import get_session
from app.git_provider import PullRequest
from app.models import GithubConnection, RepoSetting

router = APIRouter(prefix="/pull-requests", tags=["pull requests"])


class PullRequestIn(BaseModel):
    provider: str = "github"
    repo: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    title: str = Field(min_length=1)
    head: str = Field(min_length=1)
    base: str = Field(min_length=1)
    body: str = ""


@router.post("", status_code=201, response_model=PullRequest)
async def create_pull_request(
    body: PullRequestIn,
    db: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    try:
        if body.provider not in git_providers.PROVIDERS:
            raise HTTPException(422, "Unsupported git provider.")
        connection = db.get(GithubConnection, 1)
        if not connection:
            raise HTTPException(409, "Connect a git account before opening a pull request.")
        repo = db.get(RepoSetting, body.repo)
        if not repo or not repo.enabled:
            raise HTTPException(403, "Enable pull requests for this repository first.")
        provider = await git_providers.get_git_provider(body.provider, settings, connection)
        return await provider.create_pull_request(
            repo=body.repo, title=body.title, head=body.head, base=body.base, body=body.body,
        )
    except github.GitHubError as exc:
        # Provider error bodies may echo submitted source or fix content.
        raise HTTPException(502, "Git provider rejected the pull request.") from None
    except httpx.RequestError as exc:
        raise HTTPException(502, "Unable to reach the git provider.") from None
    finally:
        # No generated patch text should survive a provider call, including failure/cancellation.
        body.body = ""
        body.title = ""
        body.head = ""
        body.base = ""
        del body
