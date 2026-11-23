#!/bin/sh
# Makes the TLS fixtures in tests/certs: a self-signed localhost server certificate, and a client
# certificate for mutual TLS as PEM, an encrypted PEM key and a PKCS #12 file (passphrase "secret").
set -eu
cd "$(dirname "$0")/../tests/certs"

openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout localhost.key -out localhost.crt

openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=CarbonWire test client" \
  -keyout client.key -out client.crt
openssl pkcs8 -topk8 -in client.key -out client-encrypted.key -passout pass:secret -v2 aes-256-cbc
openssl pkcs12 -export -in client.crt -inkey client.key -out client.p12 -passout pass:secret
