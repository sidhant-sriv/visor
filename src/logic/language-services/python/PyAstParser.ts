import Parser from "web-tree-sitter";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../../ir/ir";

// Helper interface for processing blocks of code
interface ProcessResult {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  entryNodeId?: string;
  exitPoints: { id: string; label?: string }[];
}

// Helper interface to manage loop context (for break/continue)
interface LoopContext {
  breakTargetId: string;
  continueTargetId: string;
}

/**
 * A simplified class to manage the construction of Control Flow Graphs from Python code,
 * focusing on conditionals and loops. It uses web-tree-sitter and a WASM grammar file.
 */
export class PyAstParser {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
  private parser: Parser;

  private readonly nodeStyles = {
    terminator: "fill:#f9f9f9,stroke:#333,stroke-width:2px,color:#333",
    decision: "fill:#fff,stroke:#333,stroke-width:1.5px,color:#333",
    process: "fill:#fff,stroke:#333,stroke-width:1.5px,color:#333",
  };

  /**
   * Private constructor. Use the async `create` method instead.
   */
  private constructor(parser: Parser) {
    this.parser = parser;
  }

  /**
   * Asynchronously creates and initializes an instance of PyAstParser.
   * @param wasmPath The file path to the tree-sitter-python.wasm file.
   * @returns A promise that resolves to a new PyAstParser instance.
   */
  public static async create(wasmPath: string): Promise<PyAstParser> {
    await Parser.init();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new PyAstParser(parser);
  }

