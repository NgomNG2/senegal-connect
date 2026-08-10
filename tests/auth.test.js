require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Le coût réel de bcrypt est validé séparément ; ce mock garde ces tests
// d'intégration rapides sans réduire la sécurité de l'application.
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hash-de-test'),
  compare: jest.fn().mockResolvedValue(true),
}));

const bcrypt = require('bcryptjs');
const app = require('../src/app');

jest.mock('../src/config/db');
const db = require('../src/config/db');

// Vérifie les parcours principaux d'inscription, de connexion et d'authentification.
describe('Auth', () => {
  afterEach(() => jest.clearAllMocks());

  // Simule une insertion réussie et confirme que l'API retourne un jeton.
  test('POST /api/auth/register renvoie 201 à l\'inscription valide', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Test', prenom: 'User', email: 'test@example.sn', role: 'client', cree_le: new Date() }],
    });
    const res = await request(app).post('/api/auth/register').send({
      nom: 'Test', prenom: 'User', email: 'test@example.sn', mot_de_passe: 'MotDePasse123',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
  });

  // Reproduit la contrainte d'unicité SQL sur l'adresse e-mail.
  test('POST /api/auth/register renvoie 409 sur email dupliqué', async () => {
    const erreurSQL = new Error('duplicate key value violates unique constraint');
    erreurSQL.code = '23505';
    db.query.mockRejectedValueOnce(erreurSQL);
    const res = await request(app).post('/api/auth/register').send({
      nom: 'Test', prenom: 'User', email: 'deja.pris@example.sn', mot_de_passe: 'MotDePasse123',
    });
    expect(res.status).toBe(409);
  });

  // Vérifie qu'un mot de passe valide produit un JWT exploitable.
  test('POST /api/auth/login renvoie un JWT valide pour un login correct', async () => {
    const hash = await bcrypt.hash('MotDePasse123', 12);
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, nom: 'Test', prenom: 'User', email: 'test@example.sn', mot_de_passe: hash, role: 'client' }],
    });
    const res = await request(app).post('/api/auth/login').send({ email: 'test@example.sn', mot_de_passe: 'MotDePasse123' });
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3);
  });

  // Un utilisateur absent de la base ne peut pas se connecter.
  test('POST /api/auth/login renvoie 401 pour un email inconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/login').send({ email: 'inconnu@example.sn', mot_de_passe: 'PeuImporte123' });
    expect(res.status).toBe(401);
  });

  // Un jeton dont la date d'expiration est dépassée doit être refusé.
  test('GET /api/auth/profil renvoie 401 avec un token expiré', async () => {
    const tokenExpire = jwt.sign(
      { id: 1, email: 'test@example.sn', role: 'client' },
      process.env.JWT_SECRET,
      { issuer: process.env.JWT_ISSUER, expiresIn: -10 } // exp déjà dans le passé
    );
    const res = await request(app).get('/api/auth/profil').set('Authorization', `Bearer ${tokenExpire}`);
    expect(res.status).toBe(401);
    expect(res.body.erreur.toLowerCase()).toContain('expiré');
  });
});