#!/usr/bin/env bash
# Compila Missiva e crea il pacchetto Arch in dist-arch/.
# Uso: scripts/build-arch.sh [--install]
#
# I client ID OAuth si leggono da .env (vedi .env.example) e finiscono dentro il binario,
# così chi installa il pacchetto accede con Google e Microsoft senza configurare nulla.
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

out="$root/dist-arch"
mkdir -p "$out"
cd packaging/arch
# -s installa le dipendenze mancanti con pacman, -f sovrascrive un pacchetto già creato.
PKGDEST="$out" BUILDDIR="$root/src-tauri/target/makepkg" makepkg -sf --noconfirm "$@"

echo
echo "Pacchetto pronto:"
ls -1 "$out"/missiva-*.pkg.tar.zst
[[ " $* " == *" --install "* ]] || echo "Per installarlo: sudo pacman -U $(ls -1t "$out"/missiva-*.pkg.tar.zst | head -n1)"
