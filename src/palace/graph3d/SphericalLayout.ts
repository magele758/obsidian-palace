/**
 * Spherical Layout - Fibonacci lattice for even distribution on sphere surface
 */

import * as THREE from 'three';
import type { KnowledgeEdge } from '../../shared/types';

/**
 * Calculate positions using Fibonacci lattice for even distribution on a sphere
 * This method provides approximately uniform spacing without clustering at poles
 */
export function calculateSphericalPositions(
  count: number,
  radius: number
): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    // Fibonacci lattice algorithm
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - 2 * (i + 0.5) / count);

    positions.push(new THREE.Vector3(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    ));
  }

  return positions;
}

/**
 * Refine layout using force-directed simulation
 * Pulls connected nodes closer together while maintaining sphere shape
 */
export function refineLayout(
  positions: Map<string, THREE.Vector3>,
  edges: KnowledgeEdge[],
  iterations: number,
  sphereRadius: number
): void {
  const nodeIds = Array.from(positions.keys());

  for (let iter = 0; iter < iterations; iter++) {
    // Apply attraction along edges
    for (const edge of edges) {
      const sourcePos = positions.get(edge.source);
      const targetPos = positions.get(edge.target);

      if (!sourcePos || !targetPos) continue;

      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      const dz = targetPos.z - sourcePos.z;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);

      // Pull connected nodes slightly closer
      const attraction = 0.02 * edge.weight;
      sourcePos.x += (dx / dist) * attraction;
      sourcePos.y += (dy / dist) * attraction;
      sourcePos.z += (dz / dist) * attraction;
      targetPos.x -= (dx / dist) * attraction;
      targetPos.y -= (dy / dist) * attraction;
      targetPos.z -= (dz / dist) * attraction;
    }

    // Project all nodes back onto sphere surface
    for (const id of nodeIds) {
      const pos = positions.get(id)!;
      const dist = pos.length();
      if (dist > 0) {
        pos.normalize().multiplyScalar(sphereRadius);
      }
    }
  }
}

/**
 * Assign positions to nodes with optional refinement for connected nodes
 */
export function assignNodePositions(
  nodeIds: string[],
  edges: KnowledgeEdge[],
  radius: number,
  refine: boolean = true
): Map<string, THREE.Vector3> {
  const basePositions = calculateSphericalPositions(nodeIds.length, radius);
  const positions = new Map<string, THREE.Vector3>();

  nodeIds.forEach((id, i) => {
    positions.set(id, basePositions[i].clone());
  });

  if (refine && edges.length > 0) {
    refineLayout(positions, edges, 30, radius);
  }

  return positions;
}
