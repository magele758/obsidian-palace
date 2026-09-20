import { describe, expect, it } from 'vitest';
import { ChatSseAssembler } from './chatSse';

function sse(delta: Record<string, unknown>, finish?: string): string {
  const choice: Record<string, unknown> = { delta };
  if (finish) choice.finish_reason = finish;
  return `data: ${JSON.stringify({ choices: [choice] })}\n`;
}

describe('ChatSseAssembler', () => {
  it('emits content and reasoning deltas from a mixed buffer', async () => {
    const deltas: Array<{ content?: string; reasoning?: string }> = [];
    const assembler = new ChatSseAssembler((delta) => deltas.push(delta));
    await assembler.pushText(
      sse({ reasoning_content: 'think ' }) +
        sse({ content: 'Hi' }) +
        sse({ content: '!' }, 'stop') +
        'data: [DONE]\n'
    );
    await assembler.flush();
    expect(deltas).toEqual([
      { reasoning: 'think ' },
      { content: 'Hi' },
      { content: '!' },
    ]);
    expect(assembler.result()).toMatchObject({
      content: 'Hi!',
      reasoning: 'think ',
      finish_reason: 'stop',
    });
  });

  it('accumulates streamed tool_call argument fragments', async () => {
    const assembler = new ChatSseAssembler(() => undefined);
    await assembler.pushText(
      sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_vault', arguments: '{"q":' } }] }) +
        sse({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, 'tool_calls')
    );
    await assembler.flush();
    expect(assembler.result().tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'search_vault', arguments: '{"q":"x"}' } },
    ]);
  });
});
