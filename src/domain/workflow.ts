/* ============================================================
   Motor de ciclo de vida da demanda (fonte única da verdade).

   Substitui as 4 "máquinas de estado" paralelas que existiam
   (status + aprovações + scoring + estágios + DMC) por UM
   pipeline linear. Cada transição declara:
     - de qual estado parte e para qual vai
     - QUAL PAPEL pode executá-la (gating por papel, não por nome)
     - uma GUARDA: condição que precisa estar satisfeita
     - o que ela MUDA na demanda (apply)

   `proximasAcoes(demanda, papéis)` devolve as ações que o usuário
   atual pode tomar agora → alimenta o CTA "o que precisa de mim
   agora" e a caixa de entrada por papel.
   ============================================================ */

import {
  StatusDemanda,
  CRITERIO_CATEGORIA,
  aprovacoesPadrao,
  processoRecomendado,
  clasificacionEfetiva,
  CATEGORIA_RESPONSAVEL,
  CATEGORIA_VIEW_LABEL,
  type Categoria,
  type Demand,
  type Score,
  type AprovacaoStep,
  type NivelAprovacao,
} from "../data/types";
import { Role, ROLE_LABEL } from "./roles";

/* Mapeia o nível de aprovação (dado da demanda) para o papel RBAC.
   Fluxo de 4 atores: o gate único de aprovação é do DECISOR DA ÁREA. */
export const NIVEL_PARA_PAPEL: Record<NivelAprovacao, Role> = {
  decisor: Role.Decisor,
};

/* ---------------- Etapas do pipeline (para a timeline) ------ */
export const PIPELINE: { status: number; label: string; descricao: string }[] = [
  { status: StatusDemanda.Rascunho, label: "Draft", descricao: "Requester completing the request." },
  { status: StatusDemanda.Nova, label: "Triage", descricao: "PMO checks whether the request is complete enough." },
  { status: StatusDemanda.EmAnalise, label: "Evaluation", descricao: "Technical team scores the criteria and defines team/hours; PMO validates urgency." },
  { status: StatusDemanda.EmAprovacao, label: "Approval", descricao: "Area decisor decides: Infra → Sambini · Apps → Gabriela · AI → AI Decisor." },
  { status: StatusDemanda.Priorizada, label: "Prioritization", descricao: "PMO positions it in the ranking (score x capacity) and releases it for execution." },
  { status: StatusDemanda.EmExecucao, label: "Execution", descricao: "Project in progress." },
  { status: StatusDemanda.Concluida, label: "Completed", descricao: "Delivered." },
];

/** Índice da etapa no pipeline linear (estados laterais retornam -1). */
export function pipelineIndex(status: number): number {
  return PIPELINE.findIndex((p) => p.status === status);
}

/* ---------------- Guardas auxiliares ----------------------- */

/** Critérios validados, por categoria (negócio/técnico/pmo). */
export function avaliacaoCobertura(d: Demand) {
  const validados = new Set(d.avaliacoes.map((a) => a.criterio));
  const total = (Object.keys(CRITERIO_CATEGORIA) as (keyof Score)[]).length;
  const porCategoria = { negocio: false, pmo: false };
  // categoria coberta = TODOS os critérios dela validados
  const cats: Array<"negocio" | "pmo"> = ["negocio", "pmo"];
  for (const cat of cats) {
    const criteriosDaCat = (Object.keys(CRITERIO_CATEGORIA) as (keyof Score)[]).filter(
      (c) => CRITERIO_CATEGORIA[c] === cat,
    );
    porCategoria[cat] = criteriosDaCat.every((c) => validados.has(c));
  }
  return {
    validados: validados.size,
    total,
    completo: validados.size >= total,
    porCategoria,
  };
}

/** A demanda tem time e horas alocados (capacity definido pelo tech lead)? */
export function capacityDefinido(d: Demand): boolean {
  return !!d.time && d.horasEstimadas > 0;
}

