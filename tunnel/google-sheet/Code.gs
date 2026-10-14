/**
 * Académie des Sorciers : réception des candidatures dans un Google Sheet.
 *
 * Ce script reçoit les réponses de la page de candidature et les écrit dans l'onglet
 * "Candidatures", en temps réel. Une ligne par candidat :
 * - "Partielle" dès que WhatsApp et Instagram sont remplis (même si la personne abandonne),
 * - "Complète" quand elle clique sur le bouton d'envoi.
 * Les colonnes Setter, Suivi et Notes sont pour le setter : le script n'y touche jamais.
 *
 * Mise en place : voir tunnel/BRANCHEMENT.md.
 */

var CONFIG = {
  ONGLET: 'Candidatures',
  // Adresses qui reçoivent un e-mail à chaque candidature complète. Ex. : ['marco@exemple.com', 'louis@exemple.com']
  EMAILS: [],
  // Facultatif : URL d'un webhook entrant (GoHighLevel, votre SaaS, Zapier, Make...). Reçoit chaque candidature complète en JSON.
  WEBHOOKS: []
};

var COLONNES = [
  'Reçue le', 'Statut', 'Instagram', 'WhatsApp', 'Revenus mensuels',
  '1. Présentation', '2. Activité / idée', '4. Situation financière', '5. Rapport aux réseaux',
  'Source', 'Mise à jour', 'Setter', 'Suivi', 'Notes', 'ID'
];
var COL = {};
COLONNES.forEach(function (nom, i) { COL[nom] = i + 1; });
var COLONNES_SCRIPT = 11; // de "Reçue le" à "Mise à jour" : écrites par le script
var SUIVI = ['À contacter', 'Contacté', 'Appel fixé', 'Closé', 'Pas qualifié', 'Injoignable'];

var VIOLET = '#24123f', OR = '#c9a227', BRUME = '#f6f2fb', LILAS = '#e9e1f6';

/** À lancer une fois, à la main, depuis l'éditeur : crée et met en forme l'onglet. */
function installer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.ONGLET) || ss.insertSheet(CONFIG.ONGLET, 0);
  sh.getRange(1, 1, 1, COLONNES.length).setValues([COLONNES])
    .setBackground(VIOLET).setFontColor('#ffffff').setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 40);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);

  var largeurs = { 'Reçue le': 130, 'Statut': 95, 'Instagram': 150, 'WhatsApp': 150, 'Revenus mensuels': 140,
    '1. Présentation': 320, '2. Activité / idée': 320, '4. Situation financière': 260, '5. Rapport aux réseaux': 300,
    'Source': 160, 'Mise à jour': 130, 'Setter': 110, 'Suivi': 130, 'Notes': 280, 'ID': 90 };
  Object.keys(largeurs).forEach(function (k) { sh.setColumnWidth(COL[k], largeurs[k]); });

  var max = sh.getMaxRows();
  sh.getRange(2, 1, max - 1, COLONNES.length).setWrap(true).setVerticalAlignment('top');
  sh.getRange(2, COL['Reçue le'], max - 1, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  sh.getRange(2, COL['Mise à jour'], max - 1, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  sh.hideColumns(COL['ID']);

  // Menu déroulant de suivi pour le setter
  var regle = SpreadsheetApp.newDataValidation().requireValueInList(SUIVI, true).setAllowInvalid(false).build();
  sh.getRange(2, COL['Suivi'], max - 1, 1).setDataValidation(regle);

  // Couleurs : candidatures partielles en gris, suivi coloré
  var plage = sh.getRange(2, 1, max - 1, COLONNES.length);
  var lettreStatut = colonneEnLettre(COL['Statut']);
  var regles = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + lettreStatut + '2="Partielle"')
      .setFontColor('#8a849a').setItalic(true).setRanges([plage]).build(),
    regleSuivi('À contacter', '#f9f1d9', '#8a6a0b', sh),
    regleSuivi('Contacté', LILAS, VIOLET, sh),
    regleSuivi('Appel fixé', '#dcefe4', '#1f7a4d', sh),
    regleSuivi('Closé', VIOLET, OR, sh),
    regleSuivi('Pas qualifié', '#f3e1df', '#a3261d', sh),
    regleSuivi('Injoignable', '#eeeeee', '#5f5873', sh)
  ];
  sh.setConditionalFormatRules(regles);
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, max, COLONNES.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(VIOLET).setFirstRowColor('#ffffff').setSecondRowColor(BRUME);
}

function regleSuivi(valeur, fond, texte, sh) {
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(valeur)
    .setBackground(fond).setFontColor(texte).setBold(true)
    .setRanges([sh.getRange(2, COL['Suivi'], sh.getMaxRows() - 1, 1)]).build();
}

