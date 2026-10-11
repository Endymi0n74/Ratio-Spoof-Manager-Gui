// Test de fumee du frontend : verifie que l'application se rend sans lever.
//
// Pourquoi ce test existe
// -----------------------
// Le 10/10/2026, la v2.0.9 s'ouvrait sur une fenetre **entirement vide**. Une
// seule ligne du gabarit de `render()` lisait `${this.icons.download}`, or la
// classe `App` n'a pas de propriete `icons` : le `TypeError` etait leve pendant
// l'evaluation du litteral de gabarit, donc **avant** l'affectation de
// `app.innerHTML`. Rien ne s'affichait, sans le moindre message.
//
// Pourquoi la CI ne l'a pas vu :
//   - `node --check` ne verifie que la **syntaxe**, or le bundle etait
//     syntaxiquement valide ;
//   - `cargo test` ne touche qu'au backend Rust ;
//   - clippy ne voit pas le JavaScript.
//
// Aucun maillon de la chaine ne verifiait que le frontend **s'execute**. Ce
// test comble ce trou : il instancie reellement `App`, dans un DOM, et exige
// que le header soit rendu.
//
// Ce qu'il attrape : toute expression `this.x` dans un gabarit ou une methode
// de `App` ou `x` n'est pas declare, toute reference a une API inexistante,
// toute exception de premier niveau au demarrage. C'est-a-dire exactement la
// famille de fautes qui rend l'application inutilisable sans que rien ne le
// signale.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Doubles des API Tauri -------------------------------------------------
// L'application appelle `invoke`, `check` et `relaunch` au demarrage. Sous
// jsdom, le bridge IPC n'existe pas : sans ces doubles, le premier `invoke`
// echouerait et le test mesurerait l'echec du mock plutot que celui du code.

const fakeSettings = {
  success: true,
  data: {
    default_downloaded: "100%",
    default_uploaded: "50%",
    default_port: 8999,
    default_client: "qbit-4.0.3",
    default_dl_speed: "",
    default_ul_speed: "",
    polling_interval_sec: 2,
    ratio_target: 2.0,
    auto_restart: true,
    theme: "dark",
  },
};

const fakePresets = {
  success: true,
  data: [
    { id: "seed", name: "Seed pur", description: "", config: { downloaded: "100%", dl_speed: "0kbps", uploaded: "0%", ul_speed: "5mbps", port: 8999 } },
    { id: "leech", name: "Leech", description: "", config: { downloaded: "0%", dl_speed: "10mbps", uploaded: "0%", ul_speed: "0kbps", port: 8999 } },
  ],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => {
    switch (cmd) {
      case "get_settings":
        return fakeSettings;
      case "get_presets":
        return fakePresets;
      case "get_sessions":
        return { success: true, data: [] };
      case "get_build_info":
        return { success: true, data: { version: "2.0.10" } };
      default:
        return { success: true, data: null };
    }
  }),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

// `Notification` n'existe pas dans jsdom ; l'application l'utilise pour les
// alertes. On le definit pour que le chemin ne leve pas.
if (!("Notification" in window)) {
  window.Notification = class {
    static permission = "granted";
    static requestPermission() { return Promise.resolve("granted"); }
    constructor() {}
  };
}

// jsdom n'a pas de `matchMedia` ; l'application ne l'utilise pas, mais la
// libelle par defaut pour tout ce qui interroge les media.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
}

// --- Import tardif : apres les mocks ---------------------------------------
// `app.js` instancie `App` sur `DOMContentLoaded`. On l'importe une fois le
// DOM pret, puis on declenche l'evenement nous-memes pour controlling
// l'initialisation.
import { App } from "./app.js";

describe("demarrage de l'application", () => {
  let errors;

  beforeEach(() => {
    // jsdom part d'un document vide : `index.html` (qui declare
    // `<div id="app">`) n'est pas charge. On recree le conteneur racine,
    // sinon `render()` echoue sur un `null` et le test mesurerait l'absence du
    // squelette HTML plutot que celle du code de l'application.
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    errors = [];
    // Une exception levee dans un listener DOM n'est pas relancee par vitest :
    // on l'attrape pour la transformer en echec de test explicite.
    window.addEventListener("error", (e) => errors.push(e.error || e.message));
  });

  it("instancie App sans lever", () => {
    expect(() => new App()).not.toThrow();
  });

  it("remplit l'en-tete de la page (le DOM est bien rendu)", () => {
    const app = new App();
    app.render();

    const header = document.querySelector("header.app-header");
    expect(header, "le header doit exister dans le DOM").not.toBeNull();
    expect(document.querySelector(".app-logo")?.textContent).toContain("RSM");
  });

  it("affiche la version dans le bandeau", () => {
    const app = new App();
    app.render();
    const versionEl = document.getElementById("app-version");
    expect(versionEl, "le bandeau de version doit exister").not.toBeNull();
    expect(versionEl.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("contient les zones principales (formulaire, sessions, journal)", () => {
    const app = new App();
    app.render();

    expect(document.getElementById("new-session-container"), "formulaire de session").not.toBeNull();
    expect(document.getElementById("sessions-container"), "liste des sessions").not.toBeNull();
    expect(document.getElementById("log-panel-container"), "journal").not.toBeNull();
  });

  it("expose le bouton de verification de mise a jour dans « A propos »", () => {
    const app = new App();
    app.render();
    // Regression 2.0.9 : ce bouton vit dans le gabarit de la modale. Si une
    // expression y leve, le DOM entier reste vide et ce test echoue avec
    // « bouton introuvable » plutot qu'avec un TypeError illisible.
    const btn = document.getElementById("btn-about-update");
    expect(btn, "le bouton de mise a jour doit etre rendu").not.toBeNull();
    expect(document.getElementById("about-version"), "version dans « A propos »").not.toBeNull();
  });

  it("ne leve aucune erreur JavaScript pendant l'initialisation", async () => {
    const app = new App();
    await app.init();
    // laisse passer les appels asynchrones (loadSettings, loadPresets...)
    await new Promise((r) => setTimeout(r, 50));
    expect(errors, "aucune erreur ne doit etre levee au demarrage").toEqual([]);
  });
});
