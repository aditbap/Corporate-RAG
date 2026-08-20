export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type Action = 
  | 'documents:create'
  | 'documents:read'
  | 'documents:update'
  | 'documents:delete'
  | 'chat:create'
  | 'chat:read'
  | 'settings:read'
  | 'settings:update';

const ROLE_PERMISSIONS: Record<Role, Action[]> = {
  owner: [
    'documents:create', 'documents:read', 'documents:update', 'documents:delete',
    'chat:create', 'chat:read',
    'settings:read', 'settings:update'
  ],
  admin: [
    'documents:create', 'documents:read', 'documents:update', 'documents:delete',
    'chat:create', 'chat:read',
    'settings:read'
  ],
  member: [
    'documents:create', 'documents:read',
    'chat:create', 'chat:read'
  ],
  viewer: [
    'documents:read',
    'chat:read'
  ]
};

/**
 * Check if a role has permission to perform a specific action
 */
export function hasPermission(role: Role, action: Action): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes(action);
}

/**
 * Throw an error if the role does not have the required permission
 */
export function requirePermission(role: Role, action: Action): void {
  if (!hasPermission(role, action)) {
    throw new Error(`Permission denied: requires '${action}' action`);
  }
}
