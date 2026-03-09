/**
 * Knowledge Graph - storage and query layer for the Memory Palace.
 *
 * Data is stored as JSON in the plugin data directory.
 * Supports text search and embedding-based semantic search (LAION/aella-style).
 */

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

import type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraphData,
} from '../shared/types';

export class KnowledgeGraph {
  private data: KnowledgeGraphData;
  // Indexes for O(1) access
  private nodeMap: Map<string, KnowledgeNode> = new Map();
  private edgeMap: Map<string, KnowledgeEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();

  constructor(data?: KnowledgeGraphData) {
    this.data = data || { nodes: [], edges: [], lastUpdated: Date.now() };
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.adjacencyList.clear();

    for (const node of this.data.nodes) {
      this.nodeMap.set(node.id, node);
    }

    for (const edge of this.data.edges) {
      this.edgeMap.set(edge.id, edge);
      this.addAdjacency(edge);
    }
  }

  private addAdjacency(edge: KnowledgeEdge): void {
    if (!this.adjacencyList.has(edge.source)) this.adjacencyList.set(edge.source, new Set());
    if (!this.adjacencyList.has(edge.target)) this.adjacencyList.set(edge.target, new Set());
    
    this.adjacencyList.get(edge.source)!.add(edge.id);
    this.adjacencyList.get(edge.target)!.add(edge.id);
  }

  private removeAdjacency(edge: KnowledgeEdge): void {
    this.adjacencyList.get(edge.source)?.delete(edge.id);
    this.adjacencyList.get(edge.target)?.delete(edge.id);
  }

  /* ---- Nodes ---- */

  addNode(node: KnowledgeNode): void {
    if (this.nodeMap.has(node.id)) {
      const idx = this.data.nodes.findIndex(n => n.id === node.id);
      if (idx >= 0) this.data.nodes[idx] = node;
    } else {
      this.data.nodes.push(node);
    }
    this.nodeMap.set(node.id, node);
    this.data.lastUpdated = Date.now();
  }

  removeNode(id: string): void {
    if (!this.nodeMap.has(id)) return;
    
    this.data.nodes = this.data.nodes.filter(n => n.id !== id);
    this.nodeMap.delete(id);

    // Remove connected edges
    const edgesToRemove = this.data.edges.filter(e => e.source === id || e.target === id);
    for (const e of edgesToRemove) {
      this.removeEdge(e.id);
    }

    this.data.lastUpdated = Date.now();
  }

  getNode(id: string): KnowledgeNode | undefined {
    return this.nodeMap.get(id);
  }

  getConnectionCount(nodeId: string): number {
    return this.adjacencyList.get(nodeId)?.size || 0;
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

  /**
   * Semantic search (LAION/aella-style): find nodes by embedding similarity.
   * Returns nodes with embedding, sorted by cosine similarity (desc).
   * Nodes without embedding are excluded.
   */
  findNodesSemantic(queryVector: number[], limit = 30): Array<{ node: KnowledgeNode; score: number }> {
    const withEmbed = this.data.nodes.filter(n => n.embedding && n.embedding.length === queryVector.length);
    if (withEmbed.length === 0) return [];

    const scores = withEmbed.map(node => {
      const score = cosineSimilarity(queryVector, node.embedding!);
      return { node, score };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }

  /* ---- Edges ---- */

  addEdge(edge: KnowledgeEdge): void {
    if (this.edgeMap.has(edge.id)) {
      const idx = this.data.edges.findIndex(e => e.id === edge.id);
      if (idx >= 0) this.data.edges[idx] = edge;
      // We might need to update adjacency if source/target changed, but usually IDs imply same endpoints
    } else {
      this.data.edges.push(edge);
      this.addAdjacency(edge);
    }
    this.edgeMap.set(edge.id, edge);
    this.data.lastUpdated = Date.now();
  }

  removeEdge(id: string): void {
    const edge = this.edgeMap.get(id);
    if (!edge) return;

    this.data.edges = this.data.edges.filter(e => e.id !== id);
    this.edgeMap.delete(id);
    this.removeAdjacency(edge);
    this.data.lastUpdated = Date.now();
  }

  getEdges(): KnowledgeEdge[] {
    return this.data.edges;
  }

  getConnections(nodeId: string): Array<{ edge: KnowledgeEdge; node: KnowledgeNode }> {
    const results: Array<{ edge: KnowledgeEdge; node: KnowledgeNode }> = [];
    const edgeIds = this.adjacencyList.get(nodeId);
    
    if (!edgeIds) return results;

    for (const edgeId of edgeIds) {
      const edge = this.edgeMap.get(edgeId);
      if (!edge) continue;

      const connectedNodeId = edge.source === nodeId ? edge.target : edge.source;
      const node = this.nodeMap.get(connectedNodeId);
      if (node) {
        results.push({ edge, node });
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
    return this.data.nodes
      .map(node => ({ node, connections: this.adjacencyList.get(node.id)?.size || 0 }))
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

  /* ---- Subgraph ---- */
  
  /**
   * Get a subgraph centered around a specific node with a given degree of connections
   */
  getSubgraph(centerNodeId: string, maxDegree: number = 1): KnowledgeGraph {
    const subNodes = new Map<string, KnowledgeNode>();
    const subEdges = new Map<string, KnowledgeEdge>();
    
    const centerNode = this.nodeMap.get(centerNodeId);
    if (!centerNode) return new KnowledgeGraph();
    
    subNodes.set(centerNodeId, centerNode);
    
    let currentLevel = new Set<string>([centerNodeId]);
    
    for (let i = 0; i < maxDegree; i++) {
      const nextLevel = new Set<string>();
      
      for (const nodeId of currentLevel) {
        const connections = this.getConnections(nodeId);
        for (const conn of connections) {
          subNodes.set(conn.node.id, conn.node);
          subEdges.set(conn.edge.id, conn.edge);
          if (!subNodes.has(conn.node.id)) {
            nextLevel.add(conn.node.id);
          }
        }
      }
      currentLevel = nextLevel;
    }
    
    return new KnowledgeGraph({
      nodes: Array.from(subNodes.values()),
      edges: Array.from(subEdges.values()),
      lastUpdated: Date.now()
    });
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
