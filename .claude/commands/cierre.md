# /cierre — planilla-arca

Repo único, estático (GitHub Pages), remoto `GuilloSGit/planilla-arca` (público). Sin atribución a Claude en commits/PR (regla global del usuario).

1. **Estado git:** `git status --short`, `git log --oneline -5`.
2. **Datos fuera del repo (obligatorio antes de push):** `git ls-files | grep -Eci '\.(pdf|xlsx|zip)$|tests/local/'` debe dar `0`.
3. **Verificación:** `npm test` (los tests de `referencia` se saltean si no hay `tests/local/ocr`). Si algo falla, no se sigue.
4. **Docs:** actualizar solo lo que cambió (`README.md`; `NEXT_TASK.md` se sobrescribe). Docs chicos: sin rotación necesaria.
5. **Memoria:** `~/.claude/projects/-Users-guillermoandrada-Projects-planilla-arca/memory/`.
6. **Commit** (Conventional Commits) y **push** solo si el usuario lo pidió en ese cierre.
7. **NEXT_TASK.md:** sobrescribir con el prompt para la próxima sesión y mostrarlo en la respuesta final.
