import * as assert from 'assert';
import { analyzePythonCode } from '../logic/language-services/python';
import { analyzeTypeScriptCode } from '../logic/language-services/typescript';

suite('Performance Tests', () => {
    // Medium-sized Python code sample
    const pythonCode = `
def complex_function(data):
    """Process complex data structure"""
    result = []
    
    for item in data:
        if isinstance(item, dict):
            for key, value in item.items():
                if value > 10:
                    result.append(key)
                else:
                    continue
        elif isinstance(item, list):
            for subitem in item:
                if subitem % 2 == 0:
                    result.append(subitem * 2)
                else:
                    result.append(subitem + 1)
        else:
            try:
                with open('config.txt', 'r') as f:
                    config = f.read()
                    if config:
                        result.append(len(config))
            except FileNotFoundError:
                pass
    
    return result
`;

    // Large Python function for stress testing
    const largePythonCode = `
def massive_function(data, config, options):
    """Large complex function for performance testing"""
    results = []
    cache = {}
    counter = 0
    
    # Initial setup
    for i in range(len(data)):
        if data[i] is None:
            continue
        
        # Complex nested processing
        for j in range(i, len(data)):
            if j in cache:
                value = cache[j]
            else:
                try:
                    if isinstance(data[j], (int, float)):
                        value = data[j] * 2
                        if value > 100:
                            for k in range(5):
                                if k % 2 == 0:
                                    value += k
                                else:
                                    value -= k * 0.5
                        elif value < 0:
                            value = abs(value)
                        else:
                            value = value ** 0.5
                    elif isinstance(data[j], str):
                        value = len(data[j])
                        if value > 10:
                            for char in data[j]:
                                if char.isalpha():
                                    value += ord(char)
                        else:
                            value = value * 3
                    else:
                        value = 0
                except (TypeError, ValueError) as e:
                    print(f"Error processing {data[j]}: {e}")
                    value = -1
                finally:
                    counter += 1
                    cache[j] = value
            
            # Decision tree
            if value > 50:
                if counter % 3 == 0:
                    results.append(('high', value, j))
                elif counter % 3 == 1:
                    results.append(('medium', value / 2, j))
                else:
                    results.append(('low', value / 4, j))
            elif value > 0:
                try:
                    with open(f'temp_{j}.txt', 'w') as f:
                        f.write(str(value))
                    results.append(('file', value, j))
                except IOError:
                    results.append(('error', value, j))
            else:
                while counter > 0:
                    counter -= 1
                    if counter < 10:
                        break
                results.append(('negative', abs(value), j))
        
        # Cleanup phase
        if len(results) > 100:
            results = results[-50:]  # Keep only last 50
            
    # Final processing
    final_results = []
    for result_type, value, index in results:
        if result_type == 'high':
            final_results.append(value * 2)
        elif result_type == 'medium':
            final_results.append(value * 1.5)
        elif result_type == 'low':
            final_results.append(value)
        elif result_type == 'file':
            final_results.append(value + index)
        elif result_type == 'error':
            final_results.append(0)
        elif result_type == 'negative':
            final_results.append(-value)
        else:
            final_results.append(1)
    
    return final_results if final_results else [0]
`;

    // Medium-sized TypeScript code sample
    const typeScriptCode = `
function complexFunction(data: any[]): (string | number)[] {
    const result: (string | number)[] = [];
    
    for (const item of data) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            for (const [key, value] of Object.entries(item)) {
                if (typeof value === 'number' && value > 10) {
                    result.push(key);
                } else {
                    continue;
                }
            }
        } else if (Array.isArray(item)) {
            for (const subitem of item) {
                if (typeof subitem === 'number') {
                    if (subitem % 2 === 0) {
                        result.push(subitem * 2);
                    } else {
                        result.push(subitem + 1);
                    }
                }
            }
        } else {
            try {
                const fs = require('fs');
                const config = fs.readFileSync('config.txt', 'utf8');
                if (config) {
                    result.push(config.length);
                }
            } catch (error) {
                // Handle error
            }
        }
    }
    
    return result;
}
`;

    test('Python parser performance should be reasonable', function() {
        this.timeout(5000); // 5 second timeout
        
        const startTime = Date.now();
        const result = analyzePythonCode(pythonCode, 100);
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        console.log(`Python parser took ${duration}ms`);
        
        // Should complete within 1 second for reasonable code size
        assert.ok(duration < 1000, `Python parser took too long: ${duration}ms`);
        
        // Should return valid result
        assert.ok(result.flowchart);
        assert.ok(result.locationMap);
    });

    test('TypeScript parser performance should be reasonable', function() {
        this.timeout(5000); // 5 second timeout
        
        const startTime = Date.now();
        const result = analyzeTypeScriptCode(typeScriptCode, 100);
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        console.log(`TypeScript parser took ${duration}ms`);
        
        // Should complete within 1 second for reasonable code size
        assert.ok(duration < 1000, `TypeScript parser took too long: ${duration}ms`);
        
        // Should return valid result
        assert.ok(result.flowchart);
        assert.ok(result.locationMap);
    });

    test('Large Python function performance stress test', function() {
        this.timeout(10000); // 10 second timeout
        
        const startTime = Date.now();
        const result = analyzePythonCode(largePythonCode, 500);
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        const nodeCount = (result.flowchart.match(/^\s*\w+.*\[/gm) || []).length;
        console.log(`Large Python function took ${duration}ms`);
        console.log(`Generated ${nodeCount} nodes`);
        
        // Should complete within 3 seconds even for large functions
        assert.ok(duration < 3000, `Large Python parser took too long: ${duration}ms`);
        
        // Should return valid result
        assert.ok(result.flowchart);
        assert.ok(result.locationMap);
        
        // Should handle complexity gracefully (not crash)
        assert.ok(!result.flowchart.includes('Error:'), 'Should not error on complex code');
    });

    test('Multiple analysis runs for memory stability', function() {
        this.timeout(15000); // 15 second timeout
        
        // Run multiple analyses to test memory accumulation
        const iterations = 10;
        const results: number[] = [];
        
        for (let i = 0; i < iterations; i++) {
            const startTime = Date.now();
            
            // Alternate between Python and TypeScript
            if (i % 2 === 0) {
                analyzePythonCode(largePythonCode, 500);
            } else {
                analyzeTypeScriptCode(typeScriptCode, 100);
            }
            
            const duration = Date.now() - startTime;
            results.push(duration);
        }
        
        // Performance should remain stable
        const firstHalf = results.slice(0, iterations / 2);
        const secondHalf = results.slice(iterations / 2);
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        console.log(`First half average: ${firstAvg.toFixed(2)}ms`);
        console.log(`Second half average: ${secondAvg.toFixed(2)}ms`);
        console.log(`Performance stability ratio: ${(secondAvg / firstAvg).toFixed(2)}x`);
        
        // Performance should not degrade by more than 100%
        assert.ok(secondAvg < firstAvg * 2, 
            `Performance degraded too much: ${firstAvg.toFixed(2)}ms -> ${secondAvg.toFixed(2)}ms`);
    });
}); 