#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
SYSTEM="/Library/Application Support/HighGAS"
CERTDIR="$SYSTEM/certs"
TOKEN="$SYSTEM/helper.token"
PLIST="/Library/LaunchDaemons/app.highgas.helper.plist"
SITE="https://127.0.0.1:37654"
CACERT="$CERTDIR/highgas-local-ca.crt"
CAKEY="$CERTDIR/highgas-local-ca.key"
SERVERCERT="$CERTDIR/server.crt"
SERVERKEY="$CERTDIR/server.key"

for f in highgas-helper highgas-tunnel wireguard-go; do
  [[ -f "$ROOT/$f" ]] || { echo "Pacote incompleto: $f"; read -k 1 '?Fechar'; exit 1; }
done

/usr/bin/xattr -dr com.apple.quarantine "$ROOT" >/dev/null 2>&1 || true

echo "O HighGAS precisa da senha administrativa uma única vez para instalar o motor WireGuard e a interface local segura."
sudo -v

/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/app.highgas.helper.plist" >/dev/null 2>&1 || true
sudo /bin/launchctl bootout system/app.highgas.helper >/dev/null 2>&1 || true

sudo /bin/mkdir -p "$SYSTEM/profiles" "$CERTDIR" /var/run/highgas /var/run/wireguard
for f in highgas-helper highgas-tunnel wireguard-go; do
  sudo /bin/cp "$ROOT/$f" "$SYSTEM/$f"
done

if [[ ! -s "$CACERT" || ! -s "$CAKEY" || ! -s "$SERVERCERT" || ! -s "$SERVERKEY" ]]; then
  echo "Criando certificado local seguro do HighGAS..."
  CACFG="$(/usr/bin/mktemp -t highgas-ca).cnf"
  EXTCFG="$(/usr/bin/mktemp -t highgas-server).cnf"
  CSR="$(/usr/bin/mktemp -t highgas-server).csr"

  cat > "$CACFG" <<'EOF_CA'
[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
EOF_CA

  cat > "$EXTCFG" <<'EOF_EXT'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF_EXT

  sudo /usr/bin/openssl genrsa -out "$CAKEY" 2048 >/dev/null 2>&1
  sudo /usr/bin/openssl req -x509 -new -key "$CAKEY" -sha256 -days 3650 \
    -subj "/CN=HighGAS Local Root CA" -config "$CACFG" -extensions v3_ca -out "$CACERT"
  sudo /usr/bin/openssl genrsa -out "$SERVERKEY" 2048 >/dev/null 2>&1
  sudo /usr/bin/openssl req -new -key "$SERVERKEY" -subj "/CN=localhost" -out "$CSR"
  sudo /usr/bin/openssl x509 -req -in "$CSR" -CA "$CACERT" -CAkey "$CAKEY" -CAcreateserial \
    -out "$SERVERCERT" -days 1825 -sha256 -extfile "$EXTCFG"

  /bin/rm -f "$CACFG" "$EXTCFG" "$CSR"
fi

# A CA existe apenas neste Mac e só assina o endereço loopback do HighGAS.
# Reinstalamos explicitamente a confiança para evitar estados inconsistentes do Chaveiro/Safari.
sudo /usr/bin/security delete-certificate -c "HighGAS Local Root CA" /Library/Keychains/System.keychain >/dev/null 2>&1 || true
if sudo /usr/bin/security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$CACERT" >/dev/null 2>&1; then
  echo "Certificado local confiável instalado."
else
  echo "Aviso: não consegui registrar automaticamente a confiança do certificado local."
fi

sudo /usr/sbin/chown -R root:wheel "$SYSTEM"
sudo /bin/chmod 700 "$SYSTEM" "$SYSTEM/profiles" "$CERTDIR" "$SYSTEM/highgas-helper" "$SYSTEM/highgas-tunnel" "$SYSTEM/wireguard-go"
sudo /bin/chmod 600 "$CAKEY" "$SERVERKEY"
sudo /bin/chmod 644 "$CACERT" "$SERVERCERT"

if ! sudo /bin/test -s "$TOKEN"; then
  T="$(/usr/bin/openssl rand -hex 32)"
  printf '%s\n' "$T" | sudo /usr/bin/tee "$TOKEN" >/dev/null
else
  T="$(sudo /bin/cat "$TOKEN" | /usr/bin/tr -d '\r\n ')"
fi
sudo /usr/sbin/chown root:wheel "$TOKEN"
sudo /bin/chmod 600 "$TOKEN"

TMP="$(/usr/bin/mktemp -t highgas).plist"
cat > "$TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>app.highgas.helper</string>
<key>ProgramArguments</key><array>
<string>$SYSTEM/highgas-helper</string>
<string>--token-file</string><string>$TOKEN</string>
<string>--cert-file</string><string>$SERVERCERT</string>
<string>--key-file</string><string>$SERVERKEY</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$SYSTEM/helper.log</string>
<key>StandardErrorPath</key><string>$SYSTEM/helper-error.log</string>
</dict></plist>
PLIST

/usr/bin/plutil -lint "$TMP" >/dev/null
sudo /bin/cp "$TMP" "$PLIST"
/bin/rm -f "$TMP"
sudo /usr/sbin/chown root:wheel "$PLIST"
sudo /bin/chmod 644 "$PLIST"

sudo /bin/launchctl bootstrap system "$PLIST"
sudo /bin/launchctl enable system/app.highgas.helper >/dev/null 2>&1 || true
sudo /bin/launchctl kickstart -k system/app.highgas.helper
sleep 1

# O teste roda como root porque os arquivos de certificado ficam intencionalmente protegidos.
if sudo /usr/bin/curl -fsS --max-time 5 --cacert "$CACERT" https://127.0.0.1:37654/v1/health >/dev/null; then
  echo "HighGAS Local seguro e WireGuard ativos."
  /usr/bin/open "$SITE/?highgas-local=1#highgas-helper=$T"
else
  echo "O serviço não respondeu. Log: $SYSTEM/helper-error.log"
  echo "Não vou abrir o HighGAS até o helper local estar saudável."
fi

echo "Pronto: sem Xcode. A interface HighGAS agora abre pelo próprio serviço local seguro."
read -k 1 '?Pressione qualquer tecla para fechar.'
echo
