export const ORG_ROLES = ["ADMIN", "MEMBER"] as const;
export type OrgRoleConst = (typeof ORG_ROLES)[number];
