import * as THREE from 'three';

/**
 * Bloom leve: faz o sol, as lâmpadas dos postes e o semáforo de largada
 * brilharem de verdade. Os addons vêm do mesmo CDN do three; se o import
 * falhar (offline, CDN fora do ar), devolve `null` e o jogo renderiza direto.
 */
export async function createPostFX(renderer, scene, camera) {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.44,  // intensidade — o suficiente para o brilho, longe do "borrão"
      0.62,  // raio
      0.86   // limiar: só o que já é bem claro floresce
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const setSize = (w, h) => {
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
    };
    setSize(window.innerWidth, window.innerHeight);

    return {
      render: () => composer.render(),
      setSize,
      setPixelRatio: (r) => composer.setPixelRatio(r),
      dispose: () => composer.dispose?.(),
    };
  } catch (err) {
    console.warn('bloom indisponível, renderizando sem pós-processamento:', err);
    return null;
  }
}
