/**
 * Unified LLM client supporting both streaming and non-streaming,
 * with tool calling support for OpenAI-compatible APIs.
 */

import { requestUrl } from 'obsidian';
import { ChatSseAssembler } from './chatSse';
import { postSseBytes } from './nodeHttpStream';
import type { LLMMessage, LLMResponse, LLMStreamDelta, ToolDefinition } from './types';

/* ---- Embedding Types ---- */

export interface Embedding {
  vector: number[];
  text: string;
  tokens?: number;
}

export interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

function choiceToResponse(choice: {
  finish_reason?: string;
  message?: {
    content?: string | null;
    reasoning_content?: string;
    reasoning?: string;
    tool_calls?: ToolCall[];
  };
}): LLMResponse {
  const message = choice.message ?? {};
  const reasoning = message.reasoning_content || message.reasoning;
  return {
    content: message.content ?? null,
    reasoning: reasoning || undefined,
    tool_calls: message.tool_calls,
    finish_reason: choice.finish_reason || 'stop',
  };
}

export class LLMClient {
  constructor(private config: LLMClientConfig) {}

  /**
   * Non-streaming completion (for translation, extraction, etc.)
   */
  async complete(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      tools?: ToolDefinition[];
      maxTokens?: number;
    }
  ): Promise<LLMResponse> {
    const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: messages.map(m => this.serializeMessage(m)),
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
    if (options?.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 200) {
      throw new Error(`API request failed (${response.status}): ${response.text}`);
    }

    const data = response.json;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('API returned empty response');
    }

    return choiceToResponse(choice);
  }

  /**
   * Streaming completion with callback for deltas.
   * Desktop uses Node http so SSE is not buffered by requestUrl/fetch.
   */
  async stream(
    messages: LLMMessage[],
    onDelta: (delta: LLMStreamDelta) => void,
    options?: {
      temperature?: number;
      tools?: ToolDefinition[];
      signal?: AbortSignal;
      maxTokens?: number;
    }
  ): Promise<LLMResponse> {
    const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: messages.map(m => this.serializeMessage(m)),
      temperature: options?.temperature ?? 0.7,
      stream: true,
      max_tokens: options?.maxTokens ?? 8192,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
    const payload = JSON.stringify(body);
    const assembler = new ChatSseAssembler(onDelta);
    await postSseBytes(url, payload, headers, options?.signal, (chunk) =>
      assembler.pushText(chunk.toString('utf8'))
    );
    await assembler.flush();
    return assembler.result();
  }

  private serializeMessage(msg: LLMMessage): Record<string, unknown> {
    const result: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls) result.tool_calls = msg.tool_calls;
    return result;
  }

  /* ---- Embedding Methods ---- */

  /**
   * Create embedding for a single text
   */
  async createEmbedding(text: string, model?: string): Promise<Embedding> {
    const result = await this.createEmbeddings([text], model);
    return result[0];
  }

  /**
   * Create embeddings for multiple texts in batch
   */
  async createEmbeddings(texts: string[], model?: string): Promise<Embedding[]> {
    const url = this.config.baseUrl.replace(/\/+$/, '') + '/embeddings';

    const body: Record<string, unknown> = {
      model: model || this.config.modelName.replace(/^(gpt|chat)/, 'text-embedding'),
      input: texts,
    };

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 200) {
      throw new Error(`Embedding API request failed (${response.status}): ${response.text}`);
    }

    const data = response.json as EmbeddingResponse;

    // Sort by index to preserve order
    const sortedData = data.data.sort((a, b) => a.index - b.index);

    return sortedData.map((item, idx) => ({
      vector: item.embedding,
      text: texts[idx],
      tokens: data.usage?.total_tokens ? Math.floor(data.usage.total_tokens / texts.length) : undefined,
    }));
  }
}
