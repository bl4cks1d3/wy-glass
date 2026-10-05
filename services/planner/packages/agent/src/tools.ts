export const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:4000";

export const SYSTEM_PROMPT = `Voce e o Personal Agent do Planner Life, um sistema operacional pessoal de IA.
Seu papel e ajudar o usuario a organizar tarefas, projetos, clientes (CRM),
disciplinas, pesquisa cientifica, habitos, inbox e agenda. Voce tem acesso
a ferramentas com CRUD completo (criar, listar, editar e excluir) para
tarefas, projetos, clientes, disciplinas, linhas de pesquisa, artigos,
habitos, tarefas do Google Tasks e eventos do Google Calendar (criar, mover,
cancelar -- nao so ler) -- alem de poder ler e-mails completos (read_email)
e ler/criar/buscar notas markdown no vault (Obsidian, se o usuario tiver
configurado, ou uma pasta local). Use a ferramenta apropriada sempre que
precisar mexer em algum desses dados. Responda sempre em portugues, de
forma direta e util. Nao invente dados: se precisar de uma informacao que
so existe no Planner Core, no Google ou no vault, use a ferramenta
apropriada em vez de supor.

Quando o usuario pedir para "pesquisar", "resumir" ou "escrever sobre" um
assunto, use SEMPRE create_research_note (nunca create_note sozinho) --
ela salva a nota E cria o artigo vinculado na aba Pesquisa, que e onde o
usuario vai olhar depois. Usar create_note pra isso deixa a nota orfa,
sem aparecer em lugar nenhum do dashboard. Reserve create_note pra
anotacoes soltas que o usuario mesmo pediu pra guardar sem ser pesquisa.

Quando o usuario pedir uma tarefa de programacao/terminal de verdade (mexer
em codigo de algum projeto, rodar um comando, corrigir um bug, criar um
script), use a ferramenta run_claude_code para registrar um pedido pro
Claude Code rodando no PC do usuario. Isso NAO executa nada na hora -- so
cria um pedido pendente que aparece no dashboard, e o usuario precisa
confirmar antes de rodar de verdade. Avise o usuario disso na sua resposta.

Suas respostas sao exibidas como texto simples (sem renderizar markdown),
entao nunca use tabelas, cabecalhos com # ou blocos de codigo. Para listas,
use um traco "-" por linha. Prefira paragrafos curtos.`;

