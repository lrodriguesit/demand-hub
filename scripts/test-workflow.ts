/* Teste determinístico do motor de 4 atores (roda com npx tsx). */
import {
  ACOES_POR_ESTADO,
  proximasAcoes,
  precisaDeMim,
  aguardando,
  decisorDaDemanda,
} from "../src/domain/workflow";
import {
  StatusDemanda,
  TipoDemanda,
  aprovacoesPadrao,
  type Demand,
} from "../src/data/types";
import { Role } from "../src/domain/roles";

let falhas = 0;
const ok = (nome: string) => console.log("PASS " + nome);
const check = (cond: boolean, nome: string, extra?: string) => {
  if (cond) ok(nome);
  else {
    console.log("FAIL " + nome + (extra ? " — " + extra : ""));
    falhas++;
  }
};

function demanda(extra: Partial<Demand>): Demand {
  return {
    id: "d1",
    numero: "DEM-0001",
    titulo: "Test",
    descricao: "Desc",
    areaSolicitante: "Commercial",
    solicitante: "Ana",
    sponsor: "Carlos",
    tipo: TipoDemanda.ProjetoNovo,
    urgencia: 2,
    impactoNivel: 2,
    valorEstimado: 100000,
    horasEstimadas: 0,
    time: "",
    aprovacoes: [],
    avaliacoes: [],
    comentarios: [],
    anexos: [],
    score: {
      businessImpact: 3,
      riskOfNoExecution: 3,
      technicalChallenge: 3,
      revenuePotential: 3,
      strategicFit: 3,
      stakeholder: 3,
      urgency: 3,
    },
    status: StatusDemanda.Rascunho,
    finalPriority: null,
    ...extra,
  } as unknown as Demand;
}

function agir(d: Demand, acaoId: string, papeis: Role[], decisorDe?: string[], ctx: Record<string, unknown> = {}): Demand {
  const acoes = proximasAcoes(d, papeis, decisorDe as never);
  const acao = acoes.find((a) => a.id === acaoId);
  if (!acao) throw new Error(`ação ${acaoId} indisponível para ${papeis.join(",")} (${acoes.map((a) => a.id).join("|") || "nenhuma"})`);
  const guarda = acao.guarda(d);
  if (guarda !== true) throw new Error(`guarda bloqueou ${acaoId}: ${guarda}`);
  return { ...d, ...acao.apply(d, "Tester", ctx as never) };
}

/* ---- roteamento do gate por categoria ---- */
const gInfra = aprovacoesPadrao({ tipo: TipoDemanda.Infraestrutura });
check(gInfra.length === 1 && gInfra[0].nivel === "decisor", "gate único (infra)");
check(gInfra[0].responsavel.includes("Sambini"), "infra → Sambini", gInfra[0].responsavel);
const gApp = aprovacoesPadrao({ tipo: TipoDemanda.ProjetoNovo });
check(gApp[0].responsavel.includes("Gabriela"), "app → Gabriela", gApp[0].responsavel);
const gIa = aprovacoesPadrao({ tipo: TipoDemanda.ProjetoNovo, clasificacion: "ia" });
check(gIa[0].responsavel.includes("AI Decisor"), "ia → AI Decisor", gIa[0].responsavel);

/* ---- ciclo completo: Requester → PMO → Time Técnico → Decisor → PMO ---- */
let d = demanda({});
d = agir(d, "submeter", [Role.Solicitante]);
check(d.status === StatusDemanda.Nova, "1 requester submete → Nova/Triage");

d = agir(d, "aceitarTriagem", [Role.PMO]);
check(d.status === StatusDemanda.EmAnalise, "2 PMO aceita → Evaluation");

d = agir(d, "definirCapacity", [Role.TechLead], undefined, { time: "Internal Delivery", horasEstimadas: 60 });
check(d.horasEstimadas === 60, "3 time técnico define capacity");
check(d.abbottProjectType === "Minor Enhancement (ME)" || String(d.abbottProjectType).includes("Minor"), "3b <80h → Minor Enhancement", String(d.abbottProjectType));

d = agir(d, "enviarParaAprovacao", [Role.TechLead]);
check(d.status === StatusDemanda.EmAprovacao, "4 → Approval");
check(d.aprovacoes.length === 1 && d.aprovacoes[0].responsavel.includes("Gabriela"), "4b gate roteado p/ Gabriela (app)");
check(aguardando(d).includes("Gabriela"), "4c aguardando mostra decisor", aguardando(d));

/* decisor da área errada NÃO pode agir */
check(proximasAcoes(d, [Role.Decisor], ["infra"]).length === 0, "5 Sambini (infra) não vê o gate de Apps");
check(precisaDeMim(d, [Role.Decisor], ["app"]) === true, "5b Gabriela (app) tem pendência");
check(precisaDeMim(d, [Role.Decisor], ["ia"]) === false, "5c AI Decisor não tem pendência");
check(precisaDeMim(d, [Role.Admin, Role.Decisor], ["infra"]) === true, "5d Admin ignora restrição de área");

d = agir(d, "aprovarGate", [Role.Decisor], ["app"], { comentario: "ok", idServiceNow: "SN-123" });
check(d.status === StatusDemanda.Priorizada && d.dmcAprovado === true, "6 decisor aprova → Prioritized (DMC)");

d = agir(d, "definirPrioridade", [Role.PMO], undefined, { finalPriority: 1 });
d = agir(d, "iniciarExecucao", [Role.PMO]);
check(d.status === StatusDemanda.EmExecucao, "7 PMO prioriza e inicia execução");

d = agir(d, "concluir", [Role.TechLead]);
check(d.status === StatusDemanda.Concluida, "8 concluída");

/* ---- recusa do decisor exige justificativa e é terminal ---- */
let r = demanda({ tipo: TipoDemanda.Infraestrutura, status: StatusDemanda.EmAprovacao, aprovacoes: aprovacoesPadrao({ tipo: TipoDemanda.Infraestrutura }), horasEstimadas: 40, time: "Support" });
r = agir(r, "recusarGate", [Role.Decisor], ["infra"], { comentario: "sem budget" });
check(r.status === StatusDemanda.Recusada && r.dmcAprovado === false, "9 decisor recusa → Rejected");

/* ---- guarda: sem capacity não vai para aprovação ---- */
const semCap = demanda({ status: StatusDemanda.EmAnalise });
const acaoEnviar = ACOES_POR_ESTADO[StatusDemanda.EmAnalise].find((a) => a.id === "enviarParaAprovacao")!;
check(acaoEnviar.guarda(semCap) !== true, "10 guarda: capacity obrigatório antes da aprovação");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHAS`);
process.exit(falhas === 0 ? 0 : 1);

