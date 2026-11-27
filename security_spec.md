# Security Specification & Payload-First TDD — Protocolo PACTO (RBAC + Incidentes + Auditoría)

## 1. Data Invariants & RBAC Segregation of Duties
1. **PII Isolation**: User profiles (`/users/{userId}`) contain email and identity metadata and are readable/writable strictly by `request.auth.uid == userId` or verified admin (`dcpracmatic@gmail.com` or `/admins/{uid}`). Blanket `isSignedIn()` reads are forbidden.
2. **Trusted Role Sources (No Client Claims)**: Authoritative RBAC privileges (`ADMIN` via `/admins/{uid}`, `AUDITOR` via `/auditors/{uid}`, and assignments via `/role_assignments/{uid}`) are verified via Firestore lookups and can ONLY be created/modified by `isAdmin()`. Users cannot self-assign `ADMIN` or `AUDITOR`.
3. **Incident Reporters (`/incidentes/{incidenteId}`)**:
   - Verified reporters can `create` incidentes with `reporterId == request.auth.uid`, initial `status == 'REPORTADO'`, and an existing parent `convivenciaId` verified via `exists()`.
   - Reporters can `get`/`list` only their own incidents (`resource.data.reporterId == request.auth.uid`) and update only `description`/`evidenceHash` while `status == 'REPORTADO'`.
   - Deleting incidents is forbidden for all roles (`allow delete: if false`).
4. **Protocol Administrators (`S-ADMIN`)**:
   - Can create, update, and deactivate `/protocol_configs/{configId}` and `/role_assignments/{userId}`, and triage `/incidentes/{incidenteId}` (`status`, `severity`, `resolutionNote`, `assignedAdminUid`) prior to terminal `CERRADO_AUDITADO`.
   - Operate with **Pericial Blindness**: cannot alter or delete WORM audit logs (`/logs_auditoria`), incident provenance (`reporterId`, `folioFisico`, `convivenciaId`), or sealed `STATE_4_CLOSED` courtroom hashes without an audit trace.
5. **Traceability Auditors (`AUDITOR`)**:
   - Strictly read-only (`get`, `list`) across `/logs_auditoria`, `/incidentes`, `/protocol_configs`, `/role_assignments`, and `/convivencias` (plus subcollections).
   - Zero write/modify/delete permissions on protocol rules, incidents, or audit logs to guarantee separation of duties.
6. **Immutable Audit Trail (WORM)**: Documents in `/logs_auditoria/{logId}` are append-only (`allow update, delete: if false;`), preserving forensic non-repudiation.
7. **Terminal State Locking**: Once `convivencias.fsmState == 'STATE_4_CLOSED'` or `incidentes.status == 'CERRADO_AUDITADO'`, non-admin updates are rejected.
8. **CSG Cryptographic Notarization (`/convivencias/{convivenciaId}/notarias/{notariaId}`)**:
   - Append-only subcollection (`allow update, delete: if false`) gated by parent `convivenciaId` ownership or operational/admin staff; `AUDITOR` holds strictly read-only access.
   - Enforces exact SHA3-256 hex (64 chars) and Ed25519 signature hex (128 chars) field validation plus `folioFisico` matching `^[0-9]{8}$`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Profile**: `POST /users/victimUid` with `{ uid: "victimUid" }` -> `PERMISSION_DENIED`.
2. **Self-Assigned RBAC Escalation**: Non-admin `CREATE /role_assignments/myUid` or `CREATE /auditors/myUid` -> `PERMISSION_DENIED`.
3. **Blanket List Scraping**: `LIST /convivencias` or `LIST /incidentes` without `where` owner/reporter filter by non-admin/non-auditor -> `PERMISSION_DENIED`.
4. **Unverified Email Write**: `CREATE /incidentes/i1` with `email_verified: false` -> `PERMISSION_DENIED`.
5. **ID Poisoning**: `CREATE /incidentes/bad$id_1500chars` -> `PERMISSION_DENIED` (`isValidId`).
6. **Shadow Ghost Field**: `UPDATE /protocol_configs/cfg1` with `{ maxUavBudget: 8, backdoor: true }` -> `PERMISSION_DENIED`.
7. **Reporter Status Bypass**: Reporter `CREATE /incidentes/i1` with `status: "RESUELTO"` or `UPDATE` changing `severity: "CRITICA"` -> `PERMISSION_DENIED`.
8. **Auditor Mutation Attempt**: Pure `AUDITOR` attempting `UPDATE /incidentes/i1` or `CREATE /protocol_configs/c1` -> `PERMISSION_DENIED`.
9. **Post-Closure Archive Mutation**: `UPDATE /convivencias/closedCase` or `UPDATE /incidentes/closedInc` -> `PERMISSION_DENIED`.
10. **WORM Log & Incident Deletion**: `DELETE /logs_auditoria/l1` or `DELETE /incidentes/i1` -> `PERMISSION_DENIED`.
11. **Orphaned Incident Write**: `CREATE /incidentes/i1` referencing non-existent `convivenciaId` -> `PERMISSION_DENIED` (`exists()` Master Gate).
12. **Value Type Poisoning**: `CREATE /protocol_configs/c1` with `maxUavBudget: "8"` (string) or `fBlurRadiusPx: 5` (below minimum 25px privacy bound) -> `PERMISSION_DENIED`.
