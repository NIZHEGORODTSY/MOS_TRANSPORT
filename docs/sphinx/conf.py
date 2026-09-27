"""Конфигурация Sphinx: документация по коду бэкенда, NDTP-стека и ML-ядра.

Сборка — ``python docs/build_docs.py`` из корня репозитория.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# backend: пакеты app, ndtp, tools; ml_service: пакет ml
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "ml_service")]
# справочники датасета, которые app.main читает при импорте
os.environ.setdefault("MOSTRANSPORT_DATA", str(ROOT / "backend" / "data"))
os.environ.setdefault("ML_DATA_DIR", str(ROOT / "ml_data"))

project = "МосТранспорт"
author = "Команда МосТранспорт"
copyright = "2026, " + author
release = "1.0.0"
language = "ru"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "myst_parser",
]
source_suffix = {".rst": "restructuredtext", ".md": "markdown"}
myst_enable_extensions = ["colon_fence"]
myst_heading_anchors = 3

# тяжёлые ML-зависимости не нужны для сборки документации
autodoc_mock_imports = ["torch", "catboost", "sklearn"]
autodoc_default_options = {"members": True, "undoc-members": True, "member-order": "bysource"}
autodoc_typehints = "description"

html_theme = "furo"
html_title = "МосТранспорт — документация"
html_static_path = []
suppress_warnings = ["myst.header", "myst.xref_missing"]
