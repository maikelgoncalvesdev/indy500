import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Achata a árvore de um objeto: tudo que não se move vira um único mesh por
 * material. Um kart montado peça a peça custa ~35 draw calls (×10 karts, ×2
 * pelo passe de sombra); depois disto ficam ~8. Marque `userData.dynamic` no
 * que precisa continuar articulado ou transparente.
 */
export function flattenByMaterial(root) {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const drop = [];

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return;
    const g = o.geometry.clone();
    // ExtrudeGeometry (orelhas, penas) vem sem índice, e o merge recusa o lote
    // inteiro quando as geometrias divergem nisso — as peças sumiam do kart
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push({ g, cast: o.castShadow, receive: o.receiveShadow });
    drop.push(o);
  });

  for (const o of drop) o.parent?.remove(o);

  for (const [mat, parts] of buckets) {
    const geos = parts.map((p) => p.g);
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (!merged) continue; // atributos incompatíveis: perder o batch é melhor que quebrar
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = parts.some((p) => p.cast);
    m.receiveShadow = parts.some((p) => p.receive);
    root.add(m);
    for (const g of geos) if (g !== merged) g.dispose();
  }
  return root;
}

/** Geometria única a partir de um grupo (usada para semear InstancedMesh). */
export function bakeGeometry(group, material) {
  group.updateMatrixWorld(true);
  const geos = [];
  group.traverse((o) => {
    if (!o.isMesh || o.material !== material) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
  });
  if (!geos.length) return null;
  return geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
}
