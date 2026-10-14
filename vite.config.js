import { defineConfig } from "vite";

// Vitest est execute dans un DOM simule (jsdom) : le frontend est du JS de
// navigateur et n'a aucun sens sous Node. Le test lance `new App()` comme le
// ferait le chargement de page, puis verifie que le DOM a ete rempli.
//
// `url` est indispensable : avec l'URL par defaut (`about:blank`), jsdom
// n'expose pas de `localStorage` (pas d'origine). Or l'application s'en sert
// pour les presets personnalises, le theme et la restauration des sessions —
// les chemins `localStorage` seraient donc tous en `try/catch` et le test ne
// testerait pas le vrai comportement.
//
// `setupFiles` installe un `localStorage` de repli : sous Node >= 22, le
// `localStorage` global experimental ecrase celui de jsdom et laisse
// `window.localStorage` a `undefined` (voir le fichier pour le detail).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Exigé par tauri.conf.json (`frontendDist: ../dist`) et par
    // `tauri::generate_context!` : sans `dist/`, le crate ne compile pas.
    // Ne pas monter à Vite 6 sans Vitest 3 (ERESOLVE, cf. memory.md).
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost:1420/" },
    },
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.js"],
    // Le rapport doit rester lisible dans les logs de la CI.
    reporter: "verbose",
  },
});
