from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

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


def get_session() -> Iterator[Session]:
    with Session(engine()) as session:
        yield session