/**
 * Schema neutro de ferramenta (JSON Schema puro), independente de provedor.
 * Cada provider (Anthropic, Groq/OpenAI, Gemini) adapta isso para o formato
 * que espera -- assim trocar de modelo de IA nunca exige duplicar a
 * definicao das ferramentas.
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Definicao das ferramentas que o Personal Agent pode usar. Cada uma delas
 * chama a API REST do Planner Core -- o agente nunca acessa o banco
 * diretamente, entao qualquer runtime de agente (PicoClaw, Hermes, etc.)
 * pode ser trocado no futuro sem perder essa integracao.
 */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "create_task",
    description: "Cria uma nova tarefa no Planner Life.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulo da tarefa" },
        projectId: { type: "string", description: "ID do projeto relacionado" },
        dueAt: { type: "string", description: "Prazo em ISO 8601, ex: 2026-09-15T18:00:00" },
        notes: { type: "string", description: "Notas adicionais" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description: "Lista tarefas existentes, opcionalmente filtrando por status ou projeto.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "cancelled"],
        },
        projectId: { type: "string" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Marca uma tarefa como concluida.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "update_task",
    description: "Edita titulo, prazo, notas ou projeto de uma tarefa (sem mexer no status).",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        projectId: { type: "string" },
        dueAt: { type: "string" },
        notes: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "delete_task",
    description: "Exclui uma tarefa permanentemente.",
    parameters: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "create_project",
    description: "Cria um novo projeto no Planner Life.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        goal: { type: "string", description: "Objetivo do projeto" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_projects",
    description: "Lista todos os projetos e seu progresso.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_project",
    description: "Edita o nome, objetivo ou progresso (0-100) de um projeto.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        goal: { type: "string" },
        progress: { type: "number" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "delete_project",
    description: "Exclui um projeto e todas as suas tarefas.",
    parameters: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "save_memory",
    description:
      "Salva uma informacao importante na memoria de longo prazo do usuario (preferencias, fatos, contexto recorrente).",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "list_memory",
    description: "Lista as informacoes salvas na memoria de longo prazo do usuario.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "delete_memory",
    description: "Remove uma informacao da memoria de longo prazo (ex: quando o usuario diz que algo nao vale mais).",
    parameters: {
      type: "object",
      properties: { memoryId: { type: "string" } },
      required: ["memoryId"],
    },
  },

  // CRM
  {
    name: "create_client",
    description: "Cria um cliente ou lead no CRM do Planner Life.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        stage: { type: "string", enum: ["lead", "contact", "proposal", "closed"] },
        value: { type: "number", description: "Valor estimado/fechado em reais" },
        nextAction: { type: "string", description: "Proxima acao a tomar com esse cliente" },
        nextActionAt: { type: "string", description: "Data da proxima acao, ISO 8601" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_clients",
    description: "Lista todos os clientes/leads do CRM.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_client",
    description: "Atualiza o estagio, valor ou proxima acao de um cliente do CRM.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        stage: { type: "string", enum: ["lead", "contact", "proposal", "closed"] },
        value: { type: "number" },
        nextAction: { type: "string" },
        nextActionAt: { type: "string" },
      },
      required: ["clientId"],
    },
  },
  {
    name: "delete_client",
    description: "Exclui um cliente/lead do CRM.",
    parameters: {
      type: "object",
      properties: { clientId: { type: "string" } },
      required: ["clientId"],
    },
  },

  // Estudos
  {
    name: "create_subject",
    description: "Cadastra uma disciplina/materia para acompanhar o progresso.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        note: { type: "string", description: "Ex: media atual, observacao" },
        examDate: { type: "string", description: "Data da proxima prova, ISO 8601 (opcional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_subjects",
    description: "Lista as disciplinas cadastradas, progresso e data de prova de cada uma.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_subject",
    description: "Atualiza o progresso (0-100), a nota ou a data de prova de uma disciplina.",
    parameters: {
      type: "object",
      properties: {
        subjectId: { type: "string" },
        progress: { type: "number" },
        note: { type: "string" },
        examDate: { type: "string", description: "ISO 8601" },
      },
      required: ["subjectId"],
    },
  },
  {
    name: "delete_subject",
    description: "Exclui uma disciplina.",
    parameters: {
      type: "object",
      properties: { subjectId: { type: "string" } },
      required: ["subjectId"],
    },
  },
  {
    name: "create_study_topic",
    description:
      "Adiciona um topico/assunto na checklist de conteudo de uma disciplina. Se vier com dueAt, vira " +
      "uma entrega/leitura com prazo (aparece em 'Entregas e leituras' dentro de Estudos).",
    parameters: {
      type: "object",
      properties: {
        subjectId: { type: "string" },
        title: { type: "string", description: "Ex: 'Capitulo 3 - Termodinamica' ou 'Entregar resenha'" },
        dueAt: { type: "string", description: "ISO 8601, so se for uma entrega/leitura com prazo" },
      },
      required: ["subjectId", "title"],
    },
  },
  {
    name: "list_study_topics",
    description: "Lista os topicos de estudo de uma disciplina (ou de todas, se subjectId nao for informado).",
    parameters: {
      type: "object",
      properties: { subjectId: { type: "string" } },
    },
  },
  {
    name: "set_study_topic_done",
    description: "Marca (ou desmarca) um topico de estudo como concluido.",
    parameters: {
      type: "object",
      properties: { topicId: { type: "string" }, done: { type: "boolean" } },
      required: ["topicId", "done"],
    },
  },
  {
    name: "delete_study_topic",
    description: "Remove um topico de estudo.",
    parameters: {
      type: "object",
      properties: { topicId: { type: "string" } },
      required: ["topicId"],
    },
  },
  {
    name: "create_schedule_block",
    description: "Adiciona um horario fixo semanal de estudo pra uma disciplina (cronograma).",
    parameters: {
      type: "object",
      properties: {
        subjectId: { type: "string" },
        dayOfWeek: { type: "number", description: "0=domingo, 1=segunda, ... 6=sabado" },
        startTime: { type: "string", description: "Ex: '19:00'" },
        endTime: { type: "string", description: "Ex: '21:00'" },
      },
      required: ["subjectId", "dayOfWeek", "startTime", "endTime"],
    },
  },
  {
    name: "list_schedule",
    description: "Lista o cronograma semanal de estudo (todos os horarios fixos, de todas as disciplinas).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "delete_schedule_block",
    description: "Remove um horario fixo do cronograma de estudo.",
    parameters: {
      type: "object",
      properties: { blockId: { type: "string" } },
      required: ["blockId"],
    },
  },
  {
    name: "list_study_sessions",
    description: "Lista as sessoes de estudo registradas (Pomodoro/tempo estudado) nos ultimos N dias.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Default 30" } },
    },
  },
  {
    name: "delete_study_session",
    description: "Remove uma sessao de estudo registrada por engano.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "log_study_session",
    description: "Registra manualmente uma sessao de estudo ja feita (ex: usuario diz 'estudei 30min de calculo agora').",
    parameters: {
      type: "object",
      properties: {
        subjectId: { type: "string" },
        durationMinutes: { type: "number" },
      },
      required: ["durationMinutes"],
    },
  },

  // Pesquisa
  {
    name: "create_research_line",
    description: "Cria uma linha de investigacao de pesquisa cientifica.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        stage: { type: "string", description: "Ex: revisao de literatura, escrita do metodo" },
        nextStep: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_research_lines",
    description: "Lista as linhas de investigacao de pesquisa.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_research_line",
    description: "Atualiza o estagio ou o proximo passo de uma linha de pesquisa.",
    parameters: {
      type: "object",
      properties: {
        lineId: { type: "string" },
        stage: { type: "string" },
        nextStep: { type: "string" },
      },
      required: ["lineId"],
    },
  },
  {
    name: "delete_research_line",
    description: "Exclui uma linha de pesquisa (os artigos ligados a ela ficam sem linha, mas nao sao excluidos).",
    parameters: {
      type: "object",
      properties: { lineId: { type: "string" } },
      required: ["lineId"],
    },
  },
  {
    name: "create_paper",
    description: "Adiciona um artigo cientifico na fila de leitura, opcionalmente ligado a uma linha de pesquisa.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        source: { type: "string", description: "Ex: arXiv, IEEE, ACM" },
        researchLineId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_papers",
    description: "Lista os artigos da fila de leitura, opcionalmente filtrando por linha de pesquisa.",
    parameters: {
      type: "object",
      properties: { researchLineId: { type: "string" } },
    },
  },
  {
    name: "update_paper_status",
    description: "Atualiza o status de leitura de um artigo.",
    parameters: {
      type: "object",
      properties: {
        paperId: { type: "string" },
        status: { type: "string", enum: ["na_fila", "em_leitura", "resumido"] },
      },
      required: ["paperId", "status"],
    },
  },
  {
    name: "delete_paper",
    description: "Remove um artigo da fila de leitura.",
    parameters: {
      type: "object",
      properties: { paperId: { type: "string" } },
      required: ["paperId"],
    },
  },
  {
    name: "create_research_note",
    description:
      "Escreve uma pesquisa/resumo como nota markdown no vault E cria o artigo correspondente na aba " +
      "Pesquisa ja vinculado a ela (status 'resumido'), pronto pra ser lido como um livro/artigo no " +
      "dashboard. Use isso (em vez de create_paper + create_note separados) sempre que o usuario pedir " +
      "pra 'pesquisar' ou 'resumir' um assunto.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Conteudo em markdown, comecando com '# Titulo'" },
        researchLineId: { type: "string" },
      },
      required: ["title", "content"],
    },
  },

  // Habitos
  {
    name: "create_habit",
    description: "Cria um habito para acompanhar (ex: beber agua, dormir, treinar).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        unit: { type: "string", description: "Ex: ml, copos, horas, sessoes" },
        target: { type: "number", description: "Meta diaria/periodica" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_habits",
    description: "Lista os habitos acompanhados e seu progresso atual.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_habit",
    description: "Atualiza o valor atual e/ou a meta de um habito.",
    parameters: {
      type: "object",
      properties: {
        habitId: { type: "string" },
        current: { type: "number" },
        target: { type: "number" },
      },
      required: ["habitId"],
    },
  },
  {
    name: "delete_habit",
    description: "Exclui um habito.",
    parameters: {
      type: "object",
      properties: { habitId: { type: "string" } },
      required: ["habitId"],
    },
  },

  // Inbox
  {
    name: "list_messages",
    description: "Lista as mensagens mais recentes do inbox do Planner Life (assunto e preview, sem o corpo completo).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_email",
    description: "Le o corpo completo de um e-mail sincronizado do Gmail (use o id retornado por list_messages).",
    parameters: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "mark_message_handled",
    description: "Marca uma mensagem do inbox como tratada (ou desfaz isso).",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        handled: { type: "boolean" },
      },
      required: ["messageId", "handled"],
    },
  },
  {
    name: "delete_message",
    description: "Exclui uma mensagem do inbox do Planner Life (so a copia local -- nao mexe no Gmail de verdade).",
    parameters: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "clear_inbox",
    description:
      "Apaga TODAS as mensagens do inbox do Planner Life de uma vez (so a copia local -- nao mexe no Gmail " +
      "de verdade, uma proxima sincronizacao traz de volta o que ainda estiver no Gmail). Use so quando o " +
      "usuario pedir explicitamente para limpar o inbox.",
    parameters: { type: "object", properties: {} },
  },

  // Google Tasks
  {
    name: "list_google_tasks",
    description: "Lista as tarefas do Google Tasks (conta Google conectada).",
    parameters: {
      type: "object",
      properties: { account: { type: "string", description: "E-mail da conta, se houver mais de uma conectada" } },
    },
  },
  {
    name: "create_google_task",
    description: "Cria uma tarefa no Google Tasks.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string", description: "Data em ISO 8601" },
        account: { type: "string", description: "E-mail da conta, se houver mais de uma conectada" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_google_task",
    description: "Atualiza titulo, notas, prazo ou status de uma tarefa do Google Tasks.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string" },
        status: { type: "string", enum: ["needsAction", "completed"] },
        account: { type: "string", description: "E-mail da conta, se houver mais de uma conectada" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "delete_google_task",
    description: "Exclui uma tarefa do Google Tasks.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        account: { type: "string", description: "E-mail da conta, se houver mais de uma conectada" },
      },
      required: ["taskId"],
    },
  },

  // Google (Calendar, status, sincronizacao)
  {
    name: "list_calendar_events",
    description: "Lista os proximos eventos de todas as agendas do Google Calendar conectadas (inclui agendas compartilhadas, como a da familia).",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Quantidade maxima de eventos (default 10)" } },
    },
  },
  {
    name: "check_google_status",
    description: "Verifica quais contas Google estao conectadas (Gmail/Calendar/Tasks).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "sync_gmail",
    description: "Forca uma nova sincronizacao do Gmail agora, buscando as mensagens mais recentes.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Quantas mensagens buscar por conta (default 10)" },
        account: { type: "string", description: "Sincronizar so uma conta especifica (opcional)" },
      },
    },
  },
  {
    name: "disconnect_google_account",
    description: "Desconecta uma conta Google (Gmail/Calendar/Tasks param de funcionar para ela).",
    parameters: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
    },
  },

  // Notas (Obsidian / vault local em markdown)
  {
    name: "list_notes",
    description:
      "Lista todas as notas markdown do vault (Obsidian, se configurado, ou a pasta local de notas). " +
      "Retorna titulo, caminho e data de atualizacao de cada uma.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_note",
    description: "Le o conteudo completo de uma nota markdown do vault.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Caminho da nota, ex: 'Pesquisas/artigo.md'" } },
      required: ["path"],
    },
  },
  {
    name: "search_notes",
    description: "Busca notas do vault por titulo ou conteudo.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "create_note",
    description:
      "Cria (ou sobrescreve, se ja existir) uma nota markdown no vault. Use para salvar resumos, " +
      "pesquisas, resenhas ou qualquer conteudo que o usuario queira guardar como nota.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho da nota, ex: 'Pesquisas/artigo.md' (cria pastas se precisar)" },
        content: { type: "string", description: "Conteudo em markdown (comece com '# Titulo')" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_note",
    description: "Apaga uma nota do vault.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },

  // Google Calendar (CRUD completo -- nao so leitura)
  {
    name: "create_calendar_event",
    description: "Cria um evento novo no Google Calendar (calendario principal da conta).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "Data/hora de inicio em ISO 8601" },
        end: { type: "string", description: "Data/hora de fim em ISO 8601" },
        description: { type: "string" },
        account: { type: "string", description: "E-mail da conta, se houver mais de uma conectada" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "update_calendar_event",
    description: "Move, renomeia ou edita um evento existente no Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        start: { type: "string", description: "ISO 8601" },
        end: { type: "string", description: "ISO 8601" },
        description: { type: "string" },
        account: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "delete_calendar_event",
    description: "Cancela (exclui) um evento do Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        account: { type: "string" },
      },
      required: ["eventId"],
    },
  },

  // Delegacao para o Claude Code (terminal)
  {
    name: "run_claude_code",
    description:
      "Registra um PEDIDO PENDENTE para o Claude Code rodar no terminal do PC do usuario " +
      "(modo nao-interativo `claude -p`) -- nao executa nada ainda, so cria o pedido para o " +
      "usuario confirmar no dashboard. Use para pedidos como 'mexe no codigo do projeto X', " +
      "'roda os testes', 'cria um script', 'corrige esse bug' -- qualquer coisa que exija ler/editar " +
      "arquivos ou rodar comandos de verdade na maquina. So use quando o usuario pedir uma tarefa " +
      "de codigo/terminal explicitamente.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Instrucao a enviar para o Claude Code" },
        cwd: {
          type: "string",
          description: "Pasta do projeto onde rodar (default: CLAUDE_CODE_CWD do .env, ou o diretorio atual)",
        },
      },
      required: ["prompt"],
    },
  },
];

