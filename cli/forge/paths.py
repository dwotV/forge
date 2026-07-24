"""
forge.paths
───────────
Resolves Forge paths, in this priority order:

1. If FORGE_PROJECT_DIR environment variable is defined, it is used as
   the project root (useful in CI or if you run `forge` outside
   the repo).
2. Otherwise, it searches upwards from the current directory until it finds
   docker-compose.yml + the kali/ folder.

From the project root, `.forge/` is derived, which lives
**inside the repo** (e.g. /path/to/forge/.forge/), not in the user's
$HOME. This ensures config, runtime compose and default shared folder
travel along with the project — if you clone the repo on another machine
or move it, everything keeps working by just running `forge` from within.

You can force a different location for `.forge/` with the FORGE_HOME
environment variable (for example, to have multiple Forge instances
sharing the same repo via a git worktree).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

FORGE_DIR_NAME = ".forge"


def find_project_dir() -> Path:
    """Finds the root of the Forge project (docker-compose.yml + kali/)."""
    env_dir = os.environ.get("FORGE_PROJECT_DIR")
    if env_dir:
        p = Path(env_dir).expanduser().resolve()
        if (p / "docker-compose.yml").is_file():
            return p
        raise SystemExit(f"FORGE_PROJECT_DIR ({p}) does not contain docker-compose.yml")

    # 1. Search upwards from current directory (cwd)
    cur = Path.cwd().resolve()
    for candidate in (cur, *cur.parents):
        if (candidate / "docker-compose.yml").is_file() and (candidate / "kali").is_dir():
            return candidate

    # 2. Search upwards from code location (useful if installed with -e)
    script_dir = Path(__file__).resolve().parent
    for candidate in (script_dir, *script_dir.parents):
        if (candidate / "docker-compose.yml").is_file() and (candidate / "kali").is_dir():
            return candidate

    raise SystemExit(
        "Forge repository not found (docker-compose.yml + kali/ folder).\n"
        "Run 'forge' inside the repo, or export FORGE_PROJECT_DIR=/path/to/repo."
    )


@dataclass(frozen=True)
class ForgeContext:
    """Groups all relevant paths for a CLI invocation."""
    project_dir: Path
    forge_home: Path

    @property
    def config_file(self) -> Path:
        return self.forge_home / "config.json"

    @property
    def runtime_compose_file(self) -> Path:
        return self.forge_home / "docker-compose.runtime.yml"

    @property
    def shared_dir(self) -> Path:
        return self.forge_home / "shared"

    @property
    def mcp_venv(self) -> Path:
        return self.forge_home / "mcp-venv"

    @property
    def env_file(self) -> Path:
        return self.project_dir / ".env"


def build_context() -> ForgeContext:
    """Single entry point: locates project and resolves where
    `.forge/` lives (inside repo, unless FORGE_HOME overrides it)."""
    project_dir = find_project_dir()

    env_home = os.environ.get("FORGE_HOME")
    forge_home = Path(env_home).expanduser().resolve() if env_home else project_dir / FORGE_DIR_NAME

    forge_home.mkdir(parents=True, exist_ok=True)
    return ForgeContext(project_dir=project_dir, forge_home=forge_home)


def ensure_gitignore(ctx: ForgeContext) -> None:
    """Adds .forge/ and .env to project's .gitignore if missing,
    to avoid accidentally committing passwords or local state."""
    gitignore = ctx.project_dir / ".gitignore"
    entries_needed = [f"{FORGE_DIR_NAME}/", ".env"]

    existing = gitignore.read_text().splitlines() if gitignore.is_file() else []
    missing = [e for e in entries_needed if e not in existing]
    if not missing:
        return

    with gitignore.open("a") as f:
        if existing and existing[-1] != "":
            f.write("\n")
        f.write("# Added automatically by `forge install`\n")
        for e in missing:
            f.write(f"{e}\n")
