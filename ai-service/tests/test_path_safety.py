"""Tests that validate_path rejects traversal / outside-root / symlink-escape inputs."""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


def _import_main(monkeypatch, data_dir):
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    if "main" in sys.modules:
        del sys.modules["main"]
    import main as _main
    importlib.reload(_main)
    return _main


def test_empty_path_rejected(tmp_data_dir, monkeypatch):
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    with pytest.raises(HTTPException) as excinfo:
        main_mod.validate_path("")
    assert excinfo.value.status_code == 403


def test_traversal_rejected(tmp_data_dir, monkeypatch):
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    with pytest.raises(HTTPException) as excinfo:
        main_mod.validate_path("../../etc/passwd")
    assert excinfo.value.status_code == 403


def test_absolute_outside_root_rejected(tmp_data_dir, monkeypatch):
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    # Use a path on the same volume but outside DATA_DIR — portable (Unix + Windows).
    # ``/etc/passwd`` is unreliable on Windows (Git MSYS may map it under a real file).
    dr = os.path.realpath(str(tmp_data_dir))
    outside = os.path.join(os.path.dirname(dr), f"_tendersense_forbidden_{os.getpid()}.txt")
    with pytest.raises(HTTPException) as excinfo:
        main_mod.validate_path(outside)
    assert excinfo.value.status_code == 403


def test_relative_inside_root_accepted(tmp_data_dir, monkeypatch):
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    inside = Path(tmp_data_dir) / "sample.txt"
    inside.write_text("x")
    resolved = main_mod.validate_path(str(inside))
    assert resolved == os.path.realpath(str(inside))


def test_symlink_escape_rejected(tmp_data_dir, tmp_path, monkeypatch):
    """A symlink inside DATA_DIR whose target resolves outside DATA_ROOT must be rejected."""
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    # Target outside DATA_DIR (portable; avoids relying on /etc/passwd).
    target = tmp_path / "secret_outside_root.txt"
    target.write_text("secret", encoding="utf-8")
    link = Path(tmp_data_dir) / "evil-link"
    try:
        os.symlink(str(target), str(link))
    except OSError as e:
        pytest.skip(f"cannot create symlink: {e}")
    with pytest.raises(HTTPException) as excinfo:
        main_mod.validate_path(str(link))
    assert excinfo.value.status_code == 403


def test_basename_resolution_inside_root(tmp_data_dir, monkeypatch):
    """A bare filename should resolve relative to DATA_DIR, not the cwd."""
    main_mod = _import_main(monkeypatch, tmp_data_dir)
    p = Path(tmp_data_dir) / "doc.pdf"
    p.write_text("ok")
    resolved = main_mod.validate_path("doc.pdf")
    assert resolved == os.path.realpath(str(p))
