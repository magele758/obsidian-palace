/**
 * Paint assistant text as plain text during the stream.
 * MarkdownRenderer on every token blocks the UI and looks like a dump.
 */

import { MarkdownRenderer, type App, type Component } from 'obsidian';

export class LiveBubble {
  text = '';
  private frame = 0;
  private live: HTMLElement | null = null;

  constructor(private bubble: HTMLElement) {}

  append(token: string) {
    this.text += token;
    this.schedule();
  }

  showStatus(label: string) {
    this.cancel();
    this.bubble.empty();
    this.live = null;
    this.bubble.createDiv({ cls: 'ai-chat-tool-status', text: label });
    if (this.text) this.ensureLive().textContent = this.text;
  }

  showTool(toolName: string) {
    this.cancel();
    this.bubble.empty();
    this.live = null;
    const thinking = this.bubble.createDiv({ cls: 'ai-chat-tool-status' });
    thinking.createSpan({ text: `🔧 Using: ${toolName}` });
    if (this.text) this.ensureLive().textContent = this.text;
  }

  async commit(app: App, view: Component, result: string) {
    this.cancel();
    this.bubble.empty();
    this.live = null;
    await MarkdownRenderer.render(app, result, this.bubble, '', view);
  }

  discard() {
    this.cancel();
  }

  private ensureLive(): HTMLElement {
    this.bubble.querySelector('.ai-chat-typing')?.remove();
    if (!this.live) {
      this.live = this.bubble.createDiv({ cls: 'ai-chat-stream-text' });
    }
    return this.live;
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.ensureLive().textContent = this.text;
    });
  }

  private cancel() {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
