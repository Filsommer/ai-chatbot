/**
 * Client SDK for interacting with the Traces API
 * Provides easy-to-use functions for trace, generation, and span management
 * Now with local tracking and batch sending to backend
 */

interface TraceStartRequest {
  name: string;
  metadata?: any;
  tags?: string[];
  input?: any;
}

interface TraceStartResponse {
  success: boolean;
  trace: {
    id: string;
    name: string;
    status: string;
    timestamp: string;
  };
}

interface GenerationStartRequest {
  traceId: string;
  name: string;
  model?: string;
  input?: any;
  metadata?: any;
  agentName?: string;
}

interface GenerationStartResponse {
  success: boolean;
  generation: {
    id: string;
    trace_id: string;
    agent_name: string;
    step_order: number;
    status: string;
    timestamp: string;
    type: "generation";
  };
}

interface SpanStartRequest {
  traceId: string;
  name: string;
  metadata?: any;
  agentName?: string;
}

interface SpanStartResponse {
  success: boolean;
  span: {
    id: string;
    trace_id: string;
    agent_name: string;
    step_order: number;
    status: string;
    timestamp: string;
    type: "span";
  };
}

interface GenerationEndRequest {
  generationId: string;
  output?: any;
  usageDetails?: {
    input: number;
    output: number;
  };
  latency?: number;
  cost?: number;
}

interface GenerationEndResponse {
  success: boolean;
  generation: {
    id: string;
    status: string;
    output_text: string;
    tokens?: string;
    latency_ms?: number;
    total_cost?: number;
    type: "generation";
  };
}

interface SpanEndRequest {
  spanId: string;
  metadata?: any;
  latency?: number;
}

interface SpanEndResponse {
  success: boolean;
  span: {
    id: string;
    status: string;
    latency_ms?: number;
    type: "span";
  };
}

interface TraceEndRequest {
  traceId: string;
  output?: any;
  latency?: number;
  cost?: number;
  tokens?: number;
  matched_schema?: boolean;
}

interface TraceEndResponse {
  success: boolean;
  trace: {
    id: string;
    status: string;
    output: any;
    latency_ms?: number;
    total_cost?: number;
    tokens?: number;
  };
}

// Local data structures for tracking
interface LocalGeneration {
  id: string;
  name: string;
  model?: string;
  input?: any;
  output?: any;
  metadata?: any;
  agentName?: string;
  startTime: number;
  endTime?: number;
  usageDetails?: {
    input: number;
    output: number;
  };
  cost?: number;
}

interface LocalSpan {
  id: string;
  name: string;
  metadata?: any;
  agentName?: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
}

interface LocalTrace {
  id: string;
  name: string;
  userId: string;
  metadata?: any;
  tags?: string[];
  input?: any;
  output?: any;
  startTime: number;
  endTime?: number;
  generations: Map<string, LocalGeneration>;
  spans: Map<string, LocalSpan>;
  cost?: number;
  tokens?: number;
  matched_schema?: boolean;
}

/**
 * Generation class that handles its own lifecycle
 */
export class LangsheetGeneration {
  private data: LocalGeneration;
  private trace: LangsheetTrace;
  private isEnded: boolean = false;

  constructor(trace: LangsheetTrace, data: LocalGeneration) {
    this.trace = trace;
    this.data = data;
  }

  /**
   * End this generation
   */
  end(
    data: {
      output?: any;
      usageDetails?: {
        input: number;
        output: number;
      };
      cost?: number;
    } = {},
  ): void {
    if (this.isEnded) {
      console.error(
        `[LANGSHEET] Error: Generation "${this.data.name}" has already been ended.`,
      );
      return;
    }

    this.data.endTime = Date.now();
    this.data.output = data.output;
    this.data.usageDetails = data.usageDetails;
    this.data.cost = data.cost;
    this.isEnded = true;

    console.log(
      `[LANGSHEET] Ended generation "${this.data.name}" (${this.data.endTime - this.data.startTime}ms)`,
    );
  }

  /**
   * Get generation data (internal use)
   */
  getData(): LocalGeneration {
    return this.data;
  }

  /**
   * Get generation ID
   */
  getId(): string {
    return this.data.id;
  }

  /**
   * Get generation name
   */
  getName(): string {
    return this.data.name;
  }

  /**
   * Check if this generation has ended
   */
  hasEnded(): boolean {
    return this.isEnded;
  }
}

/**
 * Span class that handles its own lifecycle
 */
