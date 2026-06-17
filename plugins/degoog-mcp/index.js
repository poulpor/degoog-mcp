// degoog-mcp plugin: MCP server exposing search tool
import { sseTransport } from "./sse-transport.js";
import { handleRequest } from "./mcp-handler.js";
import { readFile } from "fs/promises";
import { join } from "path";

const INTERNAL_PORT = process.env.DEGOOG_PORT || 4444;
const DATA_DIR = join(process.cwd(), "data");
const SETTINGS_FILE = join(DATA_DIR, "plugin-settings.json");

// --- VARIABLES DE CONFIGURATION GLOBALES ---
let MAX_RESULTS_SERVER = 5; // Valeur par défaut si rien n'est configuré

const _isDisabled = async () => {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(raw)["plugin-degoog-mcp"]?.disabled === "true";
  } catch {
    return false;
  }
};

const _disabledResponse = () => new Response(
  JSON.stringify({ error: "This plugin is disabled" }),
  { status: 403, headers: { "Content-Type": "application/json" } },
);

const plugin = {
  name: "Degoog MCP",
  description: "Model Context Protocol server — exposes degoog search as an MCP tool.",
  trigger: "_mcp",
  isClientExposed: false,
  
  // 1. AJOUT DU MENU DANS L'INTERFACE
  settingsSchema: [
    {
      key: "maxResults", // Clé utilisée pour récupérer la valeur
      label: "Max Search Results",
      type: "text",
      placeholder: "5",
      description: "Nombre maximal de résultats de recherche à retourner à l'IA.",
    },
  ],

  async init() {
    // Initialisation si nécessaire
  },

  // 2. RÉCUPÉRATION DE LA VALEUR DU MENU
  configure(settings) {
    const n = parseInt(settings.maxResults, 10);
    // On s'assure que c'est un nombre valide, sinon on prend 5 par défaut
    MAX_RESULTS_SERVER = Number.isFinite(n) && n > 0 ? n : 5;
  },

  async execute() {
    return {
      title: "Degoog MCP",
      html: `<p>MCP server running. Max results set to: ${MAX_RESULTS_SERVER}</p>`,
    };
  },
};

export default plugin;

const SEARCH_TIMEOUT = 15_000;
const HEARTBEAT_INTERVAL = 30_000;

const _search = async (args) => {
  const { query, page, time, type, lang } = args;

  if (!query || !query.trim()) {
    return [{ type: "text", text: "Please provide a search query." }];
  }

  const params = new URLSearchParams({ q: query.trim() });
  if (page != null) params.set("page", String(page));
  if (time) params.set("time", time);
  if (type) params.set("type", type);
  if (lang) params.set("lang", lang);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    const res = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/search?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return [{ type: "text", text: `Search failed with status ${res.status}` }];
    }

    const data = await res.json();
    let results = data.results || data;

    if (!Array.isArray(results) || results.length === 0) {
      return [{ type: "text", text: "No results found." }];
    }

    // --- LOGIQUE DE TRI ET LIMITATION VIA LE MENU ---
    
    // 1. Tri par score décroissant
    results = results.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 2. Application de la limite définie dans le menu 'configure'
    results = results.slice(0, MAX_RESULTS_SERVER);

    // --- FIN DE LA LOGIQUE ---

    const lines = results.map((r) => {
      const title = r.title || "Untitled";
      const url = r.url || "";
      const snippet = (r.snippet || r.description || "")
        .replace(/\s+/g, " ")
        .trim();
      const sources = r.sources || [];
      const source = r.source || r.engine || "unknown";
      const score = r.score != null ? ` (score: ${r.score})` : "";
      const sourceLabel = sources.length > 1
        ? `*Sources: ${sources.join(", ")}*`
        : `*Source: ${sources.length === 1 ? sources[0] : source}*`;
      return `- [${title}](${url})${score}\n  ${snippet}\n  ${sourceLabel}`;
    });

    let output = lines.join("\n\n");

    if (Array.isArray(data.relatedSearches) && data.relatedSearches.length > 0) {
      output += `\n\nRelated: ${data.relatedSearches.join(", ")}`;
    }

    return [{ type: "text", text: output }];
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return [{ type: "text", text: "Search timed out. Please try again." }];
    }
    return [{ type: "text", text: `Search error: ${err.message}` }];
  }
};

const handleSSE = async (req) => {
  if (await _isDisabled()) return _disabledResponse();
  const url = new URL(req.url);
  const sessionId = crypto.randomUUID();

  const { stream, session } = sseTransport.createStream(sessionId, () => {
    clearInterval(session._heartbeat);
  });

  const endpointPath = `${url.pathname}?sessionId=${sessionId}`;
  session.send("endpoint", endpointPath);

  session._heartbeat = setInterval(() => {
    session.send("heartbeat", {});
  }, HEARTBEAT_INTERVAL);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

const handleRPC = async (req) => {
  if (await _isDisabled()) return _disabledResponse();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const session = sessionId ? sseTransport.getSession(sessionId) : null;

  let message;
  try {
    message = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const response = await handleRequest(message, _search);

  if (session) {
    if (response) {
      session.send("message", response);
    }
    return new Response(null, { status: 202 });
  }

  if (!response) {
    return new Response(null, { status: 202 });
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const routes = [
  {
    method: "get",
    path: "/mcp",
    handler: handleSSE,
  },
  {
    method: "post",
    path: "/mcp",
    handler: handleRPC,
  },
];
