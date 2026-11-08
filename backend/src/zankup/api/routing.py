"""Routers. Everything with user data goes on a `protected_router`, which requires a signed-in user;
the only public routes are the health check and sign-in (`PUBLIC_PATHS`, enforced by a test)."""

from fastapi import APIRouter, Depends

from zankup.auth.deps import current_user

PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/login/totp",
    "/api/auth/refresh",
    "/api/auth/passkeys/login/options",
    "/api/auth/passkeys/login",
    "/api/setup",
    "/api/setup/account",
    "/api/setup/totp",
}


def protected_router(**kwargs: object) -> APIRouter:
    return APIRouter(dependencies=[Depends(current_user)], **kwargs)  # type: ignore[arg-type]
