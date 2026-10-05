# Construtor: blocos, painéis e banco sob medida

O Planner Life tem dois lados sobre os mesmos dados:

- **Construtor** (aba _Construtor_): cria **blocos** — pedaços de tela em HTML + CSS + uma função JS que lê/grava dados e chama ferramentas.
- **Painéis** (aba _Painéis_): monta blocos em um painel, em **modo Dashboard** (grade de 12 colunas) ou **modo Canvas** (posição livre, fundo navegável). Há um painel **Básico** embutido; os seus você monta (ou o Claude monta, ver [MCP.md](MCP.md)).

E há o **banco sob medida**: _coleções_ (tabelas) que você ou o Claude definem, acessíveis pelos blocos como `col:<nome>`.

```
   você / Claude ──► coleções (esquema + registros) ──┐
        │                                              ▼
        └────────► blocos (html+css+js) ──► painel (grade ou canvas)
                        ▲   ponte com permissões   │
                        └── dados nativos · ferramentas/MCP
```

## 1. Bloco

| Parte                 | O que é                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `html`                | Marcação inicial, dentro de `<div id="root">`                                                  |
| `css`                 | Estilos do bloco                                                                               |
| `js`                  | Código; chame `planner.main(async function (ctx) { ... })`                                     |
| `permissions`         | `read`, `write` (recursos) e `tools` (ferramentas por nome). **Sem declarar, nada é acessado** |
| `refreshSeconds`      | 0 = uma vez; senão reexecuta a função a cada N s (mínimo 5)                                    |
| `source` / `approved` | `builtin` \| `user` \| `agent` e se o usuário aprovou as permissões                            |

A função principal roda ao carregar, a cada `refreshSeconds` e quando o bloco chama `ctx.refresh()`.

### API do `ctx`

| API                                                             | Precisa de    | Descrição                                                                                             |
| --------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `ctx.root`                                                      | —             | O elemento `#root`                                                                                    |
| `ctx.escape(txt)`                                               | —             | Escapa HTML. **Use sempre** ao inserir dados em `innerHTML`                                           |
| `ctx.refresh()`                                                 | —             | Reexecuta a função                                                                                    |
| `ctx.data.list(r, params?)`                                     | `read`        | Lista. `params` viram query (`{limit: 10}`; em `col:` aceita `q`, `sort`, `order`, filtros por campo) |
| `ctx.data.create(r, corpo)`                                     | `write`       | Cria                                                                                                  |
| `ctx.data.update(r, id, corpo)`                                 | `write`       | Edita (`tasks` com só `status` usa a rota de status)                                                  |
| `ctx.data.remove(r, id)`                                        | `write`       | Exclui                                                                                                |
| `ctx.tool(nome, args)`                                          | `tools`       | Chama ferramenta do agente ou de servidor MCP (`mcp__servidor__ferramenta`)                           |
| `ctx.ui.modal({title, size, width?, height?, html, css?, js?})` | —             | Modal de **tela cheia**; devolve o valor de `planner.close(v)`                                        |
| `ctx.ui.confirm(msg, {confirmLabel?, cancelLabel?})`            | —             | Confirmação; devolve `true`/`false`                                                                   |
| `ctx.ui.toast(msg, "ok"\|"warn"\|"error")`                      | —             | Aviso temporário                                                                                      |
| `planner.close(valor)`                                          | (só em modal) | Fecha o modal devolvendo o valor                                                                      |

`size` do modal: `sm` 420 px, `md` 560, `lg` 820 (ou `width` 280–1000). A altura acompanha o conteúdo (ou `height` fixo 120–720). `Esc` e clicar fora fecham (devolve `undefined`).

### Recursos

| Recurso                                                                                 | Ler |    Gravar     | Campos principais                                         |
| --------------------------------------------------------------------------------------- | :-: | :-----------: | --------------------------------------------------------- |
| `tasks`                                                                                 |  ✓  |       ✓       | id, title, status, projectId?, dueAt?, notes?             |
| `projects`                                                                              |  ✓  |       ✓       | id, name, goal?, progress                                 |
| `clients`                                                                               |  ✓  |       ✓       | id, name, stage, value, nextAction?                       |
| `subjects`                                                                              |  ✓  |       ✓       | id, name, progress, note?, examDate?                      |
| `study_topics`                                                                          |  ✓  |       ✓       | id, subjectId, title, done, dueAt?                        |
| `schedule`, `study_sessions`, `research_lines`, `papers`, `messages`, `events`, `notes` |  ✓  |       —       | ver [DATA-MODEL.md](DATA-MODEL.md)                        |
| `habits`                                                                                |  ✓  |       ✓       | id, name, unit, target, current                           |
| `memory`                                                                                |  ✓  | criar/excluir | id, content, tags                                         |
| `calendar`                                                                              |  ✓  |       —       | id, title, start, end?, calendarName (`{limit}`)          |
| `google_tasks`                                                                          |  ✓  |       ✓       | id, title, due?, status                                   |
| **`col:<nome>`**                                                                        |  ✓  |       ✓       | os campos que **você** definiu + id, createdAt, updatedAt |

