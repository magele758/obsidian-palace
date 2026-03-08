/**
 * Graph2DRenderer - Canvas-based high-performance force-directed knowledge graph visualization.
 * Designed for 7000+ nodes.
 */

import type { KnowledgeGraph } from '../knowledgeGraph';
import type { KnowledgeNode, KnowledgeEdge } from '../../shared/types';

interface Node2D {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  node: KnowledgeNode;
  connections: number;
}

interface Edge2D {
  sourceId: string;
  targetId: string;
  label: string;
}

export class Graph2DRenderer {
  private static readonly NODE_COLORS: Record<string, string> = {
    concept: '#7c3aed',
    entity: '#10b981',
    topic: '#f59e0b',
    fact: '#8b5cf6',
  };

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private nodes: Map<string, Node2D> = new Map();
  private edges: Edge2D[] = [];
  private graph: KnowledgeGraph | null = null;
  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  private onSelectCallback: ((nodeId: string | null) => void) | null = null;
  
  // Interaction & Transform
  private transform = { x: 0, y: 0, k: 1 };
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragNodeId: string | null = null;
  
  // Animation
  private animationFrameId: number | null = null;
  private simulationAlpha = 1;
  private boundResize: () => void;
  
  // Animation for smooth centering
  private isAnimating = false;
  private targetTransform = { x: 0, y: 0, k: 1 };

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.cursor = 'grab';
    container.appendChild(this.canvas);