async function coreFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${CORE_API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Planner Core respondeu ${res.status}: ${body}`);
  }
  return res.json();
}

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "create_task":
      return coreFetch("/tasks", { method: "POST", body: JSON.stringify(input) });
    case "list_tasks": {
      const params = new URLSearchParams(input as Record<string, string>);
      return coreFetch(`/tasks?${params.toString()}`);
    }
    case "complete_task":
      return coreFetch(`/tasks/${input.taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
    case "update_task": {
      const { taskId, ...rest } = input;
      return coreFetch(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_task":
      return coreFetch(`/tasks/${input.taskId}`, { method: "DELETE" });

    case "create_project":
      return coreFetch("/projects", { method: "POST", body: JSON.stringify(input) });
    case "list_projects":
      return coreFetch("/projects");
    case "update_project": {
      const { projectId, ...rest } = input;
      return coreFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_project":
      return coreFetch(`/projects/${input.projectId}`, { method: "DELETE" });

    case "save_memory":
      return coreFetch("/memory", {
        method: "POST",
        body: JSON.stringify({ ...input, source: "personal-agent" }),
      });
    case "list_memory":
      return coreFetch("/memory");
    case "delete_memory":
      return coreFetch(`/memory/${input.memoryId}`, { method: "DELETE" });

    case "create_client":
      return coreFetch("/clients", { method: "POST", body: JSON.stringify(input) });
    case "list_clients":
      return coreFetch("/clients");
    case "update_client": {
      const { clientId, ...rest } = input;
      return coreFetch(`/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_client":
      return coreFetch(`/clients/${input.clientId}`, { method: "DELETE" });

    case "create_subject":
      return coreFetch("/subjects", { method: "POST", body: JSON.stringify(input) });
    case "list_subjects":
      return coreFetch("/subjects");
    case "update_subject": {
      const { subjectId, ...rest } = input;
      return coreFetch(`/subjects/${subjectId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_subject":
      return coreFetch(`/subjects/${input.subjectId}`, { method: "DELETE" });

    case "create_study_topic":
      return coreFetch("/study/topics", { method: "POST", body: JSON.stringify(input) });
    case "list_study_topics": {
      const params = new URLSearchParams(input.subjectId ? { subjectId: input.subjectId as string } : {});
      return coreFetch(`/study/topics?${params.toString()}`);
    }
    case "set_study_topic_done":
      return coreFetch(`/study/topics/${input.topicId}`, {
        method: "PATCH",
        body: JSON.stringify({ done: input.done }),
      });
    case "delete_study_topic":
      return coreFetch(`/study/topics/${input.topicId}`, { method: "DELETE" });

    case "create_schedule_block":
      return coreFetch("/study/schedule", { method: "POST", body: JSON.stringify(input) });
    case "list_schedule":
      return coreFetch("/study/schedule");
    case "delete_schedule_block":
      return coreFetch(`/study/schedule/${input.blockId}`, { method: "DELETE" });

    case "list_study_sessions": {
      const params = new URLSearchParams(input.days ? { days: String(input.days) } : {});
      return coreFetch(`/study/sessions?${params.toString()}`);
    }
    case "delete_study_session":
      return coreFetch(`/study/sessions/${input.sessionId}`, { method: "DELETE" });
    case "log_study_session": {
      const now = new Date();
      const durationMinutes = Number(input.durationMinutes);
      const startedAt = new Date(now.getTime() - durationMinutes * 60_000).toISOString();
      return coreFetch("/study/sessions", {
        method: "POST",
        body: JSON.stringify({
          subjectId: input.subjectId,
          durationMinutes,
          startedAt,
          endedAt: now.toISOString(),
        }),
      });
    }

    case "create_research_line":
      return coreFetch("/research/lines", { method: "POST", body: JSON.stringify(input) });
    case "list_research_lines":
      return coreFetch("/research/lines");
    case "update_research_line": {
      const { lineId, ...rest } = input;
      return coreFetch(`/research/lines/${lineId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_research_line":
      return coreFetch(`/research/lines/${input.lineId}`, { method: "DELETE" });
    case "create_paper":
      return coreFetch("/research/papers", { method: "POST", body: JSON.stringify(input) });
    case "list_papers": {
      const params = new URLSearchParams(input as Record<string, string>);
      return coreFetch(`/research/papers?${params.toString()}`);
    }
    case "update_paper_status":
      return coreFetch(`/research/papers/${input.paperId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: input.status }),
      });
    case "delete_paper":
      return coreFetch(`/research/papers/${input.paperId}`, { method: "DELETE" });

    case "create_research_note": {
      const title = String(input.title ?? "").trim();
      const content = String(input.content ?? "");
      if (!title || !content) throw new Error("title e content sao obrigatorios");
      const slug = title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      const notePath = `Pesquisas/${slug || "nota"}-${Date.now()}.md`;
      await coreFetch("/vault/note", { method: "POST", body: JSON.stringify({ path: notePath, content }) });
      return coreFetch("/research/papers", {
        method: "POST",
        body: JSON.stringify({
          title,
          status: "resumido",
          notePath,
          researchLineId: input.researchLineId,
        }),
      });
    }

    case "create_habit":
      return coreFetch("/habits", { method: "POST", body: JSON.stringify(input) });
    case "list_habits":
      return coreFetch("/habits");
    case "update_habit": {
      const { habitId, ...rest } = input;
      return coreFetch(`/habits/${habitId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_habit":
      return coreFetch(`/habits/${input.habitId}`, { method: "DELETE" });

    case "list_messages":
      return coreFetch("/messages");
    case "read_email": {
      // So devolve o texto pro agente -- o HTML bruto e so pra renderizar
      // no dashboard, jogar ele no contexto da IA seria ruido inutil.
      const { html: _html, ...rest } = (await coreFetch(
        `/integrations/google/gmail/${encodeURIComponent(input.messageId as string)}/body`
      )) as { from: string; subject: string; text: string; html: string };
      return rest;
    }
    case "mark_message_handled":
      return coreFetch(`/messages/${input.messageId}/handled`, {
        method: "PATCH",
        body: JSON.stringify({ handled: input.handled }),
      });
    case "delete_message":
      return coreFetch(`/messages/${input.messageId}`, { method: "DELETE" });
    case "clear_inbox":
      return coreFetch("/messages", { method: "DELETE" });

    case "list_google_tasks": {
      const params = new URLSearchParams(input as Record<string, string>);
      return coreFetch(`/integrations/google/tasks?${params.toString()}`);
    }
    case "create_google_task":
      return coreFetch("/integrations/google/tasks", { method: "POST", body: JSON.stringify(input) });
    case "update_google_task": {
      const { taskId, ...rest } = input;
      return coreFetch(`/integrations/google/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(rest) });
    }
    case "delete_google_task": {
      const params = new URLSearchParams(
        input.account ? { account: input.account as string } : {}
      );
      return coreFetch(`/integrations/google/tasks/${input.taskId}?${params.toString()}`, { method: "DELETE" });
    }

    case "list_calendar_events": {
      const params = new URLSearchParams(input as Record<string, string>);
      return coreFetch(`/integrations/google/calendar?${params.toString()}`);
    }
    case "check_google_status":
      return coreFetch("/integrations/google/status");
    case "sync_gmail": {
      const params = new URLSearchParams(input as Record<string, string>);
      return coreFetch(`/integrations/google/sync-gmail?${params.toString()}`, { method: "POST" });
    }
    case "disconnect_google_account":
      return coreFetch(`/integrations/google/accounts/${encodeURIComponent(input.email as string)}`, {
        method: "DELETE",
      });

    case "list_notes":
      return coreFetch("/vault/notes");
    case "read_note":
      return coreFetch(`/vault/note?path=${encodeURIComponent(input.path as string)}`);
    case "search_notes":
      return coreFetch(`/vault/search?q=${encodeURIComponent(input.query as string)}`);
    case "create_note":
      return coreFetch("/vault/note", { method: "POST", body: JSON.stringify(input) });
    case "delete_note":
      return coreFetch(`/vault/note?path=${encodeURIComponent(input.path as string)}`, { method: "DELETE" });

    case "create_calendar_event":
      return coreFetch("/integrations/google/calendar/events", { method: "POST", body: JSON.stringify(input) });
    case "update_calendar_event": {
      const { eventId, ...rest } = input;
      return coreFetch(`/integrations/google/calendar/events/${encodeURIComponent(eventId as string)}`, {
        method: "PATCH",
        body: JSON.stringify(rest),
      });
    }
    case "delete_calendar_event": {
      const params = new URLSearchParams(input.account ? { account: input.account as string } : {});
      return coreFetch(`/integrations/google/calendar/events/${encodeURIComponent(input.eventId as string)}?${params.toString()}`, {
        method: "DELETE",
      });
    }

    default:
      throw new Error(`ferramenta desconhecida: ${name}`);
  }
}
