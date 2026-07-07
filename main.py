"""
Entry point shim — delegates to vscode-extension/server/main.py.

The canonical server lives in vscode-extension/server/ so the VS Code
extension and standalone users share exactly one copy of the code.
Run this file the same way you would run the server directly:

    python main.py
    # or
    uvicorn main:app --host 0.0.0.0 --port 11435
"""
import sys
import os

_SERVER_DIR = os.path.join(os.path.dirname(__file__), "vscode-extension", "server")
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

# Change working directory so relative paths inside the server (e.g. static/)
# resolve correctly, matching what the extension installer does.
os.chdir(_SERVER_DIR)

from main import app  # noqa: F401,E402  re-export for uvicorn

if __name__ == "__main__":
    import uvicorn
    from config import PORT, HOST  # noqa: E402
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