## 2. Design system

Injetado em todo bloco e modal. O Claude e você montam telas **só com estas classes**, e o resultado tem a cara do dashboard. A aba **COMPONENTES** do Construtor mostra cada um e insere o HTML no bloco.

| Grupo         | Classes                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Layout        | `pl-stack` `pl-row` `pl-row-between` `pl-row-end` `pl-wrap` `pl-grow` `pl-grid` `pl-card`                                         |
| Texto         | `pl-title` `pl-subtitle` `pl-muted` `pl-big` `pl-link`                                                                            |
| Botões        | `pl-btn` + `pl-btn-primary` \| `pl-btn-danger` \| `pl-btn-sm`                                                                     |
| Formulário    | `pl-field` (label + controle) `pl-input` `pl-select` `pl-textarea`                                                                |
| Dados         | `pl-badge` (+ `-ok` `-warn` `-accent`) `pl-bar` (`<i style="width:60%">`) `pl-table` `pl-list` `pl-tabs` `pl-tab` `pl-empty`      |
| Modal interno | `pl-modal-backdrop` `pl-modal` `pl-modal-title` `pl-modal-actions` (cobre só a área do bloco; para tela cheia use `ctx.ui.modal`) |
| Variáveis     | `--pl-fg` `--pl-muted` `--pl-accent` `--pl-border` `--pl-surface` `--pl-ok` `--pl-warn` `--pl-radius`                             |

O CSS está em `apps/web/lib/design-system.ts`.

### Modal — padrão

O modal é **outro documento** (iframe próprio) que **herda as permissões** do bloco que o abriu. Passe dados pelo HTML (`data-*`), não por variáveis. O truque `Function.toString()` evita escrever o JS do modal como string:

```js
function modalMain(ctx) {
  // vira o JS do modal
  var id = ctx.root.querySelector('[data-id]').getAttribute('data-id');
  ctx.root.querySelector('#cancelar').onclick = function () {
    planner.close(null);
  };
  ctx.root.querySelector('#salvar').onclick = async function () {
    var corpo = { nome: ctx.root.querySelector('#nome').value.trim() };
    if (!corpo.nome) return;
    if (id) await ctx.data.update('col:alunos', id, corpo);
    else await ctx.data.create('col:alunos', corpo);
    planner.close(true);
  };
}

planner.main(async function (ctx) {
  // ... ao clicar em "Novo" ou num item:
  var ok = await ctx.ui.modal({
    title: 'Aluno',
    size: 'sm',
    js: 'planner.main(' + modalMain.toString() + ');',
    html:
      '<div class="pl-stack" data-id="' +
      ctx.escape(id || '') +
      '">' +
      '<div class="pl-field"><label>Nome</label><input class="pl-input" id="nome" value="' +
      ctx.escape(nome || '') +
      '"></div>' +
      '<div class="pl-row pl-row-end"><button class="pl-btn" id="cancelar">Cancelar</button>' +
      '<button class="pl-btn pl-btn-primary" id="salvar">Salvar</button></div></div>',
  });
  if (ok) ctx.refresh();
});
```

O bloco embutido **Tarefas** usa exatamente isso (clique no título de uma tarefa).

## 3. Segurança

Um bloco é código de terceiros (você, um agente, um arquivo importado). Por isso:

