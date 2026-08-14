/** 
 * 
 * src/routes/forfaits.js
 * -----------------------------------------------------------------------
 * Routes CRUD pour les forfaits. La validation express-validator s'exécute
 * AVANT le contrôleur : si un champ est invalide, on renvoie 422 avec le
 * détail par champ, sans même toucher à la base de données.    
 * 
*/

const express = require('express');
const { body, param } = require('express-validator');
const forfaitsController = require('../controllers/forfaitsController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

router.get(
    /**
     * @openapi
     * /forfaits:
     *   get:
     *     summary: Liste des forfaits
     *     tags: [Forfaits]
     *     security: [{ BearerAuth: [] }]
     *     parameters:
     *       - in: query
     *         name: actif
     *         schema: { type: boolean }
     *         description: Filtrer les forfaits actifs ou inactifs
     *     responses:
     *       200:
     *         description: Liste des forfaits
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 donnees: { type: array, items: { $ref: '#/components/schemas/Forfait' } }
     *       401: { description: Token manquant/invalide/expiré }
     */
    '/',
    verifierJWT,
    forfaitsController.liste
);

/**
 * @openapi
 * /forfaits/{id}:
 *   get:
 *     summary: Détail d'un forfait
 *     tags: [Forfaits]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Forfait trouvé
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { forfait: { $ref: '#/components/schemas/Forfait' } } }
 *       401: { description: Token manquant/invalide/expiré }
 *       404: { description: Forfait introuvable, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.get(
    '/:id', 
    verifierJWT, 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.detail
);

/**
 * @openapi
 * /forfaits:
 *   post:
 *     summary: Créer un forfait (admin uniquement)
 *     tags: [Forfaits]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa]
 *             properties:
 *               nom: { type: string }
 *               quota_data_go: { type: number, minimum: 0 }
 *               quota_voix_min: { type: integer, minimum: 0 }
 *               prix_mensuel_fcfa: { type: number, exclusiveMinimum: 0 }
 *     responses:
 *       201: { description: Forfait créé, content: { application/json: { schema: { type: object, properties: { forfait: { $ref: '#/components/schemas/Forfait' } } } } } }
 *       403: { description: Rôle insuffisant (admin uniquement) }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.post(
  '/',
  verifierJWT,
  garderRole('admin'),
  [
    body('nom').trim().notEmpty(),
    body('quota_data_go').isFloat({ min: 0 }),
    body('quota_voix_min').isInt({ min: 0 }),
    body('prix_mensuel_fcfa').isFloat({ min: 0.01 }),
  ],
  validerRequete,
  forfaitsController.creer
);

/**
 * @openapi
 * /forfaits/{id}:
 *   put:
 *     summary: Modifier un forfait (admin uniquement)
 *     tags: [Forfaits]
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
 *               nom: { type: string }
 *               quota_data_go: { type: number, minimum: 0 }
 *               quota_voix_min: { type: integer, minimum: 0 }
 *               prix_mensuel_fcfa: { type: number, exclusiveMinimum: 0 }
 *               actif: { type: boolean }
 *     responses:
 *       200: { description: Forfait modifié, content: { application/json: { schema: { type: object, properties: { forfait: { $ref: '#/components/schemas/Forfait' } } } } } }
 *       403: { description: Rôle insuffisant (admin uniquement) }
 *       404: { description: Forfait introuvable }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.put(
    '/:id', verifierJWT, 
    garderRole('admin'), 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.modifier
);

/**
 * @openapi
 * /forfaits/{id}:
 *   delete:
 *     summary: Supprimer un forfait (admin uniquement)
 *     tags: [Forfaits]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204: { description: Forfait supprimé }
 *       403: { description: Rôle insuffisant (admin uniquement) }
 *       404: { description: Forfait introuvable }
 *       409: { description: Le forfait est utilisé par des clients, suppression impossible }
 */
router.delete(
    '/:id', verifierJWT, 
    garderRole('admin'), 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.supprimer
);

module.exports = router;