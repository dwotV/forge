"""
forge.cli
─────────
Entry point for the `forge` command. Designed to be managed like
a virtual machine (power on / power off / console / network / shared
folders), just like a Virtual Machine, but underneath it orchestrates Docker
containers (docker compose + docker-py), replicating Exegol's approach.

All of Forge's state (.forge/) lives INSIDE the project repo,
alongside docker-compose.yml — not in the user's $HOME. That's why the
first step of every command is to build a ForgeContext that locates
the project and resolves that path (see forge.paths.build_context).
"""

from __future__ import annotations

import getpass
import re
import webbrowser
from pathlib import Path

import click

from . import config as cfgmod
from . import compose_gen, docker_ops, paths
from .paths import ForgeContext
from .ui import banner, confirm, console, log, panel, rule, step_progress, wait_with_dots

USERNAME_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")

NETWORK_HELP = {
    "bridge": "Shared bridge network (default). Kali and web panel can see each other.",
    "nat":    "Isolated bridge network with dedicated subnet, with internet access.",
    "host":   "Forge uses host network directly (no isolation). Equivalent to 'Direct Bridged' / useful for L2 scans, VPN, etc.",
    "none":   "No network. Equivalent to 'Host-only' disconnected. Maximum isolation.",
}


# ──────────────────────────────────────────────────────────────────────
#  Root group — builds the ForgeContext only once
# ──────────────────────────────────────────────────────────────────────
@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(package_name="forge-cli")
@click.pass_context
def cli(ctx: click.Context) -> None:
    """Forge — manage your Docker hacking environment like a VM."""
    # `install` builds the context on its own (the project might not
    # have .forge/ created yet); the other commands reuse it.
    ctx.obj = None
    if ctx.invoked_subcommand != "install":
        try:
            ctx.obj = paths.build_context()
        except SystemExit:
            raise


# ──────────────────────────────────────────────────────────────────────
#  install
# ──────────────────────────────────────────────────────────────────────
@cli.command()
@click.option("-f", "--force", is_flag=True, help="Reinstall even if a previous configuration exists.")
@click.option("--no-build", is_flag=True, help="Do not build images (useful for debugging the rest of the flow).")
def install(force: bool, no_build: bool) -> None:
    """Installs Forge: prompts for user/password, generates .env,
    creates .forge/ inside the repo (config + shared folder) and
    builds the Docker images."""
    banner()
    project_dir = paths.find_project_dir()
    forge_home = project_dir / paths.FORGE_DIR_NAME
    ctx = ForgeContext(project_dir=project_dir, forge_home=forge_home)

    if cfgmod.is_installed(ctx) and not force:
        log("Forge is already installed in this project.", "warn")
        if not confirm("Do you want to reinstall (configuration will be overwritten)?"):
            log("Installation canceled.", "info")
            return

    rule("Forge Installation")
    log(f"Project detected at: {project_dir}", "info")
    log(f"Forge state will live in: {forge_home}", "info")

    # ── Requisitos ──────────────────────────────────────────────────
    log("Checking Docker...", "info")
    if not docker_ops.check_docker_available():
        log("Docker is not available or daemon is not responding. Install/start it and try again.", "error")
        raise SystemExit(1)
    log("Docker detected and running.", "ok")

    # ── Preguntas al usuario ───────────────────────────────────────
    console.print()
    log("Configure your Forge user:", "ask")
    kali_user = click.prompt("    User", default="hacker")
    while not USERNAME_RE.match(kali_user):
        log("Invalid user: only lowercase, numbers, '_' and '-', cannot start with a number.", "error")
        kali_user = click.prompt("    User", default="hacker")

    while True:
        password = getpass.getpass("    [?] Password: ")
        password_confirm = getpass.getpass("    [?] Confirm password: ")
        if not password:
            log("Password cannot be empty.", "error")
            continue
        if password != password_confirm:
            log("Passwords do not match, try again.", "error")
            continue
        break

    try:
        import tzlocal
        timezone = tzlocal.get_localzone_name()
    except Exception:
        timezone = cfgmod.DEFAULT_TIMEZONE
    console.print(f"    [+] Detected timezone: [bold cyan]{timezone}[/bold cyan]")
    vnc_resolution = click.prompt("    [?] VNC desktop resolution", default=cfgmod.DEFAULT_VNC_RES)

    console.print()
    log("Initial network mode (can be changed later with 'forge network <mode>'):", "ask")
    for mode, desc in NETWORK_HELP.items():
        console.print(f"      [bold]{mode:<7}[/bold] {desc}")
    network_mode = click.prompt(
        "    [?] Choose a network mode",
        type=click.Choice(list(NETWORK_HELP)),
        default=cfgmod.DEFAULT_NETWORK_MODE,
    )

    cfg = cfgmod.ForgeConfig(
        kali_user=kali_user,
        network_mode=network_mode,
        timezone=timezone,
        vnc_resolution=vnc_resolution,
    )

    console.print()
    with step_progress(5, "Installing Forge") as step:
        step("Generating .env file")
        cfgmod.write_env_file(ctx, cfg, password)

        step("Creating default shared folder")
        ctx.shared_dir.mkdir(parents=True, exist_ok=True)
        cfg.add_shared_folder(
            host=str(ctx.shared_dir),
            container=f"/home/{kali_user}/shared",
            ro=False,
        )

        step("Generating runtime docker-compose")
        compose_gen.generate_runtime_compose(ctx, cfg)

        step("Updating .gitignore")
        paths.ensure_gitignore(ctx)

        step("Saving configuration")
        cfg.installed = True
        cfgmod.save(ctx, cfg)

    if not no_build:
        console.print()
        docker_ops.compose_build(ctx.project_dir, ctx.runtime_compose_file)

    console.print()
    panel(
        "Forge was successfully installed.\n\n"
        f"  Project state at: {ctx.forge_home}\n\n"
        "  forge start          → starts the full panel (web + desktop)\n"
        "  forge shell          → starts Forge and gives a direct terminal\n"
        "  forge desktop        → starts Forge and opens only the desktop (noVNC)\n"
        "  forge status         → shows services status\n",
        title="[+] Installation Complete",
        style="green",
    )


