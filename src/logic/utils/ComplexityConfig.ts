import * as vscode from "vscode";

/**
 * Configuration interface for complexity analysis features
 */
export interface ComplexityConfiguration {
  enabled: boolean;
  displayInNodes: boolean;
  displayInPanel: boolean;
  indicators: {
    low: string;
    medium: string;
    high: string;
    veryHigh: string;
  };
  thresholds: {
    low: number;
    medium: number;
    high: number;
  };
  colors: {
    low: string;
    medium: string;
    high: string;
    veryHigh: string;
  };
}

/**
 * Default complexity configuration
 */
export const DEFAULT_COMPLEXITY_CONFIG: ComplexityConfiguration = {
  enabled: true,
  displayInNodes: true,
  displayInPanel: true,
  indicators: {
    low: "",
    medium: "⚠️",
    high: "🔴",
    veryHigh: "🚨",
  },
  thresholds: {
    low: 5, // 1-5: Simple, low risk
    medium: 10, // 6-10: More complex, moderate risk
    high: 20, // 11-20: Complex, high risk
    // 21+: Very complex, very high risk
  },
  colors: {
    low: "#28a745",
    medium: "#ffc107",
    high: "#fd7e14",
    veryHigh: "#dc3545",
  },
};

/**
 * Factory function to get complexity configuration from VS Code settings
 */
export function getComplexityConfig(): ComplexityConfiguration {
  const config = vscode.workspace.getConfiguration("visor.complexity");

  return {
    enabled: config.get<boolean>("enabled", DEFAULT_COMPLEXITY_CONFIG.enabled),
    displayInNodes: config.get<boolean>(
      "displayInNodes",
      DEFAULT_COMPLEXITY_CONFIG.displayInNodes
    ),
    displayInPanel: config.get<boolean>(
      "displayInPanel",
      DEFAULT_COMPLEXITY_CONFIG.displayInPanel
    ),
    indicators: DEFAULT_COMPLEXITY_CONFIG.indicators, // Keep defaults for now
    thresholds: {
      low: config.get<number>(
        "thresholds.low",
        DEFAULT_COMPLEXITY_CONFIG.thresholds.low
      ),
      medium: config.get<number>(
        "thresholds.medium",
        DEFAULT_COMPLEXITY_CONFIG.thresholds.medium
      ),
      high: config.get<number>(
        "thresholds.high",
        DEFAULT_COMPLEXITY_CONFIG.thresholds.high
      ),
    },
    colors: DEFAULT_COMPLEXITY_CONFIG.colors, // Keep defaults for now
  };
}

/**
 * Language-specific complexity node types mapping
 */
export const COMPLEXITY_NODE_TYPES = {
  python: new Set([
    "if_statement",
    "elif_clause",
    "else_clause",
    "for_statement",
    "while_statement",
    "try_statement",
    "except_clause",
    "finally_clause",
    "boolean_operator",
    "and",
    "or",
    "conditional_expression",
    "match_statement",
    "case_clause",
  ]),

  typescript: new Set([
    "if_statement",
    "else_clause",
    "for_statement",
    "for_in_statement",
    "for_of_statement",
    "while_statement",
    "do_statement",
    "try_statement",
    "catch_clause",
    "finally_clause",
    "binary_expression",
    "logical_expression",
    "conditional_expression",
    "ternary_expression",
    "switch_statement",
    "switch_case",
    "switch_default",
  ]),

  java: new Set([
    "if_statement",
    "else_clause",
    "for_statement",
    "enhanced_for_statement",
    "while_statement",
    "do_statement",
    "try_statement",
    "catch_clause",
    "finally_clause",
    "binary_expression",
    "logical_expression",
    "ternary_expression",
    "switch_statement",
    "switch_label",
  ]),

  cpp: new Set([
    "if_statement",
    "else_clause",
    "for_statement",
    "for_range_loop",
    "while_statement",
    "do_statement",
    "try_statement",
    "catch_clause",
    "binary_expression",
    "logical_expression",
    "conditional_expression",
    "switch_statement",
    "case_statement",
    "default_statement",
  ]),

  c: new Set([
    "if_statement",
    "else_clause",
    "for_statement",
    "while_statement",
    "do_statement",
    "binary_expression",
    "logical_expression",
    "conditional_expression",
    "switch_statement",
    "case_statement",
    "default_statement",
    "goto_statement",
    "labeled_statement",
  ]),

  rust: new Set([
    "if_expression",
    "else_clause",
    "for_expression",
    "while_expression",
    "loop_expression",
    "match_expression",
    "match_arm",
    "binary_expression",
    "logical_expression",
    "try_expression",
    "let_condition",
    "_let_chain",
    "closure_expression",
  ]),

  go: new Set([
    "if_statement",
    "else_clause",
    "for_statement",
    "range_clause",
    "switch_statement",
    "case_clause",
    "type_switch_statement",
    "type_case_clause",
    "binary_expression",
    "logical_expression",
  ]),
} as const;

/**
 * Get complexity descriptions based on configuration
 */
export function getComplexityDescription(
  complexity: number,
  config: ComplexityConfiguration = DEFAULT_COMPLEXITY_CONFIG
): string {
  if (complexity <= config.thresholds.low) {
    return "Simple function with low complexity";
  } else if (complexity <= config.thresholds.medium) {
    return "Moderately complex function";
  } else if (complexity <= config.thresholds.high) {
    return "Complex function that may benefit from refactoring";
  } else {
    return "Very complex function that should be refactored";
  }
}

/**
 * Get complexity rating based on configuration
 */
export function getComplexityRating(
  complexity: number,
  config: ComplexityConfiguration = DEFAULT_COMPLEXITY_CONFIG
): "low" | "medium" | "high" | "very-high" {
  if (complexity <= config.thresholds.low) {
    return "low";
  } else if (complexity <= config.thresholds.medium) {
    return "medium";
  } else if (complexity <= config.thresholds.high) {
    return "high";
  } else {
    return "very-high";
  }
}
