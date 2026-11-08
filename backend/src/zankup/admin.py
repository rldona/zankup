"""Account administration from the server's shell, for emergencies: the account is created at /setup
(OS-221) and recovered by e-mail (OS-222). On Railway, through `railway ssh`, use /app/.venv/bin/python.

    python -m zankup.admin set-password      # asks for the password twice (alias: reset-password)
    python -m zankup.admin enable-totp       # shows the key for the authenticator app, asks for a code
    python -m zankup.admin sessions          # lists signed-in devices
    python -m zankup.admin sign-out-all      # ends every session

They act on the owner account (OWNER_EMAIL until sign-up sets the real one; --email to change it).
"""

from __future__ import annotations

import argparse
import getpass
import sys
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.auth.security import (
    encrypt_totp_secret,
    hash_password,
    new_totp_secret,
    totp_uri,
    verify_totp,
)
from zankup.core.config import get_settings
from zankup.db.models import Device, User
from zankup.db.session import get_engine
from zankup.users import ensure_owner

MIN_PASSWORD = 12


class AdminError(ValueError):
    pass


def set_password(session: Session, user: User, password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise AdminError(f"The password must have at least {MIN_PASSWORD} characters")
    user.password_hash = hash_password(password)
    session.execute(delete(Device).where(Device.user_id == user.id))  # changing it signs everyone out


def enable_totp(user: User, secret: str, code: str, jwt_secret: str | None) -> None:
    """Turn on TOTP after checking a code from the app, so a mistyped key never locks you out."""
    counter = verify_totp(secret, code, None)
    if counter is None:
        raise AdminError("That code does not match: check the key in your authenticator app and the clock")
    user.totp_secret_enc = encrypt_totp_secret(secret, jwt_secret)
    user.totp_enabled_at = datetime.now(UTC)
    user.totp_last_counter = counter


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m zankup.admin", description=__doc__.splitlines()[0])
    parser.add_argument(
        "command", choices=["set-password", "reset-password", "enable-totp", "sessions", "sign-out-all"]
    )
    parser.add_argument("--email", help="change the owner account's e-mail")
    args = parser.parse_args(argv)
    settings = get_settings()
    jwt_secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else None
    sessions = sessionmaker(get_engine(), expire_on_commit=False)

    try:
        with sessions.begin() as session:
            user = ensure_owner(session, settings.owner_email)
            if args.email:
                user.email = args.email.strip().lower()
            if args.command in ("set-password", "reset-password"):
                password = getpass.getpass("New password: ")
                if password != getpass.getpass("Repeat it: "):
                    raise AdminError("The passwords do not match")
                set_password(session, user, password)
                print(f"Password set for {user.email}. Every session was signed out.")
            elif args.command == "enable-totp":
                secret = new_totp_secret()
                print("Add this account to your authenticator app (Google Authenticator, 1Password, Aegis…):")
                print(f"  Key: {secret}\n  Or open: {totp_uri(secret, user.email)}")
                enable_totp(user, secret, input("Code shown by the app: "), jwt_secret)
                print("Two-factor authentication is on.")
            elif args.command == "sessions":
                for device in session.scalars(select(Device).where(Device.user_id == user.id)):
                    print(
                        f"{device.id:>4}  {device.platform:<8} {device.name:<30} last seen {device.last_seen}"
                    )
            else:
                session.execute(delete(Device).where(Device.user_id == user.id))
                print("Every session was signed out.")
    except AdminError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
