"""
Forge MCP Server

Herramientas registradas:

── Backend (UI / apps gráficas) ────────────
  forge_status       → estado del entorno
  forge_launch_app   → abrir app gráfica en el VNC
  forge_close_app    → cerrar app gráfica

── Kali API (ejecución de herramientas) ────
  forge_list_tools   → catálogo de herramientas permitidas
  forge_exec         → ejecutar herramienta (síncrono)
  forge_exec_bg      → ejecutar herramienta en background
  forge_list_jobs    → listar jobs en background
  forge_job_status   → consultar estado/output de un job
  forge_job_kill     → matar un job en ejecución
"""

from __future__ import annotations

import json
import os

import httpx
from mcp.server.fastmcp import FastMCP

# ─────────────────────────────────────────────────────────────
#  Configuración
# ─────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
KALI_API_URL = os.environ.get("KALI_API_URL", "http://localhost:4000")

mcp = FastMCP("forge-mcp")

# ─────────────────────────────────────────────────────────────
#  Utilidades
# ─────────────────────────────────────────────────────────────


async def safe_fetch(
    url: str,
    *,
    method: str = "GET",
    json_body: dict | None = None,
) -> tuple[dict, bool]:
    """Fetch con manejo de errores uniforme."""
    async with httpx.AsyncClient(timeout=620) as client:
        response = await client.request(method, url, json=json_body)
        data = response.json()
        return data, response.is_success


def error_text(message: str) -> str:
    return f"Error: {message}"


def json_text(data: object) -> str:
    return json.dumps(data, indent=2)


# ═════════════════════════════════════════════════════════════
#  BACKEND — Herramientas de UI / apps gráficas
# ═════════════════════════════════════════════════════════════


@mcp.tool()
async def forge_status() -> str:
    """Get Forge environment status (backend + Kali container + kali-api)"""
    results: dict[str, object] = {}

    # Backend status
    try:
        data, _ = await safe_fetch(f"{BACKEND_URL}/api/health")
        results["backend"] = data
    except Exception:
        results["backend"] = {"status": "unreachable"}

    # Kali API status
    try:
        data, _ = await safe_fetch(f"{KALI_API_URL}/api/v1/health")
        results["kaliApi"] = data
    except Exception:
        results["kaliApi"] = {"status": "unreachable"}

    return json_text(results)


@mcp.tool()
async def forge_launch_app(
    app: str,
) -> str:
    """Open a GUI application inside Forge (appears in the VNC desktop). Available apps: firefox, burpsuite, wireshark, zaproxy, zenmap, hydra, johnny, autopsy, fern, ettercap, ghidra, terminal, files

    Args:
        app: App ID to launch (e.g. 'wireshark', 'burpsuite', 'firefox')
    """
    try:
        data, ok = await safe_fetch(
            f"{BACKEND_URL}/api/launch",
            method="POST",
            json_body={"app": app},
        )
        if not ok:
            return error_text(data.get("error", "Failed to launch application"))
        return f"{data.get('label', app)} opened"
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_close_app(
    app: str,
) -> str:
    """Close a GUI application inside Forge

    Args:
        app: App ID to close (e.g. 'wireshark', 'burpsuite')
    """
    try:
        data, ok = await safe_fetch(
            f"{BACKEND_URL}/api/kill",
            method="POST",
            json_body={"app": app},
        )
        if not ok:
            return error_text(data.get("error", "Failed to close application"))
        return json_text(data)
    except Exception as exc:
        return error_text(str(exc))


# ═════════════════════════════════════════════════════════════
#  KALI API — Ejecución de herramientas de pentesting / CTF
# ═════════════════════════════════════════════════════════════


