import Parser from "web-tree-sitter";
import {
  ComplexityConfiguration,
  getComplexityConfig,
  getComplexityDescription,
  getComplexityRating,
  COMPLEXITY_NODE_TYPES,
} from "./ComplexityConfig";

export interface ComplexityResult {
  cyclomaticComplexity: number;
  rating: "low" | "medium" | "high" | "very-high";
  decisionPoints: number;
  description: string;
}

export interface FunctionComplexityInfo {
  functionName: string;
  complexity: ComplexityResult;
  nodeComplexities: Map<string, ComplexityResult>;
}

/**
 * Analyzes cyclomatic complexity of code based on AST structure.
 * Follows McCabe's cyclomatic complexity calculation:
 * CC = E - N + 2P (for single function, P=1, so CC = E - N + 2)
 * Where E = edges, N = nodes, P = connected components
 *
 * In practice, we count decision points + 1:
 * - Each if/elif/else adds 1
 * - Each loop (for/while) adds 1
 * - Each except clause adds 1
 * - Each logical operator (and/or) adds 1
 * - Each ternary operator adds 1
 * - Each case in match statement adds 1
 */
export class ComplexityAnalyzer {
  private static config = getComplexityConfig();

  /**
   * Calculate cyclomatic complexity for a function node
   */
  public static calculateFunctionComplexity(
    functionNode: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): FunctionComplexityInfo {
    const functionName = this.extractFunctionName(functionNode, language);
    const complexity = this.calculateNodeComplexity(functionNode, language);

    // Calculate complexity for individual statement blocks within the function
    const nodeComplexities = new Map<string, ComplexityResult>();
    this.analyzeStatementBlocks(functionNode, language, nodeComplexities);

    return {
      functionName,
      complexity,
      nodeComplexities,
    };
  }

  /**
   * Calculate complexity for a specific AST node
   */
  public static calculateNodeComplexity(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): ComplexityResult {
    const decisionPoints = this.countDecisionPoints(node, language);
    const cyclomaticComplexity = decisionPoints + 1;

    return {
      cyclomaticComplexity,
      rating: getComplexityRating(cyclomaticComplexity, this.config),
      decisionPoints,
      description: getComplexityDescription(cyclomaticComplexity, this.config),
    };
  }

  private static countDecisionPoints(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): number {
    let count = 0;
    const decisionNodeTypes = this.getDecisionNodeTypes(language);

    // Use a queue for breadth-first traversal to avoid stack overflow
    const queue: Parser.SyntaxNode[] = [node];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;

      // Count decision points based on node type
      if (decisionNodeTypes.has(currentNode.type)) {
        count += this.getDecisionPointsForNodeType(currentNode, language);
      }

      // Add children to queue
      for (let i = 0; i < currentNode.childCount; i++) {
        const child = currentNode.child(i);
        if (child) {
          queue.push(child);
        }
      }
    }

