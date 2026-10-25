import json
from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import get_settings

_engine = None


def engine():
    global _engine
    if _engine is None:
        url = get_settings().database_url
        args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, connect_args=args)
    return _engine


def init_db() -> None:
    SQLModel.metadata.create_all(engine())
    # create_all never alters existing tables; add columns introduced after the first release.
    insp = inspect(engine())
    cols = {c["name"] for c in insp.get_columns("githubconnection")}
    if "access_token" not in cols:
        with engine().begin() as conn:
            conn.execute(text("ALTER TABLE githubconnection ADD COLUMN access_token VARCHAR"))
    if "engine" not in {c["name"] for c in insp.get_columns("scan")}:
        with engine().begin() as conn:
            conn.execute(text("ALTER TABLE scan ADD COLUMN engine VARCHAR NOT NULL DEFAULT 'local'"))
    issue_cols = {c["name"] for c in insp.get_columns("issue")}
    for name, ddl in (
        ("rule_doc_id", "INTEGER"),
        ("detector", "VARCHAR NOT NULL DEFAULT 'axe'"),
        ("source_file", "VARCHAR"),
        ("source_line", "INTEGER"),
        ("box", "VARCHAR"),
    ):
        if name not in issue_cols:
            with engine().begin() as conn:
                conn.execute(text(f"ALTER TABLE issue ADD COLUMN {name} {ddl}"))
    if "included" not in {c["name"] for c in insp.get_columns("fix")}:
        with engine().begin() as conn:
            conn.execute(text("ALTER TABLE fix ADD COLUMN included BOOLEAN NOT NULL DEFAULT 1"))
    if "origin" not in {c["name"] for c in insp.get_columns("ruledoc")}:
        with engine().begin() as conn:
            conn.execute(text("ALTER TABLE ruledoc ADD COLUMN origin VARCHAR NOT NULL DEFAULT 'manual'"))


def get_session() -> Iterator[Session]:
    with Session(engine()) as session:
        yield session


def fail_orphaned_scans() -> None:
    """A scan still running when the server stopped will never finish: mark it failed."""
    from app.models import EventRow, Scan  # local import: models import nothing from here

    with Session(engine()) as db:
        for scan in db.exec(select(Scan).where(Scan.status.notin_(["done", "failed"]))).all():  # type: ignore[attr-defined]
            scan.status, scan.error = "failed", "Server restarted during the scan."
            db.add(scan)
            ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            db.add(EventRow(scan_id=scan.id, payload=json.dumps({"stage": "failed", "type": "info", "ts": ts, "message": "scan failed: server restarted"})))
        db.commit()
