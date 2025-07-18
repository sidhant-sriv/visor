const { PyAstParser } = require('./dist/extension.js');

const simpleCode = `
def test_loop():
    for i in range(5):
        if i == 1:
            continue
        elif i == 3:
            break
        else:
            print(i)
`;

console.log('Testing simple loop with break and continue:');
console.log(simpleCode);

const parser = new PyAstParser();
const result = parser.generateFlowchart(simpleCode);

console.log('Generated flowchart:');
console.log(result.flowchart); 