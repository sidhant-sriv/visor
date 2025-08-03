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
      this.sb.append("    ");
      this.sb.append(node.id);
      this.sb.append(shape[0]);
      this.sb.append('"');
      this.sb.append(label);
      this.sb.append('"');
      this.sb.append(shape[1]);
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
    this.log("=== GENERATING NODE LABEL ===");
    this.log(`Node ID: ${node.id}`);
    this.log(`Settings enabled: ${this.settings.enabled}`);
    this.log(`Has sourceCode: ${!!node.sourceCode}`);

    if (!this.settings.enabled || !node.sourceCode) {
      this.log(`Returning escaped string: ${this.escapeString(node.label)}`);
      return this.escapeString(node.label);
    }

    this.log(`Source code language: ${node.sourceCode.language}`);
    this.log(
      `Supported languages: ${this.settings.supportedLanguages.join(", ")}`
    );

    // Check if the language is supported
    if (!this.settings.supportedLanguages.includes(node.sourceCode.language)) {
      this.log("Language not supported, returning escaped string");
      return this.escapeString(node.label);
    }

    try {
      const theme =
        this.settings.theme === "auto"
          ? this.detectTheme()
          : (this.settings.theme as "light" | "dark");

      this.log(`Detected theme: ${theme}`);

      const options: HighlightOptions = {
        language: node.sourceCode.language,
        theme,
        maxLines: this.settings.maxLines,
        showLineNumbers: this.settings.showLineNumbers,
        maxCharacters: this.settings.maxCharacters,
      };

      this.log(`Highlighting options: ${JSON.stringify(options)}`);
      this.log(`Source code text: ${node.sourceCode.text}`);

      const result = this.syntaxHighlighter.highlight(
        node.sourceCode.text,
        options
      );

      this.log(`Highlight result HTML: ${result.html}`);

      // Create HTML template for the highlighted code
      let htmlContent = result.html;

      if (result.truncated) {
        htmlContent +=
          '<br/><em style="color: #888; font-size: 10px;">...</em>';
      }

      // For Mermaid HTML labels, wrap content in a way that preserves HTML
      // Use backticks for HTML content in Mermaid
      const finalLabel = `\`${htmlContent}\``;
      this.log(`Final label: ${finalLabel}`);
      this.log("=== END NODE LABEL ===");

      return finalLabel;
    } catch (error) {
      // Fallback to regular escaped text if highlighting fails
      this.log(
        `Syntax highlighting failed for node: ${node.id}, error: ${error}`
      );
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
                /* Syntax highlighting for code in flowchart nodes */
                .node .label {
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace !important;
                    font-size: 12px !important;
                    line-height: 1.4 !important;
                    text-align: left !important;
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
                
                /* Additional highlighting support */
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
