"""Errors whose message is safe to show to the user. Anything else is logged and hidden."""
from __future__ import annotations


class EngineError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class InvalidFile(EngineError):
    status_code = 422


class LimitExceeded(EngineError):
    status_code = 413
