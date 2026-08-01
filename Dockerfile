# ---------------------------------------------------------------------------
# Mappe – ein Container, der alles mitbringt: API, gebautes Frontend und den
# Prisma-Client. Die Datenbank läuft daneben (siehe docker-compose.yml).
#
# Bewusst genau EIN "npm ci". Zwei Installationen in getrennten Stufen baut
# BuildKit gleichzeitig – dann liegen zwei vollständige node_modules-Bäume samt
# zwei Paket-Zwischenspeichern zur selben Zeit auf der Platte. Das sind schnell
# über 1,5 GB, und der Platz gehört dem Docker-Host, nicht diesem Bau: Läuft er
# voll, fallen auch alle anderen Container darauf um. Deshalb wird hier einmal
# installiert und danach mit "npm prune" auf die Laufzeit-Abhängigkeiten
# eingedampft, statt ein zweites Mal zu installieren.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app

# Nur die Manifeste kopieren – so bleibt die Installations-Schicht im Cache,
# solange sich keine Abhängigkeit ändert. Der Paket-Zwischenspeicher fliegt in
# derselben Schicht wieder raus; in einer späteren wäre er nur unsichtbar, aber
# nicht weg.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY . .

# Bauen und im selben Schritt stutzen. Der Prisma-Client wird danach neu
# erzeugt, weil "prune" ihn mitnehmen kann – die CLI dafür ist eine echte
# Abhängigkeit und überlebt das Stutzen.
RUN npm run build --workspace=@mappe/api \
 && npm run build --workspace=@mappe/web \
 && npm prune --omit=dev \
 && node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma \
 && npm cache clean --force


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# pdfjs braucht keine Systempakete mehr, aber tini hält die Signalbehandlung
# sauber – sonst kommt SIGTERM nicht bei Node an und der Stopp dauert 10 s.
RUN apk add --no-cache tini

# Die Manifeste gehören ins Abbild: Node liest an ihnen ab, dass der Code als
# CommonJS zu laden ist.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Der fertig gestutzte Baum aus der Bau-Stufe – keine zweite Installation.
COPY --from=build /app/node_modules node_modules

# Prisma-Schema und Migrationen müssen mit ins Abbild – der Start spielt sie ein.
COPY apps/api/prisma apps/api/prisma

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
