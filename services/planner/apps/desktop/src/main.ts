import { app, BrowserWindow, Menu, Notification, shell } from "electron";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import * as path from "node:path";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const WEB_URL = "http://localhost:4300";
const AGENT_URL = "http://localhost:4100";

const HEALTH_CHECKS = [
  "http://localhost:4000/health", // core
  "http://localhost:4100/health", // agent
  "http://localhost:4200/health", // voice
];

const children: ChildProcess[] = [];

/**
 * `shell: true` aqui e seguro porque nenhum argumento vem de entrada
 * externa (sao literais fixos) -- e e o jeito mais confiavel de rodar
 * "pnpm" no Windows sem se preocupar se o shim e .cmd, .exe ou .ps1.
 * `windowsHide` evita que cada processo abra sua propria janela de
 * console visivel no Windows -- sem isso, um app GUI (Electron) rodando
 * `shell:true` faz o Windows criar um console novo por cmd.exe intermediario.
 * `detached` (fora do Windows) faz o processo virar lider do proprio grupo,
 * pra dar pra matar a arvore inteira com `kill(-pid)` depois.
 */
function spawnManaged(args: string[]): ChildProcess {
  const child = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  children.push(child);
  return child;
}

/**
 * O app desktop nao reimplementa nada do backend -- ele so sobe os mesmos
 * processos que `pnpm dev` sobe na mao (core, agent, web, voice, p2p-node)
 * e aponta uma janela nativa pra eles, em vez do usuario abrir o navegador
 * e digitar localhost:4300.
 */
function startBackend(): void {
  spawnManaged(["dev"]);
  spawnManaged(["--filter", "@planner-life/p2p-node", "dev"]);
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => undefined);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function stopBackend(): void {
  for (const child of children) killTree(child);
  children.length = 0;
}

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(onTick: (msg: string) => void): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const results = await Promise.all(HEALTH_CHECKS.map(isUp));
    const webUp = await isUp(WEB_URL);
    const readyCount = results.filter(Boolean).length;
    onTick(`Iniciando serviços locais… (${readyCount}/${HEALTH_CHECKS.length}, dashboard ${webUp ? "ok" : "…"})`);
    if (results.every(Boolean) && webUp) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Tempo esgotado esperando os serviços locais subirem.");
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: false,
    frame: false,
    center: true,
    backgroundColor: "#1d1d1f",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html>
      <html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
        background:#1d1d1f;color:#fff;font-family:-apple-system,Segoe UI,sans-serif;">
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:800;margin-bottom:10px;">Planner Life</div>
          <div id="status" style="font-size:13px;color:#a1a1a8;">Iniciando…</div>
        </div>
        <script>
          window.setStatus = (t) => { document.getElementById('status').textContent = t; };
        </script>
      </body></html>`)
  );
  return splash;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Planner Life",
    backgroundColor: "#f5f5f7",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(WEB_URL);
  return win;
}

interface PendingNotification {
  id: string;
  title: string;
  body: string;
}

/**
 * E aqui que o Jarvis "avisa sozinho": o agent (scheduler.service.ts) enfileira
 * notificacoes (resumo da manha, compromisso chegando) e este poller mostra
 * como notificacao nativa do SO assim que aparecem, marcando como vista em
 * seguida pra nao repetir.
 */
function startNotificationPolling(): void {
  setInterval(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/notifications/pending`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const items = (await res.json()) as PendingNotification[];
      for (const item of items) {
        if (Notification.isSupported()) {
          new Notification({ title: item.title, body: item.body }).show();
        }
        fetch(`${AGENT_URL}/notifications/${item.id}/ack`, { method: "POST" }).catch(() => undefined);
      }
    } catch {
      // agent ainda nao subiu ou reiniciou -- tenta de novo no proximo tick
    }
  }, 30_000);
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Planner Life",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Recarregar",
            accelerator: "CmdOrCtrl+R",
            click: (_i, win) => win instanceof BrowserWindow && win.reload(),
          },
          {
            label: "Ferramentas do desenvolvedor",
            accelerator: "F12",
            click: (_i, win) => win instanceof BrowserWindow && win.webContents.toggleDevTools(),
          },
          { type: "separator" },
          { role: "quit", label: "Sair" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ])
  );
}

app.whenReady().then(async () => {
  buildMenu();
  startBackend();
  const splash = createSplash();

  try {
    await waitForBackend((msg) => splash.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(msg)})`));
    const main = createMainWindow();
    main.once("ready-to-show", () => splash.close());
    startNotificationPolling();
  } catch (err) {
    await splash.webContents.executeJavaScript(
      `window.setStatus(${JSON.stringify(err instanceof Error ? err.message : String(err))})`
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopBackend);
