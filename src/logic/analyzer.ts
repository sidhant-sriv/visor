import { analyzeTypeScriptCode } from "./language-services/typescript";
import { analyzePythonCode } from "./language-services/python";
import { FlowchartIR, LocationMapEntry } from "../ir/ir";
import { MermaidGenerator } from "./MermaidGenerator";

// Performance monitoring
interface PerformanceMetrics {
  analysisTime: number;
  nodeCount: number;
  edgeCount: number;
  functionSize: number;
  cacheHitRate?: number;
}

class PerformanceMonitor {
  private static metrics: PerformanceMetrics[] = [];
  private static readonly MAX_METRICS = 100;

  static recordMetrics(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }
  }

  static getAverageAnalysisTime(): number {
    if (this.metrics.length === 0) return 0;
    const sum = this.metrics.reduce((acc, m) => acc + m.analysisTime, 0);
    return sum / this.metrics.length;
  }

  static getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  static clearMetrics(): void {
    this.metrics.length = 0;
  }

  static logPerformanceSummary(): void {
    if (this.metrics.length === 0) return;
    
    const avgTime = this.getAverageAnalysisTime();
    const avgNodes = this.metrics.reduce((acc, m) => acc + m.nodeCount, 0) / this.metrics.length;
    const avgEdges = this.metrics.reduce((acc, m) => acc + m.edgeCount, 0) / this.metrics.length;
    
    console.log(`[Performance] Analyzed ${this.metrics.length} functions`);
    console.log(`[Performance] Average time: ${avgTime.toFixed(2)}ms`);
    console.log(`[Performance] Average nodes: ${avgNodes.toFixed(1)}`);
    console.log(`[Performance] Average edges: ${avgEdges.toFixed(1)}`);
  }
}

/**
 * Orchestrates the analysis of a code string.
 * Now includes performance monitoring and optimizations.
 */
export function analyzeCode(
  code: string,
  position: number,
  language: string
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
  performanceMetrics?: PerformanceMetrics;
} {
  const startTime = performance.now();

  let ir: FlowchartIR;

  // Language selection logic
  if (language === 'typescript' || language === 'javascript') {
    ir = analyzeTypeScriptCode(code, position);
  } else if (language === 'python') {
    ir = analyzePythonCode(code, position);
  } else {
    // Default or unsupported language
    ir = {
      nodes: [{ id: 'A', label: `Error: Unsupported language: ${language}`, shape: 'rect' }],
      edges: [],
      locationMap: []
    };
  }

  const endTime = performance.now();
  const analysisTime = endTime - startTime;

  // Extract metrics from IR
  const nodeCount = ir.nodes.length;
  const edgeCount = ir.edges.length;
  const functionSize = ir.functionRange ? ir.functionRange.end - ir.functionRange.start : 0;

  const metrics: PerformanceMetrics = {
    analysisTime,
    nodeCount,
    edgeCount,
    functionSize
  };

  PerformanceMonitor.recordMetrics(metrics);

  // Log slow analysis
  if (analysisTime > 100) {
    console.warn(`[Performance] Slow analysis: ${analysisTime.toFixed(2)}ms for ${functionSize} chars`);
  }

  const mermaidGenerator = new MermaidGenerator();
  const flowchart = mermaidGenerator.generate(ir);

  return {
    flowchart,
    locationMap: ir.locationMap,
    functionRange: ir.functionRange,
    performanceMetrics: metrics
  };
}

// Export performance utilities
export { PerformanceMonitor, PerformanceMetrics };