    this.boundResize = this.resize.bind(this);
    window.addEventListener('resize', this.boundResize);
    this.resize();
    this.setupEvents();
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    // Don't call ctx.scale here because we use setTransform in draw()
    this.simulationAlpha = 0.3;
    this.startAnimationLoop();
  }

  private initializeGraph(graph: KnowledgeGraph): void {
    const nodes = graph.getNodes();
    const edges = graph.getEdges();
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    this.nodes.clear();
    for (const node of nodes) {
      const connections = graph.getConnectionCount(node.id);
      this.nodes.set(node.id, {
        id: node.id,
        x: cx + (Math.random() - 0.5) * rect.width,
        y: cy + (Math.random() - 0.5) * rect.height,
        vx: 0, vy: 0,
        node,
        connections,
      });
    }

    this.edges = edges.map(e => ({
      sourceId: e.source,
      targetId: e.target,
      label: e.label,
    }));
    
    // Auto-zoom to fit for large graphs
    if (nodes.length > 1000) this.transform.k = 0.2;
  }

  /* ---- Physics Simulation (Grid Optimized) ---- */

  private simulateStep(): void {
    const rect = this.container.getBoundingClientRect();
    const alpha = this.simulationAlpha;
    const nodeArr = Array.from(this.nodes.values());
    const n = nodeArr.length;
    
    // Starry Sky Physics: Huge repulsion, longer edges, lower attraction
    const REPULSION = 8000 * alpha; // Doubled again for 7000+ nodes
    const ATTRACTION = 0.01 * alpha; // Halved again to let them drift apart
    const EDGE_LEN = 250; // Increased significantly for spread
    const gridSize = 200; // Larger grid for larger spread

    // Grid partitioning
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const g = nodeArr[i];
      const key = `${Math.floor(g.x / gridSize)},${Math.floor(g.y / gridSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    for (let i = 0; i < n; i++) {
      const a = nodeArr[i];
      if (this.isDragging && a.id === this.dragNodeId) continue;

      let fx = 0, fy = 0;

      // Grid-based repulsion
      const gx = Math.floor(a.x / gridSize);
      const gy = Math.floor(a.y / gridSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;
          for (const j of cell) {
            if (i === j) continue;
            const b = nodeArr[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 1 || d2 > 10000) continue;
            const d = Math.sqrt(d2);
            const force = REPULSION / d2;
            fx += (dx / d) * force;
            fy += (dy / d) * force;
          }
        }
      }

      // Centering
      fx += (rect.width / 2 - a.x) * 0.01 * alpha;
      fy += (rect.height / 2 - a.y) * 0.01 * alpha;

      a.vx = (a.vx + fx) * 0.8;
      a.vy = (a.vy + fy) * 0.8;
      a.x += a.vx;
      a.y += a.vy;
    }

    // Edge attraction
    for (const e of this.edges) {
      const a = this.nodes.get(e.sourceId);
      const b = this.nodes.get(e.targetId);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - EDGE_LEN) * ATTRACTION;
      const ox = (dx / d) * f, oy = (dy / d) * f;
      if (!(this.isDragging && a.id === this.dragNodeId)) { a.vx += ox; a.vy += oy; }
      if (!(this.isDragging && b.id === this.dragNodeId)) { b.vx -= ox; b.vy -= oy; }
    }
  }

  /* ---- Rendering (Starry Sky Style) ---- */

  private draw(): void {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) return;

    const { x, y, k } = this.transform;
    const dpr = window.devicePixelRatio || 1;

    // Reset transform and clear
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#0d0d1a'; // Match 3D background
    this.ctx.fillRect(0, 0, width / dpr, height / dpr);

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.scale(k, k);

    // Draw Edges (Subtle starry connections)
    this.ctx.beginPath();
    this.ctx.strokeStyle = k > 0.2 ? 'rgba(100, 100, 200, 0.04)' : 'transparent';
    this.ctx.lineWidth = 0.5 / k;
    for (const e of this.edges) {
      const s = this.nodes.get(e.sourceId), t = this.nodes.get(e.targetId);
      if (s && t) {
        this.ctx.moveTo(s.x, s.y);
        this.ctx.lineTo(t.x, t.y);
      }
    }
    this.ctx.stroke();

    // Draw Highlighted Edges (Constellation lines)
    if (this.selectedNodeId) {
      this.ctx.beginPath();
      this.ctx.strokeStyle = 'rgba(0, 255, 213, 0.5)';
      this.ctx.lineWidth = 1.5 / k;
      for (const e of this.edges) {
        if (e.sourceId === this.selectedNodeId || e.targetId === this.selectedNodeId) {
          const s = this.nodes.get(e.sourceId)!, t = this.nodes.get(e.targetId)!;
          this.ctx.moveTo(s.x, s.y);
          this.ctx.lineTo(t.x, t.y);
        }
      }
      this.ctx.stroke();
    }

    // Draw Nodes (Glowing Stars)
    const showLabels = k > 0.35;
    const nodes = Array.from(this.nodes.values());
    
    // Calculate highlighted neighbors for isolation
    const highlightedIds = new Set<string>();
    if (this.selectedNodeId) {
      highlightedIds.add(this.selectedNodeId);
      for (const e of this.edges) {
        if (e.sourceId === this.selectedNodeId) highlightedIds.add(e.targetId);
        if (e.targetId === this.selectedNodeId) highlightedIds.add(e.sourceId);
      }
    }

    // Sort nodes to draw selected/hovered last (on top)
    nodes.sort((a, b) => {
      if (a.id === this.selectedNodeId) return 1;
      if (b.id === this.selectedNodeId) return -1;
      return a.connections - b.connections;
    });

    for (const n of nodes) {
      // Focus Isolation: Skip drawing if a node is selected but this node isn't related
      if (this.selectedNodeId && !highlightedIds.has(n.id)) continue;

      const isSelected = n.id === this.selectedNodeId;
      const isHovered = n.id === this.hoveredNodeId;
      const baseRadius = Math.max(2, Math.min(12, 3 + n.connections * 0.5));
      const radius = (isSelected || isHovered) ? baseRadius * 1.5 : baseRadius;
      const color = Graph2DRenderer.NODE_COLORS[n.node.type] || '#7c3aed';

      // Create radial glow for "Star" look
      const gradient = this.ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius * 2.5);
      gradient.addColorStop(0, 'white');
      gradient.addColorStop(0.2, color);
      gradient.addColorStop(0.4, isSelected ? color + '88' : color + '44');
      gradient.addColorStop(1, 'transparent');

      this.ctx.beginPath();
      this.ctx.arc(n.x, n.y, radius * 2.5, 0, Math.PI * 2);
      this.ctx.fillStyle = gradient;
      this.ctx.fill();

      // Core point
      this.ctx.beginPath();
      this.ctx.arc(n.x, n.y, radius * 0.6, 0, Math.PI * 2);
      this.ctx.fillStyle = isSelected ? '#fff' : 'white';
      this.ctx.fill();

      // LOD Labels
      if (showLabels || isSelected || isHovered) {
        this.ctx.fillStyle = isSelected ? '#fff' : 'rgba(255, 255, 255, 0.7)';
        this.ctx.font = `${isSelected ? 16 : 10}px Inter, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(n.node.label, n.x, n.y - radius * 2.5 - 5);
      }
    }

    this.ctx.restore();
  }

  /* ---- Progressive Centering Animation ---- */
  private startAnimationLoop(): void {
    if (this.animationFrameId === null) {
      const tick = () => {
        let changed = false;

        // 1. Physics
        if (this.simulationAlpha > 0.01) {
          this.simulateStep();
          this.simulationAlpha *= 0.97;
          changed = true;
        }

        // 2. Camera Animation (Lerp)
        if (this.isAnimating) {
          const lerp = 0.1;
          this.transform.x += (this.targetTransform.x - this.transform.x) * lerp;
          this.transform.y += (this.targetTransform.y - this.transform.y) * lerp;
          this.transform.k += (this.targetTransform.k - this.transform.k) * lerp;
          
          if (Math.abs(this.transform.x - this.targetTransform.x) < 0.1 &&
              Math.abs(this.transform.k - this.targetTransform.k) < 0.001) {
            this.isAnimating = false;
          }
          changed = true;
        }

        if (changed) {
          this.draw();
          this.animationFrameId = requestAnimationFrame(tick);
        } else {
          this.animationFrameId = null;
        }
      };
      this.animationFrameId = requestAnimationFrame(tick);
    }
  }

  private screenToWorld(sx: number, sy: number) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.transform.x) / this.transform.k,
      y: (sy - rect.top - this.transform.y) / this.transform.k
    };
  }

  private setupEvents(): void {
    this.canvas.addEventListener('mousedown', e => {
      const { x, y } = this.screenToWorld(e.clientX, e.clientY);
      this.dragNodeId = this.findNodeAt(x, y);
      this.isDragging = true;
      this.isAnimating = false; // Interrupt camera animation

      if (this.dragNodeId) {
        this.simulationAlpha = 0.5;
        this.startAnimationLoop();
      } else {
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', e => {
      const { x, y } = this.screenToWorld(e.clientX, e.clientY);
      
      if (!this.isDragging) {
        this.hoveredNodeId = this.findNodeAt(x, y);
        this.draw();
        return;
      }

      if (this.dragNodeId) {
        const node = this.nodes.get(this.dragNodeId)!;
        node.x = x; node.y = y;
        node.vx = node.vy = 0;
        this.simulationAlpha = 0.2;
        this.startAnimationLoop();
      } else {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        this.transform.x += dx;
        this.transform.y += dy;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.draw();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.dragNodeId = null;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('click', e => {
      const { x, y } = this.screenToWorld(e.clientX, e.clientY);
      const nodeId = this.findNodeAt(x, y);
      
      this.selectedNodeId = nodeId;
      if (this.onSelectCallback) this.onSelectCallback(nodeId);
      
      if (nodeId) {
        this.flyToNode(nodeId);
      } else {
        this.draw();
      }
    });

    // Mac Trackpad Optimized Wheel (Zoom + Pan)
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.isAnimating = false;

      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.ctrlKey) {
        const factor = Math.pow(0.99, e.deltaY);
        const newK = Math.max(0.05, Math.min(8, this.transform.k * factor));
        this.transform.x = mouseX - (mouseX - this.transform.x) * (newK / this.transform.k);
        this.transform.y = mouseY - (mouseY - this.transform.y) * (newK / this.transform.k);
        this.transform.k = newK;
      } else {
        this.transform.x -= e.deltaX;
        this.transform.y -= e.deltaY;
      }
      
      this.draw();
    }, { passive: false });
  }

  private flyToNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const rect = this.container.getBoundingClientRect();
    const targetK = Math.max(this.transform.k, 1.2); 
    
    this.targetTransform = {
      x: rect.width / 2 - node.x * targetK,
      y: rect.height / 2 - node.y * targetK,
      k: targetK
    };
    
    this.isAnimating = true;
    this.startAnimationLoop();
  }

  private findNodeAt(x: number, y: number): string | null {
    const nodeArr = Array.from(this.nodes.values()).reverse();
    for (const n of nodeArr) {
      const hitRadius = (15 / this.transform.k) + 5;
      const dx = n.x - x, dy = n.y - y;
      if (dx * dx + dy * dy < hitRadius * hitRadius) return n.id;
    }
    return null;
  }

  /* ---- Public API ---- */

  render(graph?: KnowledgeGraph): void {
    if (graph) {
      this.graph = graph;
      this.initializeGraph(graph);
      this.simulationAlpha = 1;
      this.startAnimationLoop();
    } else {
      this.draw();
    }
  }

  highlightNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    if (nodeId) {
      this.flyToNode(nodeId);
    } else {
      this.draw();
    }
  }

  regenerate(): void {
    if (this.graph) {
      this.initializeGraph(this.graph);
      this.simulationAlpha = 1;
      this.startAnimationLoop();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.boundResize);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.canvas.remove();
  }
}
