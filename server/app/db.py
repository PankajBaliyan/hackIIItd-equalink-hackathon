from collections.abc import Iterator

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
    cols = {c["name"] for c in inspect(engine()).get_columns("githubconnection")}
    if "access_token" not in cols:
        with engine().begin() as conn:
            conn.execute(text("ALTER TABLE githubconnection ADD COLUMN access_token VARCHAR"))


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
            db.add(EventRow(scan_id=scan.id, payload='{"stage":"failed","type":"info","ts":"","message":"scan failed: server restarted"}'))
        db.commit()