# ──────────────────────────────────────────────────────────────────────
#  start / stop / restart
# ──────────────────────────────────────────────────────────────────────
def _services_for_mode(mode: str) -> list[str]:
    if mode == "full":
        return []  # empty list = all compose services
    return ["kali"]  # shell / desktop: only Kali container


def _prepare_and_up(ctx: ForgeContext, mode: str, network_override: str | None) -> cfgmod.ForgeConfig:
    cfg = cfgmod.load(ctx)

    effective_network = network_override or cfg.network_mode
    if network_override:
        log(f"Using network mode '{network_override}' for this boot only.", "info")

    if compose_gen.warn_if_network_incompatible(effective_network, mode):
        log(
            f"Network mode '{effective_network}' isolates Kali from the internal network. "
            "The web panel (browser terminal) might stop working.",
            "warn",
        )
        if not confirm("Continue anyway?"):
            raise SystemExit("Boot canceled.")

    tmp_cfg = cfgmod.ForgeConfig(**{**cfg.to_dict(), "network_mode": effective_network})
    compose_gen.generate_runtime_compose(ctx, tmp_cfg)

    cfg.last_mode = mode
    cfgmod.save(ctx, cfg)

    services = _services_for_mode(mode)
    docker_ops.compose_up(ctx.project_dir, ctx.runtime_compose_file, services)
    return cfg


@cli.command()
@click.option(
    "-m", "--mode",
    type=click.Choice(["full", "shell", "desktop"]),
    default="full",
    show_default=True,
    help="full = full web panel · shell = only terminal · desktop = only noVNC desktop",
)
@click.option(
    "-n", "--network",
    type=click.Choice(list(NETWORK_HELP)),
    default=None,
    help="Overrides configured network mode, just for this boot.",
)
@click.pass_obj
def start(ctx: ForgeContext, mode: str, network: str | None) -> None:
    """Starts Forge."""
    banner()
    rule(f"Starting Forge — mode: {mode}")

    cfg = _prepare_and_up(ctx, mode, network)

    ready = docker_ops.wait_healthy("kali", timeout=90)
    if not ready:
        log("Kali took too long to be ready. Check 'forge logs kali'.", "warn")
    else:
        log("Kali container ready.", "ok")

    if mode == "full":
        wait_with_dots(2, "Preparing web panel")
        panel(
            f"Web panel:      http://localhost:8080\n"
            f"Direct desktop (noVNC): http://localhost:6080/vnc.html\n"
            f"User:           {cfg.kali_user}",
            title="[+] Forge is running",
        )
        log("Use 'forge shell' anytime for a direct terminal.", "info")

    elif mode == "desktop":
        url = "http://localhost:6080/vnc.html"
        panel(f"Desktop available at:\n{url}\nVNC User: (password defined at installation)", title="[+] Desktop mode")
        try:
            webbrowser.open(url)
        except Exception:
            pass

    elif mode == "shell":
        log("Attaching terminal...", "ok")
        docker_ops.exec_shell(cfg.kali_user)


