import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app import rule_sync
from app.db import fail_orphaned_scans, init_db
from app.routes_github import router as github_router
from app.routes_rule_docs import router as rule_docs_router
from app.routes_scans import router as scans_router
from app.routes_sites import router as sites_router
from app.routes_pull_requests import router as pull_requests_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    fail_orphaned_scans()
    rule_sync.fail_orphaned_syncs()
    task = asyncio.create_task(rule_sync.scheduler())
    yield
    task.cancel()


app = FastAPI(title="EquaLink API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_url],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(github_router)
app.include_router(sites_router)
app.include_router(rule_docs_router)
app.include_router(scans_router)
app.include_router(pull_requests_router)


@app.get("/health")
def health():
    return {"ok": True, "github_mode": get_settings().github_mode}
