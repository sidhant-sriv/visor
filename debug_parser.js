const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');

const code = `
async def full_feature_test(data_list, config_path):
    print("Function execution started.")
    
    for item in data_list:
        if item is None:
            pass
            continue
        elif item < 0:
            print("Negative item found, breaking loop.")
            break
        else:
            try:
                await asyncio.sleep(0.1)
                result = item / 10
                if result > 5:
                    print("Result is large.")
                else:
                    print("Result is small.")
            except TypeError:
                print("A TypeError occurred.")
            except ValueError as e:
                print(f"A ValueError occurred: {e}")
            else:
                print("Try block completed without exceptions.")
                processed_items.append(result)
            finally:
                print("Finished processing one item.")
    
    return processed_items
`;

const parser = new Parser();
parser.setLanguage(Python);
const tree = parser.parse(code);

function printTreeStructure(node, depth = 0) {
  const indent = '  '.repeat(depth);
  console.log(`${indent}${node.type}: "${node.text.substring(0, 50).replace(/\n/g, '\\n')}"`);
  
  for (const child of node.children) {
    printTreeStructure(child, depth + 1);
  }
}

console.log('AST Structure:');
printTreeStructure(tree.rootNode);

// Find the for statement
const forStatement = tree.rootNode.descendantsOfType('for_statement')[0];
if (forStatement) {
  console.log('\n\nFor Statement Structure:');
  printTreeStructure(forStatement);
  
  console.log('\n\nFor Statement Body:');
  const body = forStatement.childForFieldName('body');
  if (body) {
    printTreeStructure(body);
  }
} 