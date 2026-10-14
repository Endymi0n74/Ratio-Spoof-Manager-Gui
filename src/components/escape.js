// Échappement HTML partagé — source unique pour tout le frontend.
//
// Toute donnée venant du moteur, d'un nom de fichier, d'une saisie libre ou
// du localStorage est potentiellement hostile. Ne jamais interpoler ces
// valeurs dans `innerHTML` sans passer par ici.
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

export function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
