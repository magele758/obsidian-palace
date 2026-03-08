/**
 * Type definitions for 3D knowledge graph visualization
 */

import * as THREE from 'three';
import type { KnowledgeNode, KnowledgeEdge } from '../../shared/types';

export interface Node3D {
  id: string;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  label: THREE.Sprite | null;
  node: KnowledgeNode;
  originalScale: number;
}

export interface Edge3D {
  id: string;
  line: THREE.Line;
  sourceId: string;
  targetId: string;
  weight: number;
}

export interface SelectionState {
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
}

export interface Graph3DConfig {
  sphereRadius: number;
  nodeRadius: number;
  maxLabelLength: number;
  labelSize: number;
  animationSpeed: number;
}

export const DEFAULT_CONFIG: Graph3DConfig = {
  sphereRadius: 200,
  nodeRadius: 3,
  maxLabelLength: 20,
  labelSize: 12,
  animationSpeed: 0.003,
};

// Node type colors (hex values for Three.js)
export const NODE_TYPE_COLORS: Record<string, number> = {
  concept: 0x7c3aed,  // purple
  entity: 0x10b981,   // green
  topic: 0xf59e0b,    // orange
  fact: 0x8b5cf6,     // purple
};

export interface OnNodeSelectCallback {
  (nodeId: string | null): void;
}
