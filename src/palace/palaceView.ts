/**
 * Palace View - Memory Palace knowledge graph visualization and flashcard review UI.
 */

import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import type ObsidianPalacePlugin from '../main';
import { KnowledgeGraph } from './knowledgeGraph';
import { getDueCards, getReviewStats, processReview } from './reviewScheduler';
import type { QualityRating } from './reviewScheduler';
import type { KnowledgeNode, Flashcard } from '../shared/types';
import { Graph2DRenderer } from './graph2d';
import { Graph3DRenderer } from './graph3d';

// Node type colors - defined locally to avoid minification issues
const NODE_COLORS: Record<string, string> = {
  concept: '#7c3aed',
  entity: '#10b981',
  topic: '#f59e0b',
  fact: '#8b5cf6',
};

export const PALACE_VIEW_TYPE = 'palace-view';

type ViewMode = 'graph' | 'review' | 'stats';
type GraphType = '2d' | '3d';

export class PalaceView extends ItemView {
  plugin: ObsidianPalacePlugin;
  private mode: ViewMode = 'graph';
  private graphType: GraphType = '2d';
  private container: HTMLElement;
  private currentReviewCard: Flashcard | null = null;
  private showAnswer = false;
  private graphRenderer: Graph2DRenderer | Graph3DRenderer | null = null;
  private selectedNode: KnowledgeNode | null = null;
  private isLocalView = false;

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

  async onClose() {
    // Clean up 2D renderer
    if (this.graphRenderer) {
      this.graphRenderer.dispose();
      this.graphRenderer = null;
    }
  }

  /* ---- Render ---- */

  private render() {
    // Dispose of graph renderer before clearing container
    if (this.graphRenderer) {
      this.graphRenderer.dispose();
      this.graphRenderer = null;
    }
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

    // Graph mode needs full-height canvas without padding/scroll interference
    if (this.mode === 'graph') {
      content.style.padding = '0';
      content.style.overflow = 'hidden';
    }

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

    // Show processing indicator if extraction is in progress
    if (this.plugin.isProcessing) {
      this.renderProcessingState(container);
      return;
    }

    if (stats.nodes === 0) {
      this.renderEmptyState(container);
      return;
    }

    // 1. Create persistent layout skeleton
    container.empty();
    container.style.position = 'relative';
    container.style.height = '100%';
    container.style.width = '100%';
    
    const layout = container.createDiv({ cls: 'palace-graph-layout' });

    // 2. Main Graph Panel
    const mainPanel = layout.createDiv({ cls: 'palace-main-panel' });
    const controlsContainer = mainPanel.createDiv({ cls: 'palace-graph-controls' });
    
    // Controls: Regenerate, Local/Global, 2D/3D
    this.createControlButtons(controlsContainer, layout);

    // 3. Right Sidebar (Nodes + Details)
    const rightPanel = layout.createDiv({ cls: 'palace-right-panel' });
    const nodeListSection = rightPanel.createDiv({ cls: 'palace-node-list-section' });
    const detailsSection = rightPanel.createDiv({ cls: 'palace-details-section-container' });

    // 4. Initialize Renderer
    if (this.graphRenderer) this.graphRenderer.dispose();
    
    if (this.graphType === '3d') {
      this.graphRenderer = new Graph3DRenderer(mainPanel);
    } else {
      this.graphRenderer = new Graph2DRenderer(mainPanel);
    }

    // Set up selection callback - ensuring it updates the static sections
    this.graphRenderer.onSelect((nodeId) => {
      this.handleNodeSelection(nodeId, layout);
    });

    // 5. Initial Data Loading
    this.refreshGraphDisplay();
    this.renderNodeListPanel(nodeListSection, graph, stats);
    this.renderDetailsPanel(detailsSection);

    // Legend
    const legend = mainPanel.createDiv({ cls: 'palace-legend' });
    this.renderLegend(legend);
  }

  private createControlButtons(parent: HTMLElement, layout: HTMLElement) {
    const regen = parent.createEl('button', { cls: 'palace-action-btn-small', text: '🔄' });
    regen.title = 'Regenerate Layout';
    regen.addEventListener('click', () => this.regenerateGraph());

    const viewMode = parent.createEl('button', { 
      cls: `palace-action-btn-small ${this.isLocalView ? 'active' : ''}`, 
      text: this.isLocalView ? '🔍 Local' : '🌐 Global' 
    });
    viewMode.addEventListener('click', () => {
      this.isLocalView = !this.isLocalView;
      viewMode.setText(this.isLocalView ? '🔍 Local' : '🌐 Global');
      viewMode.classList.toggle('active', this.isLocalView);
      this.refreshGraphDisplay();
    });

    const typeToggle = parent.createEl('button', { 
      cls: 'palace-action-btn-small', 
      text: this.graphType === '2d' ? '🧊 3D' : '🖼️ 2D' 
    });
    typeToggle.addEventListener('click', () => {
      this.graphType = this.graphType === '2d' ? '3d' : '2d';
      this.render(); // Re-render the whole structure
    });
  }

