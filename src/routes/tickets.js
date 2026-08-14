/**
 * Routes pour la gestion des tickets et de leurs messages.
 * - GET /api/tickets : liste des tickets avec possibilité de filtrer par statut.
 * - POST /api/tickets : création d'un nouveau ticket pour un client donné.
 * - GET /api/tickets/:id/messages : récupération des messages d'un ticket avec pagination par curseur.
 * - POST /api/tickets/:id/fichier : upload d'un fichier pour un ticket (ex: pièce jointe).
*/

const express = require('express');
const { body, param, query } = require('express-validator');
const ticketsController = require('../controllers/ticketsController');
const { verifierJWT } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');
const upload = require('../middleware/upload');
const { ErreurApplicative } = require('../middleware/erreurs');

const router = express.Router();

/**
 * @openapi
 * /tickets:
 *   get:
 *     summary: Liste des tickets
 *     tags: [Tickets]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: statut
 *         schema: { type: string }
 *         description: Filtre optionnel sur le statut du ticket
 *     responses:
 *       200:
 *         description: Liste des tickets visibles pour l'utilisateur courant
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 donnees: { type: array, items: { type: object } }
 *       401: { description: Token manquant/invalide/expiré }
 */
router.get('/', verifierJWT, ticketsController.liste);

/**
 * @openapi
 * /tickets:
 *   post:
 *     summary: Créer un ticket
 *     tags: [Tickets]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, sujet]
 *             properties:
 *               client_id:
 *                 type: integer
 *                 description: Requis pour un agent/admin. Pour un client, le serveur remplace par son propre client.
 *               sujet:
 *                 type: string
 *                 example: "Problème de connexion internet"
 *     responses:
 *       201:
 *         description: Ticket créé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket: { type: object }
 *       401: { description: Token manquant/invalide/expiré }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.post('/', verifierJWT, [body('client_id').isInt(), body('sujet').trim().notEmpty()], validerRequete, ticketsController.creer);

/**
 * @openapi
 * /tickets/{id}/messages:
 *   get:
 *     summary: Historique des messages d'un ticket
 *     tags: [Tickets]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: avant
 *         schema: { type: string, format: date-time }
 *         description: Timestamp ISO8601 pour charger les messages plus anciens
 *       - in: query
 *         name: limite
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *     responses:
 *       200:
 *         description: Messages du ticket + pagination par curseur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 donnees: { type: array, items: { type: object } }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     limite: { type: integer }
 *                     curseurSuivant: { type: string, nullable: true, format: date-time }
 *                     aPlus: { type: boolean }
 *       401: { description: Token manquant/invalide/expiré }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.get(
  '/:id/messages',
  verifierJWT,
  [param('id').isInt(), query('avant').optional().isISO8601(), query('limite').optional().isInt({ min: 1, max: 100 })],
  validerRequete,
  ticketsController.messages
);

/**
 * @openapi
 * /tickets/{id}/fichier:
 *   post:
 *     summary: Upload d'un fichier joint à un ticket
 *     tags: [Tickets]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [fichier]
 *             properties:
 *               fichier:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Fichier uploadé avec URL de stockage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticketId: { type: integer }
 *                 fichierUrl: { type: string }
 *                 fichierNom: { type: string }
 *                 fichierTaille: { type: integer }
 *                 mimeType: { type: string }
 *       401: { description: Token manquant/invalide/expiré }
 *       422: { description: Aucun fichier reçu ou validation échouée }
 */
// Upload SEUL — l'INSERT/diffusion se fait via l'événement socket fichier:partager
router.post('/:id/fichier', verifierJWT, param('id').isInt(), validerRequete, upload.single('fichier'), (req, res, next) => {
  try {
    if (!req.file) return next(new ErreurApplicative(422, 'Aucun fichier reçu.'));
    res.status(201).json({
      ticketId: parseInt(req.params.id, 10),
      fichierUrl: `/uploads/${req.file.filename}`,
      fichierNom: req.file.originalname,
      fichierTaille: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * @openapi
 * /tickets/{id}/appels:
 *   get:
 *     summary: Récupérer les appels d'un ticket
 *     tags: [Tickets]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Liste des appels associés au ticket
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 donnees: { type: array, items: { type: object } }
 *       401: { description: Token manquant/invalide/expiré }
 *       422: { description: Validation échouée, content: { application/json: { schema: { $ref: '#/components/schemas/Erreur' } } } }
 */
router.get(
  '/:id/appels', 
  verifierJWT, 
  param('id').isInt(), 
  validerRequete, 
  ticketsController.appels
);

module.exports = router;