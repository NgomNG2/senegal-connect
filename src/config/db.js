/*
 * src/config/db.js
 * -----------------------------------------------------------------------
 * Pool de connexions PostgreSQL centralisé.
 *
 * Pourquoi un pool plutôt qu'une connexion unique ?
 * Chaque requête HTTP peut arriver en parallèle (Node.js est mono-thread
 * mais non-bloquant) : un pool permet de réutiliser un nombre limité de
 * connexions TCP vers PostgreSQL au lieu d'en ouvrir/fermer une par requête,
 * ce qui serait très coûteux en latence.
 *
 * Pourquoi exposer query() et transaction() plutôt que le pool brut ?
 * Cela évite que les contrôleurs manipulent des connexions PostgreSQL
 * directement (fuite de connexion si on oublie un client.release()).
 * Toute la gestion du cycle de vie (acquire/release, BEGIN/COMMIT/ROLLBACK)
 * est centralisée ici, un seul endroit à auditer/tester.
*/

const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  // Les paramètres sont fournis par les variables d'environnement afin de
  // ne jamais stocker les identifiants de la base de données dans le code.
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  max: 20, // nombre max de connexions simultanées dans le pool
  idleTimeoutMillis: 30000, // ferme les connexions inactives après 30s
  connectionTimeoutMillis: 5000, // échoue si pas de connexion dispo sous 5s
});

pool.on('error', (erreur) => {
  // Signale les erreurs des connexions inactives gérées par le pool.
  logger.error(`Erreur inattendue sur le pool PostgreSQL : ${erreur.message}`);
});

/**
 * Exécute une requête avec une connexion gérée automatiquement par le pool.
 * @param {string} texte Requête SQL à exécuter.
 * @param {Array} [params] Valeurs des paramètres de la requête préparée.
 * @returns {Promise<import('pg').QueryResult>} Résultat PostgreSQL.
 */
async function query(texte, params) {
  const debut = Date.now();
  const resultat = await pool.query(texte, params);
  const duree = Date.now() - debut;
  logger.debug(`SQL (${duree}ms) : ${texte.replace(/\s+/g, ' ').trim()}`);
  return resultat;
}

/**
 * Exécute plusieurs opérations dans une transaction atomique.
 * La transaction est validée si le callback réussit et annulée en cas
 * d'erreur. La connexion est toujours rendue au pool.
 * @param {function(import('pg').PoolClient): Promise<*>} callback Opérations à exécuter.
 * @returns {Promise<*>} Valeur retournée par le callback.
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await callback(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    // Toujours libérer la connexion au pool, même en cas d'erreur.
    client.release();
  }
}

module.exports = { query, transaction, pool };