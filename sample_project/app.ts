// app.ts
import { Calculator, add } from './math_utils';

class Application {
    private calculator: Calculator;

    constructor() {
        this.calculator = new Calculator();
    }

    run(): void {
        console.log("Starting application...");
        
        // Use imported functions
        const sum = add(10, 20);
        console.log(`Direct addition: ${sum}`);
        
        // Use calculator class
        const calcResult1 = this.calculator.calculate('add', 5, 15);
        const calcResult2 = this.calculator.calculate('multiply', 3, 7);
        
        console.log(`Calculator results: ${calcResult1}, ${calcResult2}`);
        console.log(`History: ${this.calculator.getHistory()}`);
        
        this.displayResults([sum, calcResult1, calcResult2]);
    }
    
    private displayResults(results: number[]): void {
        console.log("All results:", results);
    }
}

const app = new Application();
app.run();