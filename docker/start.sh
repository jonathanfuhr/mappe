#!/bin/sh
# Startskript des Containers: erst die Datenbank auf Stand bringen, dann die
# Standard-Vorlagen nachziehen, dann den Server starten.
set -e

echo "[mappe] Migrationen werden eingespielt …"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "[mappe] Seed-Daten werden geprüft …"
node apps/api/dist/seed/index.js || echo "[mappe] Seed übersprungen."

echo "[mappe] Server startet."
exec node apps/api/dist/index.js
