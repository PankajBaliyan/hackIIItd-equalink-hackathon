import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app import rule_sync
from app.db import fail_orphaned_scans, init_db
from app.routes_github import router as github_router
from app.routes_rule_docs import router as rule_docs_router
from app.routes_scans import router as scans_router
from app.routes_settings import router as settings_router
from app.routes_sites import router as sites_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    fail_orphaned_scans()
    rule_sync.fail_orphaned_syncs()
    task = asyncio.create_task(rule_sync.scheduler())
    yield
    task.cancel()


app = FastAPI(title="EquaLink API", lifespan=lifespan)

cors_origins = {
    get_settings().frontend_url,
    *(
        value.strip()
        for value in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
        ).split(",")
        if value.strip()
    ),
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(cors_origins),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(github_router)
app.include_router(sites_router)
app.include_router(rule_docs_router)
app.include_router(scans_router)
app.include_router(settings_router)

# The Fixes workflow is isolated as a sub-application. Routers above take
# precedence for shared paths such as /integrations/github and /health.
try:
    from fixes.main import app as fixes_app
except ImportError:  # Imported as server.app.main from the repository root.
    from server.fixes.main import app as fixes_app


@app.get("/health")
def health():
    s = get_settings()
    return {
        "ok": True, "github_mode": s.github_mode, "openai": bool(s.openai_api_key),
        "tinyfish": bool(s.tinyfish_api_key), "scan_engine": s.scan_engine,
    }


# Mounted last so every router above (and /health, /settings) wins; anything else goes to the Fixes service.
app.mount("/", fixes_app)