@mcp.tool()
async def forge_list_tools() -> str:
    """List all allowed pentesting/CTF tools available for execution in Forge, grouped by category (recon, web, bruteforce, exploit, network, forensics, wireless, utils)"""
    try:
        data, ok = await safe_fetch(f"{KALI_API_URL}/api/v1/tools")
        if not ok:
            return error_text(data.get("error", "Failed to fetch tools"))
        return json_text(data)
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_exec(
    tool: str,
    args: list[str] | None = None,
    timeout: int | None = None,
) -> str:
    """Execute a pentesting/CTF tool inside the Forge Kali environment and wait for the result. Use this for quick commands (port scans, lookups, file analysis, etc.). The tool must be in the allowed whitelist — call forge_list_tools to see available tools. Returns stdout, stderr, exit code, and execution duration.

    Args:
        tool: Tool binary name to execute (e.g. 'nmap', 'gobuster', 'sqlmap', 'hydra', 'binwalk', 'curl')
        args: Arguments to pass to the tool (e.g. ['-sV', '-p', '80,443', '10.10.10.1'])
        timeout: Maximum execution time in seconds (default: 300, max: 600)
    """
    try:
        body: dict[str, object] = {"tool": tool}
        if args is not None:
            body["args"] = args
        if timeout is not None:
            body["timeout"] = timeout

        data, ok = await safe_fetch(
            f"{KALI_API_URL}/api/v1/exec",
            method="POST",
            json_body=body,
        )

        if not ok:
            return error_text(data.get("error", "Execution failed"))

        # Build a structured, readable response for the LLM
        output = f"Tool: {data['tool']}\nExit Code: {data['exitCode']}\nDuration: {data['durationMs']}ms"

        if data.get("stdout"):
            output += f"\n\n── stdout ──\n{data['stdout']}"
        if data.get("stderr"):
            output += f"\n\n── stderr ──\n{data['stderr']}"
        if data.get("truncated"):
            output += "\n\n⚠️ Output was truncated (exceeded 5MB limit)"

        return output
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_exec_bg(
    tool: str,
    args: list[str] | None = None,
    timeout: int | None = None,
) -> str:
    """Execute a pentesting/CTF tool in the background (for long-running scans). Returns a job ID immediately. Use forge_job_status to check progress and get results. Use forge_job_kill to stop a running job. Ideal for: full port scans, brute-force attacks, large directory fuzzing, etc.

    Args:
        tool: Tool binary name to execute (e.g. 'nmap', 'masscan', 'hydra', 'gobuster')
        args: Arguments to pass to the tool (e.g. ['-sV', '-p-', '10.10.10.0/24'])
        timeout: Maximum execution time in seconds (default: 300, max: 600)
    """
    try:
        body: dict[str, object] = {"tool": tool}
        if args is not None:
            body["args"] = args
        if timeout is not None:
            body["timeout"] = timeout

        data, ok = await safe_fetch(
            f"{KALI_API_URL}/api/v1/exec/background",
            method="POST",
            json_body=body,
        )

        if not ok:
            return error_text(data.get("error", "Failed to start background job"))

        job_args = " ".join(data.get("args", []))
        return (
            f"Background job started.\n"
            f"Job ID: {data['jobId']}\n"
            f"Tool: {data['tool']}\n"
            f"Args: {job_args}\n\n"
            f"Use forge_job_status with this job ID to check progress."
        )
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_list_jobs() -> str:
    """List all background jobs (running and completed) in the Forge Kali environment"""
    try:
        data, ok = await safe_fetch(f"{KALI_API_URL}/api/v1/jobs")
        if not ok:
            return error_text(data.get("error", "Failed to list jobs"))

        if data.get("total", 0) == 0:
            return "No background jobs found."

        return json_text(data)
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_job_status(
    jobId: str,
) -> str:
    """Get the status and output of a background job. Returns stdout, stderr, exit code, and whether the job is still running.

    Args:
        jobId: The job ID returned by forge_exec_bg
    """
    try:
        data, ok = await safe_fetch(f"{KALI_API_URL}/api/v1/jobs/{jobId}")
        if not ok:
            return error_text(data.get("error", "Job not found"))

        output = f"Job: {data['id']}\nTool: {data['tool']}\nStatus: {data['status']}"

        if data.get("exitCode") is not None:
            output += f"\nExit Code: {data['exitCode']}"
        if data.get("durationMs") is not None:
            output += f"\nDuration: {data['durationMs']}ms"
        if data.get("stdout"):
            output += f"\n\n── stdout ──\n{data['stdout']}"
        if data.get("stderr"):
            output += f"\n\n── stderr ──\n{data['stderr']}"
        if data.get("truncated"):
            output += "\n\n⚠️ Output was truncated (exceeded 5MB limit)"

        return output
    except Exception as exc:
        return error_text(str(exc))


@mcp.tool()
async def forge_job_kill(
    jobId: str,
) -> str:
    """Kill a running background job. Use this to stop long-running scans or processes that are no longer needed.

    Args:
        jobId: The job ID to kill
    """
    try:
        data, ok = await safe_fetch(
            f"{KALI_API_URL}/api/v1/jobs/{jobId}",
            method="DELETE",
        )
        if not ok:
            return error_text(data.get("error", "Failed to kill job"))
        return data.get("message", "Job killed successfully.")
    except Exception as exc:
        return error_text(str(exc))


# ─────────────────────────────────────────────────────────────
#  Arrancar servidor MCP (transporte stdio)
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
