/**
 * src/middleware/erreurs.js
 * -----------------------------------------------------------------------
 * Gestion centralisée des erreurs de l'API.
 *
 * Deux exports :
 *  - ErreurApplicative : classe d'erreur "métier" qu'on lève nous-mêmes
 *    dans les contrôleurs (ex: "ce ticket n'existe pas" -> 404).
 *  - gestionnaireErreurs : middleware Express À 4 PARAMÈTRES (err, req,
 *    res, next). C'est ce 4e paramètre qui dit à Express "ceci est un
 *    middleware de gestion d'erreurs" — sans lui, Express le traite comme
 *    un middleware normal et il ne sera jamais appelé sur une erreur.
 *
 * Toutes les routes de l'app appellent next(erreur) en cas de problème,
 * jamais res.status(...).json(...) directement pour une erreur — ça
 * centralise le format de réponse d'erreur en un seul endroit.
 */

class ErreurApplicative extends Error {
  /**
   * @param {number} codeHttp - ex: 404, 409, 422
   * @param {string} message - message lisible pour le client de l'API
   * @param {object} [details] - ex: { champs: [{ champ: 'msisdn', message: '...' }] }
   */
  constructor(codeHttp, message, details = null) {
    super(message);
    this.codeHttp = codeHttp;
    this.details = details;
  }
}

function gestionnaireErreurs(err, req, res, next) {
  const logger = require('../config/logger');

  // --- Cas 1 : erreur métier qu'on a levée nous-mêmes (ErreurApplicative) ---
  if (err instanceof ErreurApplicative) {
    logger.warn(`${err.codeHttp} — ${err.message}`);
    return res.status(err.codeHttp).json({
      erreur: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // --- Cas 2 : erreur PostgreSQL — on traduit le code d'erreur SQL en
  // code HTTP compréhensible pour le client de l'API. Codes PostgreSQL :
  //   23505 = unique_violation      (doublon)      -> 409 Conflict
  //   23503 = foreign_key_violation (FK invalide)   -> 422 Unprocessable Entity
  //   23514 = check_violation       (CHECK échoué)  -> 422 Unprocessable Entity
  if (err.code === '23505') {
    logger.warn(`409 — Doublon en base : ${err.detail || err.message}`);
    return res.status(409).json({ erreur: 'Cette ressource existe déjà (doublon détecté).' });
  }
  if (err.code === '23503' || err.code === '23514') {
    logger.warn(`422 — Contrainte BDD violée : ${err.detail || err.message}`);
    return res.status(422).json({ erreur: 'Donnée invalide (contrainte de base de données).' });
  }

  // --- Cas 3 : tout le reste — erreur inattendue (bug, panne réseau...).
  // JAMAIS renvoyer err.stack ou err.message brut au client en production
  // (fuite d'informations internes : chemins de fichiers, requêtes SQL...).
  logger.error(`500 — Erreur non gérée : ${err.stack || err.message}`);
  const estProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    erreur: 'Erreur interne du serveur.',
    ...(estProd ? {} : { detail: err.message }), // detail visible seulement hors prod, pour déboguer
  });
}

module.exports = { ErreurApplicative, gestionnaireErreurs };