// npm run ingest | db:init | db:seed | db:reset
import { resetDb, resolveDbPath } from './db';
import { ingestSources } from './ingest';
import { seedDemo, seedInit } from './seed';
import { addLink, syncTopicSources } from './links';
import { backfillHistory } from './backfill';

const cmd = process.argv[2];

switch (cmd) {
  case 'ingest': {
    seedInit();
    syncTopicSources();
    const report = await ingestSources({ force: process.argv.includes('--force') });
    console.table(report);
    break;
  }
  case 'link': {
    const r = await addLink(process.argv[3]);
    console.log(
      `${r.created ? 'Nova fonte' : 'Fonte existente'}: ${r.source.name} (${r.source.kind}) — ${r.via}. ${r.collected} itens coletados.${r.error ? ' Erro: ' + r.error : ''}`,
    );
    break;
  }
  case 'catchup': {
    const months = Number(process.argv[3]) || 24;
    console.table(await backfillHistory({ months, topics: process.argv.slice(4) }));
    break;
  }
  case 'init':
    seedInit();
    console.log(`Sources ready → ${resolveDbPath()}`);
    break;
  case 'seed':
    seedDemo();
    console.log(`Demo data seeded → ${resolveDbPath()}`);
    break;
  case 'reset':
    resetDb();
    console.log(`Database reset → ${resolveDbPath()}`);
    break;
  default:
    console.error('usage: cli.ts <ingest|link <url>|init|seed|reset>');
    process.exit(1);
}
