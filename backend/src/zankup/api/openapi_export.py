"""Write the API's OpenAPI document, the source of the typed client in packages/core.

Usage: uv run python -m zankup.api.openapi_export [path]   (default: packages/core/src/api/openapi.json)
"""

import json
import sys
from pathlib import Path

from zankup.api.main import app

DEFAULT = Path(__file__).resolve().parents[4] / "packages/core/src/api/openapi.json"


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    target.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OpenAPI written to {target}")


if __name__ == "__main__":
    main()
