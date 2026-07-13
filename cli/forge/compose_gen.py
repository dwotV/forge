"""
forge.compose_gen
─────────────────
Generates a "runtime" compose (<project>/.forge/docker-compose.runtime.yml)
based on the repo's base docker-compose.yml with:

  - The network mode chosen by the user applied to the `kali` service
    (equivalent to choosing "Bridged / NAT / Host-only" in VMware).
  - Shared folders (host → container) added as bind mounts.

The original docker-compose.yml is never edited: it's always used as a
base and the result is written to a separate file, keeping the repo
clean and versionable.
"""

from __future__ import annotations

import yaml

from .config import ForgeConfig
from .paths import ForgeContext
from .ui import log

KALI_SERVICE = "kali"
KALI_NETWORK = "panel-net"
NAT_SUBNET = "172.28.5.0/28"  # dedicated isolated network, like VM NAT mode


def _apply_network_mode(kali: dict, top_networks: dict, mode: str) -> None:
    """Mutates the `kali` service in-place according to the chosen network mode."""
    # Always start clean from these keys before deciding
    kali.pop("network_mode", None)
    kali["networks"] = [KALI_NETWORK]

    if mode == "bridge":
        # Default behavior: shared bridge network with the rest
        # of the services (backend/kali-api/frontend can reach kali).
        top_networks[KALI_NETWORK] = {"driver": "bridge"}

    elif mode == "nat":
        # Own bridge network, isolated, with dedicated subnet — equivalent
        # to VMware's "NAT" mode: container reaches internet but
        # lives in its own segment.
        top_networks[KALI_NETWORK] = {
            "driver": "bridge",
            "ipam": {"config": [{"subnet": NAT_SUBNET}]},
        }

    elif mode == "host":
        # Shares the host's network stack directly.
        kali.pop("networks", None)
        kali.pop("ports", None)  # ignored by Docker in host network_mode
        kali["network_mode"] = "host"

    elif mode == "none":
        # Total isolation: no network.
        kali.pop("networks", None)
        kali.pop("ports", None)
        kali["network_mode"] = "none"

    else:  # pragma: no cover
        raise ValueError(f"Unknown network mode: {mode}")


def _apply_shared_folders(kali: dict, cfg: ForgeConfig) -> None:
    volumes = kali.setdefault("volumes", [])
    for sf in cfg.shared_folders:
        suffix = ":ro" if sf.get("ro") else ""
        entry = f"{sf['host']}:{sf['container']}{suffix}"
        if entry not in volumes:
            volumes.append(entry)


def generate_runtime_compose(ctx: ForgeContext, cfg: ForgeConfig):
    base_file = ctx.project_dir / "docker-compose.yml"
    data = yaml.safe_load(base_file.read_text())

    services = data.get("services", {})
    if KALI_SERVICE not in services:
        raise SystemExit(f"Service '{KALI_SERVICE}' does not exist in {base_file}")

    top_networks = data.setdefault("networks", {})
    _apply_network_mode(services[KALI_SERVICE], top_networks, cfg.network_mode)
    _apply_shared_folders(services[KALI_SERVICE], cfg)

    ctx.forge_home.mkdir(parents=True, exist_ok=True)
    ctx.runtime_compose_file.write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    )
    log(f"Runtime compose generated at {ctx.runtime_compose_file}", "debug")
    return ctx.runtime_compose_file


def warn_if_network_incompatible(mode: str, run_mode: str) -> bool:
    """Returns True if user should be warned (host/none + web panel),
    just like Exegol warns when mixing --network host with --vpn."""
    return run_mode == "full" and mode in ("host", "none")
