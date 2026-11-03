#!/usr/bin/env bash
# Compila Missiva e crea l'AppImage in dist-appimage/.
# Uso: scripts/build-appimage.sh
#
# I client ID OAuth si leggono da .env (vedi .env.example) e finiscono dentro il binario,
# così chi usa l'AppImage accede con Google e Microsoft senza configurare nulla.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

for var in MISSIVA_GOOGLE_CLIENT_ID MISSIVA_MICROSOFT_CLIENT_ID; do
  if [[ -z "${!var:-}" ]]; then
    echo "Attenzione: $var non impostata, l'accesso OAuth relativo andrà configurato a mano." >&2
  fi
done

# linuxdeploy porta con sé uno strip vecchio, che non riconosce le librerie di Arch.
export NO_STRIP=true
# linuxdeploy è a sua volta un'AppImage: così si estrae da sola e non richiede FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1

npm ci
npx tauri build --bundles appimage

version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -n1)"
out="$root/dist-appimage"
mkdir -p "$out"
cp -f "src-tauri/target/release/bundle/appimage/Missiva_${version}_amd64.AppImage" "$out/missiva_v${version}.AppImage"
chmod +x "$out/missiva_v${version}.AppImage"

echo
echo "AppImage pronta: $out/missiva_v${version}.AppImage"
