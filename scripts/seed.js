/*
 * scripts/seed.js
 * -----------------------------------------------------------------------
 * Peuple la base avec des données de test/démonstration.
 *
 * Pourquoi un script séparé plutôt que des INSERT en dur dans schema.sql ?
 * Le mot de passe haché ne peut pas être écrit directement dans le SQL sans
 * risque d'erreur de copier-coller ou d'échappement shell (voir l'incident
 * du hash "$$2b$12$..." causé par un double $). En le générant ici avec
 * bcryptjs — la même librairie que authController.js — on garantit un hash
 * toujours valide et cohérent avec le reste de l'application.
 *
 * Rejouable à volonté : TRUNCATE ... RESTART IDENTITY CASCADE remet les
 * tables à zéro (données ET compteurs de séquence) avant de réinsérer.
 *
 * Usage : node scripts/seed.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { transaction, pool } = require('../src/config/db');
const logger = require('../src/config/logger');

// Mot de passe de démonstration pour les comptes de test.
const MOT_DE_PASSE_DEMO = process.env.DEMO_PASSWORD;
const ROUNDS_BCRYPT = 12; // même valeur que dans authController.js

async function seed() {
  // Un seul hash généré et réutilisé pour tous les comptes de démo —
  // suffisant ici puisque le mot de passe est identique pour tous.
  const motDePasseHache = await bcrypt.hash(MOT_DE_PASSE_DEMO, ROUNDS_BCRYPT);

  await transaction(async (client) => {
    // RESTART IDENTITY remet les SERIAL à 1 : les id générés ci-dessous
    // (utilisateur_id=4 pour Awa Diouf, etc.) restent donc valides.
    // CASCADE gère l'ordre de suppression malgré les clés étrangères.
    await client.query(`
      TRUNCATE TABLE
        reactions, appels, messages_statut, messages, tickets,
        factures, clients, forfaits, utilisateurs
      RESTART IDENTITY CASCADE
    `);

    const utilisateurs = [
      ['Sarr', 'Moussa', 'admin@senegalconnect.sn', 'admin'],
      ['Ndiaye', 'Fatou', 'agent1@senegalconnect.sn', 'agent'],
      ['Fall', 'Ibrahima', 'agent2@senegalconnect.sn', 'agent'],
      ['Diouf', 'Awa', 'awa.diouf@example.sn', 'client'],
      ['Gueye', 'Cheikh', 'cheikh.gueye@example.sn', 'client'],
      ['Mbaye', 'Aminata', 'aminata.mbaye@example.sn', 'client'],
      ['Sy', 'Ousmane', 'ousmane.sy@example.sn', 'client'],
      ['Ba', 'Khady', 'khady.ba@example.sn', 'client'],
    ];
    for (const [nom, prenom, email, role] of utilisateurs) {
      await client.query(
        `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [nom, prenom, email, motDePasseHache, role]
      );
    }

    const forfaits = [
      ['Forfait Sénégal Essentiel', 2, 100, 5000, true],
      ['Forfait Sénégal Confort', 10, 500, 15000, true],
      ['Forfait Sénégal Illimité', 50, 2000, 30000, true],
      ['Forfait Sénégal Diaspora', 20, 1000, 25000, true],
    ];
    for (const f of forfaits) {
      await client.query(
        `INSERT INTO forfaits (nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif)
         VALUES ($1, $2, $3, $4, $5)`,
        f
      );
    }

    const clients = [
      [4, '+221771234567', 2, 'actif'],
      [5, '+221781234567', 3, 'actif'],
      [6, '+221701234567', 1, 'suspendu'],
      [7, '+221761234567', 4, 'actif'],
      [8, '+221751234567', 2, 'resilie'],
    ];
    for (const c of clients) {
      await client.query(
        `INSERT INTO clients (utilisateur_id, msisdn, forfait_id, statut)
         VALUES ($1, $2, $3, $4)`,
        c
      );
    }

    const factures = [
      [1, 'FAC-202601-0001', '2026-01', 15000, 'payee', '2026-02-05'],
      [1, 'FAC-202602-0001', '2026-02', 15000, 'impayee', '2026-03-05'],
      [2, 'FAC-202601-0002', '2026-01', 30000, 'payee', '2026-02-05'],
      [3, 'FAC-202601-0003', '2026-01', 5000, 'en_retard', '2026-02-05'],
      [4, 'FAC-202602-0002', '2026-02', 25000, 'impayee', '2026-03-05'],
    ];
    for (const f of factures) {
      await client.query(
        `INSERT INTO factures (client_id, reference, periode, montant_fcfa, statut, date_echeance)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        f
      );
    }

    const tickets = [
      [1, 2, 'Facture FAC-202602-0001 incorrecte', 'en_cours'],
      [3, null, 'Demande de réactivation de ligne', 'ouvert'],
      [2, 3, 'Question sur le renouvellement de forfait', 'ferme'],
    ];
    for (const t of tickets) {
      await client.query(
        `INSERT INTO tickets (client_id, agent_id, sujet, statut)
         VALUES ($1, $2, $3, $4)`,
        t
      );
    }
  });

  logger.info('Seed terminé : données de test insérées avec succès.');
}

seed()
  .then(() => pool.end())
  .catch((erreur) => {
    logger.error(`Échec du seed : ${erreur.message}`);
    pool.end();
    process.exit(1);
  });