| Camada                   | Como                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Isolamento**           | Cada bloco roda em `<iframe sandbox="allow-scripts">` (origem opaca): sem cookies, `localStorage`, `parent.document` nem navegação do topo |
| **Sem rede**             | CSP `connect-src 'none'`, `img-src data: blob:`, `default-src 'none'`: `fetch`/XHR e imagens externas são bloqueados                       |
| **Sem injeção**          | `script-src` só aceita o _nonce_ do runtime e do `js` do bloco; `<script>` e `onerror=` no HTML do bloco não executam                      |
| **Ponte com permissões** | Dados e ferramentas só por `postMessage` → dashboard, que confere `read`/`write`/`tools` **a cada chamada**                                |
| **Aprovação**            | Bloco de agente/importado só roda depois de aprovado no Construtor. Editar código ou permissões **revoga** a aprovação                     |
| **Ferramentas vetadas**  | `run_claude_code` e `use_skill` nunca podem ser chamadas por bloco (a ponte e o Agent recusam)                                             |
| **Agent**                | `/tools/call` só aceita chamadas da própria máquina e de `Origin` conhecida                                                                |
| **Limites**              | 120 chamadas/5 s por bloco, resposta ≤ 1 MB, modais até 2 níveis, 100 KB por campo de código                                               |

Testado com um bloco hostil (aprovado, só com leitura de `tasks`): `fetch`, XHR, leitura de `memory`, escrita em `tasks`, ferramenta não declarada, `run_claude_code`, `parent.document`, `localStorage`, cookies, `top.location`, `<script>` injetado e `onerror` foram todos bloqueados.

**Limitações honestas:**

- Um bloco aprovado **pode ler o que lhe foi permitido** — a aprovação é o controle. Ele não consegue enviar isso para fora por rede, mas pode navegar o _próprio_ iframe para uma URL com dados (o runtime bloqueia cliques em links, não `location=`). Aprove só código que você leu.
- A aprovação é uma proteção de **interface**, não controle de acesso: as APIs não têm autenticação (ver [SPEC.md §8](SPEC.md)). Quem alcança o Core pode criar um bloco já com `approved:true`.

## 4. Painéis

- Cada item guarda **duas geometrias**: `grid` (colunas 0–11, linha, largura em colunas, altura em linhas de 40 px) e `canvas` (pixels). O modo alterna qual é exibida/editada; um lado é derivado do outro quando só um é informado. Editar num modo não move o outro.
- **Editar layout**: arrastar pela barra, redimensionar pelo canto, `+ Bloco`, `×` (tira do painel). Salva sozinho (0,5 s depois).
- **Janela estreita (< 720 px)** no modo Dashboard: os blocos empilham em coluna única.
- O painel **Básico** e os blocos `builtin-*` são embutidos (reaplicados a cada subida do Core): só leitura, use **Duplicar**.
- Excluir um bloco o remove de todos os painéis que o usam.

## 5. Banco sob medida (coleções)

Uma **coleção** é uma tabela com esquema; cada **registro** é validado contra ele.

| Tipo de campo                         | Valida                                   |
| ------------------------------------- | ---------------------------------------- |
| `text` (≤ 2000), `longtext` (≤ 20000) | texto                                    |
| `number`                              | número finito (aceita `"41"`, vira `41`) |
| `date`                                | data ISO (`2026-09-30`)                  |
| `boolean`                             | `true`/`false`                           |
| `select`                              | um dos `options` (obrigatório informar)  |

- Nome da coleção: `a-z`, `0-9`, `_`, começa com letra, 2–40 caracteres. Nome de campo: idem (1–40). `id`, `createdAt`, `updatedAt` são reservados.
- Campo `required` é exigido na criação. Campo desconhecido → erro. `null` num `PATCH` limpa o campo.
- Alterar o esquema **não apaga** dados; excluir a coleção apaga os registros. Máximo 10 000 registros por coleção, 40 campos.
- Consulta: `?q=` (busca em todos os campos), `?sort=&order=asc|desc`, `?limit=&offset=`, e `?campo=valor` (igualdade).
- Nos blocos: `ctx.data.list("col:alunos", {sort: "nome"})`, com `col:alunos` em `read`/`write`. O Construtor lista suas coleções nas permissões.
- Por API/MCP: ver [API.md](API.md) e [MCP.md](MCP.md).

## 6. Como criar um bloco

**No Construtor:** `+ Novo bloco` → escreva HTML/CSS/JS (a pré-visualização recarrega ao parar de digitar; o console mostra `console.log` e erros) → marque as permissões → **Salvar e aprovar**.

**Com IA (no Construtor):** descreva o bloco em "Gerar com IA". O Personal Agent usa a skill `criar-bloco` e cria o bloco **aguardando aprovação**. _Nota:_ no free tier do Groq o limite de 8 000 tokens por requisição pode bloquear turnos longos ([AGENT.md](AGENT.md)); para construir sistemas maiores use o Claude Code via MCP.

**Com o Claude Code (recomendado para sistemas inteiros):** [MCP.md](MCP.md).
