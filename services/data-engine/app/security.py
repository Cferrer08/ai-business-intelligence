from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request


def require_engine_key(request: Request, x_engine_key: str = Header(default="")) -> None:
    """Only the web app may call the engine. Constant-time comparison."""
    expected: str = request.app.state.settings.api_key
    if not x_engine_key or not hmac.compare_digest(x_engine_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Missing or invalid engine key."})
