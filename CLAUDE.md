# Brain Life — o escritório da vida

Cada subpasta é um **setor**: uma sessão do Claude Code aberta nela vira um personagem sentado na sala correspondente do escritório em pixel art (o Brain Office, http://localhost:3456). O setor é definido pelo nome da pasta, que está mapeado para uma área do layout em `~/.pixel-agents/config.json` (`standalone.areaMappings`).

| Pasta        | Sala         | Cuida de                                             | Fontes de dados                                          |
| ------------ | ------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| `agenda/`    | Agenda       | Calendário, tarefas do dia, lembretes, rotina        | Planner Life (calendar, tasks, reminders, schedule)      |
| `faculdade/` | Faculdade    | Disciplinas, provas, entregas, sessões de estudo     | Planner Life (subjects, study topics/sessions)           |
| `pesquisa/`  | Pesquisa     | Tecnologia, metas de aprendizado, pesquisa acadêmica | My Current Brain + Planner Life (research lines, papers) |
| `projetos/`  | Projetos     | Projetos paralelos: progresso, próximos passos       | Planner Life (projects, tasks) + repositórios em `../`   |
| `clientes/`  | Clientes     | CRM, próximas ações, entregas de clientes            | Planner Life (clients, projects, tasks, inbox)           |
| `pessoal/`   | Vida Pessoal | Hábitos, saúde, finanças pessoais, notas             | Planner Life (habits, notes, memory)                     |

O Planner Life e o My Current Brain agora fazem parte do Brain Office (`../services/planner` e `../services/brain`); os dados ficam em `../data`. Repositórios sem mapeamento sentam no **Central** (a sala de trabalho original).

## Regras comuns a todos os setores

- Português do Brasil, direto, sem emojis.
- **Ler é livre; escrever pede confirmação.** Antes de criar, alterar ou apagar qualquer coisa no Planner Life (tarefa, evento, cliente, hábito), mostre o que vai fazer e espere o "sim". Nunca envie e-mail nem convide pessoas.
- Datas relativas ("amanhã", "sexta") viram datas absolutas antes de gravar.
- Quando algo pertence a outro setor, diga qual setor deveria cuidar e registre como tarefa no Planner Life com o prefixo do setor (ex.: `[Faculdade] revisar capítulo 3`), em vez de resolver fora do seu escopo.
- O Brain Office sobe o Planner Core sozinho. Se as ferramentas `planner-life` retornarem `fetch failed`, o serviço caiu: avise e indique a aba Controle > Serviços para reiniciar. Para só ler dados, prefira `mcp__escritorio__ler_dados_da_vida`, que não depende do Core.

## Abrir o escritório

```powershell
.\abrir-escritorio.ps1            # abre uma aba do Windows Terminal por setor, cada uma rodando claude
.\abrir-escritorio.ps1 agenda faculdade   # só alguns setores
```
