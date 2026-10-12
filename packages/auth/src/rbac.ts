export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type Action = 
  | 'documents:create'
  | 'documents:read'
  | 'documents:update'
  | 'documents:delete'
  // "Own" variants apply only to documents the user uploaded themselves.
  | 'documents:update:own'
  | 'documents:delete:own'
  | 'folders:manage'
  | 'chat:create'
  | 'chat:read'
  | 'settings:read'
  | 'settings:update'
  | 'members:read'
  | 'members:manage'
  | 'library:update'
  | 'library:delete';

const ROLE_PERMISSIONS: Record<Role, Action[]> = {
  owner: [
    'documents:create', 'documents:read', 'documents:update', 'documents:delete', 'folders:manage',
    'chat:create', 'chat:read',
    'settings:read', 'settings:update',
    'members:read', 'members:manage', 'library:update', 'library:delete'
  ],
  admin: [
    'documents:create', 'documents:read', 'documents:update', 'documents:delete', 'folders:manage',
    'chat:create', 'chat:read',
    'settings:read',
    'members:read', 'members:manage', 'library:update'
  ],
  member: [
    'documents:create', 'documents:read',
    'documents:update:own', 'documents:delete:own',
    'chat:create', 'chat:read',
    'members:read'
  ],
  // Viewers consume the library's knowledge: they can read and ask questions (chat only
  // creates their own private conversations), but cannot change documents or folders.
  viewer: [
    'documents:read',
    'chat:create', 'chat:read',
    'members:read'
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

/**
 * Whether `role` may update/delete a document, given who uploaded it. Admins and
 * owners may touch any document; members only the ones they uploaded themselves.
 */
export function canMutateDocument(
  role: Role,
  verb: 'update' | 'delete',
  uploadedBy: string | null | undefined,
  userId: string,
): boolean {
  if (hasPermission(role, `documents:${verb}`)) return true;
  return hasPermission(role, `documents:${verb}:own`) && !!uploadedBy && uploadedBy === userId;
}
