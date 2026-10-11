// Environnement de test partage.
//
// But : fournir un `localStorage` fiable sous Node >= 22.
//
// Pourquoi ce fichier est necessaire
// ----------------------------------
// Node 22+ expose un `localStorage` **global et experimental** (active par
// `--experimental-webstorage`). Vitest le copie dans le contexte global du
// test, ou il **ecrase** celui de jsdom. Node leve alors :
//
//   ExperimentalWarning: localStorage is not available because
//   --localstorage-file was not provided.
//
// et `window.localStorage` vaut `undefined`. Or l'application s'en sert pour
// les presets personnalises, le theme et la restauration des sessions.
//
// Le test d'application (2.0.9, fenetre vide) ne verrait donc pas le
// comportement reel de ces chemins. On installe ici une implementation
// conforme a l'interface Web Storage, uniquement en memoire.
//
// A retirer quand le projetREQUIRERA une version de Node ou de Vitest qui
// cesse d'interferer avec le global experimental (cf. memory.md).

if (typeof window !== "undefined" && !window.localStorage) {
  const createStore = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => void map.set(String(k), String(v)),
      removeItem: (k) => void map.delete(String(k)),
      clear: () => map.clear(),
      key: (i) => Array.from(map.keys())[i] ?? null,
      get length() {
        return map.size;
      },
    };
  };

  Object.defineProperty(window, "localStorage", {
    value: createStore(),
    writable: false,
    configurable: true,
  });
}

// jsdom n'implemente pas `<canvas>` : `getContext('2d')` renvoie `null`, ce
// qui fait lever `SpeedChart` (`ctx.scale` sur `null`). Ce n'est pas un defaut
// de l'application — WebView2 fournit un vrai contexte — c'est une limite de
// l'environnement de test. On installe donc un contexte 2d minimal, assez
// large pour que le rendu du graphique s'exerce sans ecrire de pixels.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== "2d") return null;
    const noop = () => {};
    return {
      scale: noop,
      clearRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      fillRect: noop,
      strokeRect: noop,
      arc: noop,
      closePath: noop,
      fillText: noop,
      save: noop,
      restore: noop,
      setTransform: noop,
      // Le graphique interroge ces proprietes pour adapter ses tranches.
      measureText: (text) => ({ width: String(text).length * 6 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      setLineDash: noop,
    };
  };
}

// jsdom n'implemente pas `IntersectionObserver`, utilise par `setupLazyCharts`
// pour n'initialiser le graphique d'une session que lorsque sa carte est
// visible. Doublure minimale : `observe` ne rappelle rien, ce qui laisse les
// graphiques paresseux non initialises — le comportement wanted pour un test
// de rendu.
if (typeof window !== "undefined" && !window.IntersectionObserver) {
  class NoopIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = NoopIntersectionObserver;
  globalThis.IntersectionObserver = NoopIntersectionObserver;
}
