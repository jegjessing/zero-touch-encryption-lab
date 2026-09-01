#!/usr/bin/env bash
# Verify traffic reaches message-api THROUGH the Ingress: HTTPS works (self-signed,
# hence -k), plain HTTP redirects to HTTPS, and a full POST round-trips.
set -euo pipefail

HOST="${HOST:-api.zerotouch.local}"

echo "== 1. HTTPS health through the Ingress =="
curl -fsS -k -H "Host: $HOST" "https://localhost:8443/healthz" && echo

echo
echo "== 2. plain HTTP should redirect to HTTPS =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "http://localhost:8081/healthz")
echo "HTTP status: $code"
case "$code" in
  301|302|307|308) echo "OK — redirected to HTTPS" ;;
  *) echo "WARN — expected a redirect, got $code" ;;
esac

echo
echo "== 3. POST a message through the Ingress (end-to-end) =="
curl -fsS -k -H "Host: $HOST" -H 'content-type: application/json' \
  -d '{"recipient":"a@b.dk","subject":"Via ingress","body":"Hej fra ingress"}' \
  "https://localhost:8443/messages" && echo

echo
echo "OK — the Ingress routes to message-api over TLS."
