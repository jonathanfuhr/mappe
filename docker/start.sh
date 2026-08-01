#!/bin/sh
# Startskript des Containers: erst die Datenbank auf Stand bringen, dann die
# Standard-Vorlagen nachziehen, dann den Server starten.
set -e

# Bewusst die CLI aus dem Abbild und nicht "npx": npx würde ein fehlendes Paket
# klammheimlich aus dem Netz nachladen. Fehlt es, soll der Start hier scheitern
# – ein Container ohne Internet darf beim Start nicht darauf angewiesen sein.
echo "[mappe] Migrationen werden eingespielt …"
/app/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "[mappe] Seed-Daten werden geprüft …"
node apps/api/dist/seed/index.js || echo "[mappe] Seed übersprungen."

echo "[mappe] Server startet."
exec node apps/api/dist/index.js
