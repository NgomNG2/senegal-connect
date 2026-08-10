/**
 * scripts/reset-db.js
 * -----------------------------------------------------------------------
 * Remet la base de données à l'état initial : supprime toutes les tables
 * puis les recrée entièrement depuis docs/schema.sql (structure + données
 * de démo), exactement comme `psql -f docs/schema.sql` le ferait à la main.
 *
 * Usage : npm run db:reset
 *
 * ⚠️ NE JAMAIS lancer ce script contre une base de production — il efface
 * tout. Utilisation en développement uniquement, avant une session de
 * tests, pour repartir d'un état connu et reproductible.
 *
 * Pourquoi DROP + rejouer le fichier ENTIER plutôt que TRUNCATE + extraire
 * seulement la section INSERT ? La première version de ce script coupait
 * le fichier au texte "INSERT INTO" trouvé avec indexOf() — fragile, et
 * dépendant du contenu exact du fichier. En rejouant le fichier complet
 * (CREATE TABLE + INSERT), on obtient exactement le même résultat que la
 * commande manuelle déjà validée (psql -f docs/schema.sql), sans logique
 * de découpage de texte à maintenir.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const TABLES = [
  'reactions', 'appels', 'messages_statut', 'messages',
  'tickets', 'factures', 'clients', 'forfaits', 'utilisateurs',
];

async function reset() {
  const client = await pool.connect();
  try {
    console.log('🧹 Suppression de toutes les tables existantes...');
    await client.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
    console.log('✅ Tables supprimées.');

    console.log('🌱 Recréation du schéma depuis docs/schema.sql...');
    const cheminSchema = path.join(__dirname, '..', 'docs', 'schema.sql');
    const contenuComplet = fs.readFileSync(cheminSchema, 'utf8');

    // client.query() avec un texte brut (pas de tableau de paramètres) utilise
    // le "simple query protocol" de PostgreSQL, qui accepte plusieurs
    // instructions séparées par des points-virgules en un seul appel.
    await client.query(contenuComplet);

    console.log('✅ Schéma recréé avec succès. La base est maintenant dans l’état initial.');
  } finally {
    client.release();
    await pool.end();
  }
}

reset()
  .then(() => {
    console.log('🎉 Base de données réinitialisée avec succès.');
    process.exit(0);
  })
  .catch((erreur) => {
    console.error('❌ Échec du reset :', erreur.message);
    process.exit(1);
  });