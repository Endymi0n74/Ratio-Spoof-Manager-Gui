#!/usr/bin/env node
/**
 * Génère `latest.json`, le manifeste attendu par tauri-plugin-updater (Tauri 2),
 * à partir des artefacts signés d'un bundle Windows.
 *
 * Le manifeste décrit une version, sa date de publication et, par plateforme,
 * l'URL d'un artefact ainsi que la signature minisign de cet artefact (le
 * contenu du fichier `.sig` produit par Tauri à côté du bundle). L'updater refuse
 * tout artefact dont la signature ne vérifie pas contre la `pubkey` déclarée dans
 * `tauri.conf.json` : seuls les fichiers accompagnés d'un `.sig` sont retenus.
 *
 * Utilisé par `.github/workflows/release.yml`, mais utilisable à la main :
 *
 *   node scripts/make-updater-manifest.mjs --version=2.0.4 \
 *     --base-url=https://github.com/<owner>/<repo>/releases/download/v2.0.4 \
 *     --dir=artifacts --out=artifacts/latest.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const HELP = `Usage : node scripts/make-updater-manifest.mjs [options]

Options :
  --version=<x.y.z>  Version publiée (obligatoire)
  --base-url=<url>   Préfixe des URLs d'assets de la release, sans slash final
                     (ex. https://github.com/<owner>/<repo>/releases/download/v2.0.4)
  --dir=<chemin>     Dossier contenant les artefacts signés (défaut : artifacts)
  --out=<chemin>     Fichier de sortie (défaut : <dir>/latest.json)
  --notes=<texte>    Texte affiché par l'updater au moment de l'installation
  -h, --help         Affiche cette aide
`;

function parseArgs(argv) {
  const opts = { version: null, baseUrl: null, dir: "artifacts", out: null, notes: null, help: false };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? null : arg.slice(eq + 1);
    switch (name) {
      case "--version":
        opts.version = value;
        break;
      case "--base-url":
        opts.baseUrl = value;
        break;
      case "--dir":
        opts.dir = value ?? opts.dir;
        break;
      case "--out":
        opts.out = value ?? opts.out;
        break;
      case "--notes":
        opts.notes = value ?? opts.notes;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`Option inconnue : ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (!opts.version || !opts.baseUrl) {
  console.error(HELP);
  console.error("Il manque --version et/ou --base-url.");
  process.exit(2);
}

const dir = resolve(ROOT, opts.dir);
const out = resolve(ROOT, opts.out ?? join(opts.dir, "latest.json"));

const files = readdirSync(dir).filter(
  (f) => !f.startsWith(".") && f !== "SHA256SUMS.txt" && f !== "latest.json",
);

// Un artefact updater = un fichier + son `.sig` frère, pour la même version.
// On préfère l'archive (paquet updater Windows : l'installateur compressé),
// sinon l'installateur signé lui-même.
const signed = files
  .filter((f) => f.endsWith(".sig"))
  .map((sig) => ({ sig, target: sig.slice(0, -4) }))
  .filter(({ sig, target }) => files.includes(target) && sig.slice(0, -4) === target)
  .map(({ sig, target }) => ({ sig, target }))
  .filter(({ target }) => target.includes(`_${opts.version}_`));

if (signed.length === 0) {
  const available = files.filter((f) => f.includes(`_${opts.version}_`)).join("\n  ") || "(aucun)";
  console.error(`Aucun artefact signé pour la version ${opts.version} dans ${opts.dir}/ :`);
  console.error(`  ${available}`);
  console.error(
    "Attendu : <installateur>.zip + <installateur>.zip.sig (bundle `nsis` avec createUpdaterArtifacts).",
  );
  process.exit(1);
}
if (signed.length > 1) {
  console.error(`Plusieurs artefacts signés pour ${opts.version} :`);
  for (const { target } of signed) console.error(`  ${target}`);
  console.error("Le manifeste ne peut en référencer qu'un par plateforme.");
  process.exit(1);
}

const { sig, target } = signed[0];
if (!target.includes("_x64") && !target.includes("x86_64")) {
  console.error(`Artefact ${target} : arch non reconnue, la plateforme windows-x86_64 serait fausse.`);
  process.exit(1);
}

const manifest = {
  version: opts.version,
  notes: opts.notes ?? `Ratio Spoof Manager ${opts.version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(join(dir, sig), "utf8").trim(),
      url: `${opts.baseUrl.replace(/\/+$/, "")}/${encodeURI(target)}`,
    },
  },
};

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Manifeste d'updater : ${out}`);
console.log(`  version   ${manifest.version}`);
console.log(`  artefact  ${target}`);
console.log(`  url       ${manifest.platforms["windows-x86_64"].url}`);
