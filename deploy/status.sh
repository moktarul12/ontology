#!/usr/bin/env bash
# Formatted VPS status. Run on the server:
#   ssh root@162.35.175.150 '/opt/apps/status.sh'
set -euo pipefail
cd /opt/apps

role() {
  case "$1" in
    manavsathi) printf "ManavSathi         public  http://162.35.175.150:4100/" ;;
    ontology) printf "Wikigraph          public  http://162.35.175.150:4101/" ;;
    expomela) printf "Stall booking      public  http://162.35.175.150:4102/" ;;
    redis)    printf "Wikigraph AI cache internal (no public port)" ;;
    caddy)    printf "HTTPS reverse proxy idle — nginx owns :80/:443" ;;
    *)        printf "-" ;;
  esac
}

echo "=== APPS ==="
printf "%-12s %-22s %s\n" "SERVICE" "STATUS" "ROLE"
printf "%-12s %-22s %s\n" "-------" "------" "----"
docker compose ps --format '{{.Service}}\t{{.Status}}\t{{.Ports}}' \
  | while IFS=$'\t' read -r svc status ports; do
      printf "%-12s %-22s %s\n" "$svc" "$status" "$(role "$svc")"
      if [[ -n "${ports:-}" ]]; then
        printf "%-12s %s\n" "" "ports: ${ports}"
      fi
    done

echo
echo "=== HOST ==="
df -h / | awk 'NR==1 || NR==2 {print "disk  " $0}'
free -h | awk 'NR==1 || /^Mem:/ {print "mem   " $0}'
echo "load  $(uptime)"
