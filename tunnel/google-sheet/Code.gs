/**
 * Académie des Sorciers : réception et tri des candidatures dans un Google Sheet.
 *
 * Ce que fait ce script :
 * - Reçoit les réponses de la page de candidature en temps réel, une ligne par candidat :
 *   "Partielle" dès que WhatsApp et Instagram sont remplis, "Complète" à l'envoi.
 * - Donne une priorité selon l'argent (question 3), puisque l'argent est le premier critère :
 *   A · Prioritaire, B · À creuser, C · Pas prioritaire (réglable dans CONFIG.PRIORITE).
 * - Trie la file du setter à chaque nouvelle candidature complète : les "À contacter" en haut,
 *   les A d'abord, puis les plus anciennes (pour tenir les 48 h promises sur la page).
 * - Facultatif : fait lire chaque candidature complète par Claude (note du projet, résumé, alertes).
 *   Il faut une clé API Anthropic, voir tunnel/BRANCHEMENT.md.
 * - Signale si le candidat a cliqué sur "Confirmer sur WhatsApp" sur la page de remerciement.
 * - Envoie un e-mail à chaque candidature complète et, si besoin, un webhook (GoHighLevel, votre SaaS...).
 *
 * Les colonnes Suivi, Setter et Notes sont au setter : le script ne les écrase jamais.
 * Mise en place : voir tunnel/BRANCHEMENT.md.
 */

var CONFIG = {
  ONGLET: 'Candidatures',
  ONGLET_VISITES: 'Visites',
  ONGLET_STATS: 'Tableau de bord',
  // Adresses qui reçoivent un e-mail à chaque candidature complète. Ex. : ['marco@exemple.com']
  EMAILS: [],
  // Facultatif : webhooks entrants (GoHighLevel, votre SaaS, Zapier, Make...) qui reçoivent chaque candidature complète en JSON.
  WEBHOOKS: [],
  // Priorité selon la réponse à la question 3. À ajuster selon vos prix et votre expérience.
  PRIORITE: {
    'Moins de 2 000 €': 'C',
    '2 000 à 3 500 €': 'B',
    '3 500 à 5 000 €': 'B',
    '5 000 à 10 000 €': 'A',
    '10 000 à 30 000 €': 'A',
    'Plus de 30 000 €': 'A'
  },
  // Analyse par Claude : la clé se met dans Paramètres du projet > Propriétés du script, nom ANTHROPIC_API_KEY.
  MODELE: 'claude-opus-5-5'
};

var REVENUS = ['Moins de 2 000 €', '2 000 à 3 500 €', '3 500 à 5 000 €', '5 000 à 10 000 €', '10 000 à 30 000 €', 'Plus de 30 000 €'];
var LIBELLES = { A: 'A · Prioritaire', B: 'B · À creuser', C: 'C · Pas prioritaire' };
var COLONNES = [
  'Priorité', 'Reçue le', 'Suivi', 'Instagram', 'WhatsApp', 'Revenus mensuels', '4. Situation financière',
  'Analyse de Claude', 'Note projet', '1. Présentation', '2. Activité / idée', '5. Rapport aux réseaux',
  'WhatsApp confirmé', 'Statut', 'Source', 'Setter', 'Notes', 'Mise à jour', 'Score', 'ID'
];
var COL = {};
COLONNES.forEach(function (nom, i) { COL[nom] = i + 1; });
var SUIVI = ['À contacter', 'Contacté', 'Appel fixé', 'Closé', 'Pas qualifié', 'Injoignable'];
var EN_ATTENTE = 'Analyse en attente...';
var VIOLET = '#24123f', OR = '#c9a227', BRUME = '#f6f2fb', LILAS = '#e9e1f6';

// ======================================================================
// Installation
// ======================================================================