export class LangsheetSpan {
  private data: LocalSpan;
  private trace: LangsheetTrace;
  private isEnded: boolean = false;

  constructor(trace: LangsheetTrace, data: LocalSpan) {
    this.trace = trace;
    this.data = data;
  }

  /**
   * End this span
   */
  end(
    data: {
      metadata?: any;
    } = {},
  ): void {
    if (this.isEnded) {
      console.error(
        `[LANGSHEET] Error: Span "${this.data.name}" has already been ended.`,
      );
      return;
    }

    this.data.endTime = Date.now();
    if (data.metadata) {
      this.data.metadata = { ...this.data.metadata, ...data.metadata };
    }
    this.isEnded = true;

    console.log(
      `[LANGSHEET] Ended span "${this.data.name}" (${this.data.endTime - this.data.startTime}ms)`,
    );
  }

  /**
   * Get span data (internal use)
   */
  getData(): LocalSpan {
    return this.data;
  }

  /**
   * Get span ID
   */
  getId(): string {
    return this.data.id;
  }

  /**
   * Get span name
   */
  getName(): string {
    return this.data.name;
  }

  /**
   * Check if this span has ended
   */
  hasEnded(): boolean {
    return this.isEnded;
  }

  /**
   * Start a child span under this span
   *
   * This is useful for tracking subtasks within a larger operation,
   * especially when running multiple tasks in parallel with Promise.all().
   *
   * @example
   * ```typescript
   * const mainSpan = trace.startSpan('data-processing')
   *
   * // Start multiple child spans for parallel operations
   * const tasks = [
   *   { name: 'fetch-users', url: '/api/users' },
   *   { name: 'fetch-orders', url: '/api/orders' },
   *   { name: 'fetch-products', url: '/api/products' }
   * ]
   *
   * const childSpans = tasks.map(task =>
   *   mainSpan.startChildSpan(task.name, { metadata: { url: task.url } })
   * )
   *
   * // Run tasks in parallel and end child spans
   * const results = await Promise.all(
   *   tasks.map(async (task, index) => {
   *     const childSpan = childSpans[index]
   *     try {
   *       const result = await fetch(task.url)
   *       childSpan.end({ metadata: { status: 'success' } })
   *       return result
   *     } catch (error) {
   *       childSpan.end({ metadata: { status: 'error', error: error.message } })
   *       throw error
   *     }
   *   })
   * )
   *
   * mainSpan.end()
   * ```
   */
  startChildSpan(
    name: string,
    data: {
      metadata?: any;
      agentName?: string;
    } = {},
  ): LangsheetSpan | null {
    // Create a unique child span name to avoid conflicts
    const childSpanName = `${this.data.name}:${name}`;

    if (this.trace.hasActiveSpan(childSpanName)) {
      console.error(
        `[LANGSHEET] Error: Child span "${name}" is already active under span "${this.data.name}". End it before starting a new one.`,
      );
      return null;
    }

    const spanData: LocalSpan = {
      id: this.generateSpanId(),
      name: childSpanName,
      metadata: data.metadata,
      agentName: data.agentName || this.data.agentName,
      startTime: Date.now(),
      parentId: this.data.id, // Set this span as parent
    };

    const childSpan = new LangsheetSpan(this.trace, spanData);

    // Add to trace's span tracking
    this.trace.addSpanToTrace(spanData, childSpan);

    console.log(
      `[LANGSHEET] Started child span "${name}" under "${this.data.name}" with ID: ${spanData.id}`,
    );
    return childSpan;
  }

  /**
   * Generate a unique span ID
   */
  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all child spans of this span
   */
  getChildSpans(): LangsheetSpan[] {
    return this.trace
      .getActiveSpans()
      .filter((span) => span.getData().parentId === this.data.id);
  }

  /**
   * Get all child span names
   */
  getChildSpanNames(): string[] {
    return this.getChildSpans().map(
      (span) => span.getName().split(":").pop() || span.getName(),
    );
  }
}

class TraceClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl =
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000/api/traces"
        : "https://langsheet.vercel.app/api/traces";
    this.apiKey = "12345"; // || apiKey || process.env.LANGSHEET_KEY || "";
  }

  private async makeRequest(method: string, data: any) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add API key header if available
    if (this.apiKey) {
      headers["X-Langsheet-Key"] = this.apiKey;
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        method,
        ...data,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(
        `[LANGSHEET] Error: ${error.error || `HTTP ${response.status}`}`,
      );
      return {
        success: false,
        error: error.error || `HTTP ${response.status}`,
      };
    }

    return response.json();
  }

  /**
   * Send complete trace data to backend in a single request
   */
  async sendTraceData(traceData: LocalTrace): Promise<TraceStartResponse> {
    try {
      // Convert generations and spans to arrays sorted by creation time
      const generations = Array.from(traceData.generations.values())
        .map((gen) => ({
          id: gen.id,
          name: gen.name,
          model: gen.model,
          input: gen.input,
          output: gen.output,
          metadata: gen.metadata,
          agentName: gen.agentName,
          startTime: gen.startTime,
          endTime: gen.endTime,
          latency: gen.endTime ? gen.endTime - gen.startTime : undefined,
          usageDetails: gen.usageDetails,
          cost: gen.cost,
          status: gen.endTime ? "completed" : "running",
        }))
        .sort((a, b) => a.startTime - b.startTime);

      const spans = Array.from(traceData.spans.values())
        .map((span) => ({
          id: span.id,
          name: span.name,
          metadata: span.metadata,
          agentName: span.agentName,
          startTime: span.startTime,
          endTime: span.endTime,
          latency: span.endTime ? span.endTime - span.startTime : undefined,
          status: span.endTime ? "completed" : "running",
          parentId: span.parentId,
        }))
        .sort((a, b) => a.startTime - b.startTime);

      // Send everything in one request
      const response = await this.makeRequest("trace-complete", {
        // Trace data
        name: traceData.name,
        userId: traceData.userId,
        metadata: traceData.metadata,
        tags: traceData.tags,
        input: traceData.input,
        output: traceData.output,
        startTime: traceData.startTime,
        endTime: traceData.endTime,
        latency: traceData.endTime
          ? traceData.endTime - traceData.startTime
          : undefined,
        cost: traceData.cost,
        tokens: traceData.tokens,
        status: traceData.endTime ? "completed" : "running",
        matched_schema: traceData.matched_schema,

        // All generations and spans in creation order
        generations,
        spans,
      });

      console.log(
        `[LANGSHEET] Successfully sent complete trace data to backend`,
      );
      console.log(`[LANGSHEET] - Trace: ${traceData.name}`);
      console.log(`[LANGSHEET] - Generations: ${generations.length}`);
      console.log(`[LANGSHEET] - Spans: ${spans.length}`);
      console.log(
        `[LANGSHEET] - Total duration: ${traceData.endTime ? traceData.endTime - traceData.startTime : "ongoing"}ms`,
      );

      return response;
    } catch (error) {
      console.error(
        "[LANGSHEET] Failed to send complete trace data to backend:",
        error,
      );
      return {
        success: false,
        trace: { id: "", name: "", status: "error", timestamp: "" },
      };
    }
  }
}

/**
 * Helper class to manage a single trace with local tracking
 */
export class LangsheetTrace {
  private traceData: LocalTrace;
  private client: TraceClient;
  private manager: Langsheet | null = null;
  private activeGenerations: Map<string, LangsheetGeneration> = new Map();
  private activeSpans: Map<string, LangsheetSpan> = new Map();

  constructor(
    client: TraceClient,
    data: TraceStartRequest,
    manager?: Langsheet,
    userId?: string,
  ) {
    this.client = client;
    this.manager = manager || null;
    this.traceData = {
      id: this.generateId(),
      name: data.name,
      userId: userId || "anonymous", // Will be set when creating traces
      metadata: data.metadata,
      tags: data.tags,
      input: data.input,
      startTime: Date.now(),
      generations: new Map(),
      spans: new Map(),
    };
    console.log(
      `[LANGSHEET] Started trace "${data.name}" with ID: ${this.traceData.id}`,
    );
  }