  private renderProcessingState(container: HTMLElement) {
    container.empty();
    const processing = container.createDiv({ cls: 'palace-processing' });
    processing.createEl('div', { cls: 'palace-processing-icon', text: '⏳' });
    processing.createEl('div', { cls: 'palace-processing-title', text: 'Processing documents...' });
    const stopBtn = processing.createEl('button', { cls: 'palace-stop-btn', text: '⏹ Stop Extraction' });
    stopBtn.addEventListener('click', () => {
      // @ts-expect-error
      this.plugin.app.commands.executeCommandById('obsidian-ai-translate:stop-knowledge-extraction');
    });
  }

  private renderEmptyState(container: HTMLElement) {
    container.empty();
    const empty = container.createDiv({ cls: 'palace-empty' });
    empty.createEl('div', { cls: 'palace-empty-icon', text: '🏛️' });
    empty.createEl('div', { cls: 'palace-empty-title', text: 'Your Memory Palace is empty' });
    const actions = empty.createDiv({ cls: 'palace-empty-actions' });
    const batchBtn = actions.createEl('button', { cls: 'palace-action-btn', text: '📚 Process All Documents' });
    batchBtn.addEventListener('click', () => {
      // @ts-expect-error
      this.plugin.app.commands.executeCommandById('obsidian-ai-translate:extract-knowledge-batch');
    });
  }

  private handleNodeSelection(nodeId: string | null, layout: HTMLElement) {
    const graph = this.plugin.knowledgeGraph;
    const stats = graph.getStats();

    if (nodeId) {
      this.selectedNode = graph.getNode(nodeId) || null;
      this.updateDetailsPanel(layout);
      
      // Auto-switch to local view if graph is large
      if (stats.nodes > 500 && !this.isLocalView) {
        this.isLocalView = true;
        const viewToggleBtn = layout.querySelector('.palace-action-btn-small[title*="Toggle"]') as HTMLButtonElement;
        if (viewToggleBtn) {
          viewToggleBtn.setText('🔍 Local View');
          viewToggleBtn.classList.add('active');
        }
        this.refreshGraphDisplay();
      } else if (this.isLocalView) {
        this.refreshGraphDisplay();
      }
    } else {
      this.selectedNode = null;
      this.updateDetailsPanel(layout);
      if (this.isLocalView) {
        this.refreshGraphDisplay();
      }
    }
  }

  private refreshGraphDisplay() {
    if (!this.graphRenderer || !this.plugin.knowledgeGraph) return;

    if (this.isLocalView && this.selectedNode) {
      // Show only subgraph
      const subgraph = this.plugin.knowledgeGraph.getSubgraph(this.selectedNode.id, 1);
      this.graphRenderer.render(subgraph);
    } else {
      // Show full graph
      this.graphRenderer.render(this.plugin.knowledgeGraph);
    }
    
    if (this.selectedNode) {
      this.graphRenderer.highlightNode(this.selectedNode.id);
    }
  }