/** À lancer une fois, à la main, depuis l'éditeur. Peut être relancé sans risque. */
function installer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.ONGLET) || ss.insertSheet(CONFIG.ONGLET, 0);
  var max = sh.getMaxRows();
  if (sh.getMaxColumns() < COLONNES.length) sh.insertColumnsAfter(sh.getMaxColumns(), COLONNES.length - sh.getMaxColumns());

  sh.getRange(1, 1, 1, COLONNES.length).setValues([COLONNES])
    .setBackground(VIOLET).setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 42);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);

  var largeurs = { 'Priorité': 130, 'Reçue le': 120, 'Suivi': 125, 'Instagram': 140, 'WhatsApp': 140, 'Revenus mensuels': 130,
    '4. Situation financière': 240, 'Analyse de Claude': 320, 'Note projet': 80, '1. Présentation': 300, '2. Activité / idée': 300,
    '5. Rapport aux réseaux': 260, 'WhatsApp confirmé': 110, 'Statut': 90, 'Source': 150, 'Setter': 100, 'Notes': 260, 'Mise à jour': 120 };
  Object.keys(largeurs).forEach(function (k) { sh.setColumnWidth(COL[k], largeurs[k]); });

  sh.getRange(2, 1, max - 1, COLONNES.length).setWrap(true).setVerticalAlignment('top');
  ['Reçue le', 'Mise à jour'].forEach(function (k) { sh.getRange(2, COL[k], max - 1, 1).setNumberFormat('dd/mm HH:mm'); });
  sh.getRange(2, COL['Note projet'], max - 1, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.hideColumns(COL['Score']);
  sh.hideColumns(COL['ID']);

  sh.getRange(2, COL['Suivi'], max - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SUIVI, true).setAllowInvalid(false).build());

  // Couleurs
  var L = function (nom) { return '$' + colonneEnLettre(COL[nom]) + '2'; };
  var plage = function (nom) { return sh.getRange(2, COL[nom], max - 1, 1); };
  var toute = sh.getRange(2, 1, max - 1, COLONNES.length);
  var attente = '=AND(' + L('Statut') + '="Complète",' + L('Suivi') + '="À contacter",NOW()-' + L('Reçue le') + '>';
  var regles = [
    regle('=' + L('Statut') + '="Partielle"', [toute], null, '#8a849a', false, true),
    regle(attente + '2)', [plage('Reçue le')], '#a3261d', '#ffffff', true),
    regle(attente + '1)', [plage('Reçue le')], '#f6d9a8', '#6b4500', true),
    regleTexte('A · Prioritaire', plage('Priorité'), '#dcefe4', '#1f7a4d'),
    regleTexte('B · À creuser', plage('Priorité'), '#f9f1d9', '#8a6a0b'),
    regleTexte('C · Pas prioritaire', plage('Priorité'), '#eeeeee', '#5f5873'),
    regleTexte('Oui', plage('WhatsApp confirmé'), '#dcefe4', '#1f7a4d'),
    regleTexte('À contacter', plage('Suivi'), '#f9f1d9', '#8a6a0b'),
    regleTexte('Contacté', plage('Suivi'), LILAS, VIOLET),
    regleTexte('Appel fixé', plage('Suivi'), '#dcefe4', '#1f7a4d'),
    regleTexte('Closé', plage('Suivi'), VIOLET, OR),
    regleTexte('Pas qualifié', plage('Suivi'), '#f3e1df', '#a3261d'),
    regleTexte('Injoignable', plage('Suivi'), '#eeeeee', '#5f5873'),
    regle('=AND(ISNUMBER(' + L('Note projet') + '),' + L('Note projet') + '>=4)', [plage('Note projet')], '#dcefe4', '#1f7a4d', true),
    regle('=AND(ISNUMBER(' + L('Note projet') + '),' + L('Note projet') + '<=2)', [plage('Note projet')], '#f3e1df', '#a3261d', true)
  ];
  sh.setConditionalFormatRules(regles);
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, max, COLONNES.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(VIOLET).setFirstRowColor('#ffffff').setSecondRowColor(BRUME);

  installerVisites(ss);
  installerTableauDeBord(ss);
  if (cleApi()) activerAnalyse();
  ss.setActiveSheet(sh);
}

