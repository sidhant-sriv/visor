import { FlowchartIR, FlowchartNode } from "../ir/ir";
import { StringProcessor } from "./utils/StringProcessor";
import {
  SyntaxHighlighter,
  SyntaxHighlightSettings,
  HighlightOptions,
} from "./utils/SyntaxHighlighter";
import * as vscode from "vscode";

// Optimized string building
class StringBuilder {
  private parts: string[] = [];

  append(str: string): void {
    this.parts.push(str);
  }

  appendLine(str: string): void {
    this.parts.push(str, "\n");
  }

  toString(): string {
    return this.parts.join("");
  }

  clear(): void {
    this.parts.length = 0;
  }
}

export class MermaidGenerator {
  private sb = new StringBuilder();
  private syntaxHighlighter = new SyntaxHighlighter();
  private settings: SyntaxHighlightSettings;

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): SyntaxHighlightSettings {
    const config = vscode.workspace.getConfiguration("visor");
    return {
      enabled: config.get("syntaxHighlighting.enabled", false),
      maxCharacters: config.get("syntaxHighlighting.maxCharacters", 200),
      maxLines: config.get("syntaxHighlighting.maxLines", 10),
      showLineNumbers: config.get("syntaxHighlighting.showLineNumbers", false),
      theme: config.get("syntaxHighlighting.theme", "auto"),
      supportedLanguages: ["python", "typescript", "javascript", "java", "cpp"],
    };
  }

  public generate(ir: FlowchartIR): string {
    // Reload settings on each generation to pick up changes
    this.settings = this.loadSettings();

    this.sb.clear();
    this.sb.appendLine("graph TD");

    if (ir.title) {
      this.sb.appendLine(`%% ${ir.title}`);
    }

    // Generate nodes efficiently
    for (const node of ir.nodes) {
      const shape = this.getShape(node);
      const label = this.generateNodeLabel(node);
      this.sb.append("    ");
      this.sb.append(node.id);
      this.sb.append(shape[0]);
      this.sb.append('"');
      this.sb.append(label);
      this.sb.append('"');
      this.sb.append(shape[1]);
      this.sb.appendLine("");
    }

    // Generate edges efficiently
    for (const edge of ir.edges) {
      this.sb.append("    ");
      this.sb.append(edge.from);

      if (edge.label) {
        const label = this.escapeString(edge.label);
        this.sb.append(' -- "');
        this.sb.append(label);
        this.sb.append('" --> ');
      } else {
        this.sb.append(" --> ");
      }

      this.sb.append(edge.to);
      this.sb.appendLine("");
    }

    // Generate click handlers efficiently
    for (const entry of ir.locationMap) {
      this.sb.append("    click ");
      this.sb.append(entry.nodeId);
      this.sb.append(" call onNodeClick(");
      this.sb.append(entry.start.toString());
      this.sb.append(", ");
      this.sb.append(entry.end.toString());
      this.sb.appendLine(")");
    }

    return this.sb.toString();
  }

  /**
   * Generate the label for a node, with optional syntax highlighting
   */
  private generateNodeLabel(node: FlowchartNode): string {
    if (!this.settings.enabled || !node.sourceCode) {
      return this.escapeString(node.label);
    }

    // Check if the language is supported
    if (!this.settings.supportedLanguages.includes(node.sourceCode.language)) {
      return this.escapeString(node.label);
    }

    try {
      const theme =
        this.settings.theme === "auto"
          ? this.detectTheme()
          : (this.settings.theme as "light" | "dark");

      const options: HighlightOptions = {
        language: node.sourceCode.language,
        theme,
        maxLines: this.settings.maxLines,
        showLineNumbers: this.settings.showLineNumbers,
        maxCharacters: this.settings.maxCharacters,
      };

      const result = this.syntaxHighlighter.highlight(
        node.sourceCode.text,
        options
      );

      // Create HTML template for the highlighted code
      let htmlLabel = this.createHTMLNodeTemplate(
        result.html,
        node.shape || "rect"
      );

      if (result.truncated) {
        htmlLabel += '<div class="truncation-indicator">...</div>';
      }

      // Prepare HTML for Mermaid
      return StringProcessor.prepareHTMLContent(htmlLabel);
    } catch (error) {
      // Fallback to regular escaped text if highlighting fails
      console.warn("Syntax highlighting failed for node:", node.id, error);
      return this.escapeString(node.label);
    }
  }

  /**
   * Create HTML template for a syntax highlighted node
   */
  private createHTMLNodeTemplate(
    highlightedCode: string,
    nodeShape: string
  ): string {
    return `
            <div class="syntax-node ${nodeShape}">
                <div class="code-content">
                    ${highlightedCode}
                </div>
            </div>
        `;
  }

  /**
   * Detect the current VSCode theme
   */
  private detectTheme(): "light" | "dark" {
    try {
      const colorTheme = vscode.window.activeColorTheme;
      return colorTheme.kind === vscode.ColorThemeKind.Dark ? "dark" : "light";
    } catch {
      return "dark"; // Default fallback
    }
  }

  /**
   * Get CSS styles for syntax highlighting
   */
  public getSyntaxHighlightCSS(): string {
    if (!this.settings.enabled) {
      return "";
    }

    const theme =
      this.settings.theme === "auto"
        ? this.detectTheme()
        : (this.settings.theme as "light" | "dark");

    const themeCSS = this.syntaxHighlighter.getThemeCSS(theme);

    return `
            <style>
                .syntax-node {
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                    font-size: 12px;
                    line-height: 1.4;
                    padding: 8px 12px;
                    border-radius: 4px;
                    background: ${theme === "dark" ? "#1e1e1e" : "#ffffff"};
                    border: 1px solid ${
                      theme === "dark" ? "#3e3e3e" : "#cccccc"
                    };
                    max-width: 300px;
                    overflow: hidden;
                    text-align: left;
                }

                .syntax-node .code-content {
                    white-space: pre-wrap;
                    word-break: break-word;
                }

                .syntax-node.rect {
                    border-radius: 4px;
                }

                .syntax-node.diamond {
                    border-radius: 8px;
                    background: ${theme === "dark" ? "#2e2e2e" : "#f5f5f5"};
                }

                .truncation-indicator {
                    color: ${theme === "dark" ? "#888888" : "#666666"};
                    font-style: italic;
                    margin-top: 4px;
                    text-align: center;
                    font-size: 10px;
                }

                ${themeCSS}
            </style>
        `;
  }

  private getShape(node: FlowchartNode): [string, string] {
    switch (node.shape) {
      case "diamond":
        return ["{", "}"];
      case "round":
        return ["((", "))"];
      case "stadium":
        return ["([", "])"];
      case "rect":
      default:
        return ["[", "]"];
    }
  }

  private escapeString(str: string): string {
    return StringProcessor.escapeString(str);
  }
}
