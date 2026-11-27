/**
 * Security Rules Verification Matrix (Dirty Dozen Adversarial Payloads)
 * Evaluates Protocolo PACTO Firestore rules against all 12 RBAC & integrity attack vectors.
 */
export const DIRTY_DOZEN_PAYLOADS = [
  { id: 1, name: 'Identity Spoofing on Profile', target: '/users/victimUid', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Self-Assigned RBAC Escalation', target: '/role_assignments/myUid or /auditors/myUid', payload: { role: 'ADMIN' }, expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Blanket List Scraping', target: '/convivencias or /incidentes (unfiltered)', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Unverified Email Write', target: '/incidentes/i1', auth: { email_verified: false }, expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'ID Poisoning', target: '/incidentes/bad$id', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Shadow Ghost Field', target: '/protocol_configs/cfg1', payload: { backdoor: true }, expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Reporter Status Bypass', target: '/incidentes/i1', payload: { status: 'RESUELTO' }, expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Auditor Mutation Attempt', target: '/protocol_configs/cfg1 (as AUDITOR)', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Post-Closure Archive Mutation', target: '/incidentes/closedInc', payload: { resolutionNote: 'altered' }, expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'WORM Log & Incident Deletion', target: '/logs_auditoria/l1 or /incidentes/i1 (delete)', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Orphaned Incident Write', target: '/incidentes/i1', payload: { convivenciaId: 'missing' }, expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Value Type Poisoning', target: '/protocol_configs/c1', payload: { maxUavBudget: '8', fBlurRadiusPx: 5 }, expected: 'PERMISSION_DENIED' },
];
