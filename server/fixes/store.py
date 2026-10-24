"""Persistence for fixes and pull requests, with PostgreSQL row locking in production."""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import JSON, Column, MetaData, String, Table, Text, create_engine, insert, select, update


class Store:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS scans (
                id TEXT PRIMARY KEY, data TEXT NOT NULL, page_html TEXT NOT NULL,
                ship_state TEXT NOT NULL DEFAULT 'idle', shipment TEXT
            )""")
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, scan_id):
        with self.connect() as db:
            row = db.execute("SELECT data, page_html FROM scans WHERE id=?", (scan_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Scan not found.")
        return json.loads(row[0]), row[1]

    def list(self):
        with self.connect() as db:
            rows = db.execute("SELECT data FROM scans").fetchall()
        return sorted((json.loads(row[0])["scan"] for row in rows), key=lambda scan: scan["created_at"], reverse=True)

    def insert(self, data, html, replace_demo=False):
        with self.connect() as db:
            statement = "INSERT OR REPLACE" if replace_demo and data["scan"]["is_demo"] else "INSERT OR IGNORE"
            db.execute(f"{statement} INTO scans(id,data,page_html) VALUES (?,?,?)", (data["scan"]["id"], json.dumps(data), html))

    def review(self, scan_id, fix_id, included):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT data, ship_state FROM scans WHERE id=?", (scan_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Scan not found.")
            if row[1] != "idle":
                raise HTTPException(409, "This scan is already shipping or has a pull request.")
            data = json.loads(row[0])
            fix = next((f for f in data["fixes"] if f["id"] == fix_id), None)
            if fix is None:
                raise HTTPException(404, "Fix not found in this scan.")
            if included and not fix["validated"]:
                raise HTTPException(422, "Only validated fixes can be included.")
            fix["included"] = included
            data["summary"]["included"] = sum(f["included"] for f in data["fixes"])
            db.execute("UPDATE scans SET data=? WHERE id=?", (json.dumps(data), scan_id))
            return data

    def reserve(self, scan_id, shipment):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT ship_state,shipment,data FROM scans WHERE id=?", (scan_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Scan not found.")
            if row[0] == "in_progress":
                raise HTTPException(409, "A pull request is already being created. Refresh before retrying.")
            previous = json.loads(row[1]) if row[1] else None
            if row[0] == "completed":
                raise HTTPException(409, "This scan already has a pull request. Refresh to see it.")
            data = json.loads(row[2])
            eligible = {f["id"] for f in data["fixes"] if f["validated"] and f["included"]}
            if not set(shipment["fix_ids"]).issubset(eligible):
                raise HTTPException(409, "The fix selection changed. Refresh before opening a PR.")
            if previous and previous != shipment:
                raise HTTPException(409, "Retry with the original fix selection; a GitHub operation may already have succeeded.")
            db.execute("UPDATE scans SET ship_state='in_progress',shipment=? WHERE id=?", (json.dumps(shipment), scan_id))

    def finish(self, scan_id, pr=None, clear_shipment=False):
        with self.connect() as db:
            if pr:
                data = json.loads(db.execute("SELECT data FROM scans WHERE id=?", (scan_id,)).fetchone()[0])
                data["pr"] = pr
                db.execute("UPDATE scans SET data=?,ship_state='completed' WHERE id=?", (json.dumps(data), scan_id))
            else:
                db.execute("UPDATE scans SET ship_state='idle' WHERE id=?", (scan_id,))
                if clear_shipment:
                    db.execute("UPDATE scans SET shipment=NULL WHERE id=?", (scan_id,))

    def setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (key, json.dumps(value)))


class PostgresStore:
    """PostgreSQL store shared by the Fixes and Pull Requests APIs."""

    def __init__(self, url: str):
        self.engine = create_engine(url, pool_pre_ping=True)
        metadata = MetaData()
        self.scans = Table(
            "fix_scans",
            metadata,
            Column("id", String(100), primary_key=True),
            Column("data", JSON, nullable=False),
            Column("page_html", Text, nullable=False),
            Column("ship_state", String(20), nullable=False, default="idle"),
            Column("shipment", JSON),
        )
        self.settings = Table(
            "fix_settings",
            metadata,
            Column("key", String(255), primary_key=True),
            Column("value", JSON, nullable=False),
        )
        metadata.create_all(self.engine)

    def get(self, scan_id):
        with self.engine.connect() as db:
            row = db.execute(
                select(self.scans.c.data, self.scans.c.page_html).where(self.scans.c.id == scan_id)
            ).first()
        if row is None:
            raise HTTPException(404, "Scan not found.")
        return row.data, row.page_html

    def list(self):
        with self.engine.connect() as db:
            rows = db.execute(select(self.scans.c.data)).all()
        return sorted((row.data["scan"] for row in rows), key=lambda scan: scan["created_at"], reverse=True)

    def insert(self, data, html, replace_demo=False):
        scan_id = data["scan"]["id"]
        with self.engine.begin() as db:
            exists = db.execute(select(self.scans.c.id).where(self.scans.c.id == scan_id)).first()
            if exists and replace_demo and data["scan"]["is_demo"]:
                db.execute(
                    update(self.scans)
                    .where(self.scans.c.id == scan_id)
                    .values(data=data, page_html=html, ship_state="idle", shipment=None)
                )
            elif not exists:
                db.execute(insert(self.scans).values(id=scan_id, data=data, page_html=html, ship_state="idle"))

    def _locked(self, db, scan_id):
        row = db.execute(select(self.scans).where(self.scans.c.id == scan_id).with_for_update()).mappings().first()
        if row is None:
            raise HTTPException(404, "Scan not found.")
        return row

    def review(self, scan_id, fix_id, included):
        with self.engine.begin() as db:
            row = self._locked(db, scan_id)
            if row["ship_state"] != "idle":
                raise HTTPException(409, "This scan is already shipping or has a pull request.")
            data = row["data"]
            fix = next((item for item in data["fixes"] if item["id"] == fix_id), None)
            if fix is None:
                raise HTTPException(404, "Fix not found in this scan.")
            if included and not fix["validated"]:
                raise HTTPException(422, "Only validated fixes can be included.")
            fix["included"] = included
            data["summary"]["included"] = sum(item["included"] for item in data["fixes"])
            db.execute(update(self.scans).where(self.scans.c.id == scan_id).values(data=data))
            return data

    def reserve(self, scan_id, shipment):
        with self.engine.begin() as db:
            row = self._locked(db, scan_id)
            if row["ship_state"] == "in_progress":
                raise HTTPException(409, "A pull request is already being created. Refresh before retrying.")
            if row["ship_state"] == "completed":
                raise HTTPException(409, "This scan already has a pull request. Refresh to see it.")
            eligible = {
                item["id"] for item in row["data"]["fixes"] if item["validated"] and item["included"]
            }
            if not set(shipment["fix_ids"]).issubset(eligible):
                raise HTTPException(409, "The fix selection changed. Refresh before opening a PR.")
            if row["shipment"] and row["shipment"] != shipment:
                raise HTTPException(409, "Retry with the original fix selection; a GitHub operation may already have succeeded.")
            db.execute(
                update(self.scans)
                .where(self.scans.c.id == scan_id)
                .values(ship_state="in_progress", shipment=shipment)
            )

    def finish(self, scan_id, pr=None, clear_shipment=False):
        with self.engine.begin() as db:
            row = self._locked(db, scan_id)
            if pr:
                data = row["data"]
                data["pr"] = pr
                db.execute(
                    update(self.scans)
                    .where(self.scans.c.id == scan_id)
                    .values(data=data, ship_state="completed")
                )
            else:
                values = {"ship_state": "idle"}
                if clear_shipment:
                    values["shipment"] = None
                db.execute(update(self.scans).where(self.scans.c.id == scan_id).values(**values))

    def setting(self, key, default=None):
        with self.engine.connect() as db:
            row = db.execute(select(self.settings.c.value).where(self.settings.c.key == key)).first()
        return row.value if row else default

    def set_setting(self, key, value):
        with self.engine.begin() as db:
            exists = db.execute(select(self.settings.c.key).where(self.settings.c.key == key)).first()
            if exists:
                db.execute(update(self.settings).where(self.settings.c.key == key).values(value=value))
            else:
                db.execute(insert(self.settings).values(key=key, value=value))


def open_store(target: str):
    return PostgresStore(target) if target.startswith(("postgresql://", "postgresql+")) else Store(target)
