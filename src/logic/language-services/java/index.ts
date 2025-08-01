// import { JavaAstParser } from "./JavaAstParser";
// import { FlowchartIR } from "../../../ir/ir";

// /**
//  * Orchestrates the analysis of a Java code string.
//  * It uses tree-sitter to parse the code and find methods/functions.
//  */
// export function analyzeJavaCode(code: string, position: number): FlowchartIR {
//   try {
//     const parser = new JavaAstParser();
//     return parser.generateFlowchart(code, undefined, position);
//   } catch (error: any) {
//     console.error("Error analyzing Java code:", error);
//     return {
//       nodes: [
//         {
//           id: "A",
//           label: `Error: Unable to parse code. ${error.message || error}`,
//           shape: "rect",
//         },
//       ],
//       edges: [],
//       locationMap: [],
//     };
//   }
// }
