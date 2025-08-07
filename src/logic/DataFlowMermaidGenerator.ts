import { DataFlowAnalysisIR, FunctionInfo, GlobalStateVariable, DataFlowEdge } from "../ir/dataFlowIr";

export class DataFlowMermaidGenerator {
  private theme: string = "default";
  private vsCodeTheme: string = "light";

  public setTheme(selectedTheme: string, vsCodeTheme: string): void {
    this.theme = selectedTheme;
    this.vsCodeTheme = vsCodeTheme;
  }

  /**
   * Generate a Mermaid diagram for data flow analysis
   */
  public generateDataFlowGraph(analysis: DataFlowAnalysisIR): string {
    const lines: string[] = [];
    
    // Start with graph definition
    lines.push("graph TD");
    lines.push("");

    // Add function nodes
    const functionNodes = this.generateFunctionNodes(analysis.functions);
    lines.push(...functionNodes);
    lines.push("");

    // Add global state nodes
    const globalNodes = this.generateGlobalStateNodes(analysis.globalStateVariables);
    lines.push(...globalNodes);
    lines.push("");

    // Add data flow connections
    const connections = this.generateDataFlowConnections(analysis);
    lines.push(...connections);
    lines.push("");

    // Add styling
    const styling = this.generateStyling(analysis);
    lines.push(...styling);

    return lines.join("\n");
  }

  /**
   * Generate function nodes for the diagram
   */
  private generateFunctionNodes(functions: FunctionInfo[]): string[] {
    const lines: string[] = [];
    
    functions.forEach((func, index) => {
      const nodeId = `func_${this.sanitizeId(func.name)}`;
      const isAsync = func.isAsync ? "⚡ " : "";
      const complexity = func.complexity ? ` (${func.complexity})` : "";
      
      // Different shapes based on function characteristics
      let shape = "rect";
      if (func.isAsync) {
        shape = "round";
      } else if (func.globalStateAccesses.length > 0) {
        shape = "stadium";
      }

      const label = `${isAsync}${func.name}${complexity}`;
      
      switch (shape) {
        case "round":
          lines.push(`    ${nodeId}((${label}))`);
          break;
        case "stadium":
          lines.push(`    ${nodeId}([${label}])`);
          break;
        default:
          lines.push(`    ${nodeId}[${label}]`);
      }

      // Add file information as a comment
      const fileName = func.filePath.split('/').pop() || 'unknown';
      lines.push(`    %% ${func.name} in ${fileName}`);
    });

    return lines;
  }

  /**
   * Generate global state variable nodes
   */
  private generateGlobalStateNodes(globals: GlobalStateVariable[]): string[] {
    const lines: string[] = [];
    
    if (globals.length === 0) {
      return lines;
    }

    lines.push("    %% Global State Variables");
    
    globals.forEach(global => {
      const nodeId = `global_${this.sanitizeId(global.name)}`;
      const readCount = global.accessedBy.length;
      const writeCount = global.modifications.length;
      
      let label = `📊 ${global.name}`;
      if (readCount > 0 || writeCount > 0) {
        label += `<br/>R:${readCount} W:${writeCount}`;
      }
      
      // Use diamond shape for global variables
      lines.push(`    ${nodeId}{${label}}`);
    });

    return lines;
  }

  /**
   * Generate data flow connections between nodes
   */
  private generateDataFlowConnections(analysis: DataFlowAnalysisIR): string[] {
    const lines: string[] = [];
    const connections = new Set<string>(); // Prevent duplicate edges

    // Connect functions to global state they access
    analysis.functions.forEach(func => {
      const funcId = `func_${this.sanitizeId(func.name)}`;
      
      func.globalStateAccesses.forEach(access => {
        const globalId = `global_${this.sanitizeId(access.variableName)}`;
        
        let edgeStyle = "";
        let label = "";
        
        switch (access.accessType) {
          case "read":
            edgeStyle = "-.->"; // Dashed arrow for reads
            label = "reads";
            break;
          case "write":
            edgeStyle = "==>"; // Thick arrow for writes  
            label = "writes";
            break;
          case "read-write":
            edgeStyle = "<--->"; // Bidirectional for read-write
            label = "modifies";
            break;
        }

        const connection = `    ${funcId} ${edgeStyle}|${label}| ${globalId}`;
        if (!connections.has(connection)) {
          connections.add(connection);
          lines.push(connection);
        }
      });
    });

    // Connect functions that share global state
    const globalGroups = this.groupFunctionsByGlobalState(analysis);
    
    Object.entries(globalGroups).forEach(([globalVar, funcs]) => {
      if (funcs.length > 1) {
        // Connect functions that share the same global state
        for (let i = 0; i < funcs.length - 1; i++) {
          for (let j = i + 1; j < funcs.length; j++) {
            const func1Id = `func_${this.sanitizeId(funcs[i].name)}`;
            const func2Id = `func_${this.sanitizeId(funcs[j].name)}`;
            
            // Use dotted line to show shared state relationship
            const connection = `    ${func1Id} -.->|shares ${globalVar}| ${func2Id}`;
            if (!connections.has(connection)) {
              connections.add(connection);
              lines.push(connection);
            }
          }
        }
      }
    });

    // Add function call relationships (if available)
    analysis.functions.forEach(func => {
      const funcId = `func_${this.sanitizeId(func.name)}`;
      
      func.calls.forEach(call => {
        const targetFunc = analysis.functions.find(f => f.name === call.functionName);
        if (targetFunc) {
          const targetId = `func_${this.sanitizeId(targetFunc.name)}`;
          const connection = `    ${funcId} -->|calls| ${targetId}`;
          
          if (!connections.has(connection)) {
            connections.add(connection);
            lines.push(connection);
          }
        }
      });
    });

    return lines;
  }

