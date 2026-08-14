require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

const tokenAgent = genererToken('agent');

// Centralise les cas de validation d'entrée et de routage invalide.
describe('Validation', () => {
  afterEach(() => jest.clearAllMocks());

  // Vérifie que l'erreur identifie précisément le champ incorrect.
  test('Email invalide renvoie 422 avec le champ précisé', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nom: 'Test', prenom: 'User', email: 'pas-un-email', mot_de_passe: 'MotDePasse123',
    });
    expect(res.status).toBe(422);
    const champs = res.body.details.champs.map((c) => c.champ);
    expect(champs).toContain('email');
  });

  // Un MSISDN mal formé doit être rejeté avant l'ouverture d'une transaction.
  test('Format MSISDN incorrect renvoie 422', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${tokenAgent}`).send({
      nom: 'X', prenom: 'Y', email: 'x@y.sn', mot_de_passe: 'MotDePasse123', msisdn: '0771234567',
    });
    expect(res.status).toBe(422);
    expect(db.transaction).not.toHaveBeenCalled(); // bloqué avant même la BDD
  });

  // Un corps vide doit retourner au moins une erreur de validation détaillée.
  test('Corps vide renvoie 422', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(422);
    expect(res.body.details.champs.length).toBeGreaterThan(0);
  });

  // Toute URL non déclarée doit être signalée comme ressource inexistante.
  test('Route inconnue renvoie 404', async () => {
    const res = await request(app).get('/api/route-qui-nexiste-pas');
    expect(res.status).toBe(404);
  });
});