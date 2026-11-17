#!/usr/bin/env bash
# Generate some traffic against the test app. Usage: ./traffic.sh [base_url] [rounds]
BASE="${1:-http://localhost:3000}"
ROUNDS="${2:-5}"

for i in $(seq 1 "$ROUNDS"); do
  curl -s -X POST "$BASE/seed?n=5" >/dev/null
  curl -s -X POST "$BASE/items" -H 'content-type: application/json' -d "{\"name\":\"item-$i\"}" >/dev/null
  curl -s "$BASE/items" >/dev/null
  curl -s "$BASE/items/$i" >/dev/null
  curl -s "$BASE/items/999999" >/dev/null   # 404
  curl -s "$BASE/self" >/dev/null           # distributed trace (client + server span)
  curl -s "$BASE/slow?ms=300" >/dev/null
  curl -s "$BASE/error" >/dev/null          # 500 + error log
  sleep 1
done
echo "sent $ROUNDS rounds of traffic to $BASE"