@cli.command()
@click.pass_obj
def stop(ctx: ForgeContext) -> None:
    """Stops Forge without deleting anything. Container state remains intact."""
    if not ctx.runtime_compose_file.is_file():
        cfg = cfgmod.load(ctx)
        compose_gen.generate_runtime_compose(ctx, cfg)

    rule("Stopping Forge")
    with console.status("[cyan]Stopping services...[/cyan]"):
        docker_ops.compose_stop(ctx.project_dir, ctx.runtime_compose_file)
    log("Forge stopped. Container state is preserved.", "ok")
    log("Use 'forge start' (or 'forge shell' / 'forge desktop') to resume it.", "info")


@cli.command()
@click.option("-m", "--mode", type=click.Choice(["full", "shell", "desktop"]), default=None)
@click.pass_context
def restart(click_ctx: click.Context, mode: str | None) -> None:
    """Restarts Forge, keeping the last used mode if none is specified."""
    ctx: ForgeContext = click_ctx.obj
    cfg = cfgmod.load(ctx)
    effective_mode = mode or cfg.last_mode or "full"
    click_ctx.invoke(stop)
    click_ctx.invoke(start, mode=effective_mode, network=None)


# ──────────────────────────────────────────────────────────────────────
#  shell / desktop (shortcuts)
# ──────────────────────────────────────────────────────────────────────
@cli.command()
@click.pass_obj
def shell(ctx: ForgeContext) -> None:
    """Direct terminal to Forge, no web panel or desktop (console only)."""
    state, _ = docker_ops.container_status("kali")
    if state != "running":
        log("Kali is not running, starting in terminal mode...", "info")
        cfg = _prepare_and_up(ctx, "shell", None)
        docker_ops.wait_healthy("kali", timeout=90)
    else:
        cfg = cfgmod.load(ctx)
    docker_ops.exec_shell(cfg.kali_user)


@cli.command()
@click.pass_obj
def desktop(ctx: ForgeContext) -> None:
    """Only the graphical desktop (noVNC), no web panel or terminal."""
    state, _ = docker_ops.container_status("kali")
    if state != "running":
        log("Kali is not running, starting in desktop mode...", "info")
        _prepare_and_up(ctx, "desktop", None)
        docker_ops.wait_healthy("kali", timeout=90)
    url = "http://localhost:6080/vnc.html"
    log(f"Opening desktop: {url}", "ok")
    try:
        webbrowser.open(url)
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────
#  status / info / logs
# ──────────────────────────────────────────────────────────────────────
@cli.command()
def status() -> None:
    """Shows the status of all Forge containers."""
    from .ui import status_table
    rows = docker_ops.all_status()
    console.print(status_table(rows))


@cli.command()
@click.pass_obj
def info(ctx: ForgeContext) -> None:
    """Shows current Forge configuration."""
    from rich.table import Table
    cfg = cfgmod.load(ctx)
    
    table = Table(title="Forge Configuration", show_header=False, title_justify="left")
    table.add_column("Property", style="bold cyan")
    table.add_column("Value")
    
    table.add_row("Project:", str(ctx.project_dir))
    table.add_row("State (.forge):", str(ctx.forge_home))
    table.add_row("User:", cfg.kali_user)
    table.add_row("Network mode:", f"{cfg.network_mode}  — {NETWORK_HELP.get(cfg.network_mode, '')}")
    table.add_row("Timezone:", cfg.timezone)
    table.add_row("VNC Resolution:", cfg.vnc_resolution)
    table.add_row("Last mode:", str(cfg.last_mode))
    
    console.print(table)
    
    if cfg.shared_folders:
        console.print()
        sf_table = Table(title="Shared folders", show_header=True, header_style="bold magenta", title_justify="left")
        sf_table.add_column("Host")
        sf_table.add_column("Container")
        sf_table.add_column("Permissions")
        for sf in cfg.shared_folders:
            ro = "Read-only" if sf.get("ro") else "Read/Write"
            sf_table.add_row(str(sf.get('host', '')), str(sf.get('container', '')), ro)
        console.print(sf_table)


@cli.command()
@click.argument("service", required=False, type=click.Choice(docker_ops.SERVICES))
@click.pass_obj
def logs(ctx: ForgeContext, service: str | None) -> None:
    """Follows the logs of a service (or all if not specified)."""
    docker_ops.compose_logs(ctx.project_dir, ctx.runtime_compose_file, service)


