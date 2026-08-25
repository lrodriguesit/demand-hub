# PROMPT — Canvas App "IT Request Form" (formulário de entrada externo)

> Cole tudo abaixo da linha em um agente de código com o plugin de Canvas Apps
> (ou entregue a um desenvolvedor Power Platform). Este formulário fica **FORA**
> do app Intake Forms: é a porta de entrada para qualquer colaborador.

---

Crie um **Power Apps Canvas App** chamado **"IT Request Form"** — o formulário público de
abertura de demandas de TI da Abbott. Ele alimenta o app de gestão **"Intake Forms"**
(Power Apps Code App já existente), que faz triagem, avaliação, aprovação e priorização.

## Princípio número 1 — só pergunte o que o solicitante SABE responder

Este formulário é preenchido por **qualquer colaborador** (vendas, RH, finanças, fábrica),
não por gente de TI. Toda pergunta é em linguagem de negócio.

**NUNCA pergunte** (quem responde é o time técnico/PMO depois, dentro do Intake Forms):

| Campo proibido no formulário | Quem preenche depois |
|---|---|
| Esforço / horas / FTE | Time Técnico (etapa Avaliação) |
| Time de entrega (Internal/External/Support) | Time Técnico |
| Abbott Project Type (Minor Enhancement / RAPID / Phase 0) | Derivado automaticamente de horas e valor |
| Integrações necessárias | Time Técnico |
| Requisitos técnicos / arquitetura | Time Técnico |
| Solução proposta | Time Técnico |
| APP ID (código interno da aplicação) | Time Técnico |
| Classificação do portfólio (Infra / AI / Apps) | Derivada do tipo; PMO confirma |
| Notas de score (1 a 5) | **Calculadas automaticamente** (ver §4) |
| Prioridade no ranking | PMO |
| Nº ServiceNow / Nº do projeto | Gerado na aprovação |

## 1. Destino dos dados

Grave um registro na tabela Dataverse **`ardx_demanda`** (mesma que o Intake Forms lê).
Se a tabela ainda não estiver disponível no ambiente, use uma lista SharePoint com os
mesmos nomes lógicos de coluna e avise no fim.

Campos de sistema a preencher no envio:
- `ardx_status` = **506970000** (New — cai na triagem do PMO)
- `ardx_datasolicitacao` = `Now()`
- `ardx_numero` = deixe em branco (o Intake Forms numera) **ou** gere `DEM-####`
  sequencial se houver contador definido.

## 2. Telas (5 telas + confirmação)

Wizard curto, uma pergunta-tema por tela, barra de progresso "Etapa X de 5" no topo e
botões **Voltar / Continuar** no rodapé. Botão **"Salvar rascunho"** visível em todas as
telas (grava em coleção local `colRascunho` e restaura ao reabrir).

### Tela 1 — Quem é você e o que precisa
| Campo | Controle | Regra |
|---|---|---|
| `ardx_solicitante` | Texto **somente leitura** | `User().FullName` |
| `ardx_email` | Texto **somente leitura** | `User().Email` |
| `ardx_areasolicitante` | Dropdown obrigatório | Facilities · IT · Sales · Marketing · Finance · Human Resources · Supply Chain · Production · Quality · Regulatory · Legal |
| `ardx_sponsor` | Texto **somente leitura** (auto) | Preenchido pelo de-para da área (§3) |
| `ardx_titulo` | Texto obrigatório, máx. 120 | Placeholder: "Resuma em uma frase o que você precisa" |
| `ardx_descricao` | Texto multilinha obrigatório, mín. 30 | Placeholder: "Descreva a situação atual e o que gostaria que acontecesse" |

Ajuda contextual (ícone "?") ao lado do título: *"Uma demanda é um pedido de mudança,
melhoria ou correção que depende da TI. Não use este formulário para incidentes — para
sistema fora do ar, abra chamado no service desk."*

