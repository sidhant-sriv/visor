import * as crypto from "crypto";
import { logInfo, logWarn, logError } from "./LLMLogger";

export type Provider = "openai" | "gemini" | "groq";

export interface TranslateParams {
  mermaidSource: string;
  provider: Provider;
  model: string;
  apiKey: string;
  style?: string;
  language?: string;
}

export class LLMService {
  public static getDefaultModels(provider: Provider): string[] {
    switch (provider) {
      case "openai":
        return [ "gpt-4o-mini", "gpt-4o", "o3-mini"];
      case "gemini":
        return ["gemini-1.5-flash", "gemini-1.5-pro"];
      case "groq":
        return ["openai/gpt-oss-20b"];
    }
  }

  public static async computeCacheKey(
    mermaidSource: string,
    provider: Provider,
    model: string,
    style?: string,
    language?: string
  ): Promise<string> {
    const version = "v2";
    const h = crypto.createHash("sha256");
    h.update(mermaidSource);
    h.update(`|${provider}|${model}|style=${style || ""}|lang=${language || ""}|${version}`);
    return h.digest("hex");
  }

  public async translateLabels(params: TranslateParams): Promise<string | null> {
    const { mermaidSource, provider } = params;
    logInfo(`Translate request: provider=${provider}`);
    // For Groq, request full Mermaid rewrite preserving structure
    if (provider === "groq") {
      logInfo(`Calling Groq full-mermaid rewrite`);
      const rewrittenMermaid = await callGroqRewriteMermaid(params);
      if (!rewrittenMermaid) return null;
      return rewrittenMermaid;
    }
    // Default: label-only translation
    const extraction = extractNodeLabels(mermaidSource);
    if (extraction.labels.length === 0) return null;
    const rewritten = await callProvider(params, extraction.labels);
    if (!rewritten || rewritten.length !== extraction.labels.length) return null;
    return replaceNodeLabels(mermaidSource, extraction, rewritten);
  }
}

// Helpers for Mermaid parsing and replacement
export interface ExtractedLabels {
  // Each entry describes one node occurrence
  occurrences: Array<{
    start: number; // start index of label content without quotes
    end: number; // end index of label content without quotes
  }>;
  labels: string[];
}

// Very targeted parser: find lines like `id["label"]`, `id("label")`, `id{{"label"}}`, etc.
// It preserves any shape markers around the quoted label by only replacing the quoted content.
export function extractNodeLabels(source: string): ExtractedLabels {
  const occurrences: ExtractedLabels["occurrences"] = [];
  const labels: string[] = [];
  const pattern = /(\n|^)\s*([A-Za-z0-9_\-]+)\s*([\[\(\{><]{1,2})\s*"([\s\S]*?)"\s*([\]\)\}><]{1,2})\s*$(?=)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const labelStartInMatch = match.index + match[0].indexOf("\"") + 1; // after first quote
    const labelEndInMatch = match.index + match[0].lastIndexOf("\""); // position of last quote
    const start = labelStartInMatch;
    const end = labelEndInMatch;
    const label = match[4];
    occurrences.push({ start, end });
    labels.push(htmlUnescape(label));
  }
  return { occurrences, labels };
}

