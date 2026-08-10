/**
 * src/routes/clients.js
 * -----------------------------------------------------------------------
 * Toutes les routes nécessitent un JWT valide. La création/modification/
 * suppression sont en plus réservées aux rôles admin/agent — un client ne
 * doit pas pouvoir créer ou supprimer des fiches clients lui-même.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const clientsController = require('../controllers/clientsController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

/**
 * @openapi
 * /clients:
 *   get:
 *     summary: Liste paginée des clients, avec filtres
 *     tags: [Clients]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limite
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Recherche sur nom, prénom ou MSISDN
 *       - in: query
 *         name: forfait_id
 *         schema: { type: integer }
 *       - in: query
 *         name: statut
 *         schema: { type: string, enum: [actif, suspendu, resilie] }
 *     responses:
 *       200:
 *         description: Liste paginée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 donnees: { type: array, items: { $ref: '#/components/schemas/Client' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { description: Token manquant/invalide/expiré }
 */
router.get(
  '/',
  verifierJWT,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limite').optional().isInt({ min: 1, max: 100 }),
    query('statut').optional().isIn(['actif', 'suspendu', 'resilie']),
  ],
  validerRequete,
  clientsController.liste
);

/**
 * @openapi
 * /clients/{id}:
 *   get:
 *     summary: Détail d'un client
 *     tags: [Clients]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Client trouvé
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { client: { $ref: '#/components/schemas/Client' } } }
 *       404: { description: Client introuvable, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.get('/:id', verifierJWT, param('id').isInt(), validerRequete, clientsController.detail);

/**
 * @openapi
 * /clients:
 *   post:
 *     summary: Créer un client (admin/agent uniquement)
 *     tags: [Clients]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, prenom, email, mot_de_passe, msisdn]
 *             properties:
 *               nom: { type: string }
 *               prenom: { type: string }
 *               email: { type: string, format: email }
 *               mot_de_passe: { type: string, minLength: 8 }
 *               msisdn: { type: string, example: '+221771234567' }
 *               forfait_id: { type: integer }
 *     responses:
 *       201: { description: Client créé, content: { application/json: { schema: { type: object, properties: { client: { $ref: '#/components/schemas/Client' } } } } } }
 *       403: { description: Rôle insuffisant }
 *       409: { description: MSISDN ou email déjà utilisé, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.post(
  '/',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    body('nom').trim().notEmpty().withMessage('Le nom est requis.'),
    body('prenom').trim().notEmpty().withMessage('Le prénom est requis.'),
    body('email').isEmail().withMessage('Email invalide.').normalizeEmail(),
    body('mot_de_passe').isLength({ min: 8 }).withMessage('Mot de passe : 8 caractères minimum.'),
    body('msisdn')
      .matches(/^\+221[0-9]{9}$/)
      .withMessage('MSISDN invalide (format attendu : +221XXXXXXXXX).'),
    body('forfait_id').optional().isInt(),
  ],
  validerRequete,
  clientsController.creer
);

/**
 * @openapi
 * /clients/{id}:
 *   put:
 *     summary: Modifier le statut/forfait d'un client (admin/agent)
 *     tags: [Clients]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               forfait_id: { type: integer }
 *               statut: { type: string, enum: [actif, suspendu, resilie] }
 *     responses:
 *       200: { description: Client modifié }
 *       404: { description: Client introuvable }
 *       403: { description: Rôle insuffisant (admin/agent uniquement) }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.put(
  '/:id',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    param('id').isInt(),
    body('forfait_id').optional().isInt(),
    body('statut').optional().isIn(['actif', 'suspendu', 'resilie']),
  ],
  validerRequete,
  clientsController.modifier
);

/**
 * @openapi
 * /clients/{id}:   
*   delete:
 *     summary: Supprimer un client (admin uniquement)
 *     tags: [Clients]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204: { description: Client supprimé }
 *       403: { description: Rôle insuffisant (admin uniquement) }
 *       404: { description: Client introuvable }
 *       409: { description: Le client a des factures associées, suppression impossible }
 */
router.delete(
  '/:id',
  verifierJWT,
  garderRole('admin'),
  param('id').isInt(),
  validerRequete,
  clientsController.supprimer
);

module.exports = router;