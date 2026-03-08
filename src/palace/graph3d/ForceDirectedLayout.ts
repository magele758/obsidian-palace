/**
 * Force-Directed Layout - 3D force simulation for natural graph distribution
 *
 * Uses physical simulation:
 * - Repulsion: All nodes repel each other (like charged particles)
 * - Attraction: Connected nodes attract (like springs)
 * - Centering: Gentle force pulling toward center
 * - Cooling: Simulation gradually settles
 */

import * as THREE from 'three';
import type { KnowledgeEdge } from '../../shared/types';

interface NodePhysics {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mass: number; // Based on connections, affects movement
  connections: number;
}

interface ForceConfig {
  repulsionStrength: number;   // How strongly nodes push apart
  attractionStrength: number;  // How strongly connected nodes pull together
  idealEdgeLength: number;     // Target distance for connected nodes
  centeringStrength: number;   // Pull toward center
  damping: number;             // Velocity reduction per iteration
  iterations: number;          // Number of simulation steps
  coolingFactor: number;       // Temperature decrease rate
}

const DEFAULT_CONFIG: ForceConfig = {
  repulsionStrength: 20000,
  attractionStrength: 0.003,
  idealEdgeLength: 8000,
  centeringStrength: 0.0005,
  damping: 0.88,
  iterations: 300,
  coolingFactor: 0.98,
};

/**
 * Initialize node positions randomly within a sphere
 */
function initializePositions(
  nodeIds: string[],
  edges: KnowledgeEdge[],
  radius: number
): Map<string, NodePhysics> {
  const connectionCounts = new Map<string, number>();

  // Count connections for each node
  for (const id of nodeIds) {
    connectionCounts.set(id, 0);
  }
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
  }

  const physics = new Map<string, NodePhysics>();

  // Initialize with random positions, using connection count to influence initial clustering
  for (const id of nodeIds) {
    const connections = connectionCounts.get(id) || 0;

    // Random position within sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.pow(Math.random(), 0.5); // Cube root for uniform distribution

    physics.set(id, {
      id,
      position: new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      ),
      velocity: new THREE.Vector3(0, 0, 0),
      mass: 1 + connections * 0.1, // More connections = heavier = moves less
      connections,
    });
  }

  return physics;
}

/**
 * Run force-directed simulation with spatial grid optimization
 */
function runSimulation(
  physics: Map<string, NodePhysics>,
  edges: KnowledgeEdge[],
  config: ForceConfig
): void {
  const nodes = Array.from(physics.values());
  const nodeCount = nodes.length;
  const edgeMap = new Map<string, Set<string>>();

  // Build adjacency
  for (const edge of edges) {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, new Set());
    if (!edgeMap.has(edge.target)) edgeMap.set(edge.target, new Set());
    edgeMap.get(edge.source)!.add(edge.target);
    edgeMap.get(edge.target)!.add(edge.source);
  }

  let temperature = 1.0;
  
  // High-performance optimization for massive graphs
  const iterations = nodeCount > 5000 ? 60 : nodeCount > 2000 ? 100 : config.iterations;
  const gridSize = 60; // Size of each grid cell

  // Pre-allocate vectors to reuse
  const delta = new THREE.Vector3();
  const force = new THREE.Vector3();

  for (let iter = 0; iter < iterations; iter++) {
    temperature *= config.coolingFactor;

    // 1. Spatial Grid Partitioning (O(N))
    const grid = new Map<string, number[]>();
    for (let i = 0; i < nodeCount; i++) {
      const p = nodes[i].position;
      const gx = Math.floor(p.x / gridSize);
      const gy = Math.floor(p.y / gridSize);
      const gz = Math.floor(p.z / gridSize);
      const key = `${gx},${gy},${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    // 2. Calculate Forces
    for (let i = 0; i < nodeCount; i++) {
      const nodeA = nodes[i];
      force.set(0, 0, 0);
      const posA = nodeA.position;

      // Grid-based repulsion (Check neighbors)
      const gx = Math.floor(posA.x / gridSize);
      const gy = Math.floor(posA.y / gridSize);
      const gz = Math.floor(posA.z / gridSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cellNodes = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!cellNodes) continue;

            for (const j of cellNodes) {
              if (i === j) continue;
              const nodeB = nodes[j];
              delta.copy(posA).sub(nodeB.position);
              const distSq = Math.max(delta.lengthSq(), 100);
              if (distSq > gridSize * gridSize) continue; // Skip far nodes

              const repulsionMag = config.repulsionStrength / distSq;
              force.add(delta.normalize().multiplyScalar(repulsionMag));
            }
          }
        }
      }

      // Attraction (spring)
      const connectedToA = edgeMap.get(nodeA.id);
      if (connectedToA) {
        for (const connectedId of connectedToA) {
          const nodeB = physics.get(connectedId);
          if (!nodeB) continue;
          delta.copy(nodeB.position).sub(posA);
          const dist = delta.length();
          const displacement = dist - config.idealEdgeLength;
          force.add(delta.normalize().multiplyScalar(displacement * config.attractionStrength));
        }
      }

      // Centering
      delta.copy(posA).negate().multiplyScalar(config.centeringStrength);
      force.add(delta);

      // Apply
      force.divideScalar(nodeA.mass);
      nodeA.velocity.add(force.multiplyScalar(temperature));
      nodeA.velocity.multiplyScalar(config.damping);
    }

    for (let i = 0; i < nodeCount; i++) nodes[i].position.add(nodes[i].velocity);
  }
}

/**
 * Normalize the layout to fit within a reasonable space
 */
function normalizeLayout(
  physics: Map<string, NodePhysics>,
  targetRadius: number
): void {
  // Find bounding box
  let maxDist = 0;
  const center = new THREE.Vector3(0, 0, 0);

  for (const node of physics.values()) {
    const dist = node.position.length();
    maxDist = Math.max(maxDist, dist);
    center.add(node.position);
  }

  // Scale to fit target radius
  if (maxDist > 0) {
    const scale = targetRadius / maxDist;
    for (const node of physics.values()) {
      node.position.multiplyScalar(scale);
    }
  }
}

/**
 * Main function: Compute force-directed layout for graph
 */
export function computeForceDirectedLayout(
  nodeIds: string[],
  edges: KnowledgeEdge[],
  radius: number,
  config: Partial<ForceConfig> = {}
): Map<string, THREE.Vector3> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Initialize with random positions
  const physics = initializePositions(nodeIds, edges, radius);

  // Run force simulation
  runSimulation(physics, edges, finalConfig);

  // Normalize to fit target space
  normalizeLayout(physics, radius);

  // Extract final positions
  const positions = new Map<string, THREE.Vector3>();
  for (const [id, node] of physics) {
    positions.set(id, node.position.clone());
  }

  return positions;
}

/**
 * Legacy compatibility: Re-export with same signature as old spherical layout
 */
export function assignNodePositions(
  nodeIds: string[],
  edges: KnowledgeEdge[],
  radius: number,
  _refine: boolean = true // Kept for API compatibility
): Map<string, THREE.Vector3> {
  return computeForceDirectedLayout(nodeIds, edges, radius);
}