/** Passo de aprovação pendente (gate único do decisor da área). */
export function proximaAprovacao(d: Demand): AprovacaoStep | undefined {
  return d.aprovacoes.find((a) => a.status === "pendente");
}

/** Decisor responsável pela demanda (roteado pela classificação). */
export function decisorDaDemanda(d: Demand): { nome: string; area: string; categoria: Categoria } {
  const categoria = clasificacionEfetiva(d);
  return {
    nome: CATEGORIA_RESPONSAVEL[categoria] === "—" ? "DMC Committee" : CATEGORIA_RESPONSAVEL[categoria],
    area: CATEGORIA_VIEW_LABEL[categoria],
    categoria,
  };
}

/* ---------------- Definição das ações ---------------------- */

export interface AcaoContexto {
  comentario?: string;
  time?: string;
  horasEstimadas?: number;
  finalPriority?: number | null;
  idServiceNow?: string;
  idProjeto?: string;
  rce?: string;
}

export interface Acao {
  id: string;
  label: string;
  /** Papéis que podem executar (estático). */
  papeis: Role[];
  /** Papéis que podem executar AGORA, dependendo do estado da demanda
      (ex.: em aprovação, só o papel do gate pendente). Sobrepõe `papeis`. */
  papeisDinamicos?: (d: Demand) => Role[];
  /** Ação restrita ao decisor DA ÁREA da demanda (roteamento por categoria). */
  restritaAreaDecisor?: boolean;
  /** Cor do botão (Mantine). */
  cor: string;
  /** Se a ação exige um comentário/justificativa. */
  exigeComentario?: boolean;
  /** Campos extras que a ação coleta antes de aplicar. */
  campos?: Array<"capacity" | "prioridade" | "serviceNow">;
  /** Guarda: retorna true se liberada, ou string com o motivo do bloqueio. */
  guarda: (d: Demand) => true | string;
  /** Produz as mudanças a aplicar na demanda. */
  apply: (d: Demand, ator: string, ctx: AcaoContexto) => Partial<Demand>;
}

const agora = () => new Date().toISOString();

/** Aplica decisão no passo de aprovação atual e devolve a lista atualizada. */
function decidirAprovacao(
  d: Demand,
  decisao: "aprovado" | "recusado",
  ator: string,
  comentario: string,
): AprovacaoStep[] {
  let decidiu = false;
  return d.aprovacoes.map((a) => {
    if (!decidiu && a.status === "pendente") {
      decidiu = true;
      return { ...a, status: decisao, acaoEm: agora(), comentario, responsavel: ator || a.responsavel };
    }
    return a;
  });
}

