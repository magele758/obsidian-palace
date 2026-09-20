import { describe, expect, it } from 'vitest';
import { createPalaceToolRegistry } from './palaceTools';
import { fakeVaultApp } from './testSupport';

const CORE_TOOLS = [
  'find_orphan_notes',
  'get_note_links',
  'get_related_notes',
  'list_notes',
  'read_note',
  'search_vault',
  'traverse_links',
  'write_note',
];

describe('createPalaceToolRegistry', () => {
  it('registers only the original vault tools by default', () => {
    const names = createPalaceToolRegistry({ app: fakeVaultApp() })
      .getAll()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(CORE_TOOLS);
    expect(names).not.toContain('bash');
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('search_vault_qa');
  });

  it('adds execute_code only when a sandbox is present', () => {
    const names = createPalaceToolRegistry({
      app: fakeVaultApp(),
      sandboxProvider: {
        name: 'stub',
        init: async () => undefined,
        execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        destroy: async () => undefined,
      },
    })
      .getAll()
      .map((t) => t.name);
    expect(names).toContain('execute_code');
    expect(names.filter((n) => n === 'execute_code')).toHaveLength(1);
  });

  it('adds get_vault_status only when vault QA is enabled with HybridSearch', () => {
    const off = createPalaceToolRegistry({
      app: fakeVaultApp(),
      vaultQAEnabled: true,
    })
      .getAll()
      .map((t) => t.name);
    expect(off).not.toContain('get_vault_status');

    const on = createPalaceToolRegistry({
      app: fakeVaultApp(),
      vaultQAEnabled: true,
      hybridSearch: { search: async () => [] } as never,
    })
      .getAll()
      .map((t) => t.name);
    expect(on).toContain('get_vault_status');
  });
});
