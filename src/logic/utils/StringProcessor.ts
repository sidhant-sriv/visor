export class StringProcessor {
  private static escapeCache = new Map<string, string>();
  private static readonly MAX_CACHE_SIZE = 1000;

  // More forgiving regex for Mermaid labels
  private static readonly escapeRegex = /"|\\|\n/g;
  private static readonly escapeMap: Record<string, string> = {
    '"': '&quot;',
    '\\': '\\\\',
    '\n': '<br>',
  };

  static escapeString(str: string): string {
    if (!str) {
      return '';
    }

    const trimmedStr = str.trim();
    if (StringProcessor.escapeCache.has(trimmedStr)) {
      return StringProcessor.escapeCache.get(trimmedStr)!;
    }

    const result = trimmedStr.replace(
      StringProcessor.escapeRegex,
      (match) => StringProcessor.escapeMap[match]
    );

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