function regle(formule, plages, fond, texte, gras, italique) {
  var r = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formule).setRanges(plages);
  if (fond) r.setBackground(fond);
  if (texte) r.setFontColor(texte);
  if (gras) r.setBold(true);
  if (italique) r.setItalic(true);
  return r.build();
}
function regleTexte(valeur, plage, fond, texte) {
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(valeur).setBackground(fond).setFontColor(texte).setBold(true).setRanges([plage]).build();
}

function installerVisites(ss) {
  var v = ss.getSheetByName(CONFIG.ONGLET_VISITES) || ss.insertSheet(CONFIG.ONGLET_VISITES);
  v.getRange(1, 1, 1, 2).setValues([['Date', 'Source']]).setBackground(VIOLET).setFontColor('#ffffff').setFontWeight('bold');
  v.setFrozenRows(1);
  v.setColumnWidth(1, 140); v.setColumnWidth(2, 260);
  v.getRange(2, 1, v.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy HH:mm');
}

function installerTableauDeBord(ss) {
  var t = ss.getSheetByName(CONFIG.ONGLET_STATS) || ss.insertSheet(CONFIG.ONGLET_STATS, 1);
  t.clear();
  var C = "'" + CONFIG.ONGLET + "'!", V = "'" + CONFIG.ONGLET_VISITES + "'!";
  var c = function (nom) { var l = colonneEnLettre(COL[nom]); return C + l + '2:' + l; };
  var st = c('Statut'), dt = c('Reçue le'), su = c('Suivi'), pr = c('Priorité'), rv = c('Revenus mensuels'), wc = c('WhatsApp confirmé');
  var vi = V + 'A2:A', sem = '">="&(TODAY()-7)';

  var lignes = [
    ['Tableau de bord des candidatures', '', ''],
    ['', 'Depuis le début', '7 derniers jours'],
    ['Visites de la page', '=COUNTA(' + vi + ')', '=COUNTIF(' + vi + ',' + sem + ')'],
    ['Candidatures complètes', '=COUNTIF(' + st + ',"Complète")', '=COUNTIFS(' + st + ',"Complète",' + dt + ',' + sem + ')'],
    ['Candidatures partielles (abandons)', '=COUNTIF(' + st + ',"Partielle")', '=COUNTIFS(' + st + ',"Partielle",' + dt + ',' + sem + ')'],
    ['Taux de conversion (visite → candidature)', '=IFERROR(B4/B3,0)', '=IFERROR(C4/C3,0)'],
    ['Taux d\'abandon du questionnaire', '=IFERROR(B5/(B4+B5),0)', '=IFERROR(C5/(C4+C5),0)'],
    ['Ont confirmé sur WhatsApp', '=COUNTIFS(' + st + ',"Complète",' + wc + ',"Oui")', '=COUNTIFS(' + st + ',"Complète",' + wc + ',"Oui",' + dt + ',' + sem + ')'],
    ['En retard : à contacter depuis plus de 48 h', '=COUNTIFS(' + st + ',"Complète",' + su + ',"À contacter",' + dt + ',"<"&(NOW()-2))', ''],
    ['', '', ''],
    ['Priorité (candidatures complètes)', 'Nombre', '7 derniers jours']
  ];
  ['A · Prioritaire', 'B · À creuser', 'C · Pas prioritaire'].forEach(function (p) {
    lignes.push([p, '=COUNTIFS(' + st + ',"Complète",' + pr + ',"' + p + '")', '=COUNTIFS(' + st + ',"Complète",' + pr + ',"' + p + '",' + dt + ',' + sem + ')']);
  });
  lignes.push(['', '', '']);
  var tRevenus = lignes.length + 1;
  lignes.push(['Revenus mensuels (candidatures complètes)', 'Nombre', '']);
  REVENUS.forEach(function (r) { lignes.push([r, '=COUNTIFS(' + st + ',"Complète",' + rv + ',"' + r + '")', '']); });
  lignes.push(['', '', '']);
  var tSuivi = lignes.length + 1;
  lignes.push(['Suivi du setter', 'Nombre', '']);
  SUIVI.forEach(function (x) { lignes.push([x, '=COUNTIF(' + su + ',"' + x + '")', '']); });
  lignes.push(['', '', '']);
  var tSource = lignes.length + 1;
  lignes.push(['Candidatures complètes par source', '', '']);
  t.getRange(1, 1, lignes.length, 3).setValues(lignes);

  var debut = Math.min(COL['Statut'], COL['Source']), fin = Math.max(COL['Statut'], COL['Source']);
  var iStatut = COL['Statut'] - debut + 1, iSource = COL['Source'] - debut + 1;
  t.getRange(tSource + 1, 1).setFormula('=IFERROR(QUERY({' + C + colonneEnLettre(debut) + '2:' + colonneEnLettre(fin) + '},"select Col' + iSource +
    ', count(Col' + iStatut + ') where Col' + iStatut + ' = \'Complète\' group by Col' + iSource + ' label count(Col' + iStatut + ') \'\'",0),"Pas encore de données")');

  t.setColumnWidth(1, 380); t.setColumnWidth(2, 150); t.setColumnWidth(3, 150);
  t.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor(VIOLET);
  t.getRange('A2:C2').setFontWeight('bold').setFontColor('#5f5873');
  t.getRange('B3:C9').setFontSize(14).setFontWeight('bold').setFontColor(VIOLET).setHorizontalAlignment('center');
  t.getRange('B6:C7').setNumberFormat('0%');
  t.getRange('A3:C9').setBackground(BRUME);
  t.getRange('A9:B9').setFontColor('#a3261d');
  [11, tRevenus, tSuivi, tSource].forEach(function (r) { t.getRange(r, 1, 1, 3).setBackground(VIOLET).setFontColor('#ffffff').setFontWeight('bold'); });
  t.setFrozenRows(1);
}

/** Menu "Académie" dans le Google Sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Académie')
    .addItem('Trier la file du setter', 'trierFile')
    .addItem('Analyser les candidatures en attente', 'analyserEnAttente')
    .addSeparator()
    .addItem('Réinstaller la mise en forme', 'installer')
    .addToUi();
}

// ======================================================================
// Réception des données de la page
// ======================================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.site) return reponse({ ok: true }); // champ piège rempli : robot
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (d.type === 'visite') {
      var v = ss.getSheetByName(CONFIG.ONGLET_VISITES);
      if (!v) { installerVisites(ss); v = ss.getSheetByName(CONFIG.ONGLET_VISITES); }
      v.appendRow([new Date(), texte(String(d.source || '').slice(0, 300))]);
      return reponse({ ok: true });
    }
    if (!d.id || !/^[A-Za-z0-9-]{8,64}$/.test(String(d.id))) return reponse({ ok: false, erreur: 'id' });

    var sh = ss.getSheetByName(CONFIG.ONGLET);
    if (!sh) { installer(); sh = ss.getSheetByName(CONFIG.ONGLET); }
    var ligne = trouveLigne(sh, d.id);

    if (d.type === 'whatsapp') {
      if (ligne > 0) ecrire(sh, ligne, { 'WhatsApp confirmé': 'Oui', 'Mise à jour': new Date() });
      return reponse({ ok: true });
    }

    var nouvelle = ligne === -1;
    if (nouvelle) ligne = Math.max(sh.getLastRow(), 1) + 1;
    var dejaComplete = !nouvelle && sh.getRange(ligne, COL['Statut']).getValue() === 'Complète';
    var complete = d.statut === 'complète' || dejaComplete;
    var maintenant = new Date();

    var instagram = String(d.instagram || '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
    var chiffres = String(d.whatsapp || '').replace(/\D/g, '').slice(0, 15);
    var lettre = complete ? (CONFIG.PRIORITE[d.q3] || '') : '';

    var valeurs = {
      'Statut': complete ? 'Complète' : 'Partielle',
      'Priorité': lettre ? LIBELLES[lettre] : (complete ? '' : 'Partielle'),
      'Instagram': instagram ? '=HYPERLINK("https://www.instagram.com/' + instagram + '/","@' + instagram + '")' : '',
      'WhatsApp': chiffres ? '=HYPERLINK("https://wa.me/' + chiffres + '","+' + chiffres + '")' : '',
      'Revenus mensuels': texte(d.q3),
      '4. Situation financière': texte(d.q4),
      '1. Présentation': texte(d.q1),
      '2. Activité / idée': texte(d.q2),
      '5. Rapport aux réseaux': texte(d.q5),
      'Source': texte(d.source),
      'Mise à jour': maintenant,
      'Score': score(lettre, d.q3, complete)
    };
    if (nouvelle) {
      valeurs['Reçue le'] = maintenant;
      valeurs['Suivi'] = 'À contacter';
      valeurs['ID'] = String(d.id);
    }
    if (complete && !dejaComplete) {
      valeurs['Reçue le'] = maintenant; // le délai de 48 h part de l'envoi complet
      if (cleApi()) valeurs['Analyse de Claude'] = EN_ATTENTE;
    }
    ecrire(sh, ligne, valeurs);

    if (complete && !dejaComplete) {
      SpreadsheetApp.flush();
      prevenir(d, instagram, chiffres, lettre ? LIBELLES[lettre] : '', ss.getUrl());
      trierFile();
    }
    return reponse({ ok: true });
  } catch (err) {
    console.error(err);
    return reponse({ ok: false });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function doGet() {
  return reponse({ ok: true, service: 'Candidatures Académie des Sorciers' });
}

function ecrire(sh, ligne, valeurs) {
  Object.keys(valeurs).forEach(function (nom) {
    var cellule = sh.getRange(ligne, COL[nom]), v = valeurs[nom];
    if (typeof v === 'string' && v.charAt(0) === '=') cellule.setFormula(v); else cellule.setValue(v);
  });
}

function score(lettre, revenus, complete) {
  if (!complete) return 0;
  var base = { A: 300, B: 200, C: 100 }[lettre] || 0;
  return base + Math.max(0, REVENUS.indexOf(revenus)) * 10;
}

function trouveLigne(sh, id) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  var ids = sh.getRange(2, COL['ID'], n, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// Une réponse commençant par = + - @ ne doit pas être lue comme une formule.
function texte(v) {
  var s = String(v == null ? '' : v).slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ======================================================================
// Tri de la file du setter
// ======================================================================

/**
 * Ordre : complètes à contacter d'abord ; dans ce groupe, priorité A puis B puis C,
 * puis meilleure note projet, puis la plus ancienne (pour respecter les 48 h).
 * Ensuite les autres candidatures complètes (déjà traitées), puis les partielles.
 */
function trierFile() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ONGLET);
  var n = sh.getLastRow() - 1;
  if (n < 2) return;
  var plage = sh.getRange(2, 1, n, COLONNES.length);
  var valeurs = plage.getValues(), formules = plage.getFormulas();
  var lignes = valeurs.map(function (v, i) { return v.map(function (x, j) { return formules[i][j] || x; }); });
  var g = function (l, nom) { return l[COL[nom] - 1]; };
  var groupe = function (l) {
    if (g(l, 'Statut') !== 'Complète') return 2;
    return g(l, 'Suivi') === 'À contacter' ? 0 : 1;
  };
  lignes.sort(function (a, b) {
    var ga = groupe(a), gb = groupe(b);
    if (ga !== gb) return ga - gb;
    var sa = Number(g(a, 'Score')) || 0, sb = Number(g(b, 'Score')) || 0;
    if (sa !== sb) return sb - sa;
    var na = Number(g(a, 'Note projet')) || 0, nb = Number(g(b, 'Note projet')) || 0;
    if (na !== nb) return nb - na;
    var da = new Date(g(a, 'Reçue le')).getTime() || 0, db = new Date(g(b, 'Reçue le')).getTime() || 0;
    return ga === 0 ? da - db : db - da;
  });
  plage.setValues(lignes);
}

