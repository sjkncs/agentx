#!/usr/bin/env python3
"""
Sandbox bootstrap script — injected before every user cell.

This module is copied into the Docker image at /usr/local/bin/sandbox-bootstrap.py
and prepended to every cell source. It must be self-contained (no external imports
beyond the Python stdlib) so it cannot be blocked by the import hook itself.

It sets up:
  1. A minimal sys.path (stdlib + frozen venv site-packages only)
  2. The import hook blocklist
  3. Disabled dangerous builtins
  4. Output capture
  5. A result sentinel printed to stdout on completion

Usage (inside the container):
  python /usr/local/bin/sandbox-bootstrap.py "<escaped-user-source>"
"""
import sys
import json
import os

MAX_OUTPUT_BYTES = int(os.environ.get("DF_SANDBOX_MAX_OUTPUT", "1048576"))

# ── Minimal sys.path ──────────────────────────────────────────────────────────
# Only the stdlib and the frozen venv site-packages are accessible.
_prefix = getattr(sys, "real_prefix", getattr(sys, "base_prefix", sys.prefix))
_version = f"{sys.version_info.major}.{sys.version_info.minor}"
_stdlib = sys.base_prefix + f"/lib/python{_version}"
_venv = _prefix + f"/lib/python{_version}/site-packages"
sys.path[:] = [_stdlib, _venv]
# Remove cwd from path
sys.path.remove("") if "" in sys.path else None
# Ensure no PYTHONPATH leak
os.environ.pop("PYTHONPATH", None)

# ── Import blocklist ──────────────────────────────────────────────────────────
# Block top-level modules AND all their submodules to prevent bypass via
# import os.path; os.path.exists(...).
# Each entry covers the module and every sub-module under it.
_BLOCKED = {
    # Process & execution
    "subprocess", "os",
    # System information & capabilities
    "sys", "platform", "resource", "pwd", "grp",
    "ctypes", "fcntl", "termios", "tty",
    # Network
    "socket", "urllib", "urllib.request", "urllib.error", "urllib.parse",
    "urllib3", "http", "http.client", "http.server", "wsgiref",
    "ftplib", "telnetlib", "smtplib", "poplib", "imaplib", "nntplib",
    "asyncio", "aiohttp", "httpx", "requests", "chardet",
    # Serialisation & code execution
    "pickle", "marshal", "shelve", "configparser", "plistlib",
    "code", "codeop", "dis", "traceback", "inspect", "ast",
    # Filesystem
    "glob", "fnmatch", "pathlib", "tempfile", "shutil",
    "zipfile", "tarfile", "crypt",
    # Security & crypto
    "keyring", "secretstorage", "cryptography", "ssl", "hashlib",
    # Import machinery
    "importlib", "pkgutil", "modulefinder",
    # FFI / interop (escape vectors)
    "jnius", "pythonnet", "_ctypes", "_socket",
}

_orig_import = __builtins__.__import__
_blocked_hits = []

def _sandbox_import(name, *args, **kwargs):
    # Block the exact module and every sub-module.
    # e.g. "os.path", "os.path.abspath" all match "os".
    if name in _BLOCKED or any(name.startswith(b + ".") for b in _BLOCKED):
        _blocked_hits.append(name)
        raise ImportError(
            f"Sandbox: import of '{name}' is blocked for security reasons."
        )
    return _orig_import(name, *args, **kwargs)

__builtins__.__import__ = _sandbox_import

# ── Disable dangerous builtins ────────────────────────────────────────────────
# Collect all names that let a user read/write Python internals or execute code.
_DANGEROUS_BUILTINS = {
    # Code execution
    "compile", "exec", "eval", "__import__",
    # I/O
    "open", "input",
    # Dynamic code generation / reload
    "reload",
    # Debug (interactive debugger)
    "breakpoint",
    # Memory introspection / manipulation
    "memoryview",
    # Object introspection — lets user read/write any attribute including __builtins__
    "getattr", "setattr", "delattr", "hasattr",
    # namespace introspection
    "vars", "dir", "type", "object", "super",
    "property", "classmethod", "staticmethod",
    # Iterator introspection
    "enumerate", "zip", "map", "filter",
    "iter", "next",
    # Callable inspection
    "callable",
    # Descriptor protocol access
    "__getattribute__", "__setattr__", "__delattr__",
    # Module-level globals access
    "globals", "locals",
    # trace functions (sys.settrace equivalent)
    "settrace",
    # help() traverses sys.modules
    "help",
}

_bu = __builtins__ if isinstance(__builtins__, dict) else vars(__builtins__)
for _name in _DANGEROUS_BUILTINS:
    if _name in _bu:
        _bu[_name] = None  # Replace with no-op

# ── Output capture ────────────────────────────────────────────────────────────
class _Capture:
    __slots__ = ("_buf", "_bytes", "_fd")
    def __init__(self, fd):
        self._buf = []
        self._bytes = 0
        self._fd = fd
    def write(self, s):
        if self._bytes >= MAX_OUTPUT_BYTES:
            return
        b = s.encode("utf-8", errors="replace")
        rem = MAX_OUTPUT_BYTES - self._bytes
        if len(b) > rem:
            b = b[:rem]
        self._buf.append(b)
        self._bytes += len(b)
    def get(self):
        return b"".join(self._buf).decode("utf-8", errors="replace")

_stdout_buf = _Capture(sys.stdout)
_stderr_buf = _Capture(sys.stderr)
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf

# ── Harden sys module against __stdout__/__stderr__ bypass ───────────────────
# Users can call sys.__stdout__.write(...) to bypass our _Capture wrapper.
# Patch the backup references so all fd accessors funnel through the capture.
class _SealedOutput:
    __slots__ = ("_cap",)
    def __init__(self, cap): object.__setattr__(self, "_cap", cap)
    def write(self, s): self._cap.write(s)
    def flush(self): pass
    def fileno(self): return self._cap._fd.fileno()
    def isatty(self): return False

sys.__stdout__ = _SealedOutput(_stdout_buf)
sys.__stderr__ = _SealedOutput(_stderr_buf)
# Patch the live references too (in case user holds old refs)
sys.stdout.__class__ = _SealedOutput
sys.stderr.__class__ = _SealedOutput
object.__setattr__(sys.stdout, "_cap", _stdout_buf)
object.__setattr__(sys.stderr, "_cap", _stderr_buf)

# ── Run user source ────────────────────────────────────────────────────────────
_status = 0
_error = None

if __name__ == "__main__":
    # Source is passed as argument to avoid exec/file issues
    _source = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        compile(_source, "<cell>", "exec")
        exec(compile(_source, "<cell>", "exec"), {"__name__": "__main__"})
    except SystemExit as _e:
        _status = _e.code if isinstance(_e.code, int) else 1
        _error = str(_e)
    except Exception as _e:
        _status = 1
        _error = f"{type(_e).__name__}: {_e}"
    finally:
        # Restore stdout and print result sentinel
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        _result = {
            "status": _status,
            "error": _error,
            "blockedImports": _blocked_hits,
            "stdout": _stdout_buf.get(),
            "stderr": _stderr_buf.get(),
        }
        print(
            "\x00SBOX_RESULT:" + json.dumps(_result) + "\x00",
            end="",
            file=sys.__stdout__,
        )
