/**
 * src/config/swagger.js
 * -----------------------------------------------------------------------
 * Génère la spécification OpenAPI à partir des annotations @openapi
 * présentes dans les fichiers de routes (swagger-jsdoc les scanne), et
 * expose l'interface interactive Swagger UI.
 *
 * Pourquoi définir les schémas RÉUTILISABLES (Client, Forfait, Erreur...)
 * ici plutôt que de tout répéter dans chaque annotation de route ? DRY —
 * un seul endroit à maintenir si un champ change, et les routes restent
 * lisibles (elles référencent juste $ref: '#/components/schemas/Client').
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sénégal Connect — API',
      version: '1.0.0',
      description: "API REST d'un opérateur télécom sénégalais avec support client temps réel — Projet TCS L3 UAM Polytech Diamniadio",
    },
    servers: [{ url: '/api', description: 'Serveur local' }],
    components: {
      securitySchemes: {
        // Permet le bouton "Authorize" dans Swagger UI : on colle le JWT
        // une fois, il est réutilisé sur tous les essais "Try it out".
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Erreur: {
          type: 'object',
          properties: {
            erreur: { type: 'string', example: 'Message décrivant le problème.' },
            details: {
              type: 'object',
              properties: {
                champs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      champ: { type: 'string', example: 'msisdn' },
                      message: { type: 'string', example: 'MSISDN invalide (format attendu : +221XXXXXXXXX).' },
                    },
                  },
                },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limite: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 47 },
            totalPages: { type: 'integer', example: 3 },
          },
        },
        Client: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            nom: { type: 'string', example: 'Diouf' },
            prenom: { type: 'string', example: 'Awa' },
            email: { type: 'string', example: 'awa.diouf@example.sn' },
            msisdn: { type: 'string', example: '+221771234567' },
            statut: { type: 'string', enum: ['actif', 'suspendu', 'resilie'] },
            forfait_id: { type: 'integer', nullable: true, example: 2 },
            forfait_nom: { type: 'string', nullable: true, example: 'Forfait Sénégal Confort' },
            date_inscription: { type: 'string', format: 'date-time' },
          },
        },
        Forfait: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 2 },
            nom: { type: 'string', example: 'Forfait Sénégal Confort' },
            quota_data_go: { type: 'number', example: 10 },
            quota_voix_min: { type: 'integer', example: 500 },
            prix_mensuel_fcfa: { type: 'number', example: 15000 },
            actif: { type: 'boolean', example: true },
          },
        },
        Facture: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            client_id: { type: 'integer', example: 1 },
            reference: { type: 'string', example: 'FAC-202603-4821' },
            periode: { type: 'string', example: '2026-03' },
            montant_fcfa: { type: 'number', example: 15000 },
            statut: { type: 'string', enum: ['payee', 'impayee', 'en_retard'] },
            date_emission: { type: 'string', format: 'date-time' },
            date_echeance: { type: 'string', format: 'date' },
          },
        },
      },
    },
    // Sécurité par défaut sur TOUTES les routes documentées : chaque route
    // peut la surcharger, mais la majorité de l'API exige un JWT.
    security: [{ BearerAuth: [] }],
  },
  // Fichiers scannés à la recherche des blocs /** @openapi ... */
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);