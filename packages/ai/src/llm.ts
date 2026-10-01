/** Minimal OpenAI Chat Completions client with structured outputs, timeouts, retries and
 * usage reporting. Plain HTTP keeps it stable across SDK versions; OPENAI_BASE_URL lets
 * tests point it at a local stand-in. Swap this file to add other providers. */

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface LlmCall {
  purpose: string;
  system: string;
  user: string;
  schemaName: string;
  schema: object;
}

export interface LlmClient {
  readonly model: string;
  completeJson(call: LlmCall): Promise<{ data: unknown; usage: LlmUsage }>;
}

export class LlmError extends Error {
  constructor(public code: "auth" | "rate_limit" | "timeout" | "unavailable" | "bad_response" | "refused", message: string, public usage?: LlmUsage) {
    super(message);
  }
}

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createOpenAiClient(opts: OpenAiOptions): LlmClient {
  const base = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const maxRetries = opts.maxRetries ?? 2;

  return {
    model: opts.model,
    async completeJson(call) {
      const started = Date.now();
      let lastError: LlmError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
        let res: Response;
        try {
          res = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              model: opts.model,
              temperature: 0,
              messages: [
                { role: "system", content: call.system },
                { role: "user", content: call.user },
              ],
              response_format: { type: "json_schema", json_schema: { name: call.schemaName, strict: true, schema: call.schema } },
            }),
          });
        } catch (err) {
          lastError = new LlmError((err as Error).name === "TimeoutError" ? "timeout" : "unavailable", String(err));
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new LlmError("auth", `Model API rejected the key (${res.status}).`);
        if (res.status === 429 || res.status >= 500) {
          lastError = new LlmError(res.status === 429 ? "rate_limit" : "unavailable", `Model API returned ${res.status}.`);
          continue;
        }
        if (!res.ok) throw new LlmError("bad_response", `Model API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as {
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        };
        const usage: LlmUsage = {
          model: body.model ?? opts.model,
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
          durationMs: Date.now() - started,
        };
        const msg = body.choices?.[0]?.message;
        if (msg?.refusal) throw new LlmError("refused", "The model declined this request.", usage);
        try {
          return { data: JSON.parse(msg?.content ?? ""), usage };
        } catch {
          throw new LlmError("bad_response", "The model returned output that isn't valid JSON.", usage);
        }
      }
      throw lastError ?? new LlmError("unavailable", "Model API unavailable.");
    },
  };
}

/** Estimated cost in USD from per-million-token prices (configure to match your model). */
export function estimateCost(u: LlmUsage, pricePerMillion: { input: number; output: number }): number {
  return (u.inputTokens * pricePerMillion.input + u.outputTokens * pricePerMillion.output) / 1_000_000;
}
