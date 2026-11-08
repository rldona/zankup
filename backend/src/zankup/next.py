"""Where to go after signing in: only paths inside the app, never another site."""


def safe_next(path: str | None) -> str:
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path or "://" in path:
        return "/"
    return path
