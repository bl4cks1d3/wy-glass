// Windows Task Scheduler for the daily/weekly curator runs (moved from the old web app).
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASKS = ['MyCurrentBrain-Daily', 'MyCurrentBrain-Weekly'];

const ps = (command: string) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeout: 30_000,
    windowsHide: true,
  });

export interface ScheduleStatus {
  supported: boolean;
  tasks: { name: string; state: string; nextRun: string | null; lastRun: string | null }[];
}

export async function scheduleStatus(): Promise<ScheduleStatus> {
  if (process.platform !== 'win32') return { supported: false, tasks: [] };
  try {
    const { stdout } = await ps(
      `$r = @(); foreach ($n in @('${TASKS.join("','")}')) { $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue; if ($t) { $i = $t | Get-ScheduledTaskInfo; $r += [pscustomobject]@{ name = $n; state = [string]$t.State; nextRun = if ($i.NextRunTime) { $i.NextRunTime.ToString('o') } else { $null }; lastRun = if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('o') } else { $null } } } }; ConvertTo-Json @($r) -Compress`,
    );
    const parsed = JSON.parse(stdout.trim() || '[]');
    return { supported: true, tasks: Array.isArray(parsed) ? parsed : [parsed] };
  } catch {
    return { supported: true, tasks: [] };
  }
}

export async function enableSchedule(dailyAt: string) {
  if (process.platform !== 'win32')
    return {
      ok: false,
      message: 'Agendamento automático só no Windows por enquanto. Use cron com scripts/run-agent.',
    };
  try {
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(repoRoot, 'scripts', 'schedule-agent.ps1'),
        '-DailyAt',
        dailyAt,
      ],
      { timeout: 60_000, windowsHide: true },
    );
    return {
      ok: true,
      message: `Agendado: coleta + análise todo dia às ${dailyAt} e Weekly Brain aos domingos.`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Falhou ao agendar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function disableSchedule() {
  try {
    await ps(
      `Unregister-ScheduledTask -TaskName ${TASKS.join(',')} -Confirm:$false -ErrorAction SilentlyContinue`,
    );
    return { ok: true, message: 'Agendamento removido.' };
  } catch (e) {
    return { ok: false, message: `Falhou: ${e instanceof Error ? e.message : String(e)}` };
  }
}