  /**
   * Group functions by the global state they access
   */
  private groupFunctionsByGlobalState(analysis: DataFlowAnalysisIR): Record<string, FunctionInfo[]> {
    const groups: Record<string, FunctionInfo[]> = {};
    
    analysis.functions.forEach(func => {
      func.globalStateAccesses.forEach(access => {
        if (!groups[access.variableName]) {
          groups[access.variableName] = [];
        }
        if (!groups[access.variableName].includes(func)) {
          groups[access.variableName].push(func);
        }
      });
    });

    return groups;
  }

  /**
   * Generate styling for the diagram
   */
  private generateStyling(analysis: DataFlowAnalysisIR): string[] {
    const lines: string[] = [];
    
    lines.push("    %% Styling");
    
    // Style function nodes
    analysis.functions.forEach((func, index) => {
      const nodeId = `func_${this.sanitizeId(func.name)}`;
      const classNumber = index % 4; // Cycle through 4 different styles
      
      if (func.name === analysis.rootFunction) {
        // Highlight the root function
        lines.push(`    classDef rootFunction fill:#e1f5fe,stroke:#0277bd,stroke-width:3px,color:#000`);
        lines.push(`    class ${nodeId} rootFunction;`);
      } else if (func.isAsync) {
        lines.push(`    classDef asyncFunction fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000`);
        lines.push(`    class ${nodeId} asyncFunction;`);
      } else if (func.globalStateAccesses.length > 0) {
        lines.push(`    classDef stateFunction fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000`);
        lines.push(`    class ${nodeId} stateFunction;`);
      } else {
        lines.push(`    classDef normalFunction fill:#f5f5f5,stroke:#616161,stroke-width:1px,color:#000`);
        lines.push(`    class ${nodeId} normalFunction;`);
      }
    });

    // Style global state nodes
    analysis.globalStateVariables.forEach(global => {
      const nodeId = `global_${this.sanitizeId(global.name)}`;
      const writeCount = global.modifications.length;
      
      if (writeCount > 0) {
        // Mutable global state
        lines.push(`    classDef mutableGlobal fill:#ffebee,stroke:#c62828,stroke-width:2px,color:#000`);
        lines.push(`    class ${nodeId} mutableGlobal;`);
      } else {
        // Read-only global state
        lines.push(`    classDef readonlyGlobal fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px,color:#000`);
        lines.push(`    class ${nodeId} readonlyGlobal;`);
      }
    });

    return lines;
  }

  /**
   * Sanitize node IDs for Mermaid compatibility
   */
  private sanitizeId(input: string): string {
    return input.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  /**
   * Generate a simplified function call graph
   */
  public generateFunctionCallGraph(analysis: DataFlowAnalysisIR): string {
    const lines: string[] = [];
    
    lines.push("graph LR");
    lines.push("");

    // Add function nodes (simplified)
    analysis.functions.forEach(func => {
      const nodeId = `func_${this.sanitizeId(func.name)}`;
      const fileName = func.filePath.split('/').pop() || 'unknown';
      const label = `${func.name}<br/><small>${fileName}</small>`;
      
      if (func.name === analysis.rootFunction) {
        lines.push(`    ${nodeId}["🎯 ${label}"]`);
      } else {
        lines.push(`    ${nodeId}["${label}"]`);
      }
    });

    lines.push("");

    // Add call relationships
    analysis.functions.forEach(func => {
      const funcId = `func_${this.sanitizeId(func.name)}`;
      
      func.calls.forEach(call => {
        const targetFunc = analysis.functions.find(f => f.name === call.functionName);
        if (targetFunc) {
          const targetId = `func_${this.sanitizeId(targetFunc.name)}`;
          lines.push(`    ${funcId} --> ${targetId}`);
        }
      });
    });

    return lines.join("\n");
  }
}