/* Catálogo de todas as ações do fluxo, indexado por estado de origem. */
export const ACOES_POR_ESTADO: Record<number, Acao[]> = {
  /* -------- Rascunho -------- */
  [StatusDemanda.Rascunho]: [
    {
      id: "submeter",
      label: "Submit request",
      papeis: [Role.Solicitante],
      cor: "blue",
      guarda: (d) =>
        d.titulo.trim() && d.descricao.trim() && d.areaSolicitante.trim()
          ? true
          : "Fill in title, description and area before submitting.",
      apply: () => ({ status: StatusDemanda.Nova }),
    },
  ],

  /* -------- Em triagem (Nova) -------- */
  [StatusDemanda.Nova]: [
    {
      id: "aceitarTriagem",
      label: "Accept & start evaluation",
      papeis: [Role.PMO],
      cor: "teal",
      guarda: () => true,
      apply: () => ({ status: StatusDemanda.EmAnalise }),
    },
    {
      id: "devolver",
      label: "Return to requester",
      papeis: [Role.PMO],
      cor: "yellow",
      exigeComentario: true,
      guarda: () => true,
      apply: () => ({ status: StatusDemanda.Devolvida }),
    },
    {
      id: "recusarTriagem",
      label: "Reject request",
      papeis: [Role.PMO],
      cor: "red",
      exigeComentario: true,
      guarda: () => true,
      apply: () => ({ status: StatusDemanda.Recusada }),
    },
  ],

  /* -------- Devolvida -------- */
  [StatusDemanda.Devolvida]: [
    {
      id: "reenviar",
      label: "Resend to triage",
      papeis: [Role.Solicitante],
      cor: "blue",
      guarda: (d) =>
        d.titulo.trim() && d.descricao.trim() ? true : "Fill in title and description.",
      apply: () => ({ status: StatusDemanda.Nova }),
    },
  ],

  /* -------- Em avaliação (scoring + capacity) -------- */
  [StatusDemanda.EmAnalise]: [
    {
      id: "definirCapacity",
      label: "Define team & hours (capacity)",
      papeis: [Role.TechLead],
      cor: "violet",
      campos: ["capacity"],
      guarda: () => true,
      apply: (_d, _ator, ctx) => {
        const horasEstimadas = ctx.horasEstimadas ?? _d.horasEstimadas;
        // Abbott Project Type derivado automaticamente do esforço/valor.
        const proc = processoRecomendado({ horasEstimadas, valorEstimado: _d.valorEstimado });
        return {
          time: ctx.time ?? _d.time,
          horasEstimadas,
          abbottProjectType: proc.projectType,
        };
      },
    },
    {
      id: "enviarParaAprovacao",
      label: "Complete evaluation → send to approval",
      // PMO orquestra, mas o Tech Lead que definiu o capacity também pode empurrar.
      papeis: [Role.PMO, Role.TechLead],
      cor: "teal",
      // Requisito para avançar: capacity definido. O scoring é recomendado
      // (alimenta a prioridade) mas NÃO bloqueia — evita beco sem saída.
      guarda: (d) =>
        capacityDefinido(d)
          ? true
          : "Define team & hours (capacity) before sending to approval.",
      // Recria o gate como PENDENTE ao entrar na aprovação, roteado para o
      // decisor da área da demanda (sem becos sem saída).
      apply: (d) => ({
        status: StatusDemanda.EmAprovacao,
        aprovacoes: aprovacoesPadrao(d),
      }),
    },
    {
      id: "devolverAvaliacao",
      label: "Return to requester",
      papeis: [Role.PMO],
      cor: "yellow",
      exigeComentario: true,
      guarda: () => true,
      apply: () => ({ status: StatusDemanda.Devolvida }),
    },
  ],

  /* -------- Em aprovação (gate único do decisor da área) -------- */
  [StatusDemanda.EmAprovacao]: [
    {
      id: "aprovarGate",
      label: "Approve (area decision)",
      papeis: [Role.Decisor],
      restritaAreaDecisor: true,
      cor: "green",
      campos: ["serviceNow"], // capturado no aceite (decisor)
      guarda: (d) => (proximaAprovacao(d) ? true : "No pending gate."),
      apply: (d, ator, ctx) => {
        const aprovacoes = decidirAprovacao(d, "aprovado", ator, ctx.comentario ?? "");
        // Gate único: a decisão do decisor da área ACEITA a demanda (DMC)
        const changes: Partial<Demand> = {
          aprovacoes,
          status: StatusDemanda.Priorizada,
          dmcAprovado: true,
          dmcData: agora(),
          dmcComentario: ctx.comentario ?? "",
        };
        if (ctx.idServiceNow) changes.idServiceNow = ctx.idServiceNow;
        if (ctx.idProjeto) changes.idProjeto = ctx.idProjeto;
        if (ctx.rce) changes.rce = ctx.rce;
        return changes;
      },
    },
    {
      id: "recusarGate",
      label: "Reject (area decision)",
      papeis: [Role.Decisor],
      restritaAreaDecisor: true,
      cor: "red",
      exigeComentario: true,
      guarda: (d) => (proximaAprovacao(d) ? true : "No pending gate."),
      apply: (d, ator, ctx) => ({
        aprovacoes: decidirAprovacao(d, "recusado", ator, ctx.comentario ?? ""),
        status: StatusDemanda.Recusada,
        dmcAprovado: false,
        dmcData: agora(),
        dmcComentario: ctx.comentario ?? "",
      }),
    },
  ],

  /* -------- Priorizada -------- */
  [StatusDemanda.Priorizada]: [
    {
      id: "definirPrioridade",
      label: "Set ranking priority",
      papeis: [Role.PMO],
      cor: "teal",
      campos: ["prioridade"],
      guarda: () => true,
      apply: (_d, _ator, ctx) => ({ finalPriority: ctx.finalPriority ?? _d.finalPriority }),
    },
    {
      id: "iniciarExecucao",
      label: "Start execution",
      papeis: [Role.PMO, Role.TechLead],
      cor: "blue",
      guarda: (d) =>
        d.finalPriority != null && d.finalPriority > 0
          ? capacityDefinido(d)
            ? true
            : "Define team & hours before starting."
          : "PMO must set the ranking priority first.",
      apply: () => ({ status: StatusDemanda.EmExecucao, projectStage: "Build" }),
    },
  ],

  /* -------- Em execução -------- */
  [StatusDemanda.EmExecucao]: [
    {
      id: "concluir",
      label: "Complete request",
      papeis: [Role.TechLead, Role.PMO],
      cor: "green",
      campos: ["serviceNow"],
      guarda: () => true,
      apply: (_d, _ator, ctx) => ({
        status: StatusDemanda.Concluida,
        projectStage: "Done",
        idProjeto: ctx.idProjeto ?? _d.idProjeto,
      }),
    },
  ],
};

