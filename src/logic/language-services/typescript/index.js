"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeTypeScriptCode = analyzeTypeScriptCode;
const ts_morph_1 = require("ts-morph");
const TsAstParser_1 = require("./TsAstParser");
const MermaidGenerator_1 = require("../../MermaidGenerator");
/**
 * Orchestrates the analysis of a TypeScript code string.
 * It creates an in-memory ts-morph project to parse the code.
 */
function analyzeTypeScriptCode(code, position) {
    try {
        const project = new ts_morph_1.Project({
            useInMemoryFileSystem: true,
            compilerOptions: {
                target: ts_morph_1.ScriptTarget.ESNext,
                allowJs: true,
            },
        });
        const sourceFile = project.createSourceFile("temp.ts", code);
        const parser = new TsAstParser_1.TsAstParser();
        const ir = parser.generateFlowchart(sourceFile, position);
        const mermaidGenerator = new MermaidGenerator_1.MermaidGenerator();
        const flowchart = mermaidGenerator.generate(ir);
        return { flowchart, locationMap: ir.locationMap, functionRange: ir.functionRange };
    }
    catch (error) {
        console.error("Error analyzing TypeScript code:", error);
        const errorMessage = `graph TD\n    A[Error: Unable to parse code]\n    A --> B["${error.message || error}"]`;
        return { flowchart: errorMessage, locationMap: [] };
    }
}
//# sourceMappingURL=index.js.map