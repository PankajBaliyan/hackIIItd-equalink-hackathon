import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, delete

from app import app_settings
from app.config import Settings, get_settings
from app.db import get_session
from app.models import AppSetting

router = APIRouter(prefix="/settings", tags=["settings"])
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class SettingsPatch(BaseModel):
    """Send only what changes. A value of null puts that setting back to the server default."""

    default_level: str | None = None
    default_scope: str | None = None
    max_site_pages: int | None = None
    fix_max: int | None = None
    openai_model: str | None = None
    min_severity: str | None = None
    disabled_rules: list[str] | str | None = None
    ai_review: bool | None = None
    ai_fixes: bool | None = None


@router.get("")
def get_all(db: SessionDep, base: SettingsDep):
    return app_settings.describe(base, db)


@router.patch("")
def update(body: SettingsPatch, db: SessionDep, base: SettingsDep):
    changes = {k: getattr(body, k) for k in body.model_fields_set}
    clean: dict[str, object] = {}
    for key, value in changes.items():
        if value is None:
            continue
        try:
            clean[key] = app_settings.EDITABLE[key](value)
        except ValueError as e:
            raise HTTPException(422, f"{key.replace('_', ' ')} {e}")
    for key, value in changes.items():
        if value is None:
            row = db.get(AppSetting, key)
            if row:
                db.delete(row)
        else:
            db.merge(AppSetting(key=key, value=json.dumps(clean[key])))
    db.commit()
    return app_settings.describe(base, db)


@router.delete("")
def reset(db: SessionDep, base: SettingsDep):
    """Put every setting back to the server default."""
    db.exec(delete(AppSetting))
    db.commit()
    return app_settings.describe(base, db)
