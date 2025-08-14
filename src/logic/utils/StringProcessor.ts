import { FlowchartEdge, FlowchartNode } from "../../ir/ir";

export class StringProcessor {
  private static escapeCache = new Map<string, string>();
  private static readonly MAX_CACHE_SIZE = 1000;

  // Precompiled regex for better performance
  private static readonly escapeRegex = /"|\\|\n|<|>|`/g;
  private static readonly colonRegex = /:$/;
  private static readonly escapeMap: Record<string, string> = {
    '"': "#quot;",
    "\\": "\\\\",
    "\n": " ",
    "<": "#60;",
    ">": "#62;",
    "`": "#96;",
  };

  static escapeString(str: string): string {
    if (!str) return "";

    // Check cache first
    const cached = this.escapeCache.get(str);
    if (cached !== undefined) {
      // Move to end for LRU behavior
      this.escapeCache.delete(str);
      this.escapeCache.set(str, cached);
      return cached;
    }

    // Use LRU eviction instead of clearing entire cache
    if (this.escapeCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.escapeCache.keys().next().value;
      if (firstKey !== undefined) {
        this.escapeCache.delete(firstKey);
      }
    }

    let escaped = str.replace(
      this.escapeRegex,
      (match) => this.escapeMap[match]
    );
    escaped = escaped.replace(this.colonRegex, "").trim();

    // Length limiting for readability
    const MAX_LABEL_LENGTH = 80;
    if (escaped.length > MAX_LABEL_LENGTH) {
      escaped = escaped.substring(0, MAX_LABEL_LENGTH - 3) + "...";
    }

    this.escapeCache.set(str, escaped);
    return escaped;
  }

  static clearCache(): void {
    this.escapeCache.clear();
  }
}

export interface ProcessResult {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  entryNodeId?: string;
  exitPoints: { id: string; label?: string }[];
  nodesConnectedToExit: Set<string>;
}

export interface LoopContext {
  breakTargetId: string;
  continueTargetId: string;
}