  private renderNodeListPanel(panel: HTMLElement, graph: KnowledgeGraph, stats: { nodes: number; edges: number }) {
    panel.empty();
    const header = panel.createDiv({ cls: 'palace-node-list-header' });
    header.createEl('h3', { text: `Nodes (${stats.nodes})` });

    // Search bar
    const searchContainer = panel.createDiv({ cls: 'palace-node-search' });
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search nodes...',
      cls: 'palace-search-input',
    });
    searchInput.style.width = '100%';
    searchInput.style.marginBottom = '12px';
    searchInput.style.padding = '6px 10px';
    searchInput.style.borderRadius = '4px';
    searchInput.style.border = '1px solid var(--background-modifier-border)';
    searchInput.style.background = 'var(--background-primary)';

    const listContainer = panel.createDiv({ cls: 'palace-node-list-container' });
    listContainer.style.maxHeight = '400px';
    listContainer.style.overflowY = 'auto';

    const renderItems = (query: string = '') => {
      listContainer.empty();
      const lowerQuery = query.toLowerCase();
      
      // If query is empty, show most connected. Otherwise filter.
      const nodesToShow = query 
        ? graph.getNodes().filter(n => n.label.toLowerCase().includes(lowerQuery)).slice(0, 50)
        : graph.getMostConnected(30).map(item => ({ node: item.node, connections: item.connections }));

      for (const itemData of nodesToShow) {
        const { node } = itemData;
        const connections = 'connections' in itemData 
          ? itemData.connections 
          : graph.getConnectionCount(node.id);

        const item = listContainer.createDiv({ cls: 'palace-node-item' });
        // ... same item styling as before but simplified for readability ...
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.padding = '6px 8px';
        item.style.marginBottom = '2px';
        item.style.borderRadius = '4px';
        item.style.cursor = 'pointer';
        item.style.fontSize = '13px';

        const color = NODE_COLORS[node.type] || NODE_COLORS.concept;
        const badge = item.createSpan({ cls: 'palace-node-badge' });
        badge.style.width = '8px';
        badge.style.height = '8px';
        badge.style.borderRadius = '50%';
        badge.style.background = color;
        badge.style.marginRight = '8px';
        badge.style.flexShrink = '0';

        item.createSpan({ cls: 'palace-node-label', text: node.label });
        const count = item.createSpan({ cls: 'palace-node-count', text: `${connections}` });
        count.style.marginLeft = 'auto';
        count.style.color = 'var(--text-muted)';
        count.style.fontSize = '11px';

        item.addEventListener('click', () => {
          if (this.graphRenderer) {
            this.graphRenderer.highlightNode(node.id);
            const layout = panel.closest('.palace-graph-layout') as HTMLElement;
            if (layout) this.handleNodeSelection(node.id, layout);
          }
        });

        item.addEventListener('mouseenter', () => item.style.background = 'var(--background-modifier-hover)');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      }

      if (nodesToShow.length === 0) {
        listContainer.createDiv({ text: 'No nodes found', cls: 'palace-no-results' });
      }
    };

    searchInput.addEventListener('input', (e) => {
      renderItems((e.target as HTMLInputElement).value);
    });

    renderItems();
  }

  private renderLegend(legend: HTMLElement) {
    legend.createEl('div', { cls: 'palace-legend-title', text: 'Legend' });

    const items = [
      { type: 'concept', label: 'Concept' },
      { type: 'entity', label: 'Entity' },
      { type: 'topic', label: 'Topic' },
      { type: 'fact', label: 'Fact' },
    ];

    for (const item of items) {
      const row = legend.createDiv({ cls: 'palace-legend-item' });
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.marginBottom = '4px';

      const dot = row.createDiv({ cls: 'palace-legend-dot' });
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.marginRight = '6px';
      dot.style.backgroundColor = NODE_COLORS[item.type] || NODE_COLORS.concept;
      row.createSpan({ text: item.label });
    }
  }

  private renderDetailsPanel(panel: HTMLElement) {
    panel.empty();

    if (this.selectedNode) {
      this.renderNodeDetails(panel, this.selectedNode);
    } else {
      panel.createDiv({
        cls: 'palace-details-empty',
        text: 'Select a node to view details',
      });
    }
  }

  private renderNodeDetails(panel: HTMLElement, node: KnowledgeNode) {
    panel.empty();

    // 1. Header with Type and Source Action
    const header = panel.createDiv({ cls: 'palace-details-header' });
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '12px';

    const color = NODE_COLORS[node.type] || NODE_COLORS.concept;
    const badge = header.createSpan({ cls: 'palace-node-badge' });
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '4px';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = 'bold';
    badge.style.textTransform = 'uppercase';
    badge.style.background = color + '22';
    badge.style.color = color;
    badge.style.border = `1px solid ${color}44`;
    badge.setText(node.type);

    if (node.sourceFile) {
      const openBtn = header.createEl('button', {
        cls: 'palace-action-btn-mini',
        title: `Open ${node.sourceFile}`,
      });
      setIcon(openBtn, 'file-text');
      openBtn.style.padding = '4px';
      openBtn.addEventListener('click', () => {
        // @ts-expect-error - internal API
        this.plugin.app.workspace.openLinkText(node.sourceFile, '', true);
      });
    }

    // 2. Node Title (Large & Clear)
    const labelEl = panel.createEl('h2', { cls: 'palace-details-label', text: node.label });
    labelEl.style.margin = '0 0 12px 0';
    labelEl.style.fontSize = '18px';
    labelEl.style.color = 'var(--text-accent)';

    // 3. Description Section
    if (node.description) {
      const descSection = panel.createDiv({ cls: 'palace-details-section' });
      descSection.style.marginBottom = '16px';
      descSection.createEl('div', {
        cls: 'palace-details-section-title',
        text: 'Description',
      });
      const descText = descSection.createEl('div', { 
        cls: 'palace-details-text', 
        text: node.description 
      });
      descText.style.fontSize = '13px';
      descText.style.lineHeight = '1.5';
      descText.style.color = 'var(--text-normal)';
      descText.style.background = 'var(--background-secondary-alt)';
      descText.style.padding = '8px';
      descText.style.borderRadius = '4px';
    }

    // 4. Source File Link (Explicit)
    if (node.sourceFile) {
      const sourceSection = panel.createDiv({ cls: 'palace-details-section' });
      sourceSection.style.marginBottom = '16px';
      sourceSection.createEl('div', { cls: 'palace-details-section-title', text: 'Source Document' });
      const sourceLink = sourceSection.createEl('div', {
        cls: 'palace-source-link-container',
      });
      sourceLink.style.display = 'flex';
      sourceLink.style.alignItems = 'center';
      sourceLink.style.gap = '6px';
      sourceLink.style.cursor = 'pointer';
      sourceLink.style.color = 'var(--text-muted)';
      sourceLink.style.fontSize = '12px';
      
      const icon = sourceLink.createSpan();
      setIcon(icon, 'link');
      sourceLink.createSpan({ text: node.sourceFile });
      
      sourceLink.addEventListener('click', () => {
        // @ts-expect-error - internal API
        this.plugin.app.workspace.openLinkText(node.sourceFile, '', true);
      });
    }

    // 5. Connections (The Connected Star-map)
    const connections = this.plugin.knowledgeGraph.getConnections(node.id);
    if (connections.length > 0) {
      const connSection = panel.createDiv({ cls: 'palace-details-section' });
      connSection.createEl('div', {
        cls: 'palace-details-section-title',
        text: `Connected Nodes (${connections.length})`,
      });

      const connList = connSection.createDiv({ cls: 'palace-connection-list' });
      connList.style.display = 'flex';
      connList.style.flexDirection = 'column';
      connList.style.gap = '4px';

      for (const { edge, node: connectedNode } of connections.slice(0, 20)) {
        const connItem = connList.createDiv({ cls: 'palace-connection-item' });
        connItem.style.display = 'flex';
        connItem.style.alignItems = 'center';
        connItem.style.padding = '6px 8px';
        connItem.style.borderRadius = '4px';
        connItem.style.background = 'var(--background-primary)';
        connItem.style.border = '1px solid var(--background-modifier-border)';
        connItem.style.cursor = 'pointer';
        connItem.style.transition = 'all 0.2s ease';

        const dot = connItem.createSpan();
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.borderRadius = '50%';
        dot.style.background = NODE_COLORS[connectedNode.type] || NODE_COLORS.concept;
        dot.style.marginRight = '10px';

        const label = connItem.createSpan({ text: connectedNode.label });
        label.style.fontSize = '13px';
        label.style.flexGrow = '1';

        const edgeLabel = connItem.createSpan({ text: edge.label });
        edgeLabel.style.fontSize = '10px';
        edgeLabel.style.color = 'var(--text-muted)';
        edgeLabel.style.background = 'var(--background-secondary)';
        edgeLabel.style.padding = '2px 6px';
        edgeLabel.style.borderRadius = '10px';

        connItem.addEventListener('mouseenter', () => connItem.style.borderColor = 'var(--text-accent)');
        connItem.addEventListener('mouseleave', () => connItem.style.borderColor = 'var(--background-modifier-border)');
        
        connItem.addEventListener('click', () => {
          if (this.graphRenderer) {
            this.graphRenderer.highlightNode(connectedNode.id);
            this.selectedNode = connectedNode;
            this.renderDetailsPanel(panel);
          }
        });
      }

      if (connections.length > 20) {
        const more = connSection.createDiv({ 
          text: `+ ${connections.length - 20} more connections`,
          cls: 'palace-details-more'
        });
        more.style.textAlign = 'center';
        more.style.fontSize = '11px';
        more.style.marginTop = '8px';
        more.style.color = 'var(--text-muted)';
      }
    }
  }

  private updateDetailsPanel(layout: HTMLElement) {
    const detailsSection = layout.querySelector('.palace-details-section-container') as HTMLElement;
    if (detailsSection) {
      this.renderDetailsPanel(detailsSection);
    }
  }

  private regenerateGraph() {
    if (this.graphRenderer) {
      this.graphRenderer.regenerate();
      new Notice('Graph layout regenerated');
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
        text: 'Extract knowledge from documents to generate flashcards.',
      });

      // Add quick action button
      const actions = empty.createDiv({ cls: 'palace-empty-actions' });
      actions.style.marginTop = '20px';

      const batchBtn = actions.createEl('button', {
        cls: 'palace-action-btn',
        text: '📚 Process All Documents',
      });
      batchBtn.style.width = '100%';
      batchBtn.style.padding = '10px';
      batchBtn.addEventListener('click', () => {
        // @ts-expect-error - accessing internal command
        this.plugin.app.commands.executeCommandById('obsidian-ai-translate:extract-knowledge-batch');
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
