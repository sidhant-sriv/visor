export interface HighlightOptions {
  language: string;
  theme: "light" | "dark" | "auto";
  maxLines: number;
  showLineNumbers: boolean;
  maxCharacters: number;
}

export interface HighlightResult {
  html: string;
  truncated: boolean;
  lineCount: number;
  originalLength: number;
}

export interface CodeSnippet {
  text: string;
  startIndex: number;
  endIndex: number;
  language: string;
  nodeType: string;
}

export interface SyntaxHighlightSettings {
  enabled: boolean;
  maxCharacters: number;
  maxLines: number;
  showLineNumbers: boolean;
  theme: "auto" | "light" | "dark";
  supportedLanguages: string[];
}

/**
 * Cache for storing highlighted code results to improve performance
 */
class HighlightCache {
  private cache = new Map<string, HighlightResult>();
  private readonly MAX_CACHE_SIZE = 100;

  private generateKey(code: string, options: HighlightOptions): string {
    return `${options.language}:${options.theme}:${options.maxLines}:${options.showLineNumbers}:${code}`;
  }

  get(code: string, options: HighlightOptions): HighlightResult | undefined {
    return this.cache.get(this.generateKey(code, options));
  }

  set(code: string, options: HighlightOptions, result: HighlightResult): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(this.generateKey(code, options), result);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Main syntax highlighter class that provides syntax highlighting functionality
 * for code snippets in flowchart nodes
 */
export class SyntaxHighlighter {
  private cache = new HighlightCache();

  /**
   * Language mapping from parser types to Prism.js language identifiers
   */
  private readonly languageMap: Record<string, string> = {
    python: "python",
    typescript: "typescript",
    javascript: "javascript",
    java: "java",
    cpp: "cpp",
    c: "c",
  };

  /**
   * Highlights code using a simple token-based approach
   * In a real implementation, this would use Prism.js or similar library
   */
  highlight(code: string, options: HighlightOptions): HighlightResult {
    // Check cache first
    const cached = this.cache.get(code, options);
    if (cached) {
      return cached;
    }

    const originalLength = code.length;
    let processedCode = code;
    let truncated = false;

    // Truncate by character limit
    if (processedCode.length > options.maxCharacters) {
      processedCode = processedCode.substring(0, options.maxCharacters);
      truncated = true;
    }

    // Split into lines and limit by line count
    const lines = processedCode.split("\n");
    const lineCount = lines.length;

    if (lines.length > options.maxLines) {
      processedCode = lines.slice(0, options.maxLines).join("\n");
      truncated = true;
    }

    // Apply basic syntax highlighting
    const highlightedHtml = this.applyBasicHighlighting(
      processedCode,
      options.language
    );

    const result: HighlightResult = {
      html: highlightedHtml,
      truncated,
      lineCount: Math.min(lineCount, options.maxLines),
      originalLength,
    };

    // Cache the result
    this.cache.set(code, options, result);

    return result;
  }