// ======================================================================
// Analyse facultative par Claude
// ======================================================================

function cleApi() {
  return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '';
}

/** À lancer une fois après avoir mis la clé : analyse les candidatures en attente toutes les minutes. */
function activerAnalyse() {
  var existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'analyserEnAttente'; });
  if (!existe) ScriptApp.newTrigger('analyserEnAttente').timeBased().everyMinutes(1).create();
}

var CONSIGNES = [
  "Tu aides le setter de L'Académie des Sorciers à trier des candidatures.",
  "L'Académie accompagne des entrepreneurs, coachs, consultants, artisans et prestataires qui ont une activité mais restent invisibles en ligne : elle leur apprend à gagner en visibilité avec de courtes vidéos où ils se montrent, puis à transformer cette visibilité en clients. Elle accepte aussi des porteurs de projet pas encore lancés.",
  "L'accompagnement est payant. Le premier critère est l'argent : si la personne ne peut pas investir, la candidature n'est pas à appeler, même si le projet est bon. Le second critère est la qualité du projet : une activité claire, des clients identifiés, une vraie envie de se montrer.",
  "Tu reçois les réponses d'un candidat. Évalue-le uniquement à partir de ce qu'il a écrit. N'invente rien. Si une réponse est vague, dis-le.",
  "Écris en français, phrases courtes, sans tiret cadratin."
].join('\n\n');

