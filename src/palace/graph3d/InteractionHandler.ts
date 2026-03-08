/**
 * InteractionHandler - Mouse and keyboard handling for 3D graph
 *
 * Note: OrbitControls handles rotation and zoom directly.
 * This module provides additional click detection and keyboard shortcuts.
 */

import type { Graph3DRenderer } from './Graph3DRenderer';
import type { OnNodeSelectCallback } from './types';

export class InteractionHandler {
  private renderer: Graph3DRenderer;
  private container: HTMLElement;
  private onSelect: OnNodeSelectCallback;
  private hoverTimeout: number | null = null;

  constructor(
    renderer: Graph3DRenderer,
    container: HTMLElement,
    onSelect: OnNodeSelectCallback
  ) {
    this.renderer = renderer;
    this.container = container;
    this.onSelect = onSelect;

    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts(): void {
    this.container.addEventListener('keydown', (e) => {
      // Escape to clear selection
      if (e.key === 'Escape') {
        this.renderer.clearSelection();
      }

      // R to regenerate layout
      if (e.key === 'r' || e.key === 'R') {
        this.renderer.regenerate();
      }
    });
  }

  /**
   * Trigger node selection programmatically
   */
  selectNode(nodeId: string | null): void {
    this.renderer.highlightNode(nodeId);
    this.onSelect(nodeId);
  }

  /**
   * Clean up event listeners
   */
  dispose(): void {
    if (this.hoverTimeout !== null) {
      clearTimeout(this.hoverTimeout);
    }
  }
}