### Tela 2 — Por que isso importa
| Campo | Controle | Opções |
|---|---|---|
| `ardx_problemaresolve` | Texto multilinha obrigatório | "Qual problema isso resolve hoje?" |
| `ardx_objetivoprincipal` | Texto multilinha obrigatório | "O que muda quando estiver pronto?" |
| `ardx_consequencianaoexecucao` | **Dropdown** obrigatório | Aumento de custos · Risco regulatório · Risco operacional · Impacto ao cliente · Impacto reputacional · Exposição de segurança |
| `ardx_tipo` | Dropdown obrigatório | Projeto novo (506970000) · Melhoria de sistema (506970001) · Correção/bug (506970002) · Compliance/regulatório (506970003) · Infraestrutura (506970004) · Segurança da informação (506970005) · Automação/digitalização (506970006) |

### Tela 3 — Tamanho do impacto ★ (alimenta o score)
| Campo | Controle | Opções e valor |
|---|---|---|
| `ardx_impactoabrangencia` | **Cartões de escolha única** (não dropdown — é a pergunta mais importante) | 1 = Um usuário · 2 = Um processo · 3 = Um departamento / a organização · 4 = Infraestrutura de TI |
| `ardx_urgencia` | Dropdown obrigatório | Crítico (506970000) · Alto (506970001) · Médio (506970002) · Baixo (506970003) |
| `ardx_deadline` | Date picker opcional | "Existe uma data limite? (auditoria, contrato, lei)" |
| `ardx_valorestimado` | **Dropdown de faixas** (nunca caixa numérica livre) | Não sei estimar (0) · Até US$ 50k (25000) · US$ 50k–200k (125000) · US$ 200k–500k (350000) · Acima de US$ 500k (750000) |
| `ardx_rce` | Texto opcional | "RCE — número do projeto aprovado pela Gestão, se já existir" |

Abaixo dos cartões de impacto, mostre em tempo real:
> **Prioridade estimada: X.XX / 5.00** — calculada automaticamente pelas suas respostas.

### Tela 4 — Contexto (tudo opcional)
| Campo | Controle |
|---|---|
| `ardx_sistemasenvolvidos` | Combo box multi-seleção com busca — catálogo de aplicações (APP-0123 Salesforce CRM, APP-0456 SAP S/4HANA, APP-0789 ServiceNow ITSM, APP-0321 Workday HCM, APP-0654 Adobe Creative Cloud). Permitir "Não sei". |
| `ardx_areasenvolvidas` | Multi-seleção: Comercial · TI · Compras · RH · Finanças · Operações |
| `ardx_donoprocesso` | People picker opcional |
| `ardx_dadossensiveis` | Checkbox: "Envolve dados pessoais/sensíveis?" |
| `ardx_impactaseguranca` | Checkbox: "Tem impacto em segurança da informação?" |
| `ardx_requerauditoria` | Checkbox: "Existe exigência de auditoria/regulatória?" |
| Anexos | Componente de anexo, até **10 MB** por arquivo |

### Tela 5 — Revisar e enviar
Resumo em blocos com botão **[Editar]** por bloco (leva de volta à tela correspondente):
- **INFORMAÇÕES GERAIS** — título, solicitante, área, sponsor
- **PRIORIZAÇÃO** — impacto (x/4 + rótulo), urgência, faixa de valor, RCE,
  **Prioridade estimada X.XX / 5.00**
- **CLASSIFICAÇÃO** — tipo de demanda
- **CONTEXTO** — aplicações afetadas, áreas envolvidas, flags de compliance, anexos

Botão primário **"Enviar solicitação"**.

### Tela de confirmação
Ícone de sucesso + "Solicitação enviada", o número gerado, e o texto:
*"Sua solicitação foi para a triagem do PMO. Você receberá um e-mail a cada mudança de
status e pode acompanhar pelo Intake Forms."* Botões: **Abrir outra solicitação** e
**Acompanhar minhas solicitações** (link para o Intake Forms).

## 3. De-para de sponsor por área (preencher automático)

```
Facilities → Sambini          IT → Sambini
Sales → Carlos Mendes         Marketing → Carlos Mendes
Finance → Patricia Lima       Legal → Patricia Lima
Human Resources → Juliana Costa
Supply Chain → Roberto Almeida    Production → Roberto Almeida
Quality → Ana Beatriz Souza       Regulatory → Ana Beatriz Souza
```

