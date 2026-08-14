# =============================================================================
# Sénégal Connect — Image Docker de l'API
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# Copie uniquement les manifests d'abord : Docker met cette étape en cache
# et ne réinstalle les dépendances que si package.json/package-lock.json
# changent — pas à chaque modification du code source.
COPY package*.json ./

# --omit=dev : pas besoin de jest/nodemon/supertest dans l'image de prod.
RUN npm ci --omit=dev

COPY . .

# uploads/ et logs/ doivent exister et être inscriptibles par l'utilisateur
# non-root ci-dessous (sinon Multer/Winston échouent silencieusement).
RUN mkdir -p uploads logs && chown -R node:node /app

# On ne fait jamais tourner un conteneur en root — limite l'impact d'une
# éventuelle faille dans une dépendance.
USER node

EXPOSE 3000
EXPOSE 9000

# HEALTHCHECK via un script Node inline plutôt que curl/wget : évite
# d'installer un paquet supplémentaire dans l'image Alpine (qui ne les a
# pas par défaut), donc image plus légère et surface d'attaque réduite.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]