var SCHEMA = {
  type: 'object',
  properties: {
    note_projet: { type: 'integer', description: 'Qualité et clarté du projet, de 1 (flou ou absent) à 5 (activité claire, clients identifiés, envie de se montrer).' },
    capacite_a_investir: { type: 'string', enum: ['Bonne', 'Moyenne', 'Faible', 'Inconnue'], description: 'D\'après les revenus et la situation financière décrite.' },
    recommandation: { type: 'string', enum: ['Appeler en priorité', 'À qualifier', 'Ne pas contacter'] },
    resume: { type: 'string', description: 'Qui est la personne et ce qu\'elle veut, en deux phrases maximum.' },
    alertes: { type: 'string', description: 'Ce qui doit faire hésiter le setter (réponse vague, pas d\'argent, projet flou...). Chaîne vide s\'il n\'y en a pas.' }
  },
  required: ['note_projet', 'capacite_a_investir', 'recommandation', 'resume', 'alertes'],
  additionalProperties: false
};

/** Analyse jusqu'à 5 candidatures en attente par passage. */
function analyserEnAttente() {
  var cle = cleApi();
  if (!cle) return;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ONGLET);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var valeurs = sh.getRange(2, 1, n, COLONNES.length).getValues();
  var g = function (l, nom) { return l[COL[nom] - 1]; };
  var faites = 0;
  for (var i = 0; i < valeurs.length && faites < 5; i++) {
    if (g(valeurs[i], 'Analyse de Claude') !== EN_ATTENTE) continue;
    var ligne = i + 2;
    try {
      var a = analyser(cle, {
        revenus: g(valeurs[i], 'Revenus mensuels'), presentation: g(valeurs[i], '1. Présentation'),
        activite: g(valeurs[i], '2. Activité / idée'), finances: g(valeurs[i], '4. Situation financière'),
        reseaux: g(valeurs[i], '5. Rapport aux réseaux')
      });
      // L'argent reste éliminatoire : une priorité C n'est jamais "Appeler en priorité".
      var prio = g(valeurs[i], 'Priorité');
      if (prio === LIBELLES.C && a.recommandation === 'Appeler en priorité') a.recommandation = 'À qualifier';
      var note = Math.min(5, Math.max(1, Math.round(Number(a.note_projet) || 1)));
      var lignesTexte = [a.recommandation.toUpperCase(), 'Capacité à investir : ' + a.capacite_a_investir, a.resume];
      if (a.alertes) lignesTexte.push('À surveiller : ' + a.alertes);
      ecrire(sh, ligne, { 'Analyse de Claude': texte(lignesTexte.join('\n')), 'Note projet': note });
    } catch (err) {
      console.error('Analyse ligne ' + ligne + ' : ' + err);
      ecrire(sh, ligne, { 'Analyse de Claude': 'Analyse impossible : ' + String(err.message || err).slice(0, 200) });
    }
    faites++;
  }
  if (faites) trierFile();
}

