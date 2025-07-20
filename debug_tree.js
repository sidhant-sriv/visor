const fs = require("fs");
const Parser = require("tree-sitter");
const Python = require("tree-sitter-python");

const parser = new Parser();
parser.setLanguage(Python);

// Read the test file
const code = `def test_multiple_returns(x):
    x = 5
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"`;

console.log("Code to parse:");
console.log(code);
console.log("\n" + "=".repeat(50) + "\n");

const tree = parser.parse(code);

function printTree(node, depth = 0) {
  const indent = "  ".repeat(depth);
  const fieldName = node.isNamed ? `[${node.type}]` : `"${node.type}"`;
  const text =
    node.text.length < 50
      ? node.text.replace(/\n/g, "\\n")
      : node.text.slice(0, 47) + "...";

  console.log(`${indent}${fieldName} ${text}`);

  for (let child of node.children) {
    printTree(child, depth + 1);
  }
}

console.log("Full tree structure:");
printTree(tree.rootNode);

console.log("\n" + "=".repeat(50) + "\n");

// Find the function and examine if statements
function findAndExamineIfStatements(node) {
  if (node.type === "if_statement") {
    console.log("Found if_statement:");
    console.log(`Text: ${node.text}`);
    console.log(`Children count: ${node.children.length}`);

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      console.log(
        `  Child ${i}: ${child.type} - "${child.text.replace(/\n/g, "\\n")}"`
      );

      if (child.type === "block") {
        console.log(`    Block children count: ${child.children.length}`);
        for (let j = 0; j < child.children.length; j++) {
          const blockChild = child.children[j];
          console.log(
            `      Block child ${j}: ${
              blockChild.type
            } - "${blockChild.text.replace(/\n/g, "\\n")}"`
          );
        }
      }
    }
    console.log("");
  }

  for (let child of node.children) {
    findAndExamineIfStatements(child);
  }
}

findAndExamineIfStatements(tree.rootNode);
