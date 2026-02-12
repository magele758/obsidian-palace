/**
 * E2B Sandbox Provider - executes code in E2B cloud sandbox.
 *
 * Uses E2B REST API directly (no SDK dependency) for maximum compatibility
 * with Obsidian's Electron environment.
 *
 * API docs: https://e2b.dev/docs
 */

import type { SandboxProvider, SandboxExecResult } from '../shared/types';

interface E2BSandboxInfo {
  sandboxId: string;
  clientId: string;
}

export class E2BProvider implements SandboxProvider {
  readonly name = 'e2b';
  private apiKey: string;
  private sandboxInfo: E2BSandboxInfo | null = null;
  private baseApiUrl = 'https://api.e2b.dev';
  private templateId = 'base';  // default E2B template

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async init(): Promise<void> {
    // Create a sandbox instance
    const response = await fetch(`${this.baseApiUrl}/sandboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        templateID: this.templateId,
        timeout: 300,  // 5 minutes
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`E2B: Failed to create sandbox (${response.status}): ${text}`);
    }

    const data = await response.json();
    this.sandboxInfo = {
      sandboxId: data.sandboxID,
      clientId: data.clientID,
    };
  }

  async execute(code: string, language: string): Promise<SandboxExecResult> {
    if (!this.sandboxInfo) {
      await this.init();
    }

    const { sandboxId } = this.sandboxInfo!;

    // Use the code execution endpoint
    const command = language === 'javascript'
      ? `node -e ${JSON.stringify(code)}`
      : `python3 -c ${JSON.stringify(code)}`;

    const response = await fetch(
      `${this.baseApiUrl}/sandboxes/${sandboxId}/commands`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          cmd: command,
          timeout: 30,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`E2B: Code execution failed (${response.status}): ${text}`);
    }

    const result = await response.json();

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode ?? 0,
    };
  }

  async destroy(): Promise<void> {
    if (!this.sandboxInfo) return;

    try {
      await fetch(
        `${this.baseApiUrl}/sandboxes/${this.sandboxInfo.sandboxId}`,
        {
          method: 'DELETE',
          headers: { 'X-API-Key': this.apiKey },
        }
      );
    } catch {
      // Best effort cleanup
    }

    this.sandboxInfo = null;
  }
}