  /**
   * Basic syntax highlighting implementation
   * This is a simplified version - in production would use Prism.js
   */
  private applyBasicHighlighting(code: string, language: string): string {
    let highlighted = this.escapeHtml(code);

    // Apply language-specific highlighting patterns
    switch (language) {
      case "python":
        highlighted = this.highlightPython(highlighted);
        break;
      case "typescript":
      case "javascript":
        highlighted = this.highlightJavaScript(highlighted);
        break;
      case "java":
        highlighted = this.highlightJava(highlighted);
        break;
      case "cpp":
      case "c":
        highlighted = this.highlightCpp(highlighted);
        break;
      default:
        highlighted = this.highlightGeneric(highlighted);
    }

    return highlighted;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private highlightPython(code: string): string {
    return (
      code
        // Keywords
        .replace(
          /\b(def|class|if|elif|else|for|while|try|except|finally|with|import|from|as|return|yield|lambda|and|or|not|in|is|True|False|None)\b/g,
          '<span class="token keyword">$1</span>'
        )
        // Strings
        .replace(
          /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g,
          '<span class="token string">$1$2$1</span>'
        )
        // Comments
        .replace(/(#.*$)/gm, '<span class="token comment">$1</span>')
        // Numbers
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token number">$1</span>')
        // Functions
        .replace(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g,
          '<span class="token function">$1</span>'
        )
    );
  }

  private highlightJavaScript(code: string): string {
    return (
      code
        // Keywords
        .replace(
          /\b(function|const|let|var|if|else|for|while|do|switch|case|default|try|catch|finally|return|class|extends|import|export|from|as|async|await|typeof|instanceof)\b/g,
          '<span class="token keyword">$1</span>'
        )
        // Strings
        .replace(
          /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
          '<span class="token string">$1$2$1</span>'
        )
        // Comments
        .replace(
          /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
          '<span class="token comment">$1</span>'
        )
        // Numbers
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token number">$1</span>')
        // Functions
        .replace(
          /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g,
          '<span class="token function">$1</span>'
        )
    );
  }

  private highlightJava(code: string): string {
    return (
      code
        // Keywords
        .replace(
          /\b(public|private|protected|static|final|abstract|class|interface|extends|implements|if|else|for|while|do|switch|case|default|try|catch|finally|return|new|this|super|void|int|String|boolean|double|float|long|char)\b/g,
          '<span class="token keyword">$1</span>'
        )
        // Strings
        .replace(
          /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g,
          '<span class="token string">$1$2$1</span>'
        )
        // Comments
        .replace(
          /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
          '<span class="token comment">$1</span>'
        )
        // Numbers
        .replace(
          /\b(\d+(?:\.\d+)?[fFdDlL]?)\b/g,
          '<span class="token number">$1</span>'
        )
        // Functions
        .replace(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g,
          '<span class="token function">$1</span>'
        )
    );
  }

  private highlightCpp(code: string): string {
    return (
      code
        // Keywords
        .replace(
          /\b(int|float|double|char|bool|void|if|else|for|while|do|switch|case|default|try|catch|return|class|struct|public|private|protected|static|const|virtual|namespace|using|include|define)\b/g,
          '<span class="token keyword">$1</span>'
        )
        // Strings
        .replace(
          /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g,
          '<span class="token string">$1$2$1</span>'
        )
        // Comments
        .replace(
          /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
          '<span class="token comment">$1</span>'
        )
        // Numbers
        .replace(
          /\b(\d+(?:\.\d+)?[fFdDlL]?)\b/g,
          '<span class="token number">$1</span>'
        )
        // Functions
        .replace(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g,
          '<span class="token function">$1</span>'
        )
    );
  }

  private highlightGeneric(code: string): string {
    return (
      code
        // Basic keywords (common across languages)
        .replace(
          /\b(if|else|for|while|return|function|class)\b/g,
          '<span class="token keyword">$1</span>'
        )
        // Strings
        .replace(
          /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
          '<span class="token string">$1$2$1</span>'
        )
        // Numbers
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token number">$1</span>')
    );
  }

  /**
   * Get theme-specific CSS for syntax highlighting
   */
  getThemeCSS(theme: "light" | "dark"): string {
    if (theme === "dark") {
      return `
        .syntax-node .token.keyword { color: #569cd6; }
        .syntax-node .token.string { color: #ce9178; }
        .syntax-node .token.comment { color: #6a9955; }
        .syntax-node .token.number { color: #b5cea8; }
        .syntax-node .token.function { color: #dcdcaa; }
      `;
    } else {
      return `
        .syntax-node .token.keyword { color: #0000ff; }
        .syntax-node .token.string { color: #a31515; }
        .syntax-node .token.comment { color: #008000; }
        .syntax-node .token.number { color: #09885a; }
        .syntax-node .token.function { color: #795e26; }
      `;
    }
  }

  /**
   * Detect language from parser type and file context
   */
  detectLanguage(parserType: string, fileExtension?: string): string {
    // Try parser type first
    if (this.languageMap[parserType]) {
      return this.languageMap[parserType];
    }

    // Fallback to file extension
    if (fileExtension) {
      const extMap: Record<string, string> = {
        ".py": "python",
        ".ts": "typescript",
        ".js": "javascript",
        ".java": "java",
        ".cpp": "cpp",
        ".c": "c",
        ".hpp": "cpp",
        ".h": "c",
      };
      return extMap[fileExtension] || "text";
    }

    return "text";
  }

  /**
   * Clear the highlighting cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