function analyser(cle, r) {
  var message = [
    'Revenus mensuels / chiffre d\'affaires : ' + r.revenus,
    '1. Présentation : ' + r.presentation,
    '2. Activité ou idée : ' + r.activite,
    '4. Situation financière : ' + r.finances,
    '5. Rapport aux réseaux sociaux : ' + r.reseaux
  ].join('\n\n');
  var corps = {
    model: CONFIG.MODELE,
    max_tokens: 4000,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: CONSIGNES,
    messages: [{ role: 'user', content: message }]
  };
  var rep = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(corps)
  });
  var code = rep.getResponseCode();
  var json = JSON.parse(rep.getContentText() || '{}');
  if (code !== 200) throw new Error('API ' + code + ' : ' + ((json.error && json.error.message) || ''));
  if (json.stop_reason === 'refusal') throw new Error('refus du modèle');
  var blocs = (json.content || []).filter(function (b) { return b.type === 'text'; });
  if (!blocs.length) throw new Error('réponse vide (' + json.stop_reason + ')');
  return JSON.parse(blocs[blocs.length - 1].text);
}

// ======================================================================
// Alertes
// ======================================================================

function prevenir(d, instagram, chiffres, priorite, urlSheet) {
  if (CONFIG.EMAILS.length) {
    var h = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var corps =
      '<div style="font-family:Arial,sans-serif;color:#1d1730;max-width:600px">' +
      '<h2 style="color:#24123f">Nouvelle candidature : @' + h(instagram) + '</h2>' +
      '<p style="font-size:16px"><b>' + h(priorite) + '</b> · ' + h(d.q3) + '</p>' +
      '<p><b>WhatsApp :</b> <a href="https://wa.me/' + h(chiffres) + '">+' + h(chiffres) + '</a><br>' +
      '<b>Instagram :</b> <a href="https://www.instagram.com/' + h(instagram) + '/">@' + h(instagram) + '</a></p>' +
      '<p><b>4. Situation financière</b><br>' + h(d.q4) + '</p>' +
      '<p><b>1. Présentation</b><br>' + h(d.q1) + '</p>' +
      '<p><b>2. Activité / idée</b><br>' + h(d.q2) + '</p>' +
      '<p><b>5. Rapport aux réseaux</b><br>' + h(d.q5) + '</p>' +
      '<p style="color:#5f5873">Source : ' + h(d.source) + '</p>' +
      '<p><a href="' + urlSheet + '">Ouvrir le Google Sheet</a></p></div>';
    MailApp.sendEmail({ to: CONFIG.EMAILS.join(','), subject: priorite + ' · Nouvelle candidature : @' + instagram, htmlBody: corps });
  }
  CONFIG.WEBHOOKS.forEach(function (url) {
    try {
      UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          instagram: instagram, instagram_url: 'https://www.instagram.com/' + instagram + '/', phone: '+' + chiffres,
          priorite: priorite, revenus_mensuels: d.q3, presentation: d.q1, activite: d.q2,
          situation_financiere: d.q4, rapport_reseaux: d.q5, source: d.source, id: d.id, recu_le: new Date().toISOString()
        })
      });
    } catch (e) { console.error('Webhook ' + url + ' : ' + e); }
  });
}

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function colonneEnLettre(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Test manuel depuis l'éditeur : écrit une fausse candidature complète (à supprimer ensuite). */
function testerUneCandidature() {
  var r = doPost({ postData: { contents: JSON.stringify({
    type: 'candidature', id: 'test-' + Date.now(), statut: 'complète', whatsapp: '+33612345678', instagram: 'test.candidat',
    q1: 'Coach sportif indépendant depuis 6 ans.', q2: 'Je fais du coaching en entreprise, 12 clients réguliers.',
    q3: '5 000 à 10 000 €', q4: 'Stable, je peux investir dans mon développement.', q5: 'Jamais posté de vidéo.', source: 'test manuel'
  }) } });
  console.log(r.getContent());
}
