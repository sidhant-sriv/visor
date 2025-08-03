import { FlowchartIR, FlowchartNode, NodeType } from "../ir/ir";
import { StringProcessor } from "./utils/StringProcessor";
import { SubtleThemeManager, ThemeStyles } from "./utils/ThemeManager";

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

export class EnhancedMermaidGenerator {
  private sb = new StringBuilder();
  private themeStyles: ThemeStyles;

  constructor(
    private themeKey: string = "monokai",
    private vsCodeTheme: "light" | "dark" = "dark"
  ) {
    this.themeStyles = SubtleThemeManager.getThemeStyles(themeKey, vsCodeTheme);
  }

  public generate(ir: FlowchartIR): string {
    this.sb.clear();
    this.sb.appendLine("graph TD");

    if (ir.title) {
      this.sb.appendLine(`%% ${ir.title}`);
    }

    // Generate nodes efficiently
    for (const node of ir.nodes) {
      const shape = this.getShape(node);
      const label = this.escapeString(node.label);
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

    // Generate enhanced styling class definitions
    this.generateClassDefinitions();

    // Apply classes to nodes based on their semantic types
    for (const node of ir.nodes) {
      if (node.nodeType) {
        const className = SubtleThemeManager.getNodeClassName(node.nodeType);
        this.sb.append("    class ");
        this.sb.append(node.id);
        this.sb.append(" ");
        this.sb.append(className);
        this.sb.appendLine("");
      } else if (node.style) {
        // Fallback for nodes with old-style inline styling
        this.sb.append("    ");
        this.sb.append(node.id);
        this.sb.append(":::fallback_");
        this.sb.append(node.id);
        this.sb.appendLine("");

        // Generate inline class definition for this specific node
        this.sb.append("    classDef fallback_");
        this.sb.append(node.id);
        this.sb.append(" ");
        this.sb.append(node.style);
        this.sb.appendLine("");
      }
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

  private generateClassDefinitions(): void {
    this.sb.appendLine("");
    this.sb.appendLine("    %% Enhanced node styling classes");

    // Generate class definitions for each node type
    const nodeTypes = Object.values(NodeType);

    for (const nodeType of nodeTypes) {
      const className = SubtleThemeManager.getNodeClassName(nodeType);
      const cssStyle = this.generateCSSStyle(nodeType);

      this.sb.append("    classDef ");
      this.sb.append(className);
      this.sb.append(" ");
      this.sb.append(cssStyle);
      this.sb.appendLine("");
    }
    this.sb.appendLine("");
  }

  private generateCSSStyle(nodeType: NodeType): string {
    const nodeStyle = SubtleThemeManager.getNodeStyle(nodeType);
    const themeColor = this.getThemeColorForNodeType(nodeType);

    let cssStyle = `fill:${themeColor.fill},stroke:${themeColor.stroke}`;

    // Add stroke width based on emphasis
    const strokeWidth = this.getStrokeWidthForEmphasis(nodeStyle.emphasis);
    cssStyle += `,stroke-width:${strokeWidth}px`;

    // Add dash array for border style
    const dashArray = SubtleThemeManager.getDashArrayForBorderStyle(
      nodeStyle.borderStyle
    );
    if (dashArray) {
      cssStyle += `,stroke-dasharray:${dashArray}`;
    }

    // Add text color if specified (font-weight is not well supported in Mermaid classDef)
    if (themeColor.textColor) {
      cssStyle += `,color:${themeColor.textColor}`;
    }

    return cssStyle;
  }

  private getThemeColorForNodeType(nodeType: NodeType) {
    switch (nodeType) {
      case NodeType.ENTRY:
        return this.themeStyles.entry;
      case NodeType.EXIT:
        return this.themeStyles.exit;
      case NodeType.DECISION:
      case NodeType.LOOP_START:
        return this.themeStyles.decision;
      case NodeType.LOOP_END:
        return this.themeStyles.loop;
      case NodeType.EXCEPTION:
        return this.themeStyles.exception;
      case NodeType.ASSIGNMENT:
        return this.themeStyles.assignment;
      case NodeType.FUNCTION_CALL:
        return this.themeStyles.functionCall;
      case NodeType.ASYNC_OPERATION:
        return this.themeStyles.asyncOperation;
      case NodeType.BREAK_CONTINUE:
        return this.themeStyles.breakContinue;
      case NodeType.RETURN:
        return this.themeStyles.returnNode;
      case NodeType.PROCESS:
      default:
        return this.themeStyles.process;
    }
  }

  private getStrokeWidthForEmphasis(emphasis: string): number {
    switch (emphasis) {
      case "high":
        return 2;
      case "medium":
        return 1.5;
      case "low":
      default:
        return 1;
    }
  }

  private getFontWeightValue(fontWeight: string): string {
    switch (fontWeight) {
      case "bold":
        return "600";
      case "medium":
        return "500";
      case "normal":
      default:
        return "400";
    }
  }

  private getShape(node: FlowchartNode): [string, string] {
    // Use enhanced shape logic if nodeType is available
    if (node.nodeType) {
      const nodeStyle = SubtleThemeManager.getNodeStyle(node.nodeType);
      return this.getShapeMarkers(nodeStyle.shape);
    }

    // Fallback to original shape logic
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

  private getShapeMarkers(shape: string): [string, string] {
    switch (shape) {
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
