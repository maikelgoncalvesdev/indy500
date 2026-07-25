import * as THREE from 'three';
import { buildAnimalHead } from './car.js';

/**
 * Rende as cabeças dos pilotos uma única vez no boot e devolve um PNG por
 * animal (data URL). Assim a interface — seleção de piloto, classificação e
 * pódio — mostra o mesmo personagem que está na pista, sem custo por frame.
 *
 * Usa um renderer descartável com `preserveDrawingBuffer` para poder ler o
 * canvas; o contexto é liberado no fim.
 */
export function renderPortraits(animals, size = 224) {
  const out = new Map();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out; // sem WebGL sobrando: a UI cai no quadradinho de cor
  }

  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdceaff, 0x4a4034, 2.0));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(2, 3, 4);
  const rim = new THREE.DirectionalLight(0x9ec8ff, 1.1);
  rim.position.set(-3, 1, -2);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0.75, 0.42, 2.5);
  camera.lookAt(0, 0.02, 0);

  for (const a of animals) {
    const head = buildAnimalHead(a);
    head.rotation.y = -0.5; // três-quartos aberto: mostra focinho e bico de lado
    scene.add(head);
    renderer.render(scene, camera);
    out.set(a.name, renderer.domElement.toDataURL('image/png'));
    scene.remove(head);
    head.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }

  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
