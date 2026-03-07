/**
 * Palace View - Memory Palace knowledge graph visualization and flashcard review UI.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type ObsidianPalacePlugin from '../main';
import { KnowledgeGraph } from './knowledgeGraph';
import { getDueCards, getReviewStats, processReview } from './reviewScheduler';
import type { QualityRating } from './reviewScheduler';
import type { Flashcard } from '../shared/types';

export const PALACE_VIEW_TYPE = 'palace-view';

type ViewMode = 'graph' | 'review' | 'stats';
type GraphViewMode = '2d' | '3d';

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export class PalaceView extends ItemView {
  plugin: ObsidianPalacePlugin;
  private mode: ViewMode = 'graph';
  private graphViewMode: GraphViewMode = '2d';
  private container: HTMLElement;
  private currentReviewCard: Flashcard | null = null;
  private showAnswer = false;
  private selectedNodeId: string | null = null;
  private graphAnimationFrame: number | null = null;
  private graphCleanupFns: Array<() => void> = [];

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
    this.graphViewMode = this.plugin.palaceData?.ui?.graphViewMode ?? '2d';
    this.render();
  }

  async onClose() {
    this.cleanupGraphAnimation();
  }

  /* ---- Render ---- */

  private render() {
    this.cleanupGraphAnimation();
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

    const toolbar = container.createDiv({ cls: 'palace-graph-toolbar' });
    toolbar.createSpan({ cls: 'palace-graph-toolbar-label', text: 'Graph View' });

    const toggle = toolbar.createDiv({ cls: 'palace-graph-view-toggle' });
    this.createGraphModeButton(toggle, '2d', '2D');
    this.createGraphModeButton(toggle, '3d', '3D');

    const graphContainer = container.createDiv({ cls: `palace-graph-container palace-graph-${this.graphViewMode}` });
    if (this.graphViewMode === '2d') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.classList.add('palace-graph-svg');
      graphContainer.appendChild(svg);
      this.renderForceGraph(svg, graph);
    } else {
      const canvas = document.createElement('canvas');
      canvas.classList.add('palace-graph-canvas');
      graphContainer.appendChild(canvas);
      this.render3DGraph(canvas, graph);
    }

    const selectedNode = this.selectedNodeId ? graph.getNode(this.selectedNodeId) : null;
    if (selectedNode) {
      const details = container.createDiv({ cls: 'palace-selected-node' });
      details.createEl('h4', { text: selectedNode.label });
      details.createEl('p', { text: selectedNode.description || 'No description.' });
      const linkCount = graph.getConnections(selectedNode.id).length;
      details.createEl('div', { cls: 'palace-selected-node-meta', text: `${linkCount} connection(s)` });
    }

    // Node list below
    const nodeList = container.createDiv({ cls: 'palace-node-list' });
    nodeList.createEl('h3', { text: `Concepts (${stats.nodes})` });

    const mostConnected = graph.getMostConnected(20);
    for (const { node, connections } of mostConnected) {
      const item = nodeList.createDiv({
        cls: `palace-node-item ${this.selectedNodeId === node.id ? 'palace-node-item-active' : ''}`,
      });
      const badge = item.createSpan({ cls: `palace-node-badge palace-type-${node.type}` });
      badge.setText(node.type[0].toUpperCase());
      item.createSpan({ cls: 'palace-node-label', text: node.label });
      item.createSpan({ cls: 'palace-node-count', text: `${connections} links` });
      item.addEventListener('click', () => {
        this.selectedNodeId = this.selectedNodeId === node.id ? null : node.id;
        this.render();
      });
    }
  }

  private createGraphModeButton(parent: HTMLElement, mode: GraphViewMode, label: string) {
    const btn = parent.createEl('button', {
      cls: `palace-graph-mode-btn ${this.graphViewMode === mode ? 'palace-graph-mode-btn-active' : ''}`,
      text: label,
    });

    btn.addEventListener('click', () => {
      void this.setGraphViewMode(mode);
    });
  }

  private async setGraphViewMode(mode: GraphViewMode) {
    if (this.graphViewMode === mode) return;

    this.graphViewMode = mode;
    if (this.plugin.palaceData) {
      this.plugin.palaceData.ui = {
        ...(this.plugin.palaceData.ui || {}),
        graphViewMode: mode,
      };
      await this.plugin.savePalaceData();
    }
    this.render();
  }

  private cleanupGraphAnimation() {
    if (this.graphAnimationFrame !== null) {
      cancelAnimationFrame(this.graphAnimationFrame);
      this.graphAnimationFrame = null;
    }

    for (const cleanup of this.graphCleanupFns) {
      cleanup();
    }
    this.graphCleanupFns = [];
  }

  private getConnectedNodeIds(graph: KnowledgeGraph, nodeId: string): Set<string> {
    const connected = new Set<string>();
    for (const edge of graph.getEdges()) {
      if (edge.source === nodeId) connected.add(edge.target);
      if (edge.target === nodeId) connected.add(edge.source);
    }
    return connected;
  }

  /**
   * Simple force-directed graph layout using SVG
   */
  private renderForceGraph(svg: SVGSVGElement, graph: KnowledgeGraph) {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    if (nodes.length === 0) return;

    const width = 800;
    const height = 420;
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
    for (let iter = 0; iter < 60; iter++) {
      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions.get(nodes[i].id);
          const b = positions.get(nodes[j].id);
          if (!a || !b) continue;

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
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 100) * 0.012;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }

      // Center gravity
      for (const pos of positions.values()) {
        pos.x += (width / 2 - pos.x) * 0.01;
        pos.y += (height / 2 - pos.y) * 0.01;
        pos.x = Math.max(30, Math.min(width - 30, pos.x));
        pos.y = Math.max(30, Math.min(height - 30, pos.y));
      }
    }

    const selected = this.selectedNodeId;
    const connectedToSelected = selected ? this.getConnectedNodeIds(graph, selected) : new Set<string>();

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

      const weight = Math.max(0, Math.min(1, edge.weight || 0.3));
      const related = !selected || edge.source === selected || edge.target === selected;
      line.style.opacity = String((related ? 0.3 : 0.08) + weight * (related ? 0.6 : 0.2));
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
      const pos = positions.get(node.id);
      if (!pos) continue;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('palace-graph-node');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(pos.x));
      circle.setAttribute('cy', String(pos.y));

      const isSelected = node.id === selected;
      const isConnected = selected ? connectedToSelected.has(node.id) : false;
      const radius = isSelected ? 12 : isConnected ? 10 : 8;
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', typeColors[node.type] || typeColors.concept);
      circle.style.opacity = !selected || isSelected || isConnected ? '1' : '0.35';
      g.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(pos.x));
      text.setAttribute('y', String(pos.y - 14));
      text.setAttribute('text-anchor', 'middle');
      text.classList.add('palace-graph-label');
      text.style.opacity = !selected || isSelected || isConnected ? '1' : '0.35';
      text.textContent = node.label.length > 16 ? `${node.label.slice(0, 16)}...` : node.label;
      g.appendChild(text);

      g.addEventListener('click', () => {
        this.selectedNodeId = this.selectedNodeId === node.id ? null : node.id;
        this.render();
      });

      svg.appendChild(g);
    }
  }

  private render3DGraph(canvas: HTMLCanvasElement, graph: KnowledgeGraph) {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();
    if (nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pointState = new Map<string, Vec3>();
    const velocity = new Map<string, Vec3>();
    const projected = new Map<string, { x: number; y: number; z: number; r: number }>();

    const radius = 140;
    for (let i = 0; i < nodes.length; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / nodes.length);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      pointState.set(nodes[i].id, {
        x: radius * Math.cos(theta) * Math.sin(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(phi),
      });
      velocity.set(nodes[i].id, { x: 0, y: 0, z: 0 });
    }

    let angleY = 0;
    let angleX = 0.25;
    let width = 0;
    let height = 0;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(300, Math.floor(rect.width || 800));
      height = Math.max(220, Math.floor(rect.height || 420));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      for (const edge of edges) {
        const a = pointState.get(edge.source);
        const b = pointState.get(edge.target);
        const va = velocity.get(edge.source);
        const vb = velocity.get(edge.target);
        if (!a || !b || !va || !vb) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
        const force = (dist - 90) * 0.002;
        va.x += (dx / dist) * force;
        va.y += (dy / dist) * force;
        va.z += (dz / dist) * force;
        vb.x -= (dx / dist) * force;
        vb.y -= (dy / dist) * force;
        vb.z -= (dz / dist) * force;
      }

      const k = 500;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pointState.get(nodes[i].id);
          const b = pointState.get(nodes[j].id);
          const va = velocity.get(nodes[i].id);
          const vb = velocity.get(nodes[j].id);
          if (!a || !b || !va || !vb) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
          const force = k / (dist * dist * dist);
          va.x -= dx * force;
          va.y -= dy * force;
          va.z -= dz * force;
          vb.x += dx * force;
          vb.y += dy * force;
          vb.z += dz * force;
        }
      }

      for (const node of nodes) {
        const p = pointState.get(node.id);
        const v = velocity.get(node.id);
        if (!p || !v) continue;

        v.x *= 0.92;
        v.y *= 0.92;
        v.z *= 0.92;

        p.x += v.x;
        p.y += v.y;
        p.z += v.z;
      }

      angleY += 0.003;

      const sinY = Math.sin(angleY);
      const cosY = Math.cos(angleY);
      const sinX = Math.sin(angleX);
      const cosX = Math.cos(angleX);

      const selected = this.selectedNodeId;
      const connectedToSelected = selected ? this.getConnectedNodeIds(graph, selected) : new Set<string>();

      for (const node of nodes) {
        const p = pointState.get(node.id);
        if (!p) continue;

        const xzX = p.x * cosY - p.z * sinY;
        const xzZ = p.x * sinY + p.z * cosY;

        const yzY = p.y * cosX - xzZ * sinX;
        const yzZ = p.y * sinX + xzZ * cosX;

        const depth = 350;
        const scale = depth / (depth + yzZ + 200);
        const sx = width / 2 + xzX * scale;
        const sy = height / 2 + yzY * scale;
        const isSelected = node.id === selected;
        const isConnected = selected ? connectedToSelected.has(node.id) : false;
        const baseRadius = isSelected ? 8 : isConnected ? 6 : 5;

        projected.set(node.id, { x: sx, y: sy, z: yzZ, r: baseRadius * scale + 2 });
      }

      for (const edge of edges) {
        const a = projected.get(edge.source);
        const b = projected.get(edge.target);
        if (!a || !b) continue;

        const selected = this.selectedNodeId;
        const isRelated = !selected || edge.source === selected || edge.target === selected;
        const alpha = isRelated ? 0.35 : 0.08;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(130, 140, 160, ${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      const sorted = [...nodes].sort((a, b) => {
        const pa = projected.get(a.id);
        const pb = projected.get(b.id);
        if (!pa || !pb) return 0;
        return pa.z - pb.z;
      });

      const connectedToCurrentSelection = this.selectedNodeId
        ? this.getConnectedNodeIds(graph, this.selectedNodeId)
        : new Set<string>();

      for (const node of sorted) {
        const p = projected.get(node.id);
        if (!p) continue;

        const selected = this.selectedNodeId;
        const isSelected = selected === node.id;
        const isConnected = selected ? connectedToCurrentSelection.has(node.id) : false;
        const alpha = !selected || isSelected || isConnected ? 0.95 : 0.3;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = this.getNodeColor(node.type, alpha);
        ctx.fill();

        if (isSelected || p.r > 4.5) {
          ctx.fillStyle = !selected || isSelected || isConnected
            ? 'rgba(220, 230, 245, 0.92)'
            : 'rgba(220, 230, 245, 0.28)';
          ctx.font = '11px var(--font-interface, sans-serif)';
          ctx.textAlign = 'center';
          ctx.fillText(node.label.length > 16 ? `${node.label.slice(0, 16)}...` : node.label, p.x, p.y - p.r - 6);
        }
      }

      this.graphAnimationFrame = requestAnimationFrame(animate);
    };

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      let hit: { id: string; dist: number } | null = null;
      for (const node of nodes) {
        const p = projected.get(node.id);
        if (!p) continue;

        const dx = p.x - x;
        const dy = p.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= p.r + 4 && (!hit || dist < hit.dist)) {
          hit = { id: node.id, dist };
        }
      }

      if (hit) {
        this.selectedNodeId = this.selectedNodeId === hit.id ? null : hit.id;
        this.render();
      }
    };

    resize();
    animate();

    window.addEventListener('resize', resize);
    canvas.addEventListener('click', onClick);

    this.graphCleanupFns.push(() => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', onClick);
    });
  }

  private getNodeColor(type: string, alpha: number): string {
    switch (type) {
      case 'entity':
        return `rgba(88, 196, 124, ${alpha})`;
      case 'topic':
        return `rgba(238, 166, 80, ${alpha})`;
      case 'fact':
        return `rgba(168, 116, 255, ${alpha})`;
      default:
        return `rgba(113, 156, 255, ${alpha})`;
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
