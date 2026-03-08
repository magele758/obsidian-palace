/**
 * Graph3DRenderer - Three.js based 3D knowledge graph visualization
 *
 * Mac Trackpad Controls:
 * - Single finger drag: Rotate camera (via OrbitControls touches)
 * - Two finger pinch: Zoom
 * - Two finger drag: Pan
 * - Click on node: Select and highlight connections
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { KnowledgeGraph } from '../knowledgeGraph';
import type { KnowledgeNode, KnowledgeEdge } from '../../shared/types';
import {
  Node3D,
  Edge3D,
  SelectionState,
  Graph3DConfig,
  DEFAULT_CONFIG,
  NODE_TYPE_COLORS,
  OnNodeSelectCallback,
} from './types';
import { assignNodePositions } from './ForceDirectedLayout';

export class Graph3DRenderer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private nodes: Map<string, Node3D> = new Map();
  private edges: Map<string, Edge3D> = new Map();
  private graph: KnowledgeGraph | null = null;
  private config: Graph3DConfig;

  // Optimized rendering: InstancedMesh or Points
  private nodeInstances: THREE.InstancedMesh | null = null;
  private nodePoints: THREE.Points | null = null;
  private nodeCoreInstances: THREE.InstancedMesh | null = null;
  private nodeGlowInstances: THREE.InstancedMesh | null = null;
  private nodePositions: Map<string, THREE.Vector3> = new Map();
  private nodeColors: Map<string, number> = new Map();
  private nodeScales: Map<string, number> = new Map();

  private selectionState: SelectionState = {
    selectedNodeId: null,
    highlightedNodeIds: new Set(),
    highlightedEdgeIds: new Set(),
  };

  private onSelectCallback: OnNodeSelectCallback | null = null;
  private animationId: number | null = null;
  private isDisposed = false;
  private simulationAlpha = 0;

  // 3D effects
  private particleSystem: THREE.Points | null = null;
  private sphereGlow: THREE.Mesh | null = null;
  private time: number = 0;

  // Store node sizes and glow meshes
  private nodeGlows: Map<string, THREE.Mesh[]> = new Map();
  private nodeSizes: Map<string, number> = new Map();

  constructor(container: HTMLElement, config?: Partial<Graph3DConfig>) {
    this.container = container;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize Three.js scene with gradient-like background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0d1a);
    this.scene.fog = new THREE.FogExp2(0x0d0d1a, 0.001);

    // Camera setup
    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
    this.camera.position.set(0, 0, this.config.sphereRadius * 2.5);

    // Renderer setup with better quality
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // OrbitControls setup - optimized for Mac trackpad
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 1.0;
    this.controls.panSpeed = 1.0;
    this.controls.zoomSpeed = 1.5;
    
    // Adjust clipping and distances for 7000+ nodes
    this.camera.near = 1;
    this.camera.far = 20000;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = 2;
    this.controls.maxDistance = 15000;
    this.controls.zoomSpeed = 2.0; // Faster zooming
    this.controls.dampingFactor = 0.1; // More responsive damping

    // Enable all interaction modes for trackpad
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableRotate = true;

    // Left-click to rotate, middle to zoom, right to pan
    // On Mac trackpad: single finger drag = rotate, two finger pinch = zoom
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Touch controls for trackpad
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // Raycaster for node selection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Enhanced lighting
    this.setupLighting();

    // Add particle background
    this.createParticleBackground();

    // Add subtle sphere glow
    this.createSphereGlow();

    // Event listeners
    this.setupEventListeners();
    this.startAnimation();
  }

  private setupLighting(): void {
    // Ambient light for base illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    // Colored point lights for depth
    const pointLight1 = new THREE.PointLight(0x7c3aed, 0.5, this.config.sphereRadius * 3);
    pointLight1.position.set(this.config.sphereRadius, this.config.sphereRadius, 0);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x10b981, 0.5, this.config.sphereRadius * 3);
    pointLight2.position.set(-this.config.sphereRadius, -this.config.sphereRadius, 0);
    this.scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0xf59e0b, 0.3, this.config.sphereRadius * 3);
    pointLight3.position.set(0, 0, this.config.sphereRadius);
    this.scene.add(pointLight3);
  }

  private createParticleBackground(): void {
    const particleCount = 500;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // Distribute particles in a large sphere around the scene
      const radius = this.config.sphereRadius * 3 + Math.random() * this.config.sphereRadius * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      // Subtle color variation
      const colorIntensity = 0.3 + Math.random() * 0.3;
      colors[i * 3] = colorIntensity;
      colors[i * 3 + 1] = colorIntensity;
      colors[i * 3 + 2] = colorIntensity + Math.random() * 0.2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.scene.add(this.particleSystem);
  }

  private createSphereGlow(): void {
    // Create a subtle ambient glow at center
    const geometry = new THREE.SphereGeometry(this.config.sphereRadius * 0.3, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x1a1a3e,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });

    this.sphereGlow = new THREE.Mesh(geometry, material);
    this.scene.add(this.sphereGlow);
  }

  private setupEventListeners(): void {
    // Click to select
    this.renderer.domElement.addEventListener('click', this.handleClick.bind(this));

    // Resize handler
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Support both Mesh and Points for raycasting
    const targets: THREE.Object3D[] = [];
    if (this.nodePoints) targets.push(this.nodePoints);
    if (this.nodeInstances) targets.push(this.nodeInstances);
    
    // Fallback for individual meshes
    this.nodes.forEach(n => { if (n.mesh && n.mesh.type === 'Mesh') targets.push(n.mesh); });

    this.raycaster.params.Points!.threshold = 12.0; // Even larger threshold for 7000+ nodes
    const intersects = this.raycaster.intersectObjects(targets);

    if (intersects.length > 0) {
      let nodeId: string | null = null;
      const hit = intersects[0];
      const nodeIds = Array.from(this.nodes.keys());
      
      if (hit.object === this.nodePoints) {
        // Precise index matching for Points geometry
        nodeId = nodeIds[hit.index!];
      } else if (hit.object === this.nodeInstances) {
        nodeId = nodeIds[hit.instanceId!];
      } else {
        nodeId = hit.object.userData.nodeId;
      }
      
      if (nodeId) {
        this.selectNode(nodeId);
      }
    } else {
      this.clearSelection();
    }
  }

  private handleResize(): void {
    if (this.isDisposed || !this.container.parentElement) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private startAnimation(): void {
    const animate = () => {
      if (this.isDisposed) return;
      this.animationId = requestAnimationFrame(animate);

      this.time += 0.016;

      // Progressive Physics Simulation (The '2D Method' in 3D)
      if (this.simulationAlpha > 0.01 && this.graph) {
        this.simulateStep();
        this.updateStarPositions();
        this.simulationAlpha *= 0.98; // Cool down
      }

      // Slowly rotate particle system
      if (this.nodePoints) {
        this.nodePoints.rotation.y += 0.0001;
      }
      if (this.particleSystem) {
        this.particleSystem.rotation.y += 0.0001;
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private simulateStep(): void {
    if (!this.graph) return;
    
    const nodes = Array.from(this.nodes.values());
    const n = nodes.length;
    const alpha = this.simulationAlpha;
    const gridSize = 100;
    
    const REPULSION = 10000 * alpha;
    const ATTRACTION = 0.01 * alpha;
    const EDGE_LEN = 120;
    const damping = 0.8;

    // 1. Quick Grid Partitioning
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const p = nodes[i].position;
      const key = `${Math.floor(p.x/gridSize)},${Math.floor(p.y/gridSize)},${Math.floor(p.z/gridSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    const delta = new THREE.Vector3();
    const force = new THREE.Vector3();

    // 2. Repulsion (Grid-optimized)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      force.set(0, 0, 0);
      
      const gx = Math.floor(a.position.x / gridSize);
      const gy = Math.floor(a.position.y / gridSize);
      const gz = Math.floor(a.position.z / gridSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
            if (!cell) continue;
            for (const j of cell) {
              if (i === j) continue;
              const b = nodes[j];
              delta.copy(a.position).sub(b.position);
              const d2 = Math.max(delta.lengthSq(), 50);
              if (d2 > gridSize * gridSize) continue;
              force.add(delta.normalize().multiplyScalar(REPULSION / d2));
            }
          }
        }
      }

      // Centering
      force.add(a.position.clone().negate().multiplyScalar(0.001 * alpha));

      // Apply
      a.position.add(force.multiplyScalar(damping));
    }

    // 3. Edge Attraction (limited per frame for 7000+ nodes)
    const edges = this.graph.getEdges();
    const edgeStep = n > 5000 ? 2 : 1; // Process fewer edges if massive
    for (let i = 0; i < edges.length; i += edgeStep) {
      const e = edges[i];
      const s = this.nodes.get(e.source);
      const t = this.nodes.get(e.target);
      if (!s || !t) continue;
      
      delta.copy(t.position).sub(s.position);
      const d = delta.length() || 1;
      const f = (d - EDGE_LEN) * ATTRACTION;
      const move = delta.normalize().multiplyScalar(f);
      s.position.add(move);
      t.position.sub(move);
    }
  }

  private updateStarPositions(): void {
    if (this.nodePoints) {
      const positions = this.nodePoints.geometry.attributes.position.array as Float32Array;
      const nodes = Array.from(this.nodes.values());
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i].position;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      }
      this.nodePoints.geometry.attributes.position.needsUpdate = true;
    }
    
    // Update labels and other meshes
    for (const node3D of this.nodes.values()) {
      if (node3D.mesh && node3D.mesh.type === 'Mesh') {
        node3D.mesh.position.copy(node3D.position);
      }
      if (node3D.label) {
        node3D.label.position.copy(node3D.position);
        node3D.label.position.y += 10;
      }
    }
    
    // Update edge lines
    for (const edge3D of this.edges.values()) {
      const s = this.nodes.get(edge3D.sourceId);
      const t = this.nodes.get(edge3D.targetId);
      if (s && t) {
        const positions = edge3D.line.geometry.attributes.position.array as Float32Array;
        positions[0] = s.position.x; positions[1] = s.position.y; positions[2] = s.position.z;
        positions[3] = t.position.x; positions[4] = t.position.y; positions[5] = t.position.z;
        edge3D.line.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  /**
   * Set callback for node selection
   */
  onSelect(callback: OnNodeSelectCallback): void {
    this.onSelectCallback = callback;
  }

  /**
   * Render the knowledge graph with optimization for large node counts
   */
  render(graph: KnowledgeGraph): void {
    this.graph = graph;
    this.clearScene();

    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    if (nodes.length === 0) return;

    // Calculate connection counts for node sizing
    const connectionCounts = new Map<string, number>();
    for (const node of nodes) {
      connectionCounts.set(node.id, 0);
    }
    for (const edge of edges) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
    }

    // Store node sizes based on connections
    const maxConnections = Math.max(...connectionCounts.values(), 1);
    for (const [nodeId, count] of connectionCounts) {
      const logScale = Math.log(count + 1) / Math.log(maxConnections + 1);
      const normalizedSize = 0.5 + logScale * 2.5; 
      this.nodeSizes.set(nodeId, normalizedSize);
    }

    // Initialize random positions within a sphere instead of pre-calculating
    const positions = new Map<string, THREE.Vector3>();
    const radius = this.config.sphereRadius;
    for (const node of nodes) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * 0.5 * Math.pow(Math.random(), 0.3);
      positions.set(node.id, new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      ));
    }

    // Rendering optimization threshold
    const useStarrySky = nodes.length > 2500;
    const useInstancedRendering = nodes.length > 100 && !useStarrySky;
    const useStraightEdges = nodes.length > 250;

    if (useStarrySky) {
      this.renderStarryNodes(nodes, positions, connectionCounts);
    } else if (useInstancedRendering) {
      this.renderInstancedNodes(nodes, positions, connectionCounts);
    } else {
      // Traditional individual mesh rendering
      for (const node of nodes) {
        const position = positions.get(node.id);
        if (!position) continue;
        const connections = connectionCounts.get(node.id) || 0;
        const node3D = this.createNode(node, position, connections);
        this.nodes.set(node.id, node3D);
      }
    }

    // Create edge lines with threshold-based curves (Dynamic geometry)
    for (const edge of edges) {
      const edge3D = this.createDynamicEdge(edge, useStraightEdges);
      if (edge3D) {
        this.edges.set(edge.id, edge3D);
      }
    }

    // Start progressive simulation
    this.simulationAlpha = 1.0;
  }

  private createDynamicEdge(edge: KnowledgeEdge, straight: boolean): Edge3D | null {
    const s = this.nodes.get(edge.source);
    const t = this.nodes.get(edge.target);
    if (!s || !t) return null;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(2 * 3);
    positions[0] = s.position.x; positions[1] = s.position.y; positions[2] = s.position.z;
    positions[3] = t.position.x; positions[4] = t.position.y; positions[5] = t.position.z;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x4a4a6a,
      transparent: true,
      opacity: 0.04, // Very subtle for starry sky
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    return {
      id: edge.id,
      line,
      sourceId: edge.source,
      targetId: edge.target,
      weight: edge.weight,
    };
  }

  private renderStarryNodes(
    nodes: KnowledgeNode[], 
    positions: Map<string, THREE.Vector3>,
    connectionCounts: Map<string, number>
  ): void {
    const nodeCount = nodes.length;
    const geometry = new THREE.BufferGeometry();
    const posArray = new Float32Array(nodeCount * 3);
    const colorArray = new Float32Array(nodeCount * 3);

    const tempColor = new THREE.Color();
    nodes.forEach((node, i) => {
      const pos = positions.get(node.id)!;
      posArray[i * 3] = pos.x;
      posArray[i * 3 + 1] = pos.y;
      posArray[i * 3 + 2] = pos.z;

      const scale = this.nodeSizes.get(node.id) || 1;
      const typeColor = NODE_TYPE_COLORS[node.type] || NODE_TYPE_COLORS.concept;
      tempColor.setHex(typeColor);
      colorArray[i * 3] = tempColor.r;
      colorArray[i * 3 + 1] = tempColor.g;
      colorArray[i * 3 + 2] = tempColor.b;
      
      this.nodePositions.set(node.id, pos);
      this.nodeColors.set(node.id, typeColor);
      this.nodeScales.set(node.id, scale);

      this.nodes.set(node.id, {
        id: node.id,
        position: pos,
        mesh: null as any,
        label: null,
        node,
        originalScale: scale,
      });
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    
    // CRITICAL: Compute bounding volumes for raycasting to work!
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    
    const material = new THREE.PointsMaterial({
      size: 5,
      map: this.createStarTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.nodePoints = new THREE.Points(geometry, material);
    this.scene.add(this.nodePoints);
  }

  private createStarTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private renderInstancedNodes(
    nodes: KnowledgeNode[], 
    positions: Map<string, THREE.Vector3>,
    connectionCounts: Map<string, number>
  ): void {
    const nodeCount = nodes.length;
    
    // 1. Core instances (bright centers)
    const coreGeometry = new THREE.SphereGeometry(this.config.nodeRadius * 0.4, 8, 8);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.nodeCoreInstances = new THREE.InstancedMesh(coreGeometry, coreMaterial, nodeCount);
    
    // 2. Main instances (colored orbs)
    const mainGeometry = new THREE.SphereGeometry(this.config.nodeRadius, 12, 12);
    const mainMaterial = new THREE.MeshPhongMaterial({
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.8,
      shininess: 30,
    });
    this.nodeInstances = new THREE.InstancedMesh(mainGeometry, mainMaterial, nodeCount);

    // 3. Glow instances (subtle halos)
    const glowGeometry = new THREE.SphereGeometry(this.config.nodeRadius * 2.2, 12, 12);
    const glowMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    this.nodeGlowInstances = new THREE.InstancedMesh(glowGeometry, glowMaterial, nodeCount);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    nodes.forEach((node, i) => {
      const position = positions.get(node.id);
      if (!position) return;

      const scale = this.nodeSizes.get(node.id) || 1;
      const typeColor = NODE_TYPE_COLORS[node.type] || NODE_TYPE_COLORS.concept;
      
      this.nodePositions.set(node.id, position);
      this.nodeColors.set(node.id, typeColor);
      this.nodeScales.set(node.id, scale);

      dummy.position.copy(position);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      // Set matrices
      this.nodeInstances!.setMatrixAt(i, dummy.matrix);
      this.nodeCoreInstances!.setMatrixAt(i, dummy.matrix);
      this.nodeGlowInstances!.setMatrixAt(i, dummy.matrix);

      // Set colors
      color.setHex(typeColor);
      this.nodeInstances!.setColorAt(i, color);
      this.nodeGlowInstances!.setColorAt(i, color);

      // Create a minimal Node3D representation for metadata (without individual meshes)
      this.nodes.set(node.id, {
        id: node.id,
        position,
        mesh: this.nodeInstances as any, // Point to instanced mesh for raycasting
        label: null, // No labels by default in instanced mode for speed
        node,
        originalScale: scale,
      });

      // Special case: show labels for important nodes only (> 5 connections)
      if (connectionCounts.get(node.id)! > 5 || nodeCount < 300) {
        const label = this.createLabel(node.label, position, this.config.nodeRadius * scale);
        if (label) {
          this.scene.add(label);
          this.nodes.get(node.id)!.label = label;
        }
      }
    });

    this.scene.add(this.nodeInstances);
    this.scene.add(this.nodeCoreInstances);
    this.scene.add(this.nodeGlowInstances);
  }

  private createNode(node: KnowledgeNode, position: THREE.Vector3, connections: number): Node3D {
    const color = NODE_TYPE_COLORS[node.type] || NODE_TYPE_COLORS.concept;
    
    // Calculate node radius based on connections - more dramatic size variation
    const sizeMultiplier = this.nodeSizes.get(node.id) || 1;
    // Base size scales from 0.4 (isolated) to 2.5 (highly connected)
    const nodeRadius = this.config.nodeRadius * sizeMultiplier;

    // Create glowing orb effect with fewer layers for performance
    const glowMeshes: THREE.Mesh[] = [];

    // 1. Inner core - bright center
    const coreGeometry = new THREE.SphereGeometry(nodeRadius * 0.4, 12, 12);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.position.copy(position);
    this.scene.add(coreMesh);
    glowMeshes.push(coreMesh);

    // 2. Main sphere - semi-transparent with emissive effect
    // Using MeshPhongMaterial instead of MeshPhysicalMaterial for performance
    const mainGeometry = new THREE.SphereGeometry(nodeRadius, 16, 16);
    const mainMaterial = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
      shininess: 30,
    });

    const mesh = new THREE.Mesh(mainGeometry, mainMaterial);
    mesh.position.copy(position);
    mesh.userData.nodeId = node.id;
    mesh.userData.originalPosition = position.clone();
    this.scene.add(mesh);

    // 3. Single outer glow layer instead of multiple
    const glowGeometry = new THREE.SphereGeometry(nodeRadius * 2.2, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.position.copy(position);
    this.scene.add(glowMesh);
    glowMeshes.push(glowMesh);

    // Store glow meshes for cleanup and animation
    this.nodeGlows.set(node.id, glowMeshes);

    // Create label sprite
    const label = this.createLabel(node.label, position, nodeRadius);
    if (label) {
      this.scene.add(label);
    }

    return {
      id: node.id,
      position,
      mesh,
      label,
      node,
      originalScale: sizeMultiplier,
    };
  }

  private createLabel(text: string, position: THREE.Vector3, nodeRadius: number): THREE.Sprite | null {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;

    const displayText = text.length > this.config.maxLabelLength
      ? text.slice(0, this.config.maxLabelLength) + '…'
      : text;

    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = 'bold 24px sans-serif';
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(displayText, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);

    sprite.position.copy(position);
    sprite.position.y += nodeRadius + 15;
    sprite.scale.set(50, 12, 1);

    return sprite;
  }

  private createEdge(edge: KnowledgeEdge, straight: boolean = false): Edge3D | null {
    const sourceNode = this.nodes.get(edge.source);
    const targetNode = this.nodes.get(edge.target);

    if (!sourceNode || !targetNode) return null;

    const start = sourceNode.position.clone();
    const end = targetNode.position.clone();
    
    let geometry: THREE.BufferGeometry;
    
    if (straight) {
      geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    } else {
      // Create curved line between nodes for more 3D feel
      const mid = start.clone().add(end).multiplyScalar(0.5);

      // Push midpoint slightly outward from center for arc effect
      const toCenter = mid.clone().normalize();
      mid.add(toCenter.multiplyScalar(this.config.sphereRadius * 0.15));

      // Create quadratic bezier curve
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(12); // Reduced from 20 for performance
      geometry = new THREE.BufferGeometry().setFromPoints(points);
    }

    const material = new THREE.LineBasicMaterial({
      color: 0x4a4a6a,
      transparent: true,
      opacity: 0.2 + edge.weight * 0.3,
      linewidth: 1,
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    return {
      id: edge.id,
      line,
      sourceId: edge.source,
      targetId: edge.target,
      weight: edge.weight,
    };
  }

  /**
   * Select a node and highlight its connections
   */
  selectNode(nodeId: string): void {
    if (!this.graph) return;

    this.clearHighlight();
    this.selectionState.selectedNodeId = nodeId;
    this.selectionState.highlightedNodeIds.add(nodeId);

    // Get connected nodes
    const connections = this.graph.getConnections(nodeId);
    for (const { edge, node } of connections) {
      this.selectionState.highlightedNodeIds.add(node.id);
      this.selectionState.highlightedEdgeIds.add(edge.id);
    }

    this.applyHighlight();
    
    // Focus camera on node
    const node3D = this.nodes.get(nodeId);
    if (node3D) {
      this.focusOnNode(node3D.position);
    }

    if (this.onSelectCallback) {
      this.onSelectCallback(nodeId);
    }
  }

  private focusOnNode(targetPosition: THREE.Vector3): void {
    const distance = 150; // Distance to stop from node
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const newCameraPos = targetPosition.clone().add(direction.multiplyScalar(distance));
    
    // Smooth transition using simple lerp in the animation loop would be better, 
    // but for now we set it directly and update controls
    this.camera.position.copy(newCameraPos);
    this.controls.target.copy(targetPosition);
    this.controls.update();
  }

  /**
   * Highlight a specific node (from external source like node list)
   */
  highlightNode(nodeId: string | null): void {
    if (!nodeId) {
      this.clearHighlight();
      return;
    }
    this.selectNode(nodeId);
  }

  private applyHighlight(): void {
    const isInstanced = this.nodeInstances !== null;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // 1. Update nodes
    const nodeIds = Array.from(this.nodes.keys());
    nodeIds.forEach((id, index) => {
      const node3D = this.nodes.get(id)!;
      const isHighlighted = this.selectionState.highlightedNodeIds.has(id);
      const isSelected = id === this.selectionState.selectedNodeId;
      const originalScale = node3D.originalScale;
      
      const targetScale = isSelected ? originalScale * 1.5 : 
                         isHighlighted ? originalScale * 1.3 : 
                         this.selectionState.selectedNodeId ? 0 : originalScale; // Hide if not highlighted

      if (isInstanced) {
        // ... (InstancedMesh logic)
        const position = this.nodePositions.get(id)!;
        dummy.position.copy(position);
        dummy.scale.setScalar(targetScale);
        dummy.updateMatrix();
        
        this.nodeInstances!.setMatrixAt(index, dummy.matrix);
        this.nodeCoreInstances!.setMatrixAt(index, dummy.matrix);
        this.nodeGlowInstances!.setMatrixAt(index, dummy.matrix);

        const baseColor = this.nodeColors.get(id)!;
        color.setHex(baseColor);
        
        if (isSelected) {
          color.multiplyScalar(1.5);
        } else if (!isHighlighted && this.selectionState.selectedNodeId) {
          color.setHex(0x000000); // Completely dark if hidden
        }
        
        this.nodeInstances!.setColorAt(index, color);
      } else {
        // Individual mesh update
        node3D.mesh.scale.setScalar(targetScale);
        node3D.mesh.visible = targetScale > 0;
        
        const glows = this.nodeGlows.get(id);
        if (glows) {
          const opacities = isSelected ? [1.0, 0.4] : isHighlighted ? [0.8, 0.3] : [0, 0];
          for (let i = 0; i < glows.length && i < opacities.length; i++) {
            (glows[i].material as THREE.MeshBasicMaterial).opacity = opacities[i];
            glows[i].visible = opacities[i] > 0;
          }
        }
        const material = node3D.mesh.material as THREE.MeshPhongMaterial;
        material.opacity = isSelected ? 0.95 : isHighlighted ? 0.85 : 0;
      }
      
      // Update Points (Starry Sky)
      if (this.nodePoints && this.selectionState.selectedNodeId) {
        const sizes = this.nodePoints.geometry.attributes.size?.array as Float32Array;
        if (sizes) {
          sizes[index] = isHighlighted ? (isSelected ? 15 : 10) : 0;
          this.nodePoints.geometry.attributes.size.needsUpdate = true;
        }
      }

      if (node3D.label) {
        node3D.label.visible = isHighlighted || !this.selectionState.selectedNodeId;
        if (isSelected) node3D.label.scale.set(70, 16, 1);
        else node3D.label.scale.set(50, 12, 1);
      } else if (isSelected) {
        // Starry Sky Mode: Dynamic label generation for selected node
        const label = this.createLabel(node3D.node.label, node3D.position, 10);
        if (label) {
          this.scene.add(label);
          node3D.label = label;
          label.visible = true;
          label.scale.set(70, 16, 1);
        }
      }
    });

    if (isInstanced) {
      this.nodeInstances!.instanceMatrix.needsUpdate = true;
      this.nodeCoreInstances!.instanceMatrix.needsUpdate = true;
      this.nodeGlowInstances!.instanceMatrix.needsUpdate = true;
      if (this.nodeInstances!.instanceColor) this.nodeInstances!.instanceColor.needsUpdate = true;
    }

    // 2. Update edges
    for (const [id, edge3D] of this.edges) {
      const isHighlighted = this.selectionState.highlightedEdgeIds.has(id);
      const material = edge3D.line.material as THREE.LineBasicMaterial;

      if (isHighlighted) {
        material.color.setHex(0x00ffd5);
        material.opacity = 0.95;
      } else {
        material.color.setHex(0x2a2a4a);
        material.opacity = this.selectionState.selectedNodeId ? 0.02 : 0.15;
      }
    }
  }

  private clearHighlight(): void {
    this.selectionState.selectedNodeId = null;
    this.selectionState.highlightedNodeIds.clear();
    this.selectionState.highlightedEdgeIds.clear();

    const isInstanced = this.nodeInstances !== null;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const nodeIds = Array.from(this.nodes.keys());
    nodeIds.forEach((id, index) => {
      const node3D = this.nodes.get(id)!;
      const originalScale = node3D.originalScale;

      if (isInstanced) {
        const position = this.nodePositions.get(id)!;
        dummy.position.copy(position);
        dummy.scale.setScalar(originalScale);
        dummy.updateMatrix();
        this.nodeInstances!.setMatrixAt(index, dummy.matrix);
        this.nodeCoreInstances!.setMatrixAt(index, dummy.matrix);
        this.nodeGlowInstances!.setMatrixAt(index, dummy.matrix);

        color.setHex(this.nodeColors.get(id)!);
        this.nodeInstances!.setColorAt(index, color);
      } else {
        node3D.mesh.scale.setScalar(originalScale);
        const material = node3D.mesh.material as THREE.MeshPhongMaterial;
        material.opacity = 0.7;
        
        const glows = this.nodeGlows.get(node3D.id);
        if (glows) {
          const baseOpacities = [0.9, 0.15];
          for (let i = 0; i < glows.length && i < baseOpacities.length; i++) {
            (glows[i].material as THREE.MeshBasicMaterial).opacity = baseOpacities[i];
          }
        }
      }

      if (node3D.label) {
        node3D.label.visible = true;
        node3D.label.scale.set(50, 12, 1);
      }

      // Restore Starry Sky Points
      if (this.nodePoints) {
        const sizes = this.nodePoints.geometry.attributes.size?.array as Float32Array;
        if (sizes) {
          sizes[index] = originalScale * 5.0;
          this.nodePoints.geometry.attributes.size.needsUpdate = true;
        }
      }
    });

    if (isInstanced) {
      this.nodeInstances!.instanceMatrix.needsUpdate = true;
      this.nodeCoreInstances!.instanceMatrix.needsUpdate = true;
      this.nodeGlowInstances!.instanceMatrix.needsUpdate = true;
      if (this.nodeInstances!.instanceColor) this.nodeInstances!.instanceColor.needsUpdate = true;
    }

    // Reset edges
    for (const edge3D of this.edges.values()) {
      edge3D.line.visible = true;
      const material = edge3D.line.material as THREE.LineBasicMaterial;
      material.color.setHex(0x4a4a6a);
      material.opacity = 0.04;
    }
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.clearHighlight();
    if (this.onSelectCallback) {
      this.onSelectCallback(null);
    }
  }

  /**
   * Get selected node
   */
  getSelectedNode(): KnowledgeNode | null {
    if (!this.selectionState.selectedNodeId) return null;
    const node3D = this.nodes.get(this.selectionState.selectedNodeId);
    return node3D?.node || null;
  }

  /**
   * Regenerate the graph layout
   */
  regenerate(): void {
    if (this.graph) {
      this.render(this.graph);
    }
  }

  private clearScene(): void {
    // Remove node points
    if (this.nodePoints) {
      this.scene.remove(this.nodePoints);
      this.nodePoints.geometry.dispose();
      (this.nodePoints.material as THREE.Material).dispose();
      this.nodePoints = null;
    }

    // Remove node instances
    if (this.nodeInstances) {
      this.scene.remove(this.nodeInstances);
      this.nodeInstances.geometry.dispose();
      (this.nodeInstances.material as THREE.Material).dispose();
      this.nodeInstances = null;
    }
    
    if (this.nodeCoreInstances) {
      this.scene.remove(this.nodeCoreInstances);
      this.nodeCoreInstances.geometry.dispose();
      (this.nodeCoreInstances.material as THREE.Material).dispose();
      this.nodeCoreInstances = null;
    }

    if (this.nodeGlowInstances) {
      this.scene.remove(this.nodeGlowInstances);
      this.nodeGlowInstances.geometry.dispose();
      (this.nodeGlowInstances.material as THREE.Material).dispose();
      this.nodeGlowInstances = null;
    }

    // Remove all node glow meshes
    for (const [nodeId, glows] of this.nodeGlows) {
      for (const glowMesh of glows) {
        this.scene.remove(glowMesh);
        glowMesh.geometry.dispose();
        (glowMesh.material as THREE.Material).dispose();
      }
    }
    this.nodeGlows.clear();
    this.nodeSizes.clear();

    // Remove all nodes
    for (const node3D of this.nodes.values()) {
      if (node3D.mesh && node3D.mesh.geometry) { // Mesh might be instancedMesh shared reference
        if (node3D.mesh.type === 'Mesh') {
          this.scene.remove(node3D.mesh);
          node3D.mesh.geometry.dispose();
          (node3D.mesh.material as THREE.Material).dispose();
        }
      }
      if (node3D.label) {
        this.scene.remove(node3D.label);
        (node3D.label.material as THREE.Material).dispose();
      }
    }
    this.nodes.clear();
    this.nodePositions.clear();
    this.nodeColors.clear();
    this.nodeScales.clear();

    // Remove all edges
    for (const edge3D of this.edges.values()) {
      this.scene.remove(edge3D.line);
      edge3D.line.geometry.dispose();
      (edge3D.line.material as THREE.Material).dispose();
    }
    this.edges.clear();

    // Clear selection state
    this.selectionState = {
      selectedNodeId: null,
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    };
  }

  /**
   * Dispose and clean up resources
   */
  dispose(): void {
    this.isDisposed = true;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener('resize', this.handleResize.bind(this));

    this.clearScene();
    this.renderer.dispose();
    this.controls.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