/** Point d'entrée : la page envoie ici chaque candidature (partielle ou complète). */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.site) return reponse({ ok: true }); // champ piège rempli : robot
    if (!d.id || !/^[A-Za-z0-9-]{8,64}$/.test(String(d.id))) return reponse({ ok: false, erreur: 'id' });

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ONGLET);
    if (!sh) { installer(); sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ONGLET); }

    var ligne = trouveLigne(sh, d.id);
    var nouvelle = ligne === -1;
    if (nouvelle) ligne = sh.getLastRow() + 1;

    var avant = nouvelle ? null : sh.getRange(ligne, 1, 1, COLONNES_SCRIPT).getValues()[0];
    var dejaComplete = avant && avant[COL['Statut'] - 1] === 'Complète';
    var statut = (d.statut === 'complète' || dejaComplete) ? 'Complète' : 'Partielle';
    var maintenant = new Date();

    var instagram = String(d.instagram || '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
    var whatsapp = String(d.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 16);

    var valeurs = [
      avant ? avant[0] : maintenant,
      statut,
      '', // Instagram : formule lien, plus bas
      '', // WhatsApp : formule lien, plus bas
      texte(d.q3),
      texte(d.q1), texte(d.q2), texte(d.q4), texte(d.q5),
      texte(d.source),
      maintenant
    ];
    var plage = sh.getRange(ligne, 1, 1, COLONNES_SCRIPT);
    plage.setValues([valeurs]);

    sh.getRange(ligne, COL['Instagram']).setFormula(instagram
      ? '=HYPERLINK("https://www.instagram.com/' + instagram + '/","@' + instagram + '")' : '');
    var chiffres = whatsapp.replace(/\D/g, '');
    sh.getRange(ligne, COL['WhatsApp']).setFormula(chiffres
      ? '=HYPERLINK("https://wa.me/' + chiffres + '","+' + chiffres + '")' : '');
    if (nouvelle) {
      sh.getRange(ligne, COL['ID']).setValue(String(d.id));
      sh.getRange(ligne, COL['Suivi']).setValue('À contacter');
    }

    if (statut === 'Complète' && !dejaComplete) {
      SpreadsheetApp.flush();
      prevenir(d, instagram, whatsapp, sh.getParent().getUrl());
    }
    return reponse({ ok: true });
  } catch (err) {
    console.error(err);
    return reponse({ ok: false });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Permet de vérifier dans un navigateur que l'adresse du script répond. */
function doGet() {
  return reponse({ ok: true, service: 'Candidatures Académie des Sorciers' });
}

function trouveLigne(sh, id) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  var ids = sh.getRange(2, COL['ID'], n, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// Empêche une réponse commençant par = + - @ d'être lue comme une formule.
function texte(v) {
  var s = String(v == null ? '' : v).slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function prevenir(d, instagram, whatsapp, urlSheet) {
  if (CONFIG.EMAILS.length) {
    var h = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var corps =
      '<div style="font-family:Arial,sans-serif;color:#1d1730;max-width:600px">' +
      '<h2 style="color:#24123f">Nouvelle candidature : @' + h(instagram) + '</h2>' +
      '<p><b>WhatsApp :</b> <a href="https://wa.me/' + h(whatsapp.replace(/\D/g, '')) + '">' + h(whatsapp) + '</a><br>' +
      '<b>Instagram :</b> <a href="https://www.instagram.com/' + h(instagram) + '/">@' + h(instagram) + '</a><br>' +
      '<b>Revenus mensuels :</b> ' + h(d.q3) + '</p>' +
      '<p><b>1. Présentation</b><br>' + h(d.q1) + '</p>' +
      '<p><b>2. Activité / idée</b><br>' + h(d.q2) + '</p>' +
      '<p><b>4. Situation financière</b><br>' + h(d.q4) + '</p>' +
      '<p><b>5. Rapport aux réseaux</b><br>' + h(d.q5) + '</p>' +
      '<p style="color:#5f5873">Source : ' + h(d.source) + '</p>' +
      '<p><a href="' + urlSheet + '">Ouvrir le Google Sheet</a></p></div>';
    MailApp.sendEmail({ to: CONFIG.EMAILS.join(','), subject: 'Nouvelle candidature : @' + instagram + ' (' + (d.q3 || '?') + ')', htmlBody: corps });
  }
  CONFIG.WEBHOOKS.forEach(function (url) {
    try {
      UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          instagram: instagram, instagram_url: 'https://www.instagram.com/' + instagram + '/',
          phone: whatsapp, revenus_mensuels: d.q3, presentation: d.q1, activite: d.q2,
          situation_financiere: d.q4, rapport_reseaux: d.q5, source: d.source, id: d.id,
          recu_le: new Date().toISOString()
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

/** Test manuel depuis l'éditeur : écrit une fausse candidature complète (à supprimer ensuite dans le Sheet). */
function testerUneCandidature() {
  var r = doPost({ postData: { contents: JSON.stringify({
    id: 'test-' + Date.now(), statut: 'complète', whatsapp: '+33612345678', instagram: 'test.candidat',
    q1: 'Test', q2: 'Test', q3: '2 000 à 3 500 €', q4: 'Test', q5: 'Test', source: 'test manuel'
  }) } });
  console.log(r.getContent());
}
