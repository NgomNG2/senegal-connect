require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

const tokenAdmin = genererToken('admin');

// Vérifie la consultation et les règles de gestion des forfaits.
describe('Forfaits', () => {
  afterEach(() => jest.clearAllMocks());

  // Le résultat doit inclure le nombre de clients associés à chaque forfait.
  test('GET /api/forfaits renvoie 200 avec nb_clients par forfait', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Essentiel', nb_clients: 3 }] });
    const res = await request(app).get('/api/forfaits').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.donnees[0]).toHaveProperty('nb_clients', 3);
  });

  // Les opérations protégées exigent un jeton d'authentification.
  test('POST /api/forfaits sans token renvoie 401', async () => {
    const res = await request(app).post('/api/forfaits').send({ nom: 'X', quota_data_go: 1, quota_voix_min: 50, prix_mensuel_fcfa: 1000 });
    expect(res.status).toBe(401);
  });

  // Le prix mensuel doit respecter la contrainte de montant positif.
  test('POST /api/forfaits avec prix négatif renvoie 422', async () => {
    const res = await request(app).post('/api/forfaits').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nom: 'X', quota_data_go: 1, quota_voix_min: 50, prix_mensuel_fcfa: -100,
    });
    expect(res.status).toBe(422);
  });

  // Une suppression référencée par des clients est refusée par la base.
  test('DELETE /api/forfaits/:id renvoie 409 si des clients y sont rattachés', async () => {
    const erreurSQL = new Error('restrict_violation');
    erreurSQL.code = '23001';
    db.query.mockRejectedValueOnce(erreurSQL);
    const res = await request(app).delete('/api/forfaits/2').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(409);
  });
});