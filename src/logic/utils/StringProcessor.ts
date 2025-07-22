export class StringProcessor {
  private static escapeCache = new Map<string, string>();
  private static readonly MAX_CACHE_SIZE = 1000;

  // Comprehensive regex for Mermaid-problematic characters
  private static readonly escapeRegex = /"|\\|\n|[{}[\]();#]/g;
  private static readonly escapeMap: Record<string, string> = {
    '"': "&quot;",
    "\\": "\\\\",
    "\n": " ",
    "{": "&#123;",
    "}": "&#125;",
    "[": "&#91;",
    "]": "&#93;",
    "(": "&#40;",
    ")": "&#41;",
    ";": "&#59;",
    "#": "&#35;",
  };

  static escapeString(str: string): string {
    if (!str) {
      return "";
    }

    const trimmedStr = str.trim();
    if (StringProcessor.escapeCache.has(trimmedStr)) {
      return StringProcessor.escapeCache.get(trimmedStr)!;
    }

    // First pass: escape problematic characters
    let result = trimmedStr.replace(
      StringProcessor.escapeRegex,
      (match) => StringProcessor.escapeMap[match]
    );

    // Second pass: clean up common patterns that can cause issues
    result = result
      .replace(/:\s*$/, "") // Remove trailing colons
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim();

    // Length limiting for readability (apply after escaping)
    const MAX_LABEL_LENGTH = 100;
    if (result.length > MAX_LABEL_LENGTH) {
      result = result.substring(0, MAX_LABEL_LENGTH - 3) + "...";
    }

    if (StringProcessor.escapeCache.size >= StringProcessor.MAX_CACHE_SIZE) {
      StringProcessor.escapeCache.clear();
    }
    StringProcessor.escapeCache.set(trimmedStr, result);

    return result;
  }

  static clearCache(): void {
    StringProcessor.escapeCache.clear();
  }
}
