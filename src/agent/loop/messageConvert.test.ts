import { describe, expect, it } from 'vitest';
import {
  extractAssistantText,
  llmMessagesToSessionSeed,
  llmResponseToTurnResult,
  parseArgs,
  sessionMessagesToLlm,
  toolContentLooksFailed,
} from './messageConvert';
import type { SessionMessage } from './loopTypes';

describe('messageConvert', () => {
  it('parses tool arguments and treats missing JSON as empty object', () => {
    expect(parseArgs('{"q":"hi"}')).toEqual({ q: 'hi' });
    expect(parseArgs('not-json')).toEqual({});
    expect(parseArgs(undefined)).toEqual({});
  });

  it('flags tool JSON error payloads', () => {
    expect(toolContentLooksFailed(JSON.stringify({ error: 'nope' }))).toBe(true);
    expect(toolContentLooksFailed(JSON.stringify({ results: [] }))).toBe(false);
    expect(toolContentLooksFailed('plain text')).toBe(false);
  });

  it('converts LLM history into session seed and back', () => {
    const seeded = llmMessagesToSessionSeed([
      { role: 'user', content: 'search notes' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'search_vault', arguments: '{"query":"x"}' },
          },
        ],
      },
      { role: 'tool', content: '{"results":[]}', tool_call_id: 'c1' },
    ]);
    expect(seeded[0]?.role).toBe('user');
    const msgs: SessionMessage[] = seeded.map((s, i) => ({
      role: s.role,
      parts: s.parts,
      seq: i,
    }));
    const llm = sessionMessagesToLlm(msgs);
    expect(llm.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
    expect(llm.some((m) => m.role === 'assistant' && m.tool_calls?.[0]?.function.name === 'search_vault')).toBe(true);
  });

  it('maps reasoning-only replies into assistant parts', () => {
    const result = llmResponseToTurnResult({
      content: null,
      reasoning: 'user said hi; greet them',
      finish_reason: 'stop',
    });
    expect(result.stopReason).toBe('end');
    expect(result.assistantParts).toEqual([
      { type: 'reasoning', text: 'user said hi; greet them' },
    ]);
  });

  it('maps LLM responses with tool calls to tool_use stopReason', () => {
    const result = llmResponseToTurnResult({
      content: null,
      finish_reason: 'tool_calls',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'read_note', arguments: '{"path":"a.md"}' } },
      ],
    });
    expect(result.stopReason).toBe('tool_use');
    expect(result.assistantParts.some((p) => p.type === 'tool_call' && p.name === 'read_note')).toBe(true);
  });

  it('extracts the last assistant text', () => {
    const text = extractAssistantText([
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'final' }] },
    ]);
    expect(text).toBe('final');
  });

  it('does not leak model reasoning into visible assistant text when content exists', () => {
    const text = extractAssistantText([
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'The user said hi. Greet them.' },
          { type: 'text', text: 'Hi! How can I help?' },
        ],
      },
    ]);
    expect(text).toBe('Hi! How can I help?');
  });
});
