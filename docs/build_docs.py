"""Сборка документации: OpenAPI бэкенда + Sphinx в ``frontend_2_0/public/code-docs``.

Запуск из корня репозитория виртуальным окружением бэкенда (``pip install -r docs/requirements.txt``)::

    backend/.venv/Scripts/python docs/build_docs.py

Результат попадает в образ дашборда и доступен на сайте по ``/code-docs/``;
спецификации — ``/code-docs/api/openapi.json`` и ``/code-docs/api/ml_openapi.json``.
Спецификация ML-сервиса (``docs/api/ml_openapi.json``) выгружается из его окружения с torch
и здесь только копируется.
"""

import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = ROOT / "frontend_2_0" / "public" / "code-docs"


def export_openapi() -> None:
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ.setdefault("MOSTRANSPORT_DATA", str(ROOT / "backend" / "data"))
    from app.main import app

    path = DOCS / "api" / "openapi.json"
    path.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OpenAPI: {path.relative_to(ROOT)}")


def build_sphinx() -> None:
    from sphinx.cmd.build import build_main

    if OUT.exists():
        shutil.rmtree(OUT)
    code = build_main(["-b", "html", "-E", "-q", str(DOCS / "sphinx"), str(OUT)])
    if code:
        sys.exit(code)
    shutil.copytree(DOCS / "api", OUT / "api")
    shutil.rmtree(OUT / ".doctrees", ignore_errors=True)
    (OUT / ".buildinfo").unlink(missing_ok=True)
    print(f"Sphinx: {OUT.relative_to(ROOT)}/index.html")


if __name__ == "__main__":
    export_openapi()
    build_sphinx()
