#!/usr/bin/env bash
# End-to-end smoke test: sends one plain and one sensitive message through the
# API (which lives on localhost:8080 via the kind port mapping) and reads them
# back. Proves the classify -> encrypt -> store -> decrypt round-trip.
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"

echo "== 1. health =="
curl -fsS "$BASE/healthz" && echo
curl -fsS "$BASE/readyz"  && echo

echo
echo "== 2. a NON-sensitive message (should stay plaintext) =="
plain=$(curl -fsS -X POST "$BASE/messages" \
  -H 'content-type: application/json' \
  -d '{"recipient":"team@firma.dk","subject":"Frokost","body":"Vi ses til frokost kl 12 i kantinen."}')
echo "$plain"
plain_id=$(echo "$plain" | grep -o '"id":"\?[0-9]*' | head -1 | grep -o '[0-9]*')

echo
echo "== 3. a SENSITIVE message (CPR number -> should be encrypted) =="
sensitive=$(curl -fsS -X POST "$BASE/messages" \
  -H 'content-type: application/json' \
  -d '{"recipient":"sagsbehandler@kommune.dk","subject":"Din sag","body":"Hej, din klient har CPR 010203-1234 og skal have svar."}')
echo "$sensitive"
sens_id=$(echo "$sensitive" | grep -o '"id":"\?[0-9]*' | head -1 | grep -o '[0-9]*')

echo
echo "== 4. list (metadata only, no bodies) =="
curl -fsS "$BASE/messages" && echo

echo
echo "== 5. read the sensitive one back (decrypts on the way out) =="
curl -fsS "$BASE/messages/$sens_id" && echo

echo
echo "== 6. prove it is stored ENCRYPTED in Postgres =="
kubectl --context kind-zerotouch-lab -n zerotouch-lab exec deploy/postgres -- \
  psql -U zerotouch -d zerotouch -c \
  "SELECT id, sensitive, encrypted, left(coalesce(body_cipher, body_plain),40) AS body_at_rest FROM messages ORDER BY id;"

echo
echo "OK — plain id=$plain_id, sensitive id=$sens_id"
