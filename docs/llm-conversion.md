## LLM Label Conversion: Architecture, Caching, and Usage

This document explains how Visor’s LLM-based label conversion works end-to-end: what is sent to providers, how responses are applied to the diagram, and how caching, configuration, and privacy are handled.

### What it does

- Converts low-level, code-like node labels in the generated Mermaid diagram into concise, human-readable language using an LLM.
- Preserves the diagram’s control-flow structure, node IDs, and interactivity.
- Preserves interactive edge highlighting by embedding and restoring metadata.

### When it runs

1) Visor analyzes your current file/function to produce a Mermaid diagram (local, offline).
2) You can toggle LLM mode on or off directly in the flowchart view.
3) If LLM mode is enabled, Visor attempts to rewrite node labels via the configured provider.
4) The result is cached using a strong content-based key, so repeated requests are fast and do not re-hit the LLM.

---

## User workflow

- Enable LLM features:
  - In the flowchart view, click the "Enable LLM" button.
  - *or* Command palette → “Visor: Enable LLM Labels” (`visor.llm.enableLabels`)
  - The first time, you will choose a provider (OpenAI, Gemini, Groq, or local Ollama), provide an API key if needed (stored securely in VS Code Secrets), and pick a model.

- Toggle LLM labels:
  - In the flowchart view, click the "LLM" toggle button (🧠) to switch between original and rewritten labels.

- Change model later:
  - Command palette → “Visor: Change LLM Model” (`visor.llm.changeModel`)

- Reset cache:
  - Command palette → “Visor: Reset LLM Cache” (`visor.llm.resetCache`)

- In the flowchart view, when LLM is enabled, Visor will attempt the conversion and apply it automatically. If conversion fails, Visor falls back to the original labels and shows a warning.

---

## Settings and secrets

- Settings (VS Code → Settings → “Visor” → “LLM”):
  - `visor.llm.enabled`: enable/disable label rewriting
  - `visor.llm.provider`: `openai` | `gemini` | `groq` | `ollama`
  - `visor.llm.model`: model identifier for the provider
  - `visor.llm.style`: textual style hint (e.g., "concise", "descriptive")
  - `visor.llm.language`: output language hint (e.g., "en", "es")

- Secrets (stored in VS Code Secret Storage):
  - API keys: `visor.llm.<provider>.apiKey` for cloud providers
  - Ollama base URL: `visor.llm.ollama.baseUrl` (defaults to `http://localhost:11434`)

Example user settings snippet:

```json
{
  "visor.llm.enabled": true,
  "visor.llm.provider": "openai",
  "visor.llm.model": "gpt-4o-mini",
  "visor.llm.style": "concise",
  "visor.llm.language": "en"
}
```

---

## High-level architecture

1) Code analysis → Mermaid generation (local only)
   - `analyzeCode` builds an intermediate representation (IR) of control flow.
   - `EnhancedMermaidGenerator` renders the Mermaid graph from the IR, including style and click handlers.

2) LLM conversion (optional)
   - `BaseFlowchartProvider` requests an LLM rewrite when enabled, via `LLMManager.translateIfNeeded`.
   - To preserve interactivity, `click` handlers and `%% EDGE_META` comments are extracted from the original Mermaid, and then merged back into the translated Mermaid.

3) Caching
   - `LLMManager` uses a two-tier cache (in-memory + persistent in VS Code `globalState`) keyed by a content+config hash.
   - For non-Groq providers, an additional per-label cache allows for incremental updates, further reducing redundant API calls.

---

## Conversion logic

There are two paths depending on the provider:

- Default (OpenAI, Gemini, Ollama): label-only translation
  - `LLMService.extractNodeLabels` scans the Mermaid source to extract quoted labels from nodes, preserving shapes and IDs.
  - Visor sends a compact prompt + the array of labels to the provider, asking for a JSON array of rewritten labels.
  - The response is parsed and validated; labels are sanitized and `replaceNodeLabels` rebuilds the Mermaid with new labels.

- Groq special path: full-Mermaid rewrite
  - For `provider === "groq"`, Visor asks for a full Mermaid rewrite that preserves structure and styling while replacing label text.
  - The response is cleaned (code fences removed, basic validity checked). If it’s invalid, Visor falls back to the label-only replacement strategy when possible.

In all cases, the output Mermaid is posted back to the webview. Metadata comments and original click lines are reattached to maintain node and edge interactivity.

---

## Interactivity (Edge Highlighting)

- To enable hover-based highlighting of a node's outgoing edges and children, Visor embeds special comments in the Mermaid source:
  `%% EDGE_META:<source_node_id>:<target_node_id>`
- This metadata is parsed by the webview's JavaScript to build a graph of connections.
- During LLM translation, these comments are extracted and then re-injected into the rewritten Mermaid to ensure highlighting continues to work.

---

## Providers

- OpenAI: Chat Completions API
- Gemini: Generative Language API
- Groq: OpenAI-compatible Chat Completions API
- Ollama: Local `/api/chat` endpoint; no cloud traffic

Each provider has a helper that issues the request, handles errors, and normalizes the response into a string array (label-only) or Mermaid text (Groq full rewrite).

---

## Caching details

- Two-tier cache for full Mermaid rewrites:
  - In-memory: `Map<string, string>` within the session.
  - Persistent: `context.globalState["visor.llm.cache"]` survives window reloads.

- Incremental cache for individual labels (non-Groq providers):
  - A separate persistent cache stores translations for individual labels.
  - When a diagram changes slightly, only new or modified labels are sent to the provider.

- Cache key (versioned):
  - `sha256(mermaidSource + provider + model + style + language + version)` with an internal `version`.
  - Any change in code, provider, model, style, or language yields a new key and triggers a fresh conversion.

---

## Privacy

- All parsing and Mermaid generation happen locally.
- For label-only providers (OpenAI, Gemini, Ollama), only the extracted labels and prompt are sent, not your source code.
- For Groq full rewrite, the entire Mermaid diagram text is sent (still not your source code), so the LLM can return full Mermaid.
- Ollama runs locally; no data leaves your machine.

---

## Error handling and fallbacks

- Missing API key (non-Ollama providers): LLM is considered unavailable; no conversion is attempted.
- Request or response errors: conversion returns `null` or original Mermaid; UI warns and renders original labels.
- Robust JSON parsing: Visor tolerates some response variations and still attempts to extract a valid label array.

---

## Extending to a new provider

1) Add the provider to the `Provider` union type in the LLM code.
2) Implement a provider-specific call helper that returns a string array (label path) or Mermaid string (full rewrite path).
3) Add default models or listing logic if available.
4) Wire up secrets (API key or base URL) and update the enable/model-change flows.

---

## FAQ

- Why are some labels unchanged?
  - Nodes without quoted labels or labels that look like plain language may be left as-is. The LLM also aims to preserve meaning.

- Does changing style or language affect caching?
  - Yes. Both are part of the cache key, so updates trigger a re-conversion.

- How do I ensure no cloud calls?
  - Use `ollama` and leave cloud providers disabled. Ollama runs locally.

- How do I clear stale results?
  - Run “Visor: Reset LLM Cache”. This clears all related memory and persistent caches.


