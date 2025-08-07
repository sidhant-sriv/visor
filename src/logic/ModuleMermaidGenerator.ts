import {
  ModuleAnalysisIR,
  ModuleInfo,
  ModuleDependency,
  ExportInfo,
  ImportInfo,
} from "../ir/moduleIr";
import { SubtleThemeManager, ThemeStyles } from "./utils/ThemeManager";
import * as path from "path";

export class ModuleMermaidGenerator {
  private themeStyles: ThemeStyles;
  private vsCodeTheme: "light" | "dark" = "dark";

  constructor() {
    // Initialize with default theme
    this.themeStyles = SubtleThemeManager.getThemeStyles("monokai", "dark");
  }

  /**
   * Set theme configuration (matching BaseFlowchartProvider pattern)
   */
  public setTheme(themeKey: string, vsCodeTheme: "light" | "dark"): void {
    this.themeStyles = SubtleThemeManager.getThemeStyles(themeKey, vsCodeTheme);
    this.vsCodeTheme = vsCodeTheme;
  }
  /**
   * Generates a Mermaid graph showing module dependencies and interactions
   */
  public generateModuleGraph(analysis: ModuleAnalysisIR): string {
    let mermaid = "graph TD\n";

    // Add styling
    mermaid += this.generateStyling();

    // Generate nodes for each module (simplified)
    const nodeIds = new Map<string, string>();
    let nodeCounter = 0;

    for (const module of analysis.modules) {
      const nodeId = `M${nodeCounter++}`;
      nodeIds.set(module.filePath, nodeId);

      const displayName = this.getModuleDisplayName(module);

      // Simple, clean node labels - just the module name
      mermaid += `    ${nodeId}["${displayName}"]\n`;

      // Style based on language
      const styleClass = this.getLanguageStyleClass(module.language);
      mermaid += `    class ${nodeId} ${styleClass}\n`;

      // Mark root module differently
      if (module.filePath === analysis.rootModule) {
        mermaid += `    class ${nodeId} rootModule\n`;
      }
    }

    mermaid += "\n";

    // Generate edges for dependencies (simplified)
    for (const dependency of analysis.dependencies) {
      const fromId = nodeIds.get(dependency.from);
      const toId = nodeIds.get(dependency.to);

      if (fromId && toId) {
        const edgeStyle = this.getDependencyEdgeStyle(
          dependency.dependencyType
        );
        // Simple arrows without labels to reduce clutter
        mermaid += `    ${fromId} ${edgeStyle} ${toId}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generates a detailed module overview showing exports and imports
   */
  public generateModuleOverview(analysis: ModuleAnalysisIR): string {
    let mermaid = "graph TB\n";
    mermaid += this.generateStyling();

    let nodeCounter = 0;

    for (const module of analysis.modules) {
      const moduleId = `M${nodeCounter++}`;
      const displayName = this.getModuleDisplayName(module);

      // Main module node - escape quotes
      const escapedDisplayName = displayName.replace(/"/g, "&quot;");
      mermaid += `    ${moduleId}["📁 ${escapedDisplayName}"]\n`;
      mermaid += `    class ${moduleId} ${this.getLanguageStyleClass(
        module.language
      )}\n`;

      // Exports subgraph
      if (module.exports.length > 0) {
        const exportsId = `E${moduleId}`;
        const exportsList = module.exports
          .map((e: ExportInfo) => `${e.type}: ${e.name}`)
          .join("<br/>");
        const escapedExportsList = exportsList.replace(/"/g, "&quot;");
        mermaid += `    ${exportsId}["📤 Exports<br/>${escapedExportsList}"]\n`;
        mermaid += `    class ${exportsId} exportsNode\n`;
        mermaid += `    ${moduleId} --> ${exportsId}\n`;
      }

      // Imports subgraph
      if (module.imports.length > 0) {
        const importsId = `I${moduleId}`;
        const importsList = module.imports
          .map((i: ImportInfo) => `${i.name} from ${i.source}`)
          .join("<br/>");
        const escapedImportsList = importsList.replace(/"/g, "&quot;");
        mermaid += `    ${importsId}["📥 Imports<br/>${escapedImportsList}"]\n`;
        mermaid += `    class ${importsId} importsNode\n`;
        mermaid += `    ${importsId} --> ${moduleId}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generates a dependency matrix view
   */
  public generateDependencyMatrix(analysis: ModuleAnalysisIR): string {
    const modules = analysis.modules;
    const dependencies = analysis.dependencies;

    let mermaid = "flowchart LR\n";
    mermaid += this.generateStyling();

    // Create a matrix-like representation
    let nodeCounter = 0;
    const moduleIds = new Map<string, string>();

    // Create module nodes
    for (const module of modules) {
      const nodeId = `M${nodeCounter++}`;
      moduleIds.set(module.filePath, nodeId);

      const displayName = this.getModuleDisplayName(module);
      const dependencyCount = dependencies.filter(
        (d: ModuleDependency) => d.from === module.filePath
      ).length;
      const dependentCount = dependencies.filter(
        (d: ModuleDependency) => d.to === module.filePath
      ).length;

      // Escape quotes in display name
      const escapedDisplayName = displayName.replace(/"/g, "&quot;");
      mermaid += `    ${nodeId}["${escapedDisplayName}<br/>→${dependencyCount} ←${dependentCount}"]\n`;
      mermaid += `    class ${nodeId} ${this.getLanguageStyleClass(
        module.language
      )}\n`;

      // Mark root module differently
      if (module.filePath === analysis.rootModule) {
        mermaid += `    class ${nodeId} rootModule\n`;
      }
    }

    // Add dependency relationships
    for (const dep of dependencies) {
      const fromId = moduleIds.get(dep.from);
      const toId = moduleIds.get(dep.to);

      if (fromId && toId) {
        const edgeStyle = this.getDependencyEdgeStyle(dep.dependencyType);
        mermaid += `    ${fromId} ${edgeStyle} ${toId}\n`;
      }
    }

    return mermaid;
  }

  private generateStyling(): string {
    return `
    classDef pythonModule fill:#3776ab,stroke:#2d5aa0,stroke-width:2px,color:#fff
    classDef typescriptModule fill:#3178c6,stroke:#2761a3,stroke-width:2px,color:#fff
    classDef javascriptModule fill:#f7df1e,stroke:#d4c21a,stroke-width:2px,color:#000
    classDef javaModule fill:#f89820,stroke:#e8751a,stroke-width:2px,color:#fff
    classDef rootModule fill:#ff6b6b,stroke:#ff5252,stroke-width:4px,color:#fff
    classDef defaultNode fill:#f5f5f5,stroke:#ddd,stroke-width:1px,color:#333
    
`;
  }

  private getModuleDisplayName(module: ModuleInfo): string {
    const name = path.basename(module.fileName, path.extname(module.fileName));
    // Keep it simple - just return the clean module name
    return name.length > 20 ? name.substring(0, 17) + "..." : name;
  }

  private getModuleInfoString(module: ModuleInfo): string {
    const parts = [];

    if (module.functions.length > 0) {
      parts.push(`${module.functions.length}f`);
    }
    if (module.classes.length > 0) {
      parts.push(`${module.classes.length}c`);
    }
    if (module.exports.length > 0) {
      parts.push(`${module.exports.length}exp`);
    }
    if (module.imports.length > 0) {
      parts.push(`${module.imports.length}imp`);
    }

    return parts.join(" | ");
  }

  private getLanguageStyleClass(language: string): string {
    switch (language) {
      case "python":
        return "pythonModule";
      case "typescript":
        return "typescriptModule";
      case "javascript":
        return "javascriptModule";
      case "java":
        return "javaModule";
      default:
        return "defaultNode";
    }
  }

  private getDependencyLabel(dependency: ModuleDependency): string {
    if (!dependency.importedItems || dependency.importedItems.length === 0) {
      return "";
    }

    // Filter out empty or invalid items
    const validItems = dependency.importedItems.filter(
      (item) => item && item.trim().length > 0
    );

    if (validItems.length === 0) {
      return "";
    }

    if (validItems.length <= 3) {
      return validItems.join(", ");
    } else {
      return `${validItems.slice(0, 2).join(", ")}... +${
        validItems.length - 2
      }`;
    }
  }

  private getDependencyEdgeStyle(type: string): string {
    switch (type) {
      case "import":
        return "-->"; // Solid arrow for imports
      case "function_call":
        return "-..->"; // Dotted arrow for function calls
      default:
        return "-->"; // Default to solid arrow
    }
  }
}
