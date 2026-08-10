/**
 * src/routes/factures.js
 * -----------------------------------------------------------------------
 * Routes CRUD pour les factures. La validation express-validator s'exécute
 * AVANT le contrôleur : si un champ est invalide, on renvoie 422 avec le
 * détail par champ, sans même toucher à la base de données.    
 * 
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const facturesController = require('../controllers/facturesController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

router.get(
  /**
   * @openapi
   * /factures:
   *   get:
   *     summary: Liste paginée des factures, avec filtres
   *     tags: [Factures]
   *     security: [{ BearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limite
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *       - in: query
   *         name: client_id
   *         schema: { type: integer }
   *       - in: query
   *         name: statut
   *         schema: { type: string, enum: [payee, impayee, en_retard] }
   *       - in: query
   *         name: periode
   *         schema: { type: string, pattern: '^\d{4}-(0[1-9]|1[0-2])$' }
   *         description: Période au format YYYY-MM
   *     responses:
   *       200:
   *         description: Liste paginée des factures
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 donnees: { type: array, items: { $ref: '#/components/schemas/Facture' } }
   *                 pagination: { $ref: '#/components/schemas/Pagination' }
   *       401: { description: Token manquant/invalide/expiré }
   *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
   */
  '/',
  verifierJWT,
  [
    query('statut').optional().isIn(['payee', 'impayee', 'en_retard']),
    query('periode').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/),
  ],
  validerRequete,
  facturesController.liste
);

/**
 * @openapi
 * /factures/{id}:
 *   get:
 *     summary: Détail d'une facture
 *     tags: [Factures]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Facture trouvée
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { facture: { $ref: '#/components/schemas/Facture' } } }
 *       401: { description: Token manquant/invalide/expiré }
 *       404: { description: Facture introuvable, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.get(
    '/:id', 
    verifierJWT, 
    param('id').isInt(), 
    validerRequete, 
    facturesController.detail
);

/**
 * @openapi
 * /factures:
 *   post:
 *     summary: Créer une facture (admin/agent uniquement)
 *     tags: [Factures]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, periode, montant_fcfa, date_echeance]
 *             properties:
 *               client_id: { type: integer }
 *               periode: { type: string, pattern: '^\d{4}-(0[1-9]|1[0-2])$', example: '2026-03' }
 *               montant_fcfa: { type: number, minimum: 0 }
 *               date_echeance: { type: string, format: date }
 *     responses:
 *       201: { description: Facture créée, content: { application/json: { schema: { type: object, properties: { facture: { $ref: '#/components/schemas/Facture' } } } } } }
 *       403: { description: Rôle insuffisant (admin/agent uniquement) }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.post(
  '/',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    body('client_id').isInt(),
    body('periode').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Format période attendu : YYYY-MM.'),
    body('montant_fcfa').isFloat({ min: 0 }),
    body('date_echeance').isISO8601(),
  ],
  validerRequete,
  facturesController.creer
);

/**
 * @openapi
 * /factures/{id}/payer:
 *   patch:
 *     summary: Marquer une facture comme payée (admin/agent uniquement)
 *     tags: [Factures]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Facture marquée comme payée
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { facture: { $ref: '#/components/schemas/Facture' } } }
 *       403: { description: Rôle insuffisant (admin/agent uniquement) }
 *       404: { description: Facture introuvable }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.patch(
    '/:id/payer', 
    verifierJWT, 
    garderRole('admin', 'agent'), 
    param('id').isInt(), 
    validerRequete, 
    facturesController.marquerPayee
);

module.exports = router;