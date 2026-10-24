import re
from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import Site

router = APIRouter(prefix="/sites", tags=["sites"])
SessionDep = Annotated[Session, Depends(get_session)]
REPO_RE = re.compile(r"^[\w.-]+/[\w.-]+$")


class SiteOut(BaseModel):
    id: int
    url: str
    host: str
    repo: str | None
    created_at: datetime


class SiteIn(BaseModel):
    url: str
    repo: str | None = None


def normalize_url(raw: str) -> str:
    """http(s) URL with a real host; bare domains get https://. Fragment dropped, trailing slash on root kept."""
    v = raw.strip()
    if not v or re.search(r"\s", v):
        raise HTTPException(422, "Enter a valid URL.")
    if "://" not in v:
        v = f"https://{v}"
    parts = urlsplit(v)
    host = parts.hostname or ""
    if parts.scheme not in ("http", "https") or not ("." in host or host == "localhost"):
        raise HTTPException(422, "Only full http(s) addresses can be added, e.g. https://shop.example.com.")
    return parts._replace(fragment="").geturl()


def _out(s: Site) -> SiteOut:
    return SiteOut(id=s.id, url=s.url, host=s.host, repo=s.repo, created_at=s.created_at)  # type: ignore[arg-type]


@router.get("", response_model=list[SiteOut])
def list_sites(db: SessionDep):
    return [_out(s) for s in db.exec(select(Site).order_by(Site.created_at.desc())).all()]  # type: ignore[attr-defined]


@router.post("", response_model=SiteOut, status_code=201)
def add_site(body: SiteIn, db: SessionDep):
    url = normalize_url(body.url)
    repo = (body.repo or "").strip() or None
    if repo and not REPO_RE.match(repo):
        raise HTTPException(422, "Repository must look like owner/repo.")
    if db.exec(select(Site).where(Site.url == url)).first():
        raise HTTPException(409, "That site is already added.")
    site = Site(url=url, host=(urlsplit(url).hostname or url).removeprefix("www."), repo=repo)
    db.add(site)
    db.commit()
    db.refresh(site)
    return _out(site)


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: int, db: SessionDep):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site not found.")
    db.delete(site)
    db.commit()
