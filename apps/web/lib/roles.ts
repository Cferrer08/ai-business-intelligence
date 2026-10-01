import type { WorkspaceRole } from "@insight/types";

const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
