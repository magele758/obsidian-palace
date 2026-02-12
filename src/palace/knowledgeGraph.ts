/**
 * Knowledge Graph - storage and query layer for the Memory Palace.
 *
 * Data is stored as JSON in the plugin data directory.
 */

import type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraphData,
} from '../shared/types';

export class KnowledgeGraph {
  private data: KnowledgeGraphData;

  constructor(data?: KnowledgeGraphData) {
    this.data = data || { nodes: [], edges: [], lastUpdated: Date.now() };
  }

  /* ---- Nodes ---- */

  addNode(node: KnowledgeNode): void {
    const existing = this.data.nodes.findIndex(n => n.id === node.id);
    if (existing >= 0) {
      this.data.nodes[existing] = node;
    } else {
      this.data.nodes.push(node);
    }
    this.data.lastUpdated = Date.now();
  }

  removeNode(id: string): void {
    this.data.nodes = this.data.nodes.filter(n => n.id !== id);
    this.data.edges = this.data.edges.filter(e => e.source !== id && e.target !== id);
    this.data.lastUpdated = Date.now();
  }

  getNode(id: string): KnowledgeNode | undefined {
    return this.data.nodes.find(n => n.id === id);
  }

  getNodes(): KnowledgeNode[] {
    return this.data.nodes;
  }

  findNodes(query: string): KnowledgeNode[] {
    const lower = query.toLowerCase();
    return this.data.nodes.filter(
      n =>
        n.label.toLowerCase().includes(lower) ||
        n.description.toLowerCase().includes(lower)
    );
  }

  /* ---- Edges ---- */

  addEdge(edge: KnowledgeEdge): void {
    const existing = this.data.edges.findIndex(e => e.id === edge.id);
    if (existing >= 0) {
      this.data.edges[existing] = edge;
    } else {
      this.data.edges.push(edge);
    }
    this.data.lastUpdated = Date.now();
  }

  removeEdge(id: string): void {
    this.data.edges = this.data.edges.filter(e => e.id !== id);
    this.data.lastUpdated = Date.now();
  }

  getEdges(): KnowledgeEdge[] {
    return this.data.edges;
  }

  getConnections(nodeId: string): Array<{ edge: KnowledgeEdge; node: KnowledgeNode }> {
    const results: Array<{ edge: KnowledgeEdge; node: KnowledgeNode }> = [];

    for (const edge of this.data.edges) {
      if (edge.source === nodeId) {
        const node = this.getNode(edge.target);
        if (node) results.push({ edge, node });
      } else if (edge.target === nodeId) {
        const node = this.getNode(edge.source);
        if (node) results.push({ edge, node });
      }
    }

    return results;
  }

  /* ---- Queries ---- */

  /**
   * Get nodes by source file
   */
  getNodesByFile(filePath: string): KnowledgeNode[] {
    return this.data.nodes.filter(n => n.sourceFile === filePath);
  }

  /**
   * Get the N most connected nodes
   */
  getMostConnected(limit = 10): Array<{ node: KnowledgeNode; connections: number }> {
    const counts = new Map<string, number>();
    for (const edge of this.data.edges) {
      counts.set(edge.source, (counts.get(edge.source) || 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) || 0) + 1);
    }

    return this.data.nodes
      .map(node => ({ node, connections: counts.get(node.id) || 0 }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, limit);
  }

  /* ---- Merge ---- */

  /**
   * Merge extracted nodes and edges into the graph, avoiding duplicates
   */
  merge(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): void {
    for (const node of nodes) {
      this.addNode(node);
    }
    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  /* ---- Serialization ---- */

  getData(): KnowledgeGraphData {
    return this.data;
  }

  getStats(): { nodes: number; edges: number; lastUpdated: number } {
    return {
      nodes: this.data.nodes.length,
      edges: this.data.edges.length,
      lastUpdated: this.data.lastUpdated,
    };
  }
}
