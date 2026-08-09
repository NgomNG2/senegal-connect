/**
 * src/middleware/erreurs.js
 * -----------------------------------------------------------------------
 * Gestion centralisée des erreurs de l'API.
 *
 * Deux codes PostgreSQL distincts pour les violations de clé étrangère :
 *  - 23001 (restrict_violation)    : suppression bloquée par ON DELETE
 *    RESTRICT (ex: forfait encore utilisé par des clients) -> 409 Conflict
 *  - 23503 (foreign_key_violation) : insertion/modification référençant
 *    une clé inexistante (ex: forfait_id: 999999) -> 422 Unprocessable
 * Les deux codes sont normalisés par le standard SQL, on peut s'y fier
 * directement sans avoir besoin de deviner via le texte du message
 * (qui, lui, varie selon la version/locale de PostgreSQL).
 */

class ErreurApplicative extends Error {
  constructor(codeHttp, message, details = null) {
    super(message);
    this.codeHttp = codeHttp;
    this.details = details;
  }
}

function gestionnaireErreurs(err, req, res, next) {
  const logger = require('../config/logger');

  if (err instanceof ErreurApplicative) {
    logger.warn(`${err.codeHttp} — ${err.message}`);
    return res.status(err.codeHttp).json({
      erreur: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err.code === '23505') {
    logger.warn(`409 — Doublon en base : ${err.detail || err.message}`);
    return res.status(409).json({ erreur: 'Cette ressource existe déjà (doublon détecté).' });
  }

  // Suppression bloquée par ON DELETE RESTRICT
  if (err.code === '23001') {
    logger.warn(`409 — Suppression bloquée (RESTRICT) : ${err.message}`);
    return res.status(409).json({ erreur: "Impossible de supprimer : cette ressource est encore référencée par d'autres données." });
  }

  // Référence vers une clé inexistante, ou contrainte CHECK violée
  if (err.code === '23503' || err.code === '23514') {
    logger.warn(`422 — Contrainte BDD violée : ${err.detail || err.message}`);
    return res.status(422).json({ erreur: 'Donnée invalide (contrainte de base de données).' });
  }

  logger.error(`500 — Erreur non gérée : ${err.stack || err.message}`);
  const estProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    erreur: 'Erreur interne du serveur.',
    ...(estProd ? {} : { detail: err.message }),
  });
}

module.exports = { ErreurApplicative, gestionnaireErreurs };