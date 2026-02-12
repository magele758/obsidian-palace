/**
 * Palace View - Memory Palace knowledge graph visualization and flashcard review UI.
 */

import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import type ObsidianPalacePlugin from '../main';
import { KnowledgeGraph } from './knowledgeGraph';
import { getDueCards, getReviewStats, processReview } from './reviewScheduler';
import type { QualityRating } from './reviewScheduler';
import type { KnowledgeNode, Flashcard } from '../shared/types';

export const PALACE_VIEW_TYPE = 'palace-view';

type ViewMode = 'graph' | 'review' | 'stats';

export class PalaceView extends ItemView {
  plugin: ObsidianPalacePlugin;
  private mode: ViewMode = 'graph';
  private container: HTMLElement;
  private currentReviewCard: Flashcard | null = null;
  private showAnswer = false;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianPalacePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return PALACE_VIEW_TYPE; }
  getDisplayText() { return 'Memory Palace'; }
  getIcon() { return 'brain'; }

  async onOpen() {
    this.container = this.containerEl.children[1] as HTMLElement;
    this.container.empty();
    this.container.addClass('palace-container');
    this.render();
  }

  async onClose() {}

  /* ---- Render ---- */

  private render() {
    this.container.empty();

    // Header with mode tabs
    const header = this.container.createDiv({ cls: 'palace-header' });
    const titleRow = header.createDiv({ cls: 'palace-header-title' });
    const iconEl = titleRow.createSpan({ cls: 'palace-header-icon' });
    setIcon(iconEl, 'brain');
    titleRow.createSpan({ text: 'Memory Palace' });

    const tabs = header.createDiv({ cls: 'palace-tabs' });
    this.createTab(tabs, 'graph', 'network', 'Knowledge Graph');
    this.createTab(tabs, 'review', 'book-open', 'Review');
    this.createTab(tabs, 'stats', 'bar-chart', 'Stats');

    // Content area
    const content = this.container.createDiv({ cls: 'palace-content' });

    switch (this.mode) {
      case 'graph':
        this.renderGraph(content);
        break;
      case 'review':
        this.renderReview(content);
        break;
      case 'stats':
        this.renderStats(content);
        break;
    }
  }

  private createTab(parent: HTMLElement, mode: ViewMode, icon: string, label: string) {
    const btn = parent.createEl('button', {
      cls: `palace-tab ${this.mode === mode ? 'palace-tab-active' : ''}`,
    });
    const iconEl = btn.createSpan();
    setIcon(iconEl, icon);
    btn.createSpan({ text: label });
    btn.addEventListener('click', () => {
      this.mode = mode;
      this.render();
    });
  }

  /* ---- Graph View ---- */

  private renderGraph(container: HTMLElement) {
    const graph = this.plugin.knowledgeGraph;
    const stats = graph.getStats();

    if (stats.nodes === 0) {
      const empty = container.createDiv({ cls: 'palace-empty' });
      empty.createEl('div', { cls: 'palace-empty-icon', text: '🏛️' });
      empty.createEl('div', {
        cls: 'palace-empty-title',
        text: 'Your Memory Palace is empty',
      });
      empty.createEl('div', {
        cls: 'palace-empty-desc',
        text: 'Open a document and use the command "Extract Knowledge" to start building your knowledge graph.',
      });
      return;
    }

    // Simple graph visualization using SVG
    const graphContainer = container.createDiv({ cls: 'palace-graph-container' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.classList.add('palace-graph-svg');
    graphContainer.appendChild(svg);

    this.renderForceGraph(svg, graph);

    // Node list below
    const nodeList = container.createDiv({ cls: 'palace-node-list' });
    nodeList.createEl('h3', { text: `Concepts (${stats.nodes})` });

    const mostConnected = graph.getMostConnected(20);
    for (const { node, connections } of mostConnected) {
      const item = nodeList.createDiv({ cls: 'palace-node-item' });
      const badge = item.createSpan({ cls: `palace-node-badge palace-type-${node.type}` });
      badge.setText(node.type[0].toUpperCase());
      item.createSpan({ cls: 'palace-node-label', text: node.label });
      item.createSpan({ cls: 'palace-node-count', text: `${connections} links` });
    }
  }

  /**
   * Simple force-directed graph layout using SVG
   */
  private renderForceGraph(svg: SVGSVGElement, graph: KnowledgeGraph) {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    if (nodes.length === 0) return;

    const width = 600;
    const height = 400;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Initialize positions in a circle
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const r = Math.min(width, height) * 0.35;
      positions.set(node.id, {
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
      });
    });

    // Simple force simulation (a few iterations)
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions.get(nodes[i].id)!;
          const b = positions.get(nodes[j].id)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 500 / (dist * dist);
          a.x -= (dx / dist) * force;
          a.y -= (dy / dist) * force;
          b.x += (dx / dist) * force;
          b.y += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 80) * 0.01;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }

      // Center gravity
      for (const pos of positions.values()) {
        pos.x += (width / 2 - pos.x) * 0.01;
        pos.y += (height / 2 - pos.y) * 0.01;
        // Keep in bounds
        pos.x = Math.max(30, Math.min(width - 30, pos.x));
        pos.y = Math.max(30, Math.min(height - 30, pos.y));
      }
    }

    // Draw edges
    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.classList.add('palace-edge');
      line.style.opacity = String(0.3 + edge.weight * 0.7);
      svg.appendChild(line);
    }

    // Draw nodes
    const typeColors: Record<string, string> = {
      concept: 'var(--interactive-accent)',
      entity: 'var(--color-green)',
      topic: 'var(--color-orange)',
      fact: 'var(--color-purple)',
    };

    for (const node of nodes) {
      const pos = positions.get(node.id)!;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('palace-graph-node');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(pos.x));
      circle.setAttribute('cy', String(pos.y));
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', typeColors[node.type] || typeColors.concept);
      g.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(pos.x));
      text.setAttribute('y', String(pos.y - 12));
      text.setAttribute('text-anchor', 'middle');
      text.classList.add('palace-graph-label');
      text.textContent = node.label.length > 15 ? node.label.slice(0, 15) + '…' : node.label;
      g.appendChild(text);

      svg.appendChild(g);
    }
  }

  /* ---- Review View ---- */

  private renderReview(container: HTMLElement) {
    const flashcards = this.plugin.palaceData?.flashcards || [];
    const dueCards = getDueCards(flashcards);

    if (flashcards.length === 0) {
      const empty = container.createDiv({ cls: 'palace-empty' });
      empty.createEl('div', { cls: 'palace-empty-icon', text: '📚' });
      empty.createEl('div', { cls: 'palace-empty-title', text: 'No flashcards yet' });
      empty.createEl('div', {
        cls: 'palace-empty-desc',
        text: 'Extract knowledge from a document to generate flashcards.',
      });
      return;
    }

    if (dueCards.length === 0) {
      const done = container.createDiv({ cls: 'palace-review-done' });
      done.createEl('div', { cls: 'palace-empty-icon', text: '🎉' });
      done.createEl('div', { cls: 'palace-empty-title', text: 'All caught up!' });
      done.createEl('div', {
        cls: 'palace-empty-desc',
        text: `No cards due for review. ${flashcards.length} cards total.`,
      });
      return;
    }

    // Show current card
    if (!this.currentReviewCard) {
      this.currentReviewCard = dueCards[0];
      this.showAnswer = false;
    }

    const card = this.currentReviewCard;
    const progress = container.createDiv({ cls: 'palace-review-progress' });
    progress.setText(`${dueCards.length} cards due for review`);

    const cardEl = container.createDiv({ cls: 'palace-flashcard' });

    // Question
    const front = cardEl.createDiv({ cls: 'palace-flashcard-front' });
    front.createEl('div', { cls: 'palace-flashcard-label', text: 'Question' });
    front.createEl('div', { cls: 'palace-flashcard-text', text: card.front });

    if (this.showAnswer) {
      // Answer
      const back = cardEl.createDiv({ cls: 'palace-flashcard-back' });
      back.createEl('div', { cls: 'palace-flashcard-label', text: 'Answer' });
      back.createEl('div', { cls: 'palace-flashcard-text', text: card.back });

      // Rating buttons
      const ratings = cardEl.createDiv({ cls: 'palace-rating-buttons' });
      const ratingLabels: [QualityRating, string][] = [
        [1, 'Again'],
        [3, 'Hard'],
        [4, 'Good'],
        [5, 'Easy'],
      ];

      for (const [quality, label] of ratingLabels) {
        const btn = ratings.createEl('button', {
          cls: `palace-rating-btn palace-rating-${quality}`,
          text: label,
        });
        btn.addEventListener('click', () => this.rateCard(quality));
      }
    } else {
      // Show answer button
      const showBtn = cardEl.createEl('button', {
        cls: 'palace-show-answer-btn',
        text: 'Show Answer',
      });
      showBtn.addEventListener('click', () => {
        this.showAnswer = true;
        this.render();
      });
    }
  }

  private async rateCard(quality: QualityRating) {
    if (!this.currentReviewCard || !this.plugin.palaceData) return;

    const updated = processReview(this.currentReviewCard, quality);

    // Update in palace data
    const idx = this.plugin.palaceData.flashcards.findIndex(c => c.id === updated.id);
    if (idx >= 0) {
      this.plugin.palaceData.flashcards[idx] = updated;
    }

    await this.plugin.savePalaceData();

    // Move to next card
    this.currentReviewCard = null;
    this.showAnswer = false;
    this.render();
  }

  /* ---- Stats View ---- */

  private renderStats(container: HTMLElement) {
    const graphStats = this.plugin.knowledgeGraph.getStats();
    const flashcards = this.plugin.palaceData?.flashcards || [];
    const reviewStats = getReviewStats(flashcards);

    const statsGrid = container.createDiv({ cls: 'palace-stats-grid' });

    this.createStatCard(statsGrid, '🧠', 'Concepts', String(graphStats.nodes));
    this.createStatCard(statsGrid, '🔗', 'Connections', String(graphStats.edges));
    this.createStatCard(statsGrid, '📚', 'Flashcards', String(reviewStats.total));
    this.createStatCard(statsGrid, '📋', 'Due Today', String(reviewStats.due));
    this.createStatCard(statsGrid, '✅', 'Learned', String(reviewStats.learned));
    this.createStatCard(statsGrid, '🆕', 'New', String(reviewStats.new));
    this.createStatCard(statsGrid, '📊', 'Avg Ease', String(reviewStats.averageEase));

    if (graphStats.lastUpdated) {
      const lastUpdate = container.createDiv({ cls: 'palace-last-update' });
      lastUpdate.setText(
        `Last updated: ${new Date(graphStats.lastUpdated).toLocaleDateString()}`
      );
    }
  }

  private createStatCard(parent: HTMLElement, icon: string, label: string, value: string) {
    const card = parent.createDiv({ cls: 'palace-stat-card' });
    card.createEl('div', { cls: 'palace-stat-icon', text: icon });
    card.createEl('div', { cls: 'palace-stat-value', text: value });
    card.createEl('div', { cls: 'palace-stat-label', text: label });
  }
}
