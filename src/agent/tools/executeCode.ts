/**
 * Tool: execute_code - Execute code in a sandboxed environment
 */

import type { AgentTool, SandboxProvider } from '../../shared/types';

export function createExecuteCodeTool(sandboxProvider: SandboxProvider | null): AgentTool {
  return {
    name: 'execute_code',
    description: 'Execute code in a secure cloud sandbox. Supports Python and JavaScript. Use this for computation, data processing, or running scripts.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to execute',
        },
        language: {
          type: 'string',
          enum: ['python', 'javascript'],
          description: 'Programming language (default: python)',
        },
      },
      required: ['code'],
    },
    execute: async (args) => {
      if (!sandboxProvider) {
        return JSON.stringify({
          error: 'Sandbox is not configured. Please set up E2B API key in settings.',
        });
      }

      const code = String(args.code);
      const language = String(args.language || 'python');

      try {
        const result = await sandboxProvider.execute(code, language);
        return JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    },
  };
}
