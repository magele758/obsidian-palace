import { requestUrl, Notice } from 'obsidian';

export interface TranslatorConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  targetLang: string;
  systemPrompt: string;
  maxChunkSize: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const DEFAULT_SYSTEM_PROMPT = `You are a professional translator. Translate the following content to {targetLang}.

Rules:
1. Preserve all Markdown formatting, including headings, lists, links, images, code blocks, and inline code.
2. Do not translate content inside code blocks (\`\`\` or \`).
3. Do not translate URLs, file paths, or variable names.
4. Keep the original paragraph structure.
5. Only output the translated content, do not add explanations or notes.`;

export class Translator {
  private config: TranslatorConfig;

  constructor(config: TranslatorConfig) {
    this.config = config;
  }

  /**
   * 将长文档按段落分块，每块不超过 maxChunkSize 字符
   */
  splitIntoChunks(content: string): string[] {
    const { maxChunkSize } = this.config;
    if (content.length <= maxChunkSize) {
      return [content];
    }

    const chunks: string[] = [];
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // 如果单个段落就超过了 maxChunkSize，强制按行切割
      if (paragraph.length > maxChunkSize) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const lines = paragraph.split('\n');
        for (const line of lines) {
          if ((currentChunk + '\n' + line).length > maxChunkSize && currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = line;
          } else {
            currentChunk = currentChunk ? currentChunk + '\n' + line : line;
          }
        }
        continue;
      }

      const newChunk = currentChunk
        ? currentChunk + '\n\n' + paragraph
        : paragraph;

      if (newChunk.length > maxChunkSize && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = newChunk;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * 翻译单个文本块
   */
  async translateChunk(text: string): Promise<string> {
    const { baseUrl, apiKey, modelName, targetLang, systemPrompt } = this.config;

    const resolvedPrompt = (systemPrompt || DEFAULT_SYSTEM_PROMPT)
      .replace(/\{targetLang\}/g, targetLang);

    const messages: ChatMessage[] = [
      { role: 'system', content: resolvedPrompt },
      { role: 'user', content: text },
    ];

    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.3,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`API 请求失败 (${response.status}): ${response.text}`);
    }

    const data: ChatCompletionResponse = response.json;
    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 返回了空的响应');
    }

    return data.choices[0].message.content;
  }

  /**
   * 翻译完整文档，带进度回调
   */
  async translateDocument(
    content: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<string> {
    const chunks = this.splitIntoChunks(content);
    const translatedChunks: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }

      try {
        const translated = await this.translateChunk(chunks[i]);
        translatedChunks.push(translated);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`翻译第 ${i + 1}/${chunks.length} 段时出错: ${msg}`);
      }
    }

    return translatedChunks.join('\n\n');
  }
}
