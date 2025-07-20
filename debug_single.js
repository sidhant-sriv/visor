const {
  PyAstParser,
} = require("./out/logic/language-services/python/PyAstParser");
const fs = require("fs");

const parser = new PyAstParser();

// Test simple return
console.log("=== Testing simple return ===");
const simpleCode = fs.readFileSync("./simple_test.py", "utf8");
console.log("Simple code:", simpleCode);
const simpleResult = parser.generateFlowchart(simpleCode, "simple_test");
console.log("Simple result nodes:", simpleResult.nodes.length);
simpleResult.nodes.forEach((node) => {
  console.log(`  ${node.id}: ${node.label} (${node.shape})`);
});

// Test complex return
console.log("\n=== Testing test_multiple_returns ===");
const testCode = fs.readFileSync("./test_return_statements.py", "utf8");
const result = parser.generateFlowchart(testCode, "test_multiple_returns");

console.log("Nodes:");
result.nodes.forEach((node) => {
  console.log(`  ${node.id}: ${node.label} (${node.shape})`);
});

console.log("Edges:");
result.edges.forEach((edge) => {
  console.log(
    `  ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`
  );
});

// Check return statements specifically
const returnNodes = result.nodes.filter((node) =>
  node.label.includes("return")
);
console.log(`Return statements found: ${returnNodes.length}`);
returnNodes.forEach((node) => {
  console.log(`  Return node: ${node.id} - ${node.label}`);
});