    return count;
  }

  private static getDecisionNodeTypes(
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): Set<string> {
    return COMPLEXITY_NODE_TYPES[language] || new Set();
  }

  private static getDecisionPointsForNodeType(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): number {
    const nodeType = node.type;

    // Special handling for certain node types
    switch (nodeType) {
      case "boolean_operator":
      case "logical_expression":
      case "binary_expression":
        // Count logical operators (and/or) within the expression
        return this.countLogicalOperators(node);

      case "match_statement":
      case "switch_statement":
        // Count the number of case clauses
        return this.countCaseClauses(node, language);

      case "if_statement":
        // Count elif clauses as additional decision points
        return this.countElifClauses(node, language);

      default:
        // Most decision nodes add 1 complexity point
        return 1;
    }
  }

  private static countLogicalOperators(node: Parser.SyntaxNode): number {
    let count = 0;
    const queue: Parser.SyntaxNode[] = [node];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;

      if (
        currentNode.type === "and" ||
        currentNode.type === "or" ||
        (currentNode.type === "binary_expression" &&
          (currentNode.text.includes("&&") || currentNode.text.includes("||")))
      ) {
        count++;
      }

      for (let i = 0; i < currentNode.childCount; i++) {
        const child = currentNode.child(i);
        if (child) {
          queue.push(child);
        }
      }
    }

    return count; // Only count actual logical operators, no minimum
  }

  private static countCaseClauses(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): number {
    const caseTypes =
      language === "python"
        ? ["case_clause"]
        : language === "java"
        ? ["switch_label"]
        : language === "rust"
        ? ["match_arm"]
        : ["switch_case", "case_statement"];

    let count = 0;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && caseTypes.includes(child.type)) {
        count++;
      }
    }

    return Math.max(count, 1); // At least 1 for the switch itself
  }

  private static countElifClauses(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): number {
    if (language !== "python") return 1;

    let count = 1; // Base if statement
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === "elif_clause") {
        count++;
      }
    }

    return count;
  }

  private static extractFunctionName(
    functionNode: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): string {
    const nameField =
      language === "python"
        ? "name"
        : language === "java"
        ? "name"
        : language === "cpp" || language === "c"
        ? "declarator"
        : language === "rust"
        ? "name"
        : "name";

    const nameNode = functionNode.childForFieldName(nameField);

    if (!nameNode) {
      return "[anonymous]";
    }

    // Special handling for C++ and C declarator nodes
    if (
      (language === "cpp" || language === "c") &&
      nameField === "declarator"
    ) {
      return this.extractCppFunctionName(nameNode);
    }

    return nameNode.text || "[anonymous]";
  }

  /**
   * Extract function name from C++ declarator node by finding the identifier
   */
  private static extractCppFunctionName(
    declaratorNode: Parser.SyntaxNode
  ): string {
    // Common patterns in C++ function declarators:
    // - function_declarator with identifier
    // - qualified_identifier (for MyClass::method)
    // - identifier (simple function names)

    const queue: Parser.SyntaxNode[] = [declaratorNode];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;

      // Direct identifier
      if (currentNode.type === "identifier") {
        return currentNode.text;
      }

      // Qualified identifier (e.g., MyClass::method)
      if (currentNode.type === "qualified_identifier") {
        // Get the last identifier in the qualified name
        const nameChild = currentNode.childForFieldName("name");
        if (nameChild && nameChild.type === "identifier") {
          return nameChild.text;
        }
      }

      // Function declarator - look for the declarator field
      if (currentNode.type === "function_declarator") {
        const declarator = currentNode.childForFieldName("declarator");
        if (declarator) {
          queue.push(declarator);
          continue;
        }
      }

      // Add all children to queue for further searching
      for (let i = 0; i < currentNode.childCount; i++) {
        const child = currentNode.child(i);
        if (
          child &&
          (child.type === "identifier" ||
            child.type === "qualified_identifier" ||
            child.type === "function_declarator")
        ) {
          queue.push(child);
        }
      }
    }

    return "[anonymous]";
  }

  private static analyzeStatementBlocks(
    functionNode: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go",
    nodeComplexities: Map<string, ComplexityResult>
  ): void {
    // Find significant statement blocks (if blocks, loop bodies, etc.)
    const significantBlocks = this.findSignificantBlocks(
      functionNode,
      language
    );

    for (const block of significantBlocks) {
      const blockId = `${block.type}_${block.startIndex}_${block.endIndex}`;
      const complexity = this.calculateNodeComplexity(block, language);
      nodeComplexities.set(blockId, complexity);
    }
  }

  private static findSignificantBlocks(
    node: Parser.SyntaxNode,
    language: "python" | "typescript" | "java" | "cpp" | "c" | "rust" | "go"
  ): Parser.SyntaxNode[] {
    const blocks: Parser.SyntaxNode[] = [];
    const blockTypes = new Set([
      "block",
      "compound_statement",
      "suite", // General blocks
      "if_statement",
      "for_statement",
      "while_statement", // Control structures
      "try_statement",
      "except_clause",
      "catch_clause", // Exception handling
      "match_statement",
      "switch_statement", // Pattern matching
    ]);

    const queue: Parser.SyntaxNode[] = [node];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;

      if (blockTypes.has(currentNode.type) && currentNode !== node) {
        blocks.push(currentNode);
        // Don't traverse deeper into this block to avoid double counting
        continue;
      }

      for (let i = 0; i < currentNode.childCount; i++) {
        const child = currentNode.child(i);
        if (child) {
          queue.push(child);
        }
      }
    }

    return blocks;
  }
}
