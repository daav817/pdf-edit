"""Sign-in with energia-app accounts.

energia-app issues HS256 JWTs (claims: sub, org, role, optional
must_change_password). pdf-edit verifies them with the same JWT_SECRET, so
staff use their existing account and pdf-edit stores no passwords.

The login form posts to /api/auth/login here; this server forwards the
credentials to energia-app's /api/v1/login and keeps the returned token in an
HttpOnly cookie on pdf-edit's own host.

Settings (environment):
  JWT_SECRET       same value as energia-app (required unless AUTH_DISABLED)
  ENERGIA_APP_URL  energia-app base URL, e.g. http://energia-app.energia.svc
  AUTH_DISABLED=1  local development only: skip sign-in
  COOKIE_SECURE=1  mark the session cookie Secure (behind HTTPS)
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request, Response

SESSION_COOKIE = "pdfedit_session"


@dataclass
class User:
    id: str
    org: str
    role: str


def auth_disabled() -> bool:
    return os.environ.get("AUTH_DISABLED") == "1"


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET", "").strip()
    if not secret:
        raise HTTPException(500, "Server misconfigured: JWT_SECRET is not set.")
    return secret


def verify_token(token: str) -> User:
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=["HS256"],
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session. Sign in again.")
    if claims.get("must_change_password") is True:
        raise HTTPException(403, "Set a new password in energia-app first.")
    return User(id=str(claims["sub"]), org=str(claims.get("org", "")), role=str(claims.get("role", "")))


def _token_from(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(SESSION_COOKIE)


def session_token(request: Request) -> str | None:
    """The signed-in user's energia-app token (for calls to energia-app on their behalf)."""
    return _token_from(request)


def require_user(request: Request) -> User:
    """FastAPI dependency for every protected route."""
    if auth_disabled():
        return User(id="dev", org="dev", role="dev")
    token = _token_from(request)
    if not token:
        raise HTTPException(401, "Sign in required.")
    return verify_token(token)


def login(email: str, password: str, response: Response) -> dict:
    base = os.environ.get("ENERGIA_APP_URL", "").rstrip("/")
    if not base:
        raise HTTPException(500, "Server misconfigured: ENERGIA_APP_URL is not set.")
    req = urllib.request.Request(
        f"{base}/api/v1/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            body = json.load(res)
    except urllib.error.HTTPError as err:
        try:
            message = json.load(err).get("error")
        except Exception:
            message = None
        raise HTTPException(err.code if err.code in (400, 401, 403) else 502, message or "Sign-in failed.")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, "Could not reach energia-app to sign in.")

    token = body.get("token")
    if not token:
        raise HTTPException(502, "energia-app returned no session.")
    verify_token(token)  # rejects tokens signed with a different secret
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("COOKIE_SECURE") == "1",
        path="/",
    )
    return {"user": body.get("user")}


def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
