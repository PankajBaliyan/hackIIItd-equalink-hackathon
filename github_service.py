"""Compatibility imports for the Fixes module's standalone GitHub helper."""

from server.fixes.github_service import BASE_URL, create_accessibility_pr, encode_to_base64

__all__ = ["BASE_URL", "create_accessibility_pr", "encode_to_base64"]
