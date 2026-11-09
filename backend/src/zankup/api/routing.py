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
    "/api/auth/password/forgot",
    "/api/auth/password/reset",
    "/api/auth/google/providers",
    "/api/auth/google/start",
    "/api/auth/google/callback",
    "/api/auth/google/mobile/nonce",
    "/api/auth/google/mobile",
    # Connecting Google Health: a browser redirect; both check the session themselves (OS-603).
    "/api/wellness/google/start",
    "/api/wellness/google/callback",
    # Google Health's notifications, authorised by the subscriber secret and a signature (OS-604).
    "/api/webhooks/google-health",
    # A shared activity (OS-408): anyone with the link.
    "/api/public/shares/{token}",
    "/api/public/shares/{token}/photos/{photo_id}",
    # Uploads and downloads on the API host, authorised by a signed token in the URL (OS-404, OS-411).
    "/api/direct/uploads/{import_id}/{index}",
    "/api/direct/exports/{export_id}",
}


def protected_router(**kwargs: object) -> APIRouter:
    return APIRouter(dependencies=[Depends(current_user)], **kwargs)  # type: ignore[arg-type]
