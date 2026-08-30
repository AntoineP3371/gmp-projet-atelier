/****************************************************************************
 *  Impression 3D — point de dépôt / lecture des fichiers STEP sur Drive
 *  --------------------------------------------------------------------------
 *  À coller dans https://script.google.com  (Nouveau projet).
 *
 *  1) Créez un dossier dans votre Google Drive (ex. « Impressions 3D STEP »).
 *  2) Ouvrez-le : l'ID est la fin de l'URL
 *     https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXX  ← copiez XXXX
 *  3) Collez cet ID dans FOLDER_ID ci-dessous.
 *  4) Déployer > Nouveau déploiement > type « Application Web »
 *        - Exécuter en tant que : Moi
 *        - Qui a accès : Tout le monde
 *     Copiez l'URL /exec obtenue → à coller dans index.html (APPS_SCRIPT_URL).
 *
 *  NB : le client envoie le POST en text/plain pour éviter le pré-vol CORS
 *  (requête « simple ») — ne pas changer ce comportement côté index.html.
 ****************************************************************************/

var FOLDER_ID = 'COLLEZ_ICI_L_ID_DU_DOSSIER_DRIVE';

// -------- Dépôt d'un fichier (upload) --------------------------------------
// Options :
//   body.replaceByName       : supprime d'abord les fichiers existants du même nom (ex. photo de pièce).
//   body.subfolder           : nom d'un sous-dossier cible (créé s'il n'existe pas ; ex. "backups").
//   body.purgeOlderThanDays  : met à la corbeille les fichiers du dossier cible plus vieux que N jours.
//   body.private             : si true, NE PAS partager le fichier par lien (données sensibles = backups).
function doPost (e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var name     = body.name     || 'fichier.step';
    var mimeType = body.mimeType || 'application/octet-stream';
    var dataB64  = body.dataB64  || '';

    var folder = DriveApp.getFolderById(FOLDER_ID);

    // Sous-dossier optionnel (créé s'il n'existe pas).
    if (body.subfolder) {
      var subs = folder.getFoldersByName(body.subfolder);
      folder = subs.hasNext() ? subs.next() : folder.createFolder(body.subfolder);
    }

    // Purge optionnelle : corbeille les fichiers du dossier cible plus vieux que N jours.
    if (body.purgeOlderThanDays) {
      var cutoff = new Date().getTime() - Number(body.purgeOlderThanDays) * 24 * 60 * 60 * 1000;
      var it = folder.getFiles();
      while (it.hasNext()) {
        var old = it.next();
        if (old.getDateCreated().getTime() < cutoff) old.setTrashed(true);
      }
    }

    // Remplacement : met à la corbeille les anciens fichiers du même nom.
    if (body.replaceByName) {
      var existants = folder.getFilesByName(name);
      while (existants.hasNext()) { existants.next().setTrashed(true); }
    }

    var bytes = Utilities.base64Decode(dataB64);
    var blob  = Utilities.newBlob(bytes, mimeType, name);
    var file  = folder.createFile(blob);

    // Lien de consultation (lecture par lien) — SAUF fichiers privés (ex. sauvegardes).
    if (!body.private) {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
    }

    return json({ ok: true, id: file.getId(), link: file.getUrl(), name: name });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// -------- Lecture d'un fichier (pour réafficher la 3D) ----------------------
// GET ?id=<fileId>  → renvoie le contenu en base64
// GET ?ping=1       → test de fonctionnement
function doGet (e) {
  try {
    if (e && e.parameter && e.parameter.ping) {
      return json({ ok: true, pong: true });
    }
    var id = e.parameter.id;
    if (!id) return json({ ok: false, error: 'id manquant' });

    var file = DriveApp.getFileById(id);
    var blob = file.getBlob();
    return json({
      ok: true,
      name: file.getName(),
      mimeType: blob.getContentType() || 'application/octet-stream',
      dataB64: Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json (obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
