require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

const tokenAgent = genererToken('agent');

// Vérifie le filtrage, la validation et le paiement des factures.
describe('Factures', () => {
  afterEach(() => jest.clearAllMocks());

  // Chaque facture retournée doit appartenir au client demandé.
  test('GET /api/factures?client_id=1 filtre correctement', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: '2' }] }).mockResolvedValueOnce({ rows: [{ id: 1, client_id: 1 }, { id: 2, client_id: 1 }] });
    const res = await request(app).get('/api/factures?client_id=1').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(200);
    res.body.donnees.forEach((f) => expect(f.client_id).toBe(1));
  });

  // Un montant inférieur à zéro est rejeté par la validation métier.
  test('POST /api/factures avec montant négatif renvoie 422', async () => {
    const res = await request(app).post('/api/factures').set('Authorization', `Bearer ${tokenAgent}`).send({
      client_id: 1, periode: '2026-03', montant_fcfa: -500, date_echeance: '2026-04-05',
    });
    expect(res.status).toBe(422);
  });

  // Traduit une violation de clé étrangère en erreur de validation API.
  test('POST /api/factures avec client_id inexistant renvoie 422', async () => {
    const erreurSQL = new Error('foreign_key_violation');
    erreurSQL.code = '23503';
    db.query.mockRejectedValueOnce(erreurSQL);
    const res = await request(app).post('/api/factures').set('Authorization', `Bearer ${tokenAgent}`).send({
      client_id: 999999, periode: '2026-03', montant_fcfa: 15000, date_echeance: '2026-04-05',
    });
    expect(res.status).toBe(422);
  });

  // Confirme que le paiement met bien le statut de la facture à jour.
  test('PATCH /api/factures/:id/payer met à jour le statut (200)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'payee' }] });
    const res = await request(app).patch('/api/factures/1/payer').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(200);
    expect(res.body.facture.statut).toBe('payee');
  });
});