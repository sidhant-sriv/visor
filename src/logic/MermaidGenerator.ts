import { FlowchartIR, FlowchartNode } from "../ir/ir";
import { StringProcessor } from "./utils/StringProcessor";
import {
  SyntaxHighlighter,
  SyntaxHighlightSettings,
  HighlightOptions,
} from "./utils/SyntaxHighlighter";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

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
  private debugLog: string[] = [];
  private logFilePath: string;

  constructor() {
    this.settings = this.loadSettings();
    // Create a temp file for debug logs
    const tempDir = require("os").tmpdir();
    this.logFilePath = path.join(tempDir, `visor-debug-${Date.now()}.log`);
    this.log("=== VISOR DEBUG LOG STARTED ===");
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.debugLog.push(logEntry);
    console.log(message);

    // Also write to file immediately for debugging
    try {
      fs.appendFileSync(this.logFilePath, logEntry + "\n");
    } catch (error) {
      console.error("Failed to write to debug log file:", error);
    }
  }

  private loadSettings(): SyntaxHighlightSettings {
    const config = vscode.workspace.getConfiguration("visor");
    return {
      enabled: config.get("syntaxHighlighting.enabled", true),
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

    this.log(`Debug log file: ${this.logFilePath}`);
    this.log("=== STARTING FLOWCHART GENERATION ===");

    this.sb.clear();
    this.sb.appendLine("graph TD");

    if (ir.title) {
      this.sb.appendLine(`%% ${ir.title}`);
    }

    // Generate nodes efficiently
    this.log("=== PROCESSING NODES ===");
    this.log(`Total nodes: ${ir.nodes.length}`);

    for (const node of ir.nodes) {
      this.log(`Processing node: ${node.id}, label: ${node.label}`);
      this.log(`Node has sourceCode: ${!!node.sourceCode}`);
      if (node.sourceCode) {
        this.log(`SourceCode language: ${node.sourceCode.language}`);
        this.log(`SourceCode text length: ${node.sourceCode.text.length}`);
        this.log(
          `SourceCode text preview: ${node.sourceCode.text.substring(
            0,
            100
          )}...`
        );
      }

      const shape = this.getShape(node);
      const label = this.generateNodeLabel(node);

      // Add CSS class for syntax highlighting if node has source code
      const cssClass =
        node.sourceCode && this.settings.enabled
          ? `:::syntax-${node.sourceCode.language}`
          : "";

      this.sb.append("    ");
      this.sb.append(node.id);
      this.sb.append(shape[0]);
      this.sb.append('"');
      this.sb.append(label);
      this.sb.append('"');
      this.sb.append(shape[1]);
      this.sb.append(cssClass);
      this.sb.appendLine("");
    }
    this.log("=== END PROCESSING NODES ===");

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

    const finalMermaid = this.sb.toString();

    // Debug logging - log the final Mermaid syntax
    this.log("=== FINAL MERMAID SYNTAX ===");
    this.log(finalMermaid);
    this.log("=== END MERMAID SYNTAX ===");

    // Also log settings for debugging
    this.log("=== SYNTAX HIGHLIGHTING SETTINGS ===");
    this.log(`Enabled: ${this.settings.enabled}`);
    this.log(
      `Supported languages: ${this.settings.supportedLanguages.join(", ")}`
    );
    this.log(`Theme: ${this.settings.theme}`);
    this.log("=== END SETTINGS ===");

    return finalMermaid;
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

      // Instead of HTML, use plain text with syntax-aware node styling
      // Store the highlighted content for CSS class application
      let textContent = node.sourceCode.text;

      if (result.truncated) {
        textContent =
          textContent.substring(0, this.settings.maxCharacters) + "...";
      }

      // Return clean text content for Mermaid
      // The styling will be applied via CSS classes
      return this.escapeString(textContent);
    } catch (error) {
      // Fallback to regular escaped text if highlighting fails
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
    this.log("=== GENERATING SYNTAX CSS ===");
    this.log(`Settings enabled: ${this.settings.enabled}`);

    if (!this.settings.enabled) {
      this.log("Syntax highlighting disabled, returning empty CSS");
      return "";
    }

    const theme =
      this.settings.theme === "auto"
        ? this.detectTheme()
        : (this.settings.theme as "light" | "dark");

    this.log(`CSS Theme: ${theme}`);

    const themeCSS = this.syntaxHighlighter.getThemeCSS(theme);
    this.log(`Theme CSS from highlighter: ${themeCSS}`);

    const finalCSS = `
            <style>
                /* Base syntax highlighting for flowchart nodes */
                .syntax-python .nodeLabel,
                .syntax-typescript .nodeLabel,
                .syntax-javascript .nodeLabel,
                .syntax-java .nodeLabel,
                .syntax-cpp .nodeLabel {
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace !important;
                    font-size: 11px !important;
                    line-height: 1.3 !important;
                    text-align: left !important;
                    white-space: pre !important;
                    background-color: ${
                      theme === "dark" ? "#1e1e1e" : "#ffffff"
                    } !important;
                    color: ${
                      theme === "dark" ? "#d4d4d4" : "#000000"
                    } !important;
                    padding: 4px 6px !important;
                    border-radius: 3px !important;
                }
                
                /* Style the actual node containers for code nodes */
                .syntax-python rect,
                .syntax-typescript rect,
                .syntax-javascript rect,
                .syntax-java rect,
                .syntax-cpp rect {
                    fill: ${
                      theme === "dark" ? "#1e1e1e" : "#f8f8f8"
                    } !important;
                    stroke: ${
                      theme === "dark" ? "#569cd6" : "#0066cc"
                    } !important;
                    stroke-width: 2px !important;
                }

                /* Token-based syntax highlighting */
                .token.keyword { color: ${
                  theme === "dark" ? "#569cd6" : "#0000ff"
                } !important; }
                .token.string { color: ${
                  theme === "dark" ? "#ce9178" : "#a31515"
                } !important; }
                .token.comment { color: ${
                  theme === "dark" ? "#6a9955" : "#008000"
                } !important; }
                .token.number { color: ${
                  theme === "dark" ? "#b5cea8" : "#09885a"
                } !important; }
                .token.function { color: ${
                  theme === "dark" ? "#dcdcaa" : "#795e26"
                } !important; }
                
                /* Fallback for generic node text */
                .mermaid .node text {
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace !important;
                }
            </style>
        `;

    this.log(`Final CSS: ${finalCSS}`);
    this.log("=== END SYNTAX CSS ===");

    return finalCSS;
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
