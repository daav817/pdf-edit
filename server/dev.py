"""Run the API with auto-reload for local development (port 8750).

Sign-in is skipped unless JWT_SECRET is set, so the app works without
energia-app running. Set JWT_SECRET and ENERGIA_APP_URL to test real sign-in.
"""

import os

import uvicorn

if __name__ == "__main__":
    if not os.environ.get("JWT_SECRET"):
        os.environ.setdefault("AUTH_DISABLED", "1")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8750, reload=True, reload_dirs=["app"])
