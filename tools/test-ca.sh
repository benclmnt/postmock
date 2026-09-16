#!/usr/bin/env bash
# Writes a throwaway test CA and a server certificate for the Postmark host names into <out dir>:
#   ca.pem (trust this), cert.pem + key.pem (serve these).
# A client that trusts ca.pem accepts postmock as api.postmarkapp.com (docs/01 §3.3 option B).
# The protection is the deleted CA key: nobody can sign another certificate with this CA.
# Name constraints (postmarkapp.com, localhost, 127.0.0.1) add a limit for clients that enforce
# them on a trust anchor; Java does not.
set -euo pipefail
out="${1:?usage: tools/test-ca.sh <out dir>}"
mkdir -p "$out"
cd "$out"

openssl req -x509 -newkey rsa:2048 -nodes -days 30 -sha256 \
  -keyout ca-key.pem -out ca.pem -subj "/CN=postmock test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "nameConstraints=critical,permitted;DNS:postmarkapp.com,permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255"

openssl req -newkey rsa:2048 -nodes -sha256 -keyout key.pem -out cert.csr \
  -subj "/CN=api.postmarkapp.com"

cat >cert.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:api.postmarkapp.com,DNS:smtp.postmarkapp.com,DNS:smtp-broadcasts.postmarkapp.com,DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 30 -sha256 \
  -extfile cert.ext -out cert.pem
rm -f cert.csr cert.ext ca.srl ca-key.pem
