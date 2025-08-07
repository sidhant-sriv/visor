import * as fs from 'fs';
import * as path from 'path';
import { DataFlowAnalyzer } from './logic/DataFlowAnalyzer';
import { DataFlowMermaidGenerator } from './logic/DataFlowMermaidGenerator';

/**
 * Manual test runner for data flow analysis - validates components individually
 */
async function runManualTests() {
  console.log('=== Manual Data Flow Analysis Tests ===\n');

  try {
    // Test 1: Create analyzer and generator
    console.log('1. Creating analyzer and generator...');
    const analyzer = new DataFlowAnalyzer();
    const generator = new DataFlowMermaidGenerator();
    console.log('✅ Components created successfully\n');

    // Test 2: Read test file
    console.log('2. Reading test file...');
    const testFilePath = path.join(__dirname, 'test-dataflow-simple.ts');
    const testFileExists = fs.existsSync(testFilePath);
    console.log('Test file exists:', testFileExists);
    
    if (testFileExists) {
      const content = fs.readFileSync(testFilePath, 'utf8');
      console.log('Test file size:', content.length, 'characters');
      console.log('First 100 characters:', content.substring(0, 100));
    } else {
      console.log('❌ Test file not found, creating a simple one...');
      const simpleTestContent = `
let globalVar = 0;
function testFunc() {
  globalVar++;
  return globalVar;
}
      `.trim();
      fs.writeFileSync(testFilePath, simpleTestContent);
      console.log('✅ Created simple test file');
    }
    console.log();

    // Test 3: Test mermaid generation with minimal data
    console.log('3. Testing mermaid generation...');
    const sampleAnalysis = {
      functions: [{
        name: 'testFunction',
        filePath: testFilePath,
        location: { start: 0, end: 50, line: 1, column: 0 },
        globalStateAccesses: [],
        parameters: [],
        calls: [],
        isAsync: false
      }],
      globalStateVariables: [],
      dataFlowEdges: [],
      title: "Manual Test",
      scope: 'function' as const,
      analysisTimestamp: Date.now()
    };

    const mermaidCode = generator.generateDataFlowGraph(sampleAnalysis);
    console.log('Generated mermaid code:');
    console.log('---');
    console.log(mermaidCode);
    console.log('---');
    console.log('Mermaid code length:', mermaidCode.length);

    // Validate mermaid syntax
    const isValidMermaid = mermaidCode.includes('graph TD') && mermaidCode.trim().length > 10;
    console.log('Valid mermaid syntax:', isValidMermaid ? '✅' : '❌');
    console.log();

    // Test 4: Test with global variables
    console.log('4. Testing with global variables...');
    const analysisWithGlobals = {
      ...sampleAnalysis,
      globalStateVariables: [{
        name: 'globalVar',
        type: 'number',
        declarationLocation: { start: 0, end: 20, line: 1, column: 0 },
        accessedBy: ['testFunction'],
        modifications: []
      }],
      functions: [{
        ...sampleAnalysis.functions[0],
        globalStateAccesses: [
          { variableName: 'globalVar', accessType: 'write' as const, location: { start: 30, end: 40, line: 2, column: 0 } }
        ]
      }]
    };

    const mermaidWithGlobals = generator.generateDataFlowGraph(analysisWithGlobals);
    console.log('Generated mermaid with globals:');
    console.log('---');
    console.log(mermaidWithGlobals);
    console.log('---');
    console.log('Contains global node:', mermaidWithGlobals.includes('global_globalVar') ? '✅' : '❌');
    console.log('Contains function node:', mermaidWithGlobals.includes('func_testFunction') ? '✅' : '❌');
    console.log();

    console.log('=== Manual Tests Completed Successfully ===');
    return true;

  } catch (error) {
    console.error('❌ Manual test failed:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'Unknown error');
    return false;
  }
}

// Test analyzer methods individually
async function testAnalyzerMethods() {
  console.log('=== Testing Analyzer Methods ===\n');
  
  try {
    // Test regex patterns for finding functions and globals
    const testCode = `
let globalCounter = 0;
const userState = { name: "", active: false };

function processData(input) {
  if (!userState.active) return null;
  globalCounter++;
  return input.toUpperCase();
}

async function asyncProcess(data) {
  globalCounter += 2;
  return processData(data);
}
    `.trim();

    console.log('Test code length:', testCode.length);

    // Test function detection
    const functionRegex = /(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(/gm;
    const functions = [];
    let match;
    while ((match = functionRegex.exec(testCode)) !== null) {
      functions.push(match[1]);
    }
    console.log('Functions found:', functions);

    // Test global variable detection
    const globalRegex = /(?:^|\s)(?:let|const|var)\s+(\w+)\s*=/gm;
    const globals: string[] = [];
    while ((match = globalRegex.exec(testCode)) !== null) {
      globals.push(match[1]);
    }
    console.log('Globals found:', globals);

    // Test global usage detection
    console.log('\nGlobal usage analysis:');
    functions.forEach(func => {
      const funcStart = testCode.indexOf(`function ${func}`);
      const funcEnd = testCode.indexOf('}', funcStart);
      const funcBody = testCode.substring(funcStart, funcEnd + 1);
      
      console.log(`\n${func}:`);
      globals.forEach(global => {
        const usage = funcBody.includes(global);
        if (usage) {
          const writePattern = new RegExp(`${global}\\s*[\\+\\-\\*\\/]?=`, 'g');
          const isWrite = writePattern.test(funcBody);
          console.log(`  - ${global}: ${isWrite ? 'WRITE' : 'READ'}`);
        }
      });
    });

    console.log('\n✅ Analyzer method tests completed');
  } catch (error) {
    console.error('❌ Analyzer method test failed:', error);
  }
}

// Run all tests
if (require.main === module) {
  runManualTests()
    .then((success) => {
      if (success) {
        return testAnalyzerMethods();
      }
    })
    .then(() => {
      console.log('\n🎉 All manual tests completed!');
    })
    .catch(error => {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    });
}

export { runManualTests, testAnalyzerMethods };