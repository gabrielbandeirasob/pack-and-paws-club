#!/usr/bin/env python3
"""Aplica uma migracao .sql no Supabase do Pack & Paws e confere o resultado.

Uso:
    python3 apply_migration.py supabase/migrations/202609120022_exclusoes_e_tokens.sql

Por que existe: a migracao precisa ser aplicada no banco de verdade (nao basta o arquivo
existir no repositorio), e o resultado tem de ser CONFERIDO por consulta — foi assim que
se confirmou a politica nova em pg_policies.
"""
import json, re, sys, urllib.request
from pathlib import Path

REF = "bhuexxjcrjdhkmsvagdw"
ENV = Path("/opt/data/.env")


def token() -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*PACKPAWS_SUPABASE_TOKEN\s*=\s*(.*)", line)
        if m:
            return m.group(1).strip().strip('"').strip("'").split("#")[0].strip()
    raise SystemExit("FALTA PACKPAWS_SUPABASE_TOKEN em /opt/data/.env")


def run_sql(sql: str) -> list:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        body = resp.read().decode()
    return json.loads(body) if body.strip() else []


def main() -> None:
    arquivo = Path(sys.argv[1])
    sql = arquivo.read_text(encoding="utf-8")

    # Comentarios de linha nao atrapalham o endpoint, mas o BEGIN/COMMIT solto sim: o
    # endpoint ja roda o lote numa transacao. Remove as duas linhas de controle.
    sql = re.sub(r"(?mi)^\s*(begin|commit)\s*;\s*$", "", sql)

    resultado = run_sql(sql)
    print("SQL aplicado:", arquivo)
    print("  retorno:", resultado)

    conferencia = run_sql(
        "select policyname, cmd, qual from pg_policies "
        "where schemaname = 'public' and tablename = 'device_tokens' order by policyname;"
    )
    print("politicas em device_tokens (conferencia):")
    for linha in conferencia:
        print("  -", linha)


if __name__ == "__main__":
    main()
