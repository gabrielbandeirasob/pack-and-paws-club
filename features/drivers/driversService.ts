/**
 * Regras de status do motorista (puras, testaveis).
 * O banco usa o enum member_status: invited | active | disabled.
 */
export type MemberStatus = 'invited' | 'active' | 'disabled';

export function memberStatusFromActive(isActive: boolean): MemberStatus {
  return isActive ? 'active' : 'disabled';
}

export function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active';
}

export function memberStatusLabel(status: string | null | undefined): string {
  if (status === 'active') return 'Active';
  if (status === 'invited') return 'Invite pending';
  if (status === 'disabled') return 'Disabled';
  return 'Unknown';
}

export function fullNameOrFallback(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Driver';
}

/** Papel do membro: o convite cria motorista, mas o gestor tambem pode trazer outro gestor. */
export type MemberRole = 'manager' | 'driver';

export function normalizeRole(role: string | null | undefined): MemberRole {
  return role === 'manager' ? 'manager' : 'driver';
}

export function memberRoleLabel(role: string | null | undefined): string {
  return normalizeRole(role) === 'manager' ? 'Manager' : 'Driver';
}

/* ------------------------------------------------------------------ *
 * REMOCAO DE MOTORISTA DA EQUIPE
 *
 * "Excluir motorista" aqui NAO apaga a conta do usuario (isso exige a chave de
 * administrador do Supabase, que nao vive no app): remove o vinculo com a
 * organizacao — o motorista perde acesso a tudo e nao recebe mais rota.
 *
 * O que fica: as rotas ja feitas continuam no historico (routes.driver_id aponta
 * para o usuario, nao para o vinculo). O que muda: o nome dele deixa de aparecer
 * para o gestor (a leitura de profiles e por organizacao) e as rotas de HOJE em
 * diante ficariam sem motorista — por isso o aviso, e por isso a alternativa de
 * so desligar (Disable), que mantem o vinculo e o nome no historico.
 * ------------------------------------------------------------------ */

export type DriverRemovalCounts = {
  /** rotas de hoje em diante atribuidas a ele */
  futureRoutes: number;
  /** rotas ja passadas em que ele aparece */
  pastRoutes: number;
  /** true = o proprio gestor logado (a API tambem recusa: user_id <> auth.uid()) */
  isSelf: boolean;
};

export type DriverRemovalPlan = {
  /** false = nem mostrar o botao (o caso do proprio usuario) */
  allowed: boolean;
  title: string;
  message: string;
  /** true = sugerir "Disable" em vez de remover */
  offerDisable: boolean;
  /** rotulo do botao de confirmacao */
  confirmLabel: string;
};

export function driverRemovalPlan(name: string | null | undefined, counts: DriverRemovalCounts): DriverRemovalPlan {
  const driver = fullNameOrFallback(name);
  if (counts.isSelf) {
    return {
      allowed: false,
      title: 'Cannot remove yourself',
      message: 'This is the account you are signed in with. Ask another manager to remove it.',
      offerDisable: false,
      confirmLabel: 'Remove driver',
    };
  }

  const future = Math.max(0, counts.futureRoutes);
  const past = Math.max(0, counts.pastRoutes);

  if (future > 0) {
    const routes = `${future} ${future === 1 ? 'route' : 'routes'}`;
    return {
      allowed: true,
      title: `Remove ${driver} from the team?`,
      message:
        `${driver} is assigned to ${routes} from today on. Those routes stay in the app without a driver — assign them to someone else, or use “Disable” to keep the account and stop the assignments. ` +
        'The past routes are kept in the history.',
      offerDisable: true,
      confirmLabel: 'Remove anyway',
    };
  }

  if (past > 0) {
    return {
      allowed: true,
      title: `Remove ${driver} from the team?`,
      message:
        `${driver} loses access to the app and stops receiving push notifications right away. ` +
        `The ${past} past ${past === 1 ? 'route' : 'routes'} stay in the history, but the name will no longer show next to them.`,
      offerDisable: true,
      confirmLabel: 'Remove driver',
    };
  }

  return {
    allowed: true,
    title: `Remove ${driver} from the team?`,
    message: `${driver} loses access to the app and stops receiving push notifications right away. This cannot be undone by you — the account has to be invited again.`,
    offerDisable: false,
    confirmLabel: 'Remove driver',
  };
}
