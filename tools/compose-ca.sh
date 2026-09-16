#!/bin/sh
# The `ca` service of compose.yaml. Keeps a valid test CA across runs: /tls holds postmock's
# cert.pem and key.pem, /ca holds only ca.pem for the clients. A missing file, a certificate that
# /ca/ca.pem does not verify, a key that does not match the certificate, or a certificate that
# expires within a day makes a new CA. A running postmock keeps the old certificate until it restarts.
set -eu
if [ -f /ca/ca.pem ] && [ -f /tls/cert.pem ] && [ -f /tls/key.pem ] &&
  openssl verify -CAfile /ca/ca.pem /tls/cert.pem >/dev/null 2>&1 &&
  [ "$(openssl x509 -noout -pubkey -in /tls/cert.pem)" = "$(openssl pkey -pubout -in /tls/key.pem)" ] &&
  openssl x509 -checkend 86400 -noout -in /tls/cert.pem >/dev/null; then
  exit 0
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
test-ca.sh "$work"
cp "$work/cert.pem" "$work/key.pem" /tls/
cp "$work/ca.pem" /ca/
echo "compose-ca: wrote a new test CA"
