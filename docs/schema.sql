-- =============================================================================
-- Sénégal Connect — Schéma PostgreSQL
--------------------------------------------------------------------------------

-- Exécuté automatiquement par Docker au premier démarrage (monté dans
-- /docker-entrypoint-initdb.d/), ou à la main avec :
--   psql -U <user> -d <db> -f docs/schema.sql
-- =============================================================================

-- Comptes d'accès à l'application et rôles associés.
CREATE TABLE utilisateurs (
    id             SERIAL PRIMARY KEY,
    nom            VARCHAR(100) NOT NULL,
    prenom         VARCHAR(100) NOT NULL,
    email          VARCHAR(150) NOT NULL UNIQUE,
    mot_de_passe   VARCHAR(255) NOT NULL,
    role           VARCHAR(20)  NOT NULL CHECK (role IN ('client', 'agent', 'admin')),
    cree_le        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Accélère les recherches de connexion et le filtrage par rôle.
CREATE INDEX idx_utilisateurs_email ON utilisateurs (email);
CREATE INDEX idx_utilisateurs_role  ON utilisateurs (role);

-- Catalogue des forfaits proposés aux clients.
CREATE TABLE forfaits (
    id                 SERIAL PRIMARY KEY,
    nom                VARCHAR(100) NOT NULL,
    quota_data_go      NUMERIC(6,2)  NOT NULL CHECK (quota_data_go >= 0),
    quota_voix_min     INTEGER       NOT NULL CHECK (quota_voix_min >= 0),
    prix_mensuel_fcfa  NUMERIC(10,2) NOT NULL CHECK (prix_mensuel_fcfa > 0),
    actif              BOOLEAN NOT NULL DEFAULT TRUE
);

-- Permet de retrouver rapidement les forfaits disponibles à la souscription.
CREATE INDEX idx_forfaits_actif ON forfaits (actif);

-- Profil télécom d'un utilisateur ayant le rôle client.
CREATE TABLE clients (
    id                SERIAL PRIMARY KEY,
    utilisateur_id    INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    msisdn            VARCHAR(20) NOT NULL UNIQUE CHECK (msisdn ~ '^\+221[0-9]{9}$'),
    forfait_id        INTEGER REFERENCES forfaits(id) ON DELETE RESTRICT,
    statut            VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'resilie')),
    date_inscription  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index utiles pour la recherche par numéro, forfait et état de la ligne.
CREATE INDEX idx_clients_msisdn     ON clients (msisdn);
CREATE INDEX idx_clients_forfait_id ON clients (forfait_id);
CREATE INDEX idx_clients_statut     ON clients (statut);

-- Factures périodiques rattachées à un client.
CREATE TABLE factures (
    id             SERIAL PRIMARY KEY,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    reference      VARCHAR(30) NOT NULL UNIQUE,
    periode        VARCHAR(7)  NOT NULL CHECK (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    montant_fcfa   NUMERIC(10,2) NOT NULL CHECK (montant_fcfa >= 0),
    statut         VARCHAR(20) NOT NULL DEFAULT 'impayee' CHECK (statut IN ('payee', 'impayee', 'en_retard')),
    date_emission  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_echeance  TIMESTAMPTZ NOT NULL
);

-- Index destinés à la consultation de l'historique et des impayés.
CREATE INDEX idx_factures_client_id ON factures (client_id);
CREATE INDEX idx_factures_statut    ON factures (statut);
CREATE INDEX idx_factures_periode   ON factures (periode);

-- Demandes d'assistance ouvertes par les clients et prises en charge par les agents.
CREATE TABLE tickets (
    id         SERIAL PRIMARY KEY,
    client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    agent_id   INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
    sujet      VARCHAR(200) NOT NULL,
    statut     VARCHAR(20) NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'en_cours', 'ferme')),
    ouvert_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ferme_le   TIMESTAMPTZ
);

-- Index pour afficher rapidement les tickets d'un client, d'un agent ou d'un état donné.
CREATE INDEX idx_tickets_client_id ON tickets (client_id);
CREATE INDEX idx_tickets_agent_id  ON tickets (agent_id);
CREATE INDEX idx_tickets_statut    ON tickets (statut);

-- Messages échangés dans le cadre d'un ticket.
CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    expediteur_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type            VARCHAR(10) NOT NULL CHECK (type IN ('texte', 'fichier', 'image', 'audio')),
    contenu         TEXT,
    fichier_url     VARCHAR(500),
    fichier_nom     VARCHAR(255),
    fichier_taille  INTEGER,
    envoye_le       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- L'ordre décroissant sur la date facilite l'affichage des messages récents.
CREATE INDEX idx_messages_ticket_id ON messages (ticket_id);
CREATE INDEX idx_messages_envoye_le ON messages (envoye_le DESC);

-- Statut de lecture d'un message pour chaque utilisateur destinataire.
CREATE TABLE messages_statut (
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    statut          VARCHAR(10) NOT NULL CHECK (statut IN ('envoye', 'lu')),
    lu_le           TIMESTAMPTZ,
    PRIMARY KEY (message_id, utilisateur_id)
);

-- Accès rapide aux statuts associés à un message.
CREATE INDEX idx_messages_statut_message_id ON messages_statut (message_id);

-- Appels audio ou vidéo initiés dans le contexte d'un ticket.
CREATE TABLE appels (
    id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    initiateur_id     INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    destinataire_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type              VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    statut            VARCHAR(20) NOT NULL DEFAULT 'initie'
                        CHECK (statut IN ('initie', 'accepte', 'refuse', 'termine')),
    duree_secondes    INTEGER,
    debut_le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fin_le            TIMESTAMPTZ
);

-- Index pour suivre les appels d'un ticket et les appels selon leur état.
CREATE INDEX idx_appels_ticket_id ON appels (ticket_id);
CREATE INDEX idx_appels_statut    ON appels (statut);

-- 9e table : non listée dans les "8 obligatoires" du tableau récap, mais
-- exigée par la section fonctionnelle M3 ("stockage dans une table
-- reactions avec PRIMARY KEY composite").
CREATE TABLE reactions (
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    emoji           VARCHAR(10) NOT NULL,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, utilisateur_id, emoji)
);

-- La clé primaire composite empêche un utilisateur d'ajouter deux fois
-- la même réaction au même message.

-- =============================================================================
-- Données de test et démonstration
-- Voir scripts/seed.js — génère les mots de passe hachés dynamiquement
-- avec bcryptjs plutôt que de stocker des hashs en dur dans ce fichier SQL.
-- Usage : node scripts/seed.js
-- =============================================================================