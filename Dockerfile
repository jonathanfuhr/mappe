# ---------------------------------------------------------------------------
# Mappe – ein Container, der alles mitbringt: API, gebautes Frontend und den
# Prisma-Client. Die Datenbank läuft daneben (siehe docker-compose.yml).
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
# Nur die Manifeste kopieren – so bleibt die Installations-Schicht im Cache,
# solange sich keine Abhängigkeit ändert.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci


FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace=@mappe/api \
 && npm run build --workspace=@mappe/web


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# pdfjs braucht keine Systempakete mehr, aber tini hält die Signalbehandlung
# sauber – sonst kommt SIGTERM nicht bei Node an und der Stopp dauert 10 s.
RUN apk add --no-cache tini

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

# Prisma-Schema und Migrationen müssen mit ins Abbild – der Start spielt sie ein.
COPY apps/api/prisma apps/api/prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Als node laufen, nicht als root. Die Ablage gehört dem Nutzer.
RUN mkdir -p /data/storage && chown -R node:node /data
USER node

ENV PORT=3000
ENV STORAGE_DIR=/data/storage
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]