# ──────────────────────────────────────────────────────────────────────
#  network
# ──────────────────────────────────────────────────────────────────────
@cli.command()
@click.argument("mode", required=False, type=click.Choice(list(NETWORK_HELP)))
@click.pass_obj
def network(ctx: ForgeContext, mode: str | None) -> None:
    """Queries or changes Forge's network mode (bridge/nat/host/none)."""
    cfg = cfgmod.load(ctx)

    if mode is None:
        console.print(f"Current network mode: [bold]{cfg.network_mode}[/bold]")
        for m, desc in NETWORK_HELP.items():
            marker = "→" if m == cfg.network_mode else " "
            console.print(f"  {marker} [bold]{m:<7}[/bold] {desc}")
        return

    if mode in ("host", "none"):
        log(f"The '{mode}' mode isolates Kali from other services (backend/frontend).", "warn")
        if not confirm("Confirm the change?"):
            log("No changes made.", "info")
            return

    cfg.network_mode = mode
    cfgmod.save(ctx, cfg)
    log(f"Network mode updated to '{mode}'.", "ok")
    log("Run 'forge restart' to apply the change.", "info")


# ──────────────────────────────────────────────────────────────────────
#  share / shared-folder
# ──────────────────────────────────────────────────────────────────────
@cli.command()
@click.argument("host_path", type=click.Path(exists=True, file_okay=True, dir_okay=True))
@click.argument("container_name", required=False)
@click.option("--ro", is_flag=True, help="Mount in read-only mode.")
@click.pass_obj
def share(ctx: ForgeContext, host_path: str, container_name: str | None, ro: bool) -> None:
    """Shares a host file or folder inside Forge.

    Example:  forge share ~/Downloads/wordlists.txt
              forge share ./project project --ro
    """
    cfg = cfgmod.load(ctx)

    abs_host = str(Path(host_path).expanduser().resolve())
    name = container_name or Path(abs_host).name
    container_path = f"/home/{cfg.kali_user}/shared/{name}"

    cfg.add_shared_folder(host=abs_host, container=container_path, ro=ro)
    cfgmod.save(ctx, cfg)

    compose_gen.generate_runtime_compose(ctx, cfg)

    log(f"'{abs_host}' will be shared at '{container_path}'{' (read-only)' if ro else ''}.", "ok")
    state, _ = docker_ops.container_status("kali")
    if state == "running":
        log("Kali is already running: restart so the new mount takes effect.", "warn")
        log("Run: forge restart", "info")
    else:
        log("The mount will be applied on the next 'forge start'.", "info")


@cli.command(name="shared-folder")
@click.option("--open", "open_it", is_flag=True, help="Open the shared folder in the host file explorer.")
@click.pass_obj
def shared_folder(ctx: ForgeContext, open_it: bool) -> None:
    """Shows (or opens) the default persistent shared folder."""
    cfg = cfgmod.load(ctx)
    ctx.shared_dir.mkdir(parents=True, exist_ok=True)
    container_path = f"/home/{cfg.kali_user}/shared"

    console.print(f"[bold]Host:[/bold]      {ctx.shared_dir}")
    console.print(f"[bold]Container:[/bold] {container_path}")

    if open_it:
        import platform
        import subprocess as sp
        system = platform.system()
        try:
            if system == "Darwin":
                sp.run(["open", str(ctx.shared_dir)])
            elif system == "Windows":
                sp.run(["explorer", str(ctx.shared_dir)])
            else:
                sp.run(["xdg-open", str(ctx.shared_dir)])
        except Exception:
            log("Could not automatically open file explorer.", "warn")


# ──────────────────────────────────────────────────────────────────────
#  destroy
# ──────────────────────────────────────────────────────────────────────
@cli.command()
@click.option("-v", "--volumes", is_flag=True, help="Also deletes volumes (home, tools). IRREVERSIBLE.")
@click.pass_obj
def destroy(ctx: ForgeContext, volumes: bool) -> None:
    """Destroys Forge containers."""
    log("This action will destroy Forge containers.", "warn")
    if volumes:
        log("VOLUMES (user home, installed tools) will also be deleted. This CANNOT be undone.", "error")
    if not confirm("Are you completely sure?"):
        log("Canceled.", "info")
        return
    with console.status("[red]Destroying environment...[/red]"):
        docker_ops.compose_down(ctx.project_dir, ctx.runtime_compose_file, volumes=volumes)
    log("Forge environment destroyed.", "ok")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
