"""Shared helpers for direct mode tests."""

import os
import sys


def to_hex(addr_bytes):
    """Convert address bytes to checksummed hex matching contract output."""
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    from genlayer.py.types import Address

    return Address(addr_bytes).as_hex


# genlayer-test's direct-mode loader writes the encoded message to a temp file,
# dup2's it onto fd 0 (stdin), then tries os.unlink(path) while fd 0 still
# references it. On Windows that raises PermissionError. Tolerate it so the
# suite runs on Windows.
if sys.platform == "win32":
    _orig_unlink = os.unlink

    def _tolerant_unlink(path, *args, **kwargs):
        try:
            _orig_unlink(path, *args, **kwargs)
        except PermissionError:
            pass

    os.unlink = _tolerant_unlink
