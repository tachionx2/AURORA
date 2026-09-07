#!/bin/sh
# Esegue tutte le suite. Da lanciare dalla cartella del progetto:
#   sh test/tutti.sh
cd "$(dirname "$0")"
fail=0
for f in integrita.mjs logica.mjs puntatore.mjs video.mjs diagnostica.mjs layout.mjs larghezze.mjs resilienza.mjs offline.mjs percorsi.mjs applicazione.mjs; do
  printf '── %s ──\n' "$f"
  node "$f" 2>/dev/null | tail -2
  [ $? -ne 0 ] && fail=1
done
exit $fail
