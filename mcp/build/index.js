import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
// ─────────────────────────────────────────────────────────────
//  Forge MCP Server
//
//  Herramientas registradas:
//
//  ── Backend (UI / apps gráficas) ────────────
//    forge_status       → estado del entorno
//    forge_launch_app   → abrir app gráfica en el VNC
//    forge_close_app    → cerrar app gráfica
//
//  ── Kali API (ejecución de herramientas) ────
//    forge_list_tools   → catálogo de herramientas permitidas
//    forge_exec         → ejecutar herramienta (síncrono)
//    forge_exec_bg      → ejecutar herramienta en background
//    forge_list_jobs    → listar jobs en background
//    forge_job_status   → consultar estado/output de un job
//    forge_job_kill     → matar un job en ejecución
// ─────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";
const KALI_API_URL = process.env.KALI_API_URL ?? "http://localhost:4000";
const server = new McpServer({
    name: 'forge-mcp',
    version: '1.0.0',
});
// ─────────────────────────────────────────────────────────────
//  Utilidad: fetch con manejo de errores uniforme
// ─────────────────────────────────────────────────────────────
async function safeFetch(url, init) {
    const response = await fetch(url, init);
    const data = await response.json();
    return { data, ok: response.ok };
}
function errorContent(message) {
    return { content: [{ type: "text", text: `Error: ${message}` }] };
}
function textContent(text) {
    return { content: [{ type: "text", text }] };
}
function jsonContent(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
// ═════════════════════════════════════════════════════════════
//  BACKEND — Herramientas de UI / apps gráficas
// ═════════════════════════════════════════════════════════════
// ── forge_status ─────────────────────────────────────────────
server.registerTool("forge_status", {
    description: "Get Forge environment status (backend + Kali container + kali-api)",
    inputSchema: z.object({})
}, async () => {
    try {
        const results = {};
        // Backend status
        try {
            const { data } = await safeFetch(`${BACKEND_URL}/api/health`);
            results.backend = data;
        }
        catch {
            results.backend = { status: "unreachable" };
        }
        // Kali API status
        try {
            const { data } = await safeFetch(`${KALI_API_URL}/api/v1/health`);
            results.kaliApi = data;
        }
        catch {
            results.kaliApi = { status: "unreachable" };
        }
        return jsonContent(results);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_launch_app ─────────────────────────────────────────
server.registerTool("forge_launch_app", {
    description: "Open a GUI application inside Forge (appears in the VNC desktop). Available apps: firefox, burpsuite, wireshark, zaproxy, zenmap, hydra, johnny, autopsy, fern, ettercap, ghidra, terminal, files",
    inputSchema: z.object({
        app: z.string().describe("App ID to launch (e.g. 'wireshark', 'burpsuite', 'firefox')")
    })
}, async ({ app }) => {
    try {
        const { data, ok } = await safeFetch(`${BACKEND_URL}/api/launch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app })
        });
        if (!ok)
            return errorContent(data.error);
        return textContent(`${data.label} opened`);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_close_app ──────────────────────────────────────────
server.registerTool("forge_close_app", {
    description: "Close a GUI application inside Forge",
    inputSchema: z.object({
        app: z.string().describe("App ID to close (e.g. 'wireshark', 'burpsuite')")
    })
}, async ({ app }) => {
    try {
        const { data, ok } = await safeFetch(`${BACKEND_URL}/api/kill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app })
        });
        if (!ok)
            return errorContent(data.error ?? "Failed to close application");
        return jsonContent(data);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ═════════════════════════════════════════════════════════════
//  KALI API — Ejecución de herramientas de pentesting / CTF
// ═════════════════════════════════════════════════════════════
// ── forge_list_tools ─────────────────────────────────────────
server.registerTool("forge_list_tools", {
    description: "List all allowed pentesting/CTF tools available for execution in Forge, grouped by category (recon, web, bruteforce, exploit, network, forensics, wireless, utils)",
    inputSchema: z.object({})
}, async () => {
    try {
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/tools`);
        if (!ok)
            return errorContent(data.error ?? "Failed to fetch tools");
        return jsonContent(data);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_exec ───────────────────────────────────────────────
server.registerTool("forge_exec", {
    description: "Execute a pentesting/CTF tool inside the Forge Kali environment and wait for the result. " +
        "Use this for quick commands (port scans, lookups, file analysis, etc.). " +
        "The tool must be in the allowed whitelist — call forge_list_tools to see available tools. " +
        "Returns stdout, stderr, exit code, and execution duration.",
    inputSchema: z.object({
        tool: z.string().describe("Tool binary name to execute (e.g. 'nmap', 'gobuster', 'sqlmap', 'hydra', 'binwalk', 'curl')"),
        args: z.array(z.string()).optional().describe("Arguments to pass to the tool (e.g. ['-sV', '-p', '80,443', '10.10.10.1'])"),
        timeout: z.number().optional().describe("Maximum execution time in seconds (default: 300, max: 600)"),
    })
}, async ({ tool, args, timeout }) => {
    try {
        const body = { tool };
        if (args)
            body.args = args;
        if (timeout)
            body.timeout = timeout;
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/exec`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!ok)
            return errorContent(data.error ?? "Execution failed");
        // Build a structured, readable response for the LLM
        let output = `Tool: ${data.tool}\nExit Code: ${data.exitCode}\nDuration: ${data.durationMs}ms`;
        if (data.stdout) {
            output += `\n\n── stdout ──\n${data.stdout}`;
        }
        if (data.stderr) {
            output += `\n\n── stderr ──\n${data.stderr}`;
        }
        if (data.truncated) {
            output += `\n\n⚠️ Output was truncated (exceeded 5MB limit)`;
        }
        return textContent(output);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_exec_bg ────────────────────────────────────────────
server.registerTool("forge_exec_bg", {
    description: "Execute a pentesting/CTF tool in the background (for long-running scans). " +
        "Returns a job ID immediately. Use forge_job_status to check progress and get results. " +
        "Use forge_job_kill to stop a running job. Ideal for: full port scans, brute-force attacks, large directory fuzzing, etc.",
    inputSchema: z.object({
        tool: z.string().describe("Tool binary name to execute (e.g. 'nmap', 'masscan', 'hydra', 'gobuster')"),
        args: z.array(z.string()).optional().describe("Arguments to pass to the tool (e.g. ['-sV', '-p-', '10.10.10.0/24'])"),
        timeout: z.number().optional().describe("Maximum execution time in seconds (default: 300, max: 600)"),
    })
}, async ({ tool, args, timeout }) => {
    try {
        const body = { tool };
        if (args)
            body.args = args;
        if (timeout)
            body.timeout = timeout;
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/exec/background`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!ok)
            return errorContent(data.error ?? "Failed to start background job");
        return textContent(`Background job started.\n` +
            `Job ID: ${data.jobId}\n` +
            `Tool: ${data.tool}\n` +
            `Args: ${(data.args || []).join(' ')}\n\n` +
            `Use forge_job_status with this job ID to check progress.`);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_list_jobs ──────────────────────────────────────────
server.registerTool("forge_list_jobs", {
    description: "List all background jobs (running and completed) in the Forge Kali environment",
    inputSchema: z.object({})
}, async () => {
    try {
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/jobs`);
        if (!ok)
            return errorContent(data.error ?? "Failed to list jobs");
        if (data.total === 0) {
            return textContent("No background jobs found.");
        }
        return jsonContent(data);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_job_status ─────────────────────────────────────────
server.registerTool("forge_job_status", {
    description: "Get the status and output of a background job. Returns stdout, stderr, exit code, and whether the job is still running.",
    inputSchema: z.object({
        jobId: z.string().describe("The job ID returned by forge_exec_bg")
    })
}, async ({ jobId }) => {
    try {
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/jobs/${jobId}`);
        if (!ok)
            return errorContent(data.error ?? "Job not found");
        let output = `Job: ${data.id}\nTool: ${data.tool}\nStatus: ${data.status}`;
        if (data.exitCode !== null) {
            output += `\nExit Code: ${data.exitCode}`;
        }
        if (data.durationMs !== null) {
            output += `\nDuration: ${data.durationMs}ms`;
        }
        if (data.stdout) {
            output += `\n\n── stdout ──\n${data.stdout}`;
        }
        if (data.stderr) {
            output += `\n\n── stderr ──\n${data.stderr}`;
        }
        if (data.truncated) {
            output += `\n\n⚠️ Output was truncated (exceeded 5MB limit)`;
        }
        return textContent(output);
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ── forge_job_kill ───────────────────────────────────────────
server.registerTool("forge_job_kill", {
    description: "Kill a running background job. Use this to stop long-running scans or processes that are no longer needed.",
    inputSchema: z.object({
        jobId: z.string().describe("The job ID to kill")
    })
}, async ({ jobId }) => {
    try {
        const { data, ok } = await safeFetch(`${KALI_API_URL}/api/v1/jobs/${jobId}`, {
            method: "DELETE",
        });
        if (!ok)
            return errorContent(data.error ?? "Failed to kill job");
        return textContent(data.message ?? "Job killed successfully.");
    }
    catch (error) {
        return errorContent(String(error));
    }
});
// ─────────────────────────────────────────────────────────────
//  Arrancar servidor MCP
// ─────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main();
