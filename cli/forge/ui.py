"""
forge.ui
────────
Everything related to terminal presentation: colors, Exegol-style
prefixes ([*] [+] [-] [!] [?]), ASCII banner, spinners, and progress
bars. The rest of the CLI never prints directly: it always goes through
here to maintain a consistent visual identity.
"""

from __future__ import annotations

import contextlib
import time
from typing import Callable, Iterable, Iterator

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table
from rich.text import Text

console = Console()

# ── Level palette (symbol, color) — inspired by Exegol ─────────
_LEVELS: dict[str, tuple[str, str]] = {
    "info":    ("*", "cyan"),
    "ok":      ("+", "green"),
    "warn":    ("!", "yellow"),
    "error":   ("!", "red"),
    "ask":     ("?", "magenta"),
    "debug":   ("D", "grey50"),
}

BANNER = r"""[bold green]
█▀▀ █▀█ █▀█ █▀▀ █▀▀
█▀░ █▄█ █▀▄ █▄█ ██▄
[/bold green][grey50]      CLI — hacking environment manager[/grey50]
"""


def banner() -> None:
    console.print(BANNER)


def log(msg: str, level: str = "info") -> None:
    """Prints a message with the [*]/[+]/[!]/[?] prefix like Exegol."""
    symbol, color = _LEVELS.get(level, _LEVELS["info"])
    console.print(f"[{color}][{symbol}][/{color}] {msg}")


def rule(title: str = "") -> None:
    console.rule(f"[bold green]{title}[/bold green]" if title else "", style="green")


def panel(body: str, title: str = "", style: str = "green") -> None:
    console.print(Panel.fit(body, title=title, border_style=style))


def confirm(question: str, default: bool = False) -> bool:
    suffix = r"\[Y/n]" if default else r"\[y/N]"
    while True:
        raw = console.input(f"[magenta][?][/magenta] {question} {suffix} ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        console.print("  answer 'y' or 'n'.")


# ── Discrete steps progress bar (installation, config generation) ──
@contextlib.contextmanager
def step_progress(total_steps: int, title: str = "") -> Iterator[Callable[[str], None]]:
    """
    Progress bar with discrete steps. Usage:

        with step_progress(4) as step:
            step("Checking requirements")
            ...
            step("Generating .env")
            ...
    """
    progress = Progress(
        SpinnerColumn(style="green"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=30, complete_style="green", finished_style="green"),
        TextColumn("[cyan]{task.completed}/{task.total}[/cyan]"),
        console=console,
        transient=False,
    )
    with progress:
        task_id = progress.add_task(title or "Progress", total=total_steps)

        def step(description: str) -> None:
            progress.update(task_id, description=f"[white]{description}[/white]")
            progress.advance(task_id)

        yield step


@contextlib.contextmanager
def spinner(text: str) -> Iterator[None]:
    """Indeterminate spinner with elapsed time, for long tasks
    (image build, healthcheck wait, etc.)."""
    progress = Progress(
        SpinnerColumn(style="cyan"),
        TextColumn("[white]{task.description}[/white]"),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    )
    with progress:
        progress.add_task(text, total=None)
        yield


def status_table(rows: Iterable[tuple[str, str, str]]) -> Table:
    """rows = [(service_name, status, detail), ...]"""
    table = Table(title="Forge Status", border_style="green", header_style="bold green")
    table.add_column("Service")
    table.add_column("Status")
    table.add_column("Detail")
    state_colors = {
        "running": "green",
        "exited": "yellow",
        "not created": "grey50",
        "unknown": "red",
        "restarting": "yellow",
    }
    for name, state, detail in rows:
        color = state_colors.get(state, "red")
        table.add_row(name, f"[{color}]{state}[/{color}]", detail)
    return table


def wait_with_dots(seconds: float, message: str) -> None:
    """Small dots animation, useful for short waits (e.g. between
    starting a container and the internal service being ready)."""
    end = time.time() + seconds
    frame = 0
    dots_cycle = [".", "..", "...", ""]
    with console.status(f"[cyan]{message}[/cyan]") as s:
        while time.time() < end:
            s.update(f"[cyan]{message}{dots_cycle[frame % len(dots_cycle)]}[/cyan]")
            frame += 1
            time.sleep(0.35)
