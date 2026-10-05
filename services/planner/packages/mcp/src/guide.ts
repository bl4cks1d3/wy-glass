// Guia que o Claude le antes de construir. Serve de recurso MCP, de ferramenta
// (planner_guide) e de base do prompt "construir-sistema".
export const GUIDE = `# Como construir no Planner Life

Voce e o construtor: a partir da situacao que o usuario descrever, monte o **banco de dados**, os **blocos** (telas) e o **painel** (em canvas). Tudo pelas ferramentas deste servidor; nao edite arquivos para isso.

## Fluxo
1. Entenda a situacao. Faca no maximo 3 perguntas, so se faltar algo que muda o modelo (ex.: "cada sessao tem valor?"). Senao, assuma o razoavel e diga o que assumiu.
2. Modele os dados: uma **colecao** por entidade (\`save_collection\`). Nomes em minusculas_com_underscore. Se houver dados iniciais que o usuario forneceu, \`import_records\`.
3. Crie os **blocos** (\`save_block\`): normalmente (a) um resumo/indicadores, (b) uma lista/tabela por colecao com botao "Novo" e edicao em modal, (c) o que for especifico (agenda da semana, funil, grafico de barras).
4. Monte o **painel** (\`save_dashboard\`) com \`mode: "canvas"\` e os blocos posicionados (x 0-11, y linha, w colunas, h linhas de 40px).
5. Diga ao usuario: abra **Painéis**, e em **Construtor** revise e **aprove** cada bloco (eles nascem aguardando aprovacao; sem aprovar, nao acessam dados).

## Banco de dados (colecoes)
- \`save_collection\`: name (a-z 0-9 _), label, fields: [{name, label?, type, required?, options?}]. Tipos: text, longtext, number, date (ISO), boolean, select (exige options).
- Campos reservados: id, createdAt, updatedAt (todo registro ja os tem).
- \`save_record\` (create/update), \`import_records\` (varios), \`list_records\` (q, sort, order, limit, filtros por campo), \`delete_record\`.
- Alterar o esquema depois (adicionar campos) nao apaga dados. Excluir colecao apaga os registros.
- Alem das suas colecoes existem os modulos nativos (tarefas, projetos, clientes, estudos, habitos, agenda...): use as ferramentas nativas ou os recursos nativos nos blocos quando servirem, em vez de recriar.

## Blocos
Bloco = html (dentro de <div id="root">) + css + js + permissoes {read, write, tools}. Roda isolado (sem rede/cookies). js:

    planner.main(async function (ctx) { ... });   // roda ao carregar, a cada refreshSeconds e em ctx.refresh()

ctx: root, escape(txt) [SEMPRE em innerHTML], refresh(), data.list(r, params) | create(r, corpo) | update(r, id, corpo) | remove(r, id), tool(nome, args), ui.modal({title,size,html,css?,js?}) -> valor de planner.close(v), ui.confirm(msg) -> boolean, ui.toast(msg, "ok|warn|error").
Recurso de uma colecao sua: **"col:<nome>"** (ex.: ctx.data.list("col:pacientes", {sort:"nome"})) e precisa estar em read/write do bloco. Recursos nativos: tasks, projects, clients, subjects, study_topics, schedule, study_sessions, research_lines, papers, habits, memory, messages, events, notes, calendar, google_tasks.
Declare so as permissoes necessarias; ferramentas em \`tools\` por nome (inclusive de outros servidores MCP).

### Design system (ja injetado; use so estas classes)
layout: pl-stack pl-row pl-row-between pl-row-end pl-wrap pl-grow pl-grid pl-card | texto: pl-title pl-subtitle pl-muted pl-big pl-link | botoes: pl-btn (+pl-btn-primary|pl-btn-danger|pl-btn-sm) | forms: pl-field(label+controle) pl-input pl-select pl-textarea | dados: pl-badge(-ok|-warn|-accent) pl-bar(<i style="width:60%">) pl-table pl-list pl-tabs pl-tab pl-empty | cores: var(--pl-accent|--pl-muted|--pl-border|--pl-fg).

### Modal
O modal roda em iframe proprio por cima do dashboard e herda as permissoes do bloco. Padrao (ex.: cadastro em colecao):

    function modalMain(ctx) {                     // vira o JS do modal via toString()
      var box = ctx.root.querySelector("[data-id]"); var id = box.getAttribute("data-id");
      ctx.root.querySelector("#cancelar").onclick = function () { planner.close(null); };
      ctx.root.querySelector("#salvar").onclick = async function () {
        var corpo = { nome: ctx.root.querySelector("#nome").value.trim() };
        if (!corpo.nome) return;
        if (id) await ctx.data.update("col:pacientes", id, corpo); else await ctx.data.create("col:pacientes", corpo);
        planner.close(true);
      };
    }
    // no bloco:
    var ok = await ctx.ui.modal({ title: "Paciente", size: "sm", js: "planner.main(" + modalMain.toString() + ");",
      html: '<div class="pl-stack" data-id="' + ctx.escape(id || "") + '"><div class="pl-field"><label>Nome</label><input class="pl-input" id="nome" value="' + ctx.escape(nome || "") + '"></div>' +
            '<div class="pl-row pl-row-end"><button class="pl-btn" id="cancelar">Cancelar</button><button class="pl-btn pl-btn-primary" id="salvar">Salvar</button></div></div>' });
    if (ok) ctx.refresh();

Passe dados ao modal pelo html (data-*), nunca por variaveis (o modal e outro documento). Nao ha fetch, localStorage, links externos.

## Regras
- Blocos que voce cria/edita ficam **aguardando aprovacao**; nunca tente aprovar. Editar revoga.
- Blocos e paineis embutidos (builtin-*) nao se editam: leia com get_block e crie uma versao nova.
- Seja defensivo no JS (lista vazia, erro de rede, campo ausente).
- Para mudar o **proprio Planner Life** (codigo) so quando blocos/colecoes nao bastarem: trabalhe numa branch/worktree, rode \`pnpm typecheck\`, mostre o diff e NAO faca commit/push sem o usuario pedir. Nunca toque em .env nem em data/.
`;
