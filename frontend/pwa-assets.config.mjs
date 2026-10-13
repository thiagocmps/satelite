import { defineConfig } from '@vite-pwa/assets-generator/config';

/**
 * Gera todos os ícones do PWA a partir de uma única fonte: public/pwa-source.svg
 *
 *   npm run generate-pwa-assets
 *
 * Por que `padding: 0` e `resizeOptions` explícitos (os defaults quebram):
 *
 *  - O default do gerador é `padding: 0.3` + `background: 'white'` nos tipos
 *    maskable e apple. Isso encolhe a arte pra 70% e pinta a volta de BRANCO —
 *    era o "contorno branco" que aparecia no launcher do Samsung.
 *  - O default de `transparent` é `padding: 0.05` + fundo transparente, que
 *    deixava os cantos vazios. O launcher do Samsung pinta de branco atrás do
 *    que fica transparente => "quadrado com contorno".
 *
 * A fonte já desenha fundo full-bleed (retângulo + nebulosas até a borda), então
 * com padding 0 a arte cobre o canvas inteiro, sai 100% opaco e o fundo branco
 * nunca aparece.
 *
 * Safe zone do maskable (canto mais extremo do satélite, x=120 y=604 em 1024):
 * raio ~196px num canvas de 512, limite 205px => cabe com folga. As estrelas
 * passam da borda, mas são decorativas e podem ser cortadas pelo launcher.
 */
const opaque = { fit: 'cover', background: 'transparent' };

export default defineConfig({
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, 'favicon.ico']],
      padding: 0,
      resizeOptions: opaque,
    },
    maskable: {
      sizes: [512, 192],
      padding: 0,
      resizeOptions: opaque,
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: opaque,
    },
  },
  images: ['public/pwa-source.svg'],
});
