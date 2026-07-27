import { useAuth } from "../auth/AuthContext";
import type { Role } from "../domain/roles";
import type { Categoria } from "../data/types";

export interface CurrentUser {
  name: string;
  email: string;
  cargo: string;
  roles: Role[];
  /** Para Decisores: frentes do portfólio que o usuário decide. */
  decisorDe: Categoria[];
  photoUrl?: string;
}

/** Usuário (persona) logado, com seus papéis RBAC. */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) {
    return { name: "Guest", email: "", cargo: "", roles: [], decisorDe: [] };
  }
  return {
    name: user.displayName,
    email: user.email,
    cargo: user.cargo,
    roles: user.roles,
    decisorDe: user.decisorDe ?? [],
  };
}
