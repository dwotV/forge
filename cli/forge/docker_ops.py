"""
forge.docker_ops
────────────────
All Docker interaction:

  - `docker compose` commands (build / up / stop / down / logs) via
    subprocess, using --project-directory so that relative paths
    in compose (./kali, ./backend, ...) keep working even if the
    runtime file lives in ~/.forge/.
  - Container status and inspection via docker-py SDK (docker),
    more reliable than parsing text from `docker ps`.
  - Attaching an interactive shell to `forge-kali` replacing the
    current process (os.execvp), just like Exegol does.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import docker
from docker.errors import DockerException, NotFound

from .ui import console, log, spinner

SERVICES = ("kali", "backend", "kali-api", "frontend")
CONTAINER_NAMES = {
    "kali": "forge-kali",
    "backend": "forge-backend",
    "kali-api": "forge-kali-api",
    "frontend": "forge-frontend",
}


# ── docker compose (subprocess) ───────────────────────────────────────
def _compose_prefix() -> list[str]:
    if shutil.which("docker"):
        try:
            subprocess.run(
                ["docker", "compose", "version"],
                capture_output=True, check=True,
            )
            return ["docker", "compose"]
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    raise SystemExit(
        "Neither 'docker compose' nor 'docker-compose' was found. Install Docker "
        "Desktop or the Compose plugin before proceeding."
    )


def check_docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def _run_compose(args: list[str], project_dir: Path, compose_file: Path) -> int:
    cmd = _compose_prefix() + [
        "-f", str(compose_file),
        "--project-directory", str(project_dir),
        *args,
    ]
    return subprocess.call(cmd)


def compose_build(project_dir: Path, compose_file: Path, services: list[str] | None = None) -> None:
    log("Building Docker images (may take several minutes)...", "info")
    rc = _run_compose(["build", *(services or [])], project_dir, compose_file)
    if rc != 0:
        raise SystemExit("Image build failed. Check the logs above.")


def compose_up(
    project_dir: Path, compose_file: Path, services: list[str] | None = None
) -> None:
    rc = _run_compose(["up", "-d", *(services or [])], project_dir, compose_file)
    if rc != 0:
        raise SystemExit("Failed to start Forge services.")


def compose_stop(project_dir: Path, compose_file: Path) -> None:
    rc = _run_compose(["stop"], project_dir, compose_file)
    if rc != 0:
        raise SystemExit("Failed to stop Forge properly.")


def compose_down(project_dir: Path, compose_file: Path, volumes: bool = False) -> None:
    args = ["down"]
    if volumes:
        args.append("-v")
    rc = _run_compose(args, project_dir, compose_file)
    if rc != 0:
        raise SystemExit("Failed to destroy Forge environment.")


def compose_logs(project_dir: Path, compose_file: Path, service: str | None = None) -> None:
    args = ["logs", "-f", "--tail", "100"]
    if service:
        args.append(service)
    _run_compose(args, project_dir, compose_file)


# ── docker-py: status and inspection ────────────────────────────────────
def _client() -> docker.DockerClient:
    try:
        return docker.from_env()
    except DockerException as exc:
        raise SystemExit(f"Could not connect to Docker daemon: {exc}")


def container_status(service: str) -> tuple[str, str]:
    """Returns (status, detail) for a Forge service."""
    name = CONTAINER_NAMES[service]
    client = _client()
    try:
        c = client.containers.get(name)
    except NotFound:
        return "not created", "-"
    health = ""
    try:
        health_info = c.attrs.get("State", {}).get("Health", {})
        if health_info:
            health = f"health: {health_info.get('Status', '?')}"
    except Exception:
        pass
    return c.status, health or c.attrs.get("State", {}).get("StartedAt", "")[:19]


def all_status() -> list[tuple[str, str, str]]:
    rows = []
    for svc in SERVICES:
        state, detail = container_status(svc)
        rows.append((CONTAINER_NAMES[svc], state, detail))
    return rows


def wait_healthy(service: str = "kali", timeout: int = 90) -> bool:
    """Waits until the container reaches 'running' state (and healthcheck OK
    if present). Used after `compose up` before attaching the shell."""
    name = CONTAINER_NAMES[service]
    client = _client()
    deadline = time.time() + timeout
    with spinner(f"Waiting for {name} to be ready"):
        while time.time() < deadline:
            try:
                c = client.containers.get(name)
                c.reload()
                health = c.attrs.get("State", {}).get("Health", {}).get("Status")
                if c.status == "running" and health in (None, "healthy"):
                    return True
            except NotFound:
                pass
            time.sleep(1.5)
    return False


# ── interactive shell inside Kali container ──────────────────────
def exec_shell(kali_user: str) -> None:
    """Attaches an interactive shell to the forge-kali container,
    replacing the current process (just like Exegol)."""
    container = CONTAINER_NAMES["kali"]
    cmd = ["docker", "exec", "-it", "-u", kali_user, "-w", f"/home/{kali_user}", container, "zsh"]
    console.print(f"[green][+][/green] Attaching shell to [bold]{container}[/bold] as [bold]{kali_user}[/bold]...\n")
    sys.stdout.flush()
    os.execvp(cmd[0], cmd)  # never returns if successful