export function replaceNodeLabels(
  source: string,
  extracted: ExtractedLabels,
  newLabels: string[]
): string {
  if (extracted.labels.length !== newLabels.length) return source;
  let result = source;
  // Replace from end to start to preserve indices
  for (let i = extracted.occurrences.length - 1; i >= 0; i--) {
    const { start, end } = extracted.occurrences[i];
    const replacement = escapeForMermaid(newLabels[i]);
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

function escapeForMermaid(label: string): string {
  // Sanitize and escape double quotes
  const cleaned = sanitizeLabel(label);
  return cleaned.replace(/"/g, '\\"');
}

function htmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

async function callProvider(params: TranslateParams, labels: string[]): Promise<string[] | null> {
  const { provider, model, apiKey, style, language } = params;
  const instruction = [
    "You are a label rewritter for flowchart nodes.",
    "- INPUT: JSON with keys 'instruction' and 'labels' (array of strings).",
    "- TASK: Paraphrase each label into human language, keeping semantic meaning but removing code identifiers and syntax.",
    "- STRICT RULES:",
    "  1) Output MUST be a JSON array of strings ONLY (no object wrapper, no extra keys).",
    "  2) The array length and order MUST MATCH the input 'labels'.",
    "  3) Each item MUST be a single line (no newlines).",
    "  4) Do NOT include Markdown, code fences, or backticks.",
    "  5) Avoid quoting variable names or including code syntax; use natural language.",
    "  6) Keep each label under 120 characters if possible.",
    `  7) Style: ${style || "concise"}.` + (language ? ` Output language: ${language}.` : ""),
    "- EXAMPLE INPUT: {\"instruction\":\"...\",\"labels\":[\"if (x > 0)\",\"return y\"]}",
    "- EXAMPLE OUTPUT: [\"Check whether x is positive\",\"Return the value\"]",
  ].join("\n");
  const payload = { instruction, labels };

  try {
    switch (provider) {
      case "openai":
        return await callOpenAI(model, apiKey, payload);
      case "gemini":
        return await callGemini(model, apiKey, payload);
      case "groq":
        return await callGroq(model, apiKey, payload);
    }
  } catch {
    return null;
  }
}

// -------------------- Provider response types and guards --------------------
interface OpenAIChatMessage {
  content?: string;
}
interface OpenAIChatChoice {
  message?: OpenAIChatMessage;
}
interface OpenAIChatCompletionResponse {
  choices?: OpenAIChatChoice[];
}
function isOpenAIChatCompletionResponse(x: unknown): x is OpenAIChatCompletionResponse {
  if (!x || typeof x !== "object") return false;
  const obj = x as { choices?: unknown };
  if (!Array.isArray(obj.choices)) return false;
  // Basic sanity check on first choice
  const first = obj.choices[0] as unknown;
  if (!first || typeof first !== "object") return true; // allow empty/unknown structure but array exists
  const msg = (first as { message?: unknown }).message;
  return msg === undefined || typeof msg === "object";
}

interface GeminiPart { text?: string }
interface GeminiContent { parts?: GeminiPart[] }
interface GeminiCandidate { content?: GeminiContent }
interface GeminiGenerateContentResponse { candidates?: GeminiCandidate[] }
function isGeminiGenerateContentResponse(x: unknown): x is GeminiGenerateContentResponse {
  if (!x || typeof x !== "object") return false;
  const obj = x as { candidates?: unknown };
  if (!Array.isArray(obj.candidates)) return false;
  // Minimal validation
  return true;
}

function parseLabelsJsonText(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s));
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { labels?: unknown }).labels)) {
      return ((parsed as { labels: unknown[] }).labels).map((s) => String(s));
    }
    return null;
  } catch {
    return null;
  }
}

// -------------------- Provider calls --------------------
async function callOpenAI(model: string, apiKey: string, payload: { instruction: string; labels: string[] }): Promise<string[] | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Follow the user's constraints exactly. Output pure JSON array only." },
        { role: "user", content: payload.instruction },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (!isOpenAIChatCompletionResponse(data)) return null;
  const content: string | undefined = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : undefined;
  if (!content) return null;
  return parseLabelsJsonText(content);
}

async function callGemini(model: string, apiKey: string, payload: { instruction: string; labels: string[] }): Promise<string[] | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: "Follow constraints exactly. Output JSON array only." },
              { text: payload.instruction },
              { text: JSON.stringify(payload) },
            ],
          },
        ],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (!isGeminiGenerateContentResponse(data)) return null;
  const first = data.candidates && data.candidates[0];
  const text: string | undefined = first && first.content && first.content.parts && first.content.parts[0] ? first.content.parts[0].text : undefined;
  if (!text) return null;
  return parseLabelsJsonText(text);
}