## 4. Score automático — grave estas 3 notas ★

O app de gestão usa **3 critérios com pesos redondos**. O formulário calcula e grava:

| Coluna Dataverse | Critério | Peso | Fórmula a partir das respostas |
|---|---|---|---|
| `ardx_scorebusinessimpact` | Impacto no negócio | **50%** | Um usuário=2 · Um processo=3 · Departamento=4 · Infraestrutura=5 |
| `ardx_scoreurgency` | Urgência e risco | **30%** | Crítico=5 · Alto=4 · Médio=3 · Baixo=2 |
| `ardx_scorerevenue` | Retorno esperado | **20%** | Não sei=1 · <50k=2 · 50–200k=3 · 200–500k=4 · ≥500k=5 |

Prioridade final exibida = `impacto*0.5 + urgência*0.3 + retorno*0.2` (resultado 1.00–5.00).

Power Fx sugerido:
```powerfx
// Impacto (cartões): valor 1..4 selecionado em varAbrangencia
Set(varNotaImpacto,  Switch(varAbrangencia, 1,2, 2,3, 3,4, 4,5, 2));
Set(varNotaUrgencia, Switch(ddUrgencia.Selected.Value, "Crítico",5, "Alto",4, "Médio",3, 2));
Set(varNotaRetorno,  Switch(ddValor.Selected.Valor, 0,1, 25000,2, 125000,3, 350000,4, 5));
Set(varPrioridade,   varNotaImpacto*0.5 + varNotaUrgencia*0.3 + varNotaRetorno*0.2);
```

**Não mostre pesos nem "notas" como campo editável.** O solicitante vê apenas o número
final de prioridade estimada, como consequência das respostas dele.

## 5. Validações

- Título, descrição, área, problema, objetivo, consequência, tipo, impacto e urgência são
  **obrigatórios**; o botão Continuar fica desabilitado até a tela estar válida.
- Descrição com mínimo de 30 caracteres (contador visível).
- Anexo acima de 10 MB → mensagem de erro clara, sem travar o envio dos demais.
- Ao enviar: `Patch` na tabela; em caso de erro, manter os dados na tela e mostrar o erro.
- Duplo clique no envio não pode criar dois registros (desabilite o botão durante o Patch).

## 6. Identidade visual (obrigatória — igual à do Intake Forms)

```
Fundo #F4F6FA · Superfície #FFFFFF · Texto #1A2B3C · Título #0F1F30 · Secundário #64748B
Linha #E7EDF4 · Azul Abbott #007ACC · Azul escuro #005C99 · Navy #004982 · Azul claro #E6F3FB
Acento #7C35FF · Âmbar #E8590C · Verde #2F9E44 · Vermelho #E03131
Gradiente da marca: 60° de #006BB3 para #7C35FF
Fonte: Segoe UI/Inter · Cantos 12 · Sombra suave
```

- **Cabeçalho**: faixa superior de 3px em #007ACC; logo Abbott em cartão branco à
  esquerda; título "IT Request Form" e subtítulo "by LIT Digitall".
- Botão primário no gradiente da marca; secundário branco com borda.
- Cartões de escolha (impacto) com borda azul e leve elevação quando selecionados.
- Barra de progresso do wizard em #007ACC.
- **Layout responsivo** (o formulário será aberto em celular na fábrica): usar containers
  com `LayoutDirection` vertical, `FillPortions` explícito e largura relativa a
  `Parent.Width`.
- Idioma da interface: **português (pt-BR)**.

## 7. Notificações

Ao enviar com sucesso, dispare um Power Automate (ou `Office365Outlook.SendEmailV2`) para:
- **o solicitante** — confirmação com o resumo e o número;
- **o PMO** — "Nova solicitação em triagem", com título, área, prioridade estimada e link.

## 8. Entrega

Ao final, informe: telas criadas, colunas gravadas, onde ficou o cálculo do score, e
qualquer campo que você não conseguiu mapear na tabela de destino.
