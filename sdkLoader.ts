import * as path from 'path';
import { pathToFileURL } from 'url';

import type * as AgentSdk from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import type * as Zod from 'zod' with { 'resolution-mode': 'import' };

export type Sdk = typeof AgentSdk;
export type ZodModule = typeof Zod;

export interface LoadedSdk {
  sdk: Sdk;
  z: ZodModule['z'];
}

// Hidden from the bundler: esbuild rewrites a literal import() into require()
// for CommonJS output, and both packages must load as ES modules. Loading zod
// the same way keeps a single zod instance shared with the SDK's tool() helper.
const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

let loading: Promise<LoadedSdk> | null = null;

export function loadAgentSdk(): Promise<LoadedSdk> {
  loading ??= (async () => {
    const sdkUrl = pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href;
    // require.resolve yields zod's CommonJS entry; the SDK imports its ESM one.
    const zodPkg = require.resolve('zod/package.json');
    const zodEsm = (require(zodPkg) as { exports: { '.': { import: string } } }).exports['.'].import;
    const zodUrl = pathToFileURL(path.join(path.dirname(zodPkg), zodEsm)).href;
    const [sdk, zod] = await Promise.all([
      dynamicImport(sdkUrl) as Promise<Sdk>,
      dynamicImport(zodUrl) as Promise<ZodModule>,
    ]);
    return { sdk, z: zod.z };
  })();
  return loading;
}