  private generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  private escapeString(str: string): string {
    if (!str) {
      return "";
    }
    const sanitized = str
      .replace(/"/g, "#quot;")
      .replace(/\n/g, " ")
      .replace(/:$/, "")
      .trim();
    const MAX_LABEL_LENGTH = 80;
    return sanitized.length > MAX_LABEL_LENGTH
      ? sanitized.substring(0, MAX_LABEL_LENGTH - 3) + "..."
      : sanitized;
  }

  /**
   * Main public method to generate a flowchart from Python source code.
   */
  public async generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): Promise<FlowchartIR> {
    const tree = this.parser.parse(sourceCode);
    this.nodeIdCounter = 0;
    this.locationMap = [];

    let targetNode: Parser.SyntaxNode | undefined;

    // Find the function definition containing the cursor
    if (position !== undefined) {
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => position >= f.startIndex && position <= f.endIndex);
    } else if (functionName) {
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => f.childForFieldName("name")?.text === functionName);
    } else {
      // Default to the first function if no position or name is given
      targetNode = tree.rootNode.descendantsOfType("function_definition")[0];
    }

    if (!targetNode) {
      return {
        nodes: [{
          id: "A",
          label: "Place cursor inside a function to generate a flowchart.",
          shape: "rect",
        }, ],
        edges: [],
        locationMap: [],
      };
    }

    const bodyToProcess = targetNode.childForFieldName("body");
    const funcNameStr = this.escapeString(targetNode.childForFieldName("name")!.text);
    const title = `Flowchart for function: ${funcNameStr}`;

    if (!bodyToProcess) {
      return {
        nodes: [{ id: "A", label: "Function has no body.", shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push({ id: entryId, label: `Start`, shape: "round", style: this.nodeStyles.terminator });
    nodes.push({ id: exitId, label: "End", shape: "round", style: this.nodeStyles.terminator });

    const bodyResult = this.processBlock(bodyToProcess, exitId);
    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);

    if (bodyResult.entryNodeId) {
      edges.push({ from: entryId, to: bodyResult.entryNodeId });
    } else {
      edges.push({ from: entryId, to: exitId }); // Empty function
    }

    bodyResult.exitPoints.forEach((ep) => {
        edges.push({ from: ep.id, to: exitId, label: ep.label });
    });

    return {
      nodes,
      edges,
      locationMap: this.locationMap,
      functionRange: { start: targetNode.startIndex, end: targetNode.endIndex },
      title,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
  }

  /**
   * Processes a block of statements, connecting them sequentially.
   */
  private processBlock(blockNode: Parser.SyntaxNode | null, exitId: string, loopContext?: LoopContext): ProcessResult {
    if (!blockNode) {
      return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [] };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    let entryNodeId: string | undefined = undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = blockNode.namedChildren.filter( s => s.type !== "pass_statement" && s.type !== "comment");

    if (statements.length === 0) {
        // If a block is empty (e.g., just 'pass'), it has no entry and its exit is where it was entered from.
        return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [] };
    }

    for (const statement of statements) {
      const result = this.processStatement(statement, exitId, loopContext);
      nodes.push(...result.nodes);
      edges.push(...result.edges);

      if (!entryNodeId) {
        entryNodeId = result.entryNodeId;
      }

      if (lastExitPoints.length > 0 && result.entryNodeId) {
        lastExitPoints.forEach((exitPoint) => {
          edges.push({ from: exitPoint.id, to: result.entryNodeId!, label: exitPoint.label });
        });
      }
      
      // Only update lastExitPoints if the current statement has exits.
      // Statements like 'return' or 'break' have no exits to the next statement.
      if (result.exitPoints.length > 0) {
        lastExitPoints = result.exitPoints;
      } else {
        lastExitPoints = []; // Terminal statement, stop linking
      }
    }

    return { nodes, edges, entryNodeId, exitPoints: lastExitPoints };
  }

  /**
   * Delegates a statement to the appropriate processing function.
   */
  private processStatement(statement: Parser.SyntaxNode, exitId: string, loopContext?: LoopContext): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext);
      case "for_statement":
        return this.processForStatement(statement, exitId);
      case "while_statement":
        return this.processWhileStatement(statement, exitId);
      case "return_statement":
         return this.processReturnStatement(statement, exitId);
      case "break_statement":
        if (loopContext) return this.processBreakStatement(statement, loopContext);
        return this.processDefaultStatement(statement); // Treat as regular statement if not in a loop
      case "continue_statement":
        if (loopContext) return this.processContinueStatement(statement, loopContext);
        return this.processDefaultStatement(statement); // Treat as regular statement if not in a loop
      default:
        return this.processDefaultStatement(statement);
    }
  }

  /**
   * Processes a standard statement as a single rectangular node.
   */
  private processDefaultStatement(statement: Parser.SyntaxNode): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    const nodeText = this.escapeString(statement.text);
    const node: FlowchartNode = {
      id: nodeId,
      label: nodeText,
      shape: "rect",
      style: this.nodeStyles.process,
    };
    this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });
    return { nodes: [node], edges: [], entryNodeId: nodeId, exitPoints: [{ id: nodeId }] };
  }

  /**
   * Processes an if-elif-else statement chain.
   * This is the corrected function.
   */
  private processIfStatement(ifNode: Parser.SyntaxNode, exitId: string, loopContext?: LoopContext): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const allExitPoints: { id: string; label?: string }[] = [];

    // Process the initial 'if' condition and its consequence block
    const conditionNode = ifNode.childForFieldName("condition")!;
    const consequenceNode = ifNode.childForFieldName("consequence")!;
    const conditionId = this.generateNodeId("cond");

    nodes.push({
      id: conditionId,
      label: this.escapeString(conditionNode.text),
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    this.locationMap.push({ start: conditionNode.startIndex, end: conditionNode.endIndex, nodeId: conditionId });

    const consequenceResult = this.processBlock(consequenceNode, exitId, loopContext);
    nodes.push(...consequenceResult.nodes);
    edges.push(...consequenceResult.edges);

    if (consequenceResult.entryNodeId) {
      edges.push({ from: conditionId, to: consequenceResult.entryNodeId, label: "True" });
    } else {
      // Handle empty 'if' block. The 'True' path becomes an exit point for the if-structure.
      allExitPoints.push({ id: conditionId, label: "True" });
    }
    allExitPoints.push(...consequenceResult.exitPoints);

    // This will track the ID of the last condition, so we can chain the "False" branches.
    let lastConditionId = conditionId;
    
    // Use childrenForFieldName to get all 'elif' and 'else' clauses.
    const alternativeNodes = ifNode.childrenForFieldName("alternative");

    for (const alternativeNode of alternativeNodes) {
      if (alternativeNode.type === 'elif_clause') {
        const elifConditionNode = alternativeNode.childForFieldName("condition")!;
        const elifConsequenceNode = alternativeNode.childForFieldName("consequence")!;
        const elifConditionId = this.generateNodeId("cond");
        
        nodes.push({
          id: elifConditionId,
          label: this.escapeString(elifConditionNode.text),
          shape: "diamond",
          style: this.nodeStyles.decision,
        });
        this.locationMap.push({ start: elifConditionNode.startIndex, end: elifConditionNode.endIndex, nodeId: elifConditionId });
        
        // Connect the previous condition's "False" branch to this 'elif' condition.
        edges.push({ from: lastConditionId, to: elifConditionId, label: "False" });

        const elifConsequenceResult = this.processBlock(elifConsequenceNode, exitId, loopContext);
        nodes.push(...elifConsequenceResult.nodes);
        edges.push(...elifConsequenceResult.edges);

        if (elifConsequenceResult.entryNodeId) {
          edges.push({ from: elifConditionId, to: elifConsequenceResult.entryNodeId, label: "True" });
        } else {
          allExitPoints.push({ id: elifConditionId, label: "True" });
        }
        allExitPoints.push(...elifConsequenceResult.exitPoints);

        // The next "False" branch will now come from this 'elif' condition.
        lastConditionId = elifConditionId;

      } else if (alternativeNode.type === 'else_clause') {
        const elseResult = this.processBlock(alternativeNode.childForFieldName("body"), exitId, loopContext);
        nodes.push(...elseResult.nodes);
        edges.push(...elseResult.edges);

        if (elseResult.entryNodeId) {
          // Connect the last condition's "False" branch to the 'else' block.
          edges.push({ from: lastConditionId, to: elseResult.entryNodeId, label: "False" });
        } else {
          allExitPoints.push({ id: lastConditionId, label: "False" });
        }
        allExitPoints.push(...elseResult.exitPoints);

        // Mark that the final "False" path has been handled, as 'else' is always last.
        lastConditionId = ''; 
        break; // Exit the loop since 'else' must be the final alternative.
      }
    }

    // If the chain did not end with an 'else' clause (i.e., lastConditionId is still set),
    // the final "False" branch becomes an exit point for the entire structure.
    if (lastConditionId) {
      allExitPoints.push({ id: lastConditionId, label: "False" });
    }

    return { nodes, edges, entryNodeId: conditionId, exitPoints: allExitPoints };
  }


  /**
   * Processes a for loop.
   */
  private processForStatement(forNode: Parser.SyntaxNode, exitId: string): ProcessResult {
    const left = forNode.childForFieldName("left")!.text;
    const right = forNode.childForFieldName("right")!.text;
    const headerText = this.escapeString(`for ${left} in ${right}`);
    const headerId = this.generateNodeId("for_header");

    const headerNode: FlowchartNode = {
      id: headerId,
      label: headerText,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };
    this.locationMap.push({ start: forNode.startIndex, end: forNode.childForFieldName("right")!.endIndex, nodeId: headerId });
    
    const loopContext: LoopContext = { breakTargetId: exitId, continueTargetId: headerId };
    
    const bodyResult = this.processBlock(forNode.childForFieldName("body"), exitId, loopContext);
    
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    if (bodyResult.entryNodeId) {
        edges.push({ from: headerId, to: bodyResult.entryNodeId, label: "Loop" });
        bodyResult.exitPoints.forEach(ep => {
            edges.push({ from: ep.id, to: headerId });
        });
    } else {
        // Empty loop body, just loops back to itself
        edges.push({ from: headerId, to: headerId, label: "Loop" });
    }

    return {
      nodes: [headerNode, ...bodyResult.nodes],
      edges: edges,
      entryNodeId: headerId,
      exitPoints: [{ id: headerId, label: "End Loop" }],
    };
  }

  /**
   * Processes a while loop.
   */
  private processWhileStatement(whileNode: Parser.SyntaxNode, exitId: string): ProcessResult {
    const conditionNode = whileNode.childForFieldName("condition")!;
    const conditionText = this.escapeString(conditionNode.text);
    const conditionId = this.generateNodeId("while_cond");

    const condition: FlowchartNode = {
      id: conditionId,
      label: conditionText,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };
    this.locationMap.push({ start: conditionNode.startIndex, end: conditionNode.endIndex, nodeId: conditionId });
    
    const loopContext: LoopContext = { breakTargetId: exitId, continueTargetId: conditionId };

    const bodyResult = this.processBlock(whileNode.childForFieldName("body"), exitId, loopContext);
    
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    if (bodyResult.entryNodeId) {
        edges.push({ from: conditionId, to: bodyResult.entryNodeId, label: "True" });
        bodyResult.exitPoints.forEach(ep => {
            edges.push({ from: ep.id, to: conditionId });
        });
    } else {
        edges.push({ from: conditionId, to: conditionId, label: "True" }); // Empty loop
    }

    return {
      nodes: [condition, ...bodyResult.nodes],
      edges: edges,
      entryNodeId: conditionId,
      exitPoints: [{ id: conditionId, label: "False" }],
    };
  }

  /**
   * Processes a return statement. It's a terminal node.
   */
  private processReturnStatement(returnNode: Parser.SyntaxNode, exitId: string): ProcessResult {
    const nodeId = this.generateNodeId("return");
    const node: FlowchartNode = {
      id: nodeId,
      label: this.escapeString(returnNode.text),
      shape: "stadium"
    };
    this.locationMap.push({ start: returnNode.startIndex, end: returnNode.endIndex, nodeId });
    // A return statement connects directly to the main function exit.
    return { nodes: [node], edges: [{ from: nodeId, to: exitId }], entryNodeId: nodeId, exitPoints: [] };
  }

  /**
   * Processes a break statement. It's a terminal node within its flow.
   */
  private processBreakStatement(breakNode: Parser.SyntaxNode, loopContext: LoopContext): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = { id: nodeId, label: "break", shape: "stadium" };
    this.locationMap.push({ start: breakNode.startIndex, end: breakNode.endIndex, nodeId });
    // A break statement connects to the loop's exit point.
    return { nodes: [node], edges: [{ from: nodeId, to: loopContext.breakTargetId }], entryNodeId: nodeId, exitPoints: [] };
  }

  /**
   * Processes a continue statement. It's a terminal node within its flow.
   */
  private processContinueStatement(continueNode: Parser.SyntaxNode, loopContext: LoopContext): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const node: FlowchartNode = { id: nodeId, label: "continue", shape: "stadium" };
    this.locationMap.push({ start: continueNode.startIndex, end: continueNode.endIndex, nodeId });
    // A continue statement connects back to the loop's condition/header.
    return { nodes: [node], edges: [{ from: nodeId, to: loopContext.continueTargetId }], entryNodeId: nodeId, exitPoints: [] };
  }
}