/* ---------------- API pública ------------------------------ */

/** Ações disponíveis no estado atual da demanda (independente de papel). */
export function acoesDoEstado(status: number): Acao[] {
  return ACOES_POR_ESTADO[status] ?? [];
}

/** Papéis que podem executar a ação AGORA (dinâmicos sobrepõem estáticos). */
export function papeisDaAcao(acao: Acao, d: Demand): Role[] {
  return acao.papeisDinamicos ? acao.papeisDinamicos(d) : acao.papeis;
}

/** Ações que o usuário (com `papeis` e, para Decisores, `decisorDe`) pode
    acionar no estado atual. Ações `restritaAreaDecisor` só aparecem para o
    decisor da frente da demanda (Admin ignora a restrição). */
export function proximasAcoes(d: Demand, papeis: Role[], decisorDe?: Categoria[]): Acao[] {
  return acoesDoEstado(d.status).filter((a) => {
    if (!papeisDaAcao(a, d).some((p) => papeis.includes(p))) return false;
    if (a.restritaAreaDecisor && !papeis.includes(Role.Admin) && decisorDe !== undefined) {
      const cat = clasificacionEfetiva(d);
      // "otro" não tem decisor dedicado → qualquer decisor pode atuar
      if (cat !== "otro" && !decisorDe.includes(cat)) return false;
    }
    return true;
  });
}

/** Verdadeiro se ALGUMA ação do estado atual está liberada para o usuário. */
export function precisaDeMim(d: Demand, papeis: Role[], decisorDe?: Categoria[]): boolean {
  return proximasAcoes(d, papeis, decisorDe).some((a) => a.guarda(d) === true);
}

/** Texto curto do que a demanda aguarda agora (para listas/cards). */
export function aguardando(d: Demand): string {
  const acoes = acoesDoEstado(d.status);
  if (!acoes.length) {
    if (d.status === StatusDemanda.Concluida) return "Completed";
    if (d.status === StatusDemanda.Recusada) return "Rejected";
    return "—";
  }
  if (d.status === StatusDemanda.EmAprovacao) {
    const prox = proximaAprovacao(d);
    if (prox) return `Waiting on ${prox.responsavel}`;
  }
  const papeis = new Set(acoes.flatMap((a) => a.papeis));
  return `Waiting on ${[...papeis].map((p) => ROLE_LABEL[p]).join(" / ")}`;
}
