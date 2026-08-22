"""Cross-platform file lock for atomic CLI config writes.

Two concurrent `df init` invocations could otherwise truncate each other's
YAML output. We open an OS-level lock against a sibling `*.lock` file; the
process either gets the lock instantly or waits up to `timeout_s` before
giving up.

The implementation is deliberately minimal:

- POSIX (Linux + macOS) → `fcntl.flock`
- Windows → `msvcrt.locking`

The lock file is intentionally separate from the config file so a stale
lock file from a crashed previous process can be cleaned up by `df doctor`
without touching the actual config.
"""

from __future__ import annotations

import contextlib
import errno
import os
import time
from pathlib import Path
from typing import Iterator

LOCK_SUFFIX = ".lock"


def lock_path(config_path: Path) -> Path:
    """Resolve the lockfile path for a given config file."""

    return config_path.with_name(config_path.name + LOCK_SUFFIX)


class LockAcquisitionError(RuntimeError):
    """Raised when the lock cannot be acquired within `timeout_s`."""


@contextlib.contextmanager
def config_lock(config_path: Path, *, timeout_s: float = 5.0) -> Iterator[None]:
    """Acquire an exclusive lock on the config file for the duration of the block.

    Raises `LockAcquisitionError` if the lock cannot be acquired before the
    timeout elapses. The context manager releases the lock on exit, even
    if the block raises.
    """

    path = lock_path(config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Open in append mode so the file exists but stays empty.
    fd = os.open(str(path), os.O_CREAT | os.O_RDWR, 0o600)
    start = time.monotonic()
    try:
        _acquire(fd, timeout_s, start)
        yield
    finally:
        try:
            _release(fd)
        finally:
            os.close(fd)


def _acquire(fd: int, timeout_s: float, started: float) -> None:
    if os.name == "nt":
        _acquire_windows(fd, timeout_s, started)
    else:
        _acquire_posix(fd, timeout_s, started)


def _release(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
    else:
        import fcntl

        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass


def _acquire_windows(fd: int, timeout_s: float, started: float) -> None:
    import msvcrt

    # msvcrt.locking blocks the thread. Poll for the timeout with sleep.
    while True:
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return
        except OSError as exc:
            if exc.errno not in (errno.EAGAIN, errno.EACCES, errno.EDEADLK):
                raise LockAcquisitionError(f"msvcrt.locking failed: {exc}") from exc
            if time.monotonic() - started >= timeout_s:
                raise LockAcquisitionError(
                    f"could not lock config within {timeout_s:.1f}s"
                ) from exc
            time.sleep(0.05)


def _acquire_posix(fd: int, timeout_s: float, started: float) -> None:
    import fcntl

    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except OSError as exc:
            if exc.errno not in (errno.EWOULDBLOCK, errno.EAGAIN):
                raise LockAcquisitionError(f"fcntl.flock failed: {exc}") from exc
            if time.monotonic() - started >= timeout_s:
                raise LockAcquisitionError(
                    f"could not lock config within {timeout_s:.1f}s"
                ) from exc
            time.sleep(0.05)


__all__ = ["LockAcquisitionError", "config_lock", "lock_path"]