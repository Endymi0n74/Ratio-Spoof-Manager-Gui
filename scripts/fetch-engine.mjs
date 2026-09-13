#!/usr/bin/env node
/**
 * Récupère le sidecar `ratio-spoof` depuis la release du dépôt moteur et l'installe
 * dans `src-tauri/binaries/`, à l'emplacement exact attendu par Tauri.
 *
 * Le dépôt moteur (Endymi0n74/ratio-spoof) est la seule source de vérité : ce dépôt
 * n'en garde ni copie des sources, ni binaire versionné. Le tag et l'empreinte
 * SHA-256 de chaque asset sont épinglés dans `engine.lock.json`, donc un asset
 * remplacé côté release fait échouer le build au lieu de passer inaperçu.
 *
 * Appelé automatiquement par `beforeDevCommand` / `beforeBuildCommand`, mais aussi
 * utilisable à la main :
 *
 *   node scripts/fetch-engine.mjs                 # installe le sidecar de la cible courante
 *   node scripts/fetch-engine.mjs --force         # retélécharge même si l'empreinte correspond
 *   node scripts/fetch-engine.mjs --check         # vérifie seulement (code de sortie 1 si absent)
 *   node scripts/fetch-engine.mjs --offline       # n'accède pas au réseau
 *   node scripts/fetch-engine.mjs --print-target  # affiche le target triple résolu
 *   node scripts/fetch-engine.mjs --update-lock   # ré-épingle l'empreinte du binaire installé
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOCK_PATH = join(ROOT, "engine.lock.json");
const DEST_DIR = join(ROOT, "src-tauri", "binaries");

const PLATFORM_FALLBACK = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

const HELP = `Usage : node scripts/fetch-engine.mjs [options]

Options :
  --target=<triple>  Cible Rust à installer (défaut : cible de la machine / du build)
  --force            Retélécharge et réinstalle même si l'empreinte correspond déjà
  --check            Vérifie le sidecar installé sans rien télécharger (code 1 si absent)
  --offline          N'accède pas au réseau : échoue si le sidecar doit être téléchargé
  --update-lock      Ré-épingle dans engine.lock.json l'empreinte du binaire installé
  --print-target      Affiche le target triple résolu puis quitte
  -h, --help         Affiche cette aide

Variable d'environnement :
  RATIO_SPOOF_ENGINE_BIN  Chemin d'un binaire construit localement à installer à la
                          place de l'asset (développement du moteur). L'empreinte
                          n'est alors pas vérifiée : le script vous la donne.
`;

function parseArgs(argv) {
  const opts = { target: null, force: false, check: false, offline: false, updateLock: false, printTarget: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === "--force") opts.force = true;
    else if (arg === "--check") opts.check = true;
    else if (arg === "--offline") opts.offline = true;
    else if (arg === "--update-lock") opts.updateLock = true;
    else if (arg === "--print-target") opts.printTarget = true;
    else if (arg.startsWith("--target=")) opts.target = arg.slice("--target=".length);
    else {
      process.stderr.write(`Option inconnue : ${arg}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return opts;
}

function detectTriple() {
  if (process.env.RATIO_SPOOF_TARGET) return process.env.RATIO_SPOOF_TARGET;
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  try {
    const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
      .split("\n")
      .find((line) => line.startsWith("host:"));
    if (host) return host.slice("host:".length).trim();
  } catch {
    // rustc absent : on retombe sur la plateforme de Node.
  }
  const key = `${process.platform}-${process.arch}`;
  const triple = PLATFORM_FALLBACK[key];
  if (!triple) throw new Error(`Cible inconnue pour ${key} ; passez --target=<triple>.`);
  return triple;
}

function loadLock() {
  if (!existsSync(LOCK_PATH)) throw new Error(`Fichier d'épinglage introuvable : ${LOCK_PATH}`);
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  if (!lock.repository || !lock.tag || !lock.assets) {
    throw new Error(`${LOCK_PATH} doit déclarer "repository", "tag" et "assets".`);
  }
  return lock;
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

async function downloadAsset(url, tmpPath) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ratio-spoof-manager/fetch-engine" },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Téléchargement impossible (${response.status} ${response.statusText}) : ${url}\n` +
        `  L'asset existe-t-il bien sur ce tag ? Vérifiez la release du dépôt moteur.`,
    );
  }
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(tmpPath),
  );
  return hash.digest("hex");
}

function install(fromPath, destPath) {
  rmSync(destPath, { force: true });
  try {
    renameSync(fromPath, destPath);
  } catch {
    // Renommage impossible (autre volume) : on copie puis on nettoie.
    copyFileSync(fromPath, destPath);
    rmSync(fromPath, { force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lock = loadLock();
  const target = opts.target ?? detectTriple();

  if (opts.printTarget) {
    process.stdout.write(`${target}\n`);
    return;
  }

  const entry = lock.assets[target];
  if (!entry) {
    throw new Error(
      `Aucun asset épinglé pour la cible « ${target} ».\n` +
        `  Cibles disponibles : ${Object.keys(lock.assets).join(", ")}.`,
    );
  }

  const destPath = join(DEST_DIR, entry.name);
  const expected = entry.sha256.toLowerCase();
  const installed = existsSync(destPath) ? sha256File(destPath) : null;
  const upToDate = installed === expected;

  if (opts.updateLock) {
    if (!installed) throw new Error(`Rien à épingler : ${entry.name} n'est pas installé.`);
    entry.sha256 = installed;
    writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write(`✓ engine.lock.json : ${target} → ${installed}\n`);
    return;
  }

  if (opts.check) {
    if (upToDate) {
      process.stdout.write(`✓ ${entry.name} correspond à l'empreinte épinglée (${expected})\n`);
      return;
    }
    throw new Error(
      installed
        ? `✗ ${entry.name} installé mais différent de l'empreinte épinglée\n  attendu : ${expected}\n  obtenu  : ${installed}`
        : `✗ ${entry.name} absent ; lancez « npm run engine:fetch »`,
    );
  }

  if (upToDate && !opts.force) {
    process.stdout.write(`✓ ${entry.name} déjà en place (${expected})\n`);
    return;
  }

  const localOverride = process.env.RATIO_SPOOF_ENGINE_BIN;
  mkdirSync(DEST_DIR, { recursive: true });

  if (localOverride) {
    const localPath = resolve(localOverride);
    if (!existsSync(localPath)) throw new Error(`RATIO_SPOOF_ENGINE_BIN introuvable : ${localPath}`);
    install(localPath, destPath);
    const got = sha256File(destPath);
    process.stdout.write(
      `⚠ ${entry.name} installé depuis ${localPath} (empreinte non vérifiée)\n` +
        `  sha256 : ${got}\n` +
        `  Pour ré-épingler : node scripts/fetch-engine.mjs --target=${target} --update-lock\n`,
    );
    return;
  }

  if (opts.offline) {
    throw new Error(
      `--offline : ${entry.name} doit être téléchargé mais le réseau est interdit.\n` +
        `  Lancez « npm run engine:fetch » avec accès réseau.`,
    );
  }

  const url = `https://github.com/${lock.repository}/releases/download/${lock.tag}/${entry.name}`;
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  process.stdout.write(`↓ ${entry.name} (${lock.repository} ${lock.tag})\n`);

  let got;
  try {
    got = await downloadAsset(url, tmpPath);
    if (got !== expected) {
      throw new Error(
        `Empreinte SHA-256 inattendue pour ${entry.name}\n  attendue : ${expected}\n  obtenue  : ${got}\n` +
          `  La release a-t-elle été republiée ? Mettez à jour engine.lock.json si c'est voulu.`,
      );
    }
    install(tmpPath, destPath);
  } finally {
    rmSync(tmpPath, { force: true });
  }

  process.stdout.write(`✓ ${entry.name} installé dans src-tauri/binaries/\n`);
}

main().catch((error) => {
  process.stderr.write(`\nfetch-engine : ${error.message}\n`);
  process.exit(1);
});
