import time
from urllib.parse import urlencode
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from app import github
from app.config import Settings, get_settings
from app.db import get_session
from app.models import GithubConnection, RepoSetting

router = APIRouter(prefix="/integrations/github", tags=["github"])

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[Session, Depends(get_session)]


class Repo(BaseModel):
    full_name: str
    enabled: bool


class GithubStatus(BaseModel):
    """Matches the dashboard's GithubStatus type (plus mode / install_url)."""

    connected: bool
    account: str | None = None
    repos: list[Repo] = []
    mode: str = "none"
    install_url: str | None = None


class RepoPatch(BaseModel):
    full_name: str
    enabled: bool


def _disconnected(s: Settings, install_url: str | None = None) -> GithubStatus:
    return GithubStatus(connected=False, mode=s.github_mode, install_url=install_url)


async def _token(s: Settings, conn: GithubConnection) -> tuple[str, bool]:
    """(token, is_installation) for talking to GitHub as this connection."""
    if conn.mode == "app":
        if not s.app_configured or conn.installation_id is None:
            raise HTTPException(409, "GitHub App is no longer configured on the server.")
        return await github.installation_token(s, conn.installation_id), True
    if conn.mode == "oauth":
        if not conn.access_token:
            raise HTTPException(409, "No GitHub token stored. Connect again.")
        return conn.access_token, False
    if not s.github_token:
        raise HTTPException(409, "GITHUB_TOKEN is no longer set on the server.")
    return s.github_token, False


async def _status(s: Settings, db: Session, conn: GithubConnection) -> GithubStatus:
    token, inst = await _token(s, conn)
    names = await github.list_repos(token, installation=inst)
    enabled = {r.full_name for r in db.exec(select(RepoSetting).where(RepoSetting.enabled)).all()}
    return GithubStatus(
        connected=True,
        account=conn.account,
        repos=[Repo(full_name=n, enabled=n in enabled) for n in sorted(names, key=str.lower)],
        mode=conn.mode,
    )


def _save(
    db: Session, mode: str, account: str, installation_id: int | None = None, access_token: str | None = None
) -> GithubConnection:
    conn = GithubConnection(
        id=1, mode=mode, account=account, installation_id=installation_id, access_token=access_token
    )
    db.merge(conn)
    db.commit()
    return conn


def _sign_state(s: Settings, purpose: str = "gh-install") -> str:
    return jwt.encode({"exp": int(time.time()) + 600, "purpose": purpose}, s.state_secret, algorithm="HS256")


def _check_state(s: Settings, state: str, purpose: str = "gh-install") -> None:
    try:
        claims = jwt.decode(state, s.state_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(400, "Invalid or expired install state. Start the connection again.")
    if claims.get("purpose") != purpose:
        raise HTTPException(400, "Invalid install state.")


@router.get("", response_model=GithubStatus)
async def status(s: SettingsDep, db: SessionDep):
    conn = db.get(GithubConnection, 1)
    if not conn:
        return _disconnected(s)
    try:
        return await _status(s, db, conn)
    except github.GitHubError as e:
        if e.status == 401 and conn.mode == "oauth":
            # The user revoked EquaLink on GitHub: forget the dead token.
            db.exec(delete(GithubConnection))
            db.commit()
            return _disconnected(s)
        raise HTTPException(502, e.message)


@router.post("/connect", response_model=GithubStatus)
async def connect(s: SettingsDep, db: SessionDep):
    if s.github_mode == "none":
        raise HTTPException(
            400, "GitHub isn't configured on the server. Set GITHUB_TOKEN, or the GITHUB_APP_* variables, in server/.env."
        )
    if s.github_mode in ("app", "oauth") and not s.state_secret:
        raise HTTPException(500, "STATE_SECRET is not set in server/.env.")
    try:
        if s.github_mode == "oauth":
            return _disconnected(s, install_url=github.oauth_authorize_url(s, _sign_state(s, "gh-oauth")))
        if s.github_mode == "app":
            url = f"https://github.com/apps/{s.github_app_slug}/installations/new?state={_sign_state(s)}"
            return _disconnected(s, install_url=url)
        conn = _save(db, "pat", await github.pat_user(s.github_token))
        return await _status(s, db, conn)
    except github.GitHubError as e:
        raise HTTPException(502, e.message)


@router.get("/callback")
async def callback(
    s: SettingsDep,
    db: SessionDep,
    installation_id: Annotated[int, Query()],
    state: Annotated[str, Query()],
):
    """GitHub App 'Setup URL': GitHub redirects here after the user installs the app."""
    _check_state(s, state)
    try:
        account = await github.installation_account(s, installation_id)
    except github.GitHubError as e:
        raise HTTPException(502, e.message)
    _save(db, "app", account, installation_id)
    return RedirectResponse(f"{s.frontend_url}/integrations/github?connected=1")


@router.get("/oauth/callback")
async def oauth_callback(
    s: SettingsDep,
    db: SessionDep,
    state: Annotated[str, Query()],
    code: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
):
    """OAuth App callback URL: GitHub redirects here after the user approves (or denies)."""
    _check_state(s, state, "gh-oauth")
    back = f"{s.frontend_url}/integrations/github"
    if error or not code:
        return RedirectResponse(f"{back}?{urlencode({'error': error or 'missing_code'})}")
    try:
        token = await github.exchange_code(s, code)
        account = await github.pat_user(token)  # GET /user works for any user token
    except github.GitHubError as e:
        return RedirectResponse(f"{back}?{urlencode({'error': e.message})}")
    _save(db, "oauth", account, access_token=token)
    return RedirectResponse(f"{back}?connected=1")


@router.delete("", response_model=GithubStatus)
async def disconnect(s: SettingsDep, db: SessionDep):
    db.exec(delete(GithubConnection))
    db.exec(delete(RepoSetting))
    db.commit()
    return _disconnected(s)


@router.patch("/repos", response_model=GithubStatus)
async def set_repo(body: RepoPatch, s: SettingsDep, db: SessionDep):
    conn = db.get(GithubConnection, 1)
    if not conn:
        raise HTTPException(409, "GitHub is not connected.")
    try:
        status_now = await _status(s, db, conn)
    except github.GitHubError as e:
        raise HTTPException(502, e.message)
    if body.full_name not in {r.full_name for r in status_now.repos}:
        raise HTTPException(404, f"{body.full_name} isn't accessible with this connection.")
    db.merge(RepoSetting(full_name=body.full_name, enabled=body.enabled))
    db.commit()
    for r in status_now.repos:
        if r.full_name == body.full_name:
            r.enabled = body.enabled
    return status_now