async function callGroq(model: string, apiKey: string, payload: { instruction: string; labels: string[] }): Promise<string[] | null> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Follow the user's constraints exactly. Output pure JSON array only." },
      { role: "user", content: payload.instruction },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
  logInfo(`Groq label-array request: model=${model} body=${JSON.stringify(body).slice(0, 2000)}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (!isOpenAIChatCompletionResponse(data)) return null;
  const content: string | undefined = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : undefined;
  if (!content) return null;
  return parseLabelsJsonText(content);
}

// -------------------- Groq: full Mermaid rewrite path --------------------
function buildGroqMermaidPrompt(mermaidSource: string, style?: string, language?: string): string {
  const lines: string[] = [];
  const promptTemplate = `
You are given a Mermaid diagram in code form.

- The diagram represents program logic with nodes and edges.
- Keep the exact same structure, node IDs, and connections.
- Replace only the node labels that contain code with plain-English descriptions of what that code does.
- Decision nodes should be written as yes/no questions when possible.
- Preserve all flow and logic exactly as in the original diagram.
- Keep the output as valid Mermaid syntax so it can be rendered directly.
- Keep style/class definitions exactly as they appear in the input.
- Do not add explanations, comments, or any other text outside the Mermaid code.
- Do not wrap the output in code fences; output Mermaid code only.
`.trim();
  lines.push(promptTemplate);
  if (style) lines.push(`- Style: ${style}.`);
  if (language) lines.push(`- Output language: ${language}.`);
  lines.push("");
  lines.push("INPUT MERMAID:");
  lines.push(mermaidSource);
  return lines.join("\n");
}

function cleanMermaidResponse(text: string): string | null {
  if (!text) return null;
  let s = text.trim();
  // Extract from code fences if present
  const mermaidFence = /```\s*mermaid\s*([\s\S]*?)```/i.exec(s);
  if (mermaidFence && mermaidFence[1]) {
    s = mermaidFence[1].trim();
  } else {
    const genericFence = /```([\s\S]*?)```/.exec(s);
    if (genericFence && genericFence[1]) {
      s = genericFence[1].trim();
    }
  }
  // If any preface before 'graph' leaked in, keep from first 'graph'
  const idx = s.toLowerCase().indexOf("graph ");
  if (idx > 0) s = s.slice(idx).trim();
  // Convert literal escape sequences (e.g., \n) to real newlines if present
  if (/\\n/.test(s) && !/\n/.test(s)) {
    s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  // Normalize Windows newlines
  s = s.replace(/\r\n/g, "\n");
  // Basic validity check
  if (!/^graph\s+/i.test(s)) return null;
  return s;
}

async function callGroqRewriteMermaid(params: TranslateParams): Promise<string | null> {
  const { model, apiKey, mermaidSource, style, language } = params;
  const prompt = buildGroqMermaidPrompt(mermaidSource, style, language);
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: "You transform Mermaid diagrams by understanding and rewriting only node labels to plain English. You must preserve structure and return Mermaid code only, with no extra text or fences." },
      { role: "user", content: prompt },
    ],
  };
  logInfo(`Groq full-mermaid request: model=${model} body=${JSON.stringify(body).slice(0, 2000)}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logError(`Groq fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (!isOpenAIChatCompletionResponse(data)) return null;
  const content: string | undefined = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : undefined;
  if (!content) return null;
  const cleaned = cleanMermaidResponse(content);
  if (!cleaned) {
    logWarn("Groq response did not contain a valid Mermaid graph; attempting fallback label replacement.");
    // Fallback: try to extract labels JSON from message and rebuild
    const labels = parseLabelsJsonText(content);
    if (labels && labels.length > 0) {
      try {
        const extraction = extractNodeLabels(params.mermaidSource);
        if (extraction.labels.length === labels.length) {
          return replaceNodeLabels(params.mermaidSource, extraction, labels);
        }
      } catch {}
    }
  }
  return cleaned;
}

// -------------------- Groq models listing --------------------
interface GroqModelsListResponse { data?: Array<{ id?: string }> }
function isGroqModelsListResponse(x: unknown): x is GroqModelsListResponse {
  if (!x || typeof x !== "object") return false;
  const obj = x as { data?: unknown };
  if (!Array.isArray(obj.data)) return false;
  return true;
}

export async function getGroqModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      logWarn(`Groq models list failed: ${res.status}`);
      return [];
    }
    const data: unknown = await res.json();
    if (!isGroqModelsListResponse(data)) return [];
    const ids = data.data?.map((m) => (m && m.id ? String(m.id) : "")).filter((s) => !!s) || [];
    // Optional: filter to chat-capable models
    return ids;
  } catch {
    return [];
  }
}

// -------------------- Label sanitation --------------------
function sanitizeLabel(label: string): string {
  let s = label;
  // Remove code fences and backticks
  s = s.replace(/```[\s\S]*?```/g, "");
  s = s.replace(/`/g, "");
  // Remove surrounding quotes if present
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // Collapse whitespace and remove newlines
  s = s.replace(/\r?\n|\r/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Limit length
  const maxLen = 120;
  if (s.length > maxLen) {
    s = s.slice(0, maxLen - 1).trimEnd() + "…";
  }
  return s;
}