  private generateId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateGenerationId(): string {
    return `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start a new generation and return the generation object
   */
  startGeneration(
    name: string,
    data: {
      model?: string;
      input?: any;
      metadata?: any;
      agentName?: string;
    } = {},
  ): LangsheetGeneration | null {
    if (this.activeGenerations.has(name)) {
      console.error(
        `[LANGSHEET] Error: Generation "${name}" is already active. End it before starting a new one.`,
      );
      return null;
    }

    const generationData: LocalGeneration = {
      id: this.generateGenerationId(),
      name,
      model: data.model,
      input: data.input,
      metadata: data.metadata,
      agentName: data.agentName,
      startTime: Date.now(),
    };

    const generation = new LangsheetGeneration(this, generationData);
    this.traceData.generations.set(name, generationData);
    this.activeGenerations.set(name, generation);

    console.log(
      `[LANGSHEET] Started generation "${name}" with ID: ${generationData.id}`,
    );
    return generation;
  }

  /**
   * Start a new span and return the span object
   */
  startSpan(
    name: string,
    data: {
      metadata?: any;
      agentName?: string;
    } = {},
  ): LangsheetSpan | null {
    if (this.activeSpans.has(name)) {
      console.error(
        `[LANGSHEET] Error: Span "${name}" is already active. End it before starting a new one.`,
      );
      return null;
    }

    const spanData: LocalSpan = {
      id: this.generateSpanId(),
      name,
      metadata: data.metadata,
      agentName: data.agentName,
      startTime: Date.now(),
    };

    const span = new LangsheetSpan(this, spanData);
    this.traceData.spans.set(name, spanData);
    this.activeSpans.set(name, span);

    console.log(`[LANGSHEET] Started span "${name}" with ID: ${spanData.id}`);
    return span;
  }

  /**
   * End the trace and send all data to backend
   */
  async end(
    data: {
      output?: any;
      cost?: number;
      tokens?: number;
      matched_schema?: boolean;
    } = {},
  ): Promise<TraceStartResponse> {
    this.traceData.endTime = Date.now();
    this.traceData.output = data.output;
    this.traceData.cost = data.cost;
    this.traceData.tokens = data.tokens;
    this.traceData.matched_schema = data.matched_schema;

    // Calculate total cost from generations if not provided
    if (!this.traceData.cost) {
      this.traceData.cost = Array.from(
        this.traceData.generations.values(),
      ).reduce((total, gen) => total + (gen.cost || 0), 0);
    }

    console.log(
      `[LANGSHEET] Ending trace "${this.traceData.name}" (${this.traceData.endTime - this.traceData.startTime}ms total)`,
    );
    console.log(
      `[LANGSHEET] - Generations: ${this.traceData.generations.size}`,
    );
    console.log(`[LANGSHEET] - Spans: ${this.traceData.spans.size}`);
    console.log(`[LANGSHEET] - Total cost: $${this.traceData.cost || 0}`);

    // Send all data to backend
    const result = await this.client.sendTraceData(this.traceData);

    // Remove this trace from the manager's active traces
    if (this.manager) {
      this.manager.removeTrace(this.traceData.id);
    }

    return result;
  }

  /**
   * Get trace ID
   */
  getId(): string {
    return this.traceData.id;
  }

  /**
   * Get active generation names
   */
  getActiveGenerationNames(): string[] {
    return Array.from(this.activeGenerations.keys()).filter((name) => {
      const gen = this.activeGenerations.get(name);
      return gen && !gen.hasEnded();
    });
  }

  /**
   * Get active span names
   */
  getActiveSpanNames(): string[] {
    return Array.from(this.activeSpans.keys()).filter((name) => {
      const span = this.activeSpans.get(name);
      return span && !span.hasEnded();
    });
  }

  /**
   * Get all active generations
   */
  getActiveGenerations(): LangsheetGeneration[] {
    return Array.from(this.activeGenerations.values()).filter(
      (gen) => !gen.hasEnded(),
    );
  }

  /**
   * Get all active spans
   */
  getActiveSpans(): LangsheetSpan[] {
    return Array.from(this.activeSpans.values()).filter(
      (span) => !span.hasEnded(),
    );
  }

  /**
   * Check if a generation is active
   */
  hasActiveGeneration(name: string): boolean {
    const gen = this.activeGenerations.get(name);
    return gen ? !gen.hasEnded() : false;
  }

  /**
   * Check if a span is active
   */
  hasActiveSpan(name: string): boolean {
    const span = this.activeSpans.get(name);
    return span ? !span.hasEnded() : false;
  }

  /**
   * Debug method - print current state
   */
  debugState(): void {
    console.log("[LANGSHEET DEBUG] Current trace state:");
    console.log("  Trace ID:", this.traceData.id);
    console.log("  Name:", this.traceData.name);
    console.log(
      "  Start time:",
      new Date(this.traceData.startTime).toISOString(),
    );
    console.log(
      "  Generations:",
      Array.from(this.traceData.generations.keys()),
    );
    console.log("  Active Generations:", this.getActiveGenerationNames());
    console.log("  Spans:", Array.from(this.traceData.spans.keys()));
    console.log("  Active Spans:", this.getActiveSpanNames());
  }

  /**
   * Add a span to the trace's span tracking (used by child spans)
   */
  addSpanToTrace(spanData: LocalSpan, span: LangsheetSpan): void {
    this.traceData.spans.set(span.getName(), spanData);
    this.activeSpans.set(span.getName(), span);
  }
}

/**
 * Main Langsheet class - manager for multiple concurrent traces
 */
export class Langsheet {
  private client: TraceClient;
  private activeTraces: Map<string, LangsheetTrace> = new Map();
  private apiKey: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.LANGSHEET_KEY || "";
    this.client = new TraceClient(baseUrl, this.apiKey);
  }

  /**
   * Create a new trace. Multiple traces can be active simultaneously.
   */
  async newTrace(data: TraceStartRequest): Promise<LangsheetTrace | null> {
    // Get the authenticated user using API key
    const user = {
      key: "12345",
      userEmail: "support@rosenvalley.tech",
      userId: "2dbf69e1-c493-4d33-a860-64ba217ba94b", // UUID for support@rosenvalley.tech user
      createdAt: "2025-07-03T21:00:00Z",
      isActive: true,
    };

    if (!user) {
      console.error(
        "[LANGSHEET] Error: Invalid LANGSHEET_KEY. User must be authenticated to create traces",
      );
      return null;
    }

    const trace = new LangsheetTrace(this.client, data, this, user.userId);
    this.activeTraces.set(trace.getId(), trace);

    console.log(
      `[LANGSHEET] Created new trace "${data.name}" (ID: ${trace.getId()}) for user: ${user.userEmail}`,
    );
    console.log(`[LANGSHEET] Active traces: ${this.activeTraces.size}`);

    return trace;
  }

  /**
   * Get a specific trace by ID
   */
  getTrace(traceId: string): LangsheetTrace | null {
    return this.activeTraces.get(traceId) || null;
  }

  /**
   * Get all active traces
   */
  getActiveTraces(): LangsheetTrace[] {
    return Array.from(this.activeTraces.values());
  }

  /**
   * Get active trace IDs
   */
  getActiveTraceIds(): string[] {
    return Array.from(this.activeTraces.keys());
  }

  /**
   * Remove a trace from active tracking (called when trace ends)
   */
  removeTrace(traceId: string): void {
    if (this.activeTraces.delete(traceId)) {
      console.log(`[LANGSHEET] Removed trace ${traceId} from active tracking`);
      console.log(`[LANGSHEET] Active traces: ${this.activeTraces.size}`);
    }
  }

  /**
   * Check if there are any active traces
   */
  hasActiveTraces(): boolean {
    return this.activeTraces.size > 0;
  }

  /**
   * Get count of active traces
   */
  getActiveTraceCount(): number {
    return this.activeTraces.size;
  }

  /**
   * End all active traces (useful for cleanup)
   */
  async endAllTraces(
    data: {
      output?: any;
      cost?: number;
      tokens?: number;
      matched_schema?: boolean;
    } = {},
  ): Promise<TraceStartResponse[]> {
    const traces = Array.from(this.activeTraces.values());
    const results: TraceStartResponse[] = [];

    console.log(`[LANGSHEET] Ending all ${traces.length} active traces`);

    for (const trace of traces) {
      try {
        const result = await trace.end(data);
        results.push(result);
      } catch (error) {
        console.error(
          `[LANGSHEET] Failed to end trace ${trace.getId()}:`,
          error,
        );
      }
    }

    this.activeTraces.clear();
    return results;
  }

  /**
   * Debug method - print current state
   */
  debugState(): void {
    console.log("[LANGSHEET DEBUG] Manager state:");
    console.log("  Active traces:", this.activeTraces.size);

    for (const [id, trace] of this.activeTraces) {
      console.log(`  Trace ${id}:`);
      trace.debugState();
    }
  }
}

// Export a default instance (will use LANGSHEET_KEY from environment)
export const langsheet = new Langsheet();

// Export the TraceClient class for custom instances
export { TraceClient };

// Export types for TypeScript users
export type {
  GenerationEndRequest,
  GenerationEndResponse,
  GenerationStartRequest,
  GenerationStartResponse,
  LocalGeneration,
  LocalSpan,
  LocalTrace,
  SpanEndRequest,
  SpanEndResponse,
  SpanStartRequest,
  SpanStartResponse,
  TraceEndRequest,
  TraceEndResponse,
  TraceStartRequest,
  TraceStartResponse,
};
