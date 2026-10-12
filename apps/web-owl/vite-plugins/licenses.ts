import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One third-party package that ends up in the browser bundle. */
export interface ThirdPartyLicense {
  name: string;
  version: string;
  license: string;
  repository: string | null;
  /** Published path of the package's licence text, or null when the package ships none. */
  file: string | null;
}

const NODE_MODULES = '/node_modules/';

// Just the parts of the Rollup plugin API used here. Typed structurally rather
// than importing Vite's Plugin, because vitest/config bundles its own Vite
// types, which differ from the Vite this app builds with.
interface BundledModule {
  renderedLength: number;
}
interface BundleOutput {
  type: 'chunk' | 'asset';
  modules?: Record<string, BundledModule>;
  /** For assets (fonts, images): the source files they were emitted from. */
  originalFileNames?: readonly string[];
}
interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
}
export interface LicensesPlugin {
  name: string;
  apply: 'build';
  generateBundle(this: EmitContext, options: unknown, bundle: Record<string, BundleOutput>): void;
}

/**
 * The package directory a bundled module belongs to, or null for our own code.
 * Handles scoped names and pnpm's nested layout
 * (`.pnpm/@odoo+owl@2.8.3/node_modules/@odoo/owl/dist/owl.es.js` -> `.../node_modules/@odoo/owl`).
 */
export function packageRoot(moduleId: string): string | null {
  if (moduleId.startsWith('\0')) return null; // Vite/Rollup virtual modules
  const path = moduleId.replace(/\\/g, '/').split('?')[0] ?? '';
  const at = path.lastIndexOf(NODE_MODULES);
  if (at === -1) return null;
  const segments = path.slice(at + NODE_MODULES.length).split('/');
  const first = segments[0] ?? '';
  const second = segments[1] ?? '';
  if (!first) return null;
  const name = first.startsWith('@') ? `${first}/${second}` : first;
  return path.slice(0, at + NODE_MODULES.length) + name;
}

/** A file name safe for any package name, scoped ones included. */
export function licenseFileName(packageName: string): string {
  return `licenses/${packageName.replace(/^@/, '').replace(/\//g, '__')}.txt`;
}

function repositoryUrl(repository: unknown): string | null {
  const raw = typeof repository === 'string' ? repository : (repository as { url?: unknown } | undefined)?.url;
  if (typeof raw !== 'string') return null;
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

/**
 * Emits `licenses.json` and each package's licence text, built from the
 * modules and assets that actually ship in the bundle rather than package.json, so the
 * list cannot drift from what visitors download. Read by /licenses.
 */
export function thirdPartyLicenses(): LicensesPlugin {
  return {
    name: 'onsite-third-party-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const output of Object.values(bundle)) {
        // A font or image shipped from a package (a self-hosted web font) is
        // redistributed just like its code, so its licence is listed too.
        if (output.type === 'asset') {
          for (const source of output.originalFileNames ?? []) {
            const root = packageRoot(resolve(source));
            if (root) roots.add(root);
          }
          continue;
        }
        if (!output.modules) continue;
        for (const [id, info] of Object.entries(output.modules)) {
          if (info.renderedLength === 0) continue; // tree-shaken away entirely
          const root = packageRoot(id);
          if (root) roots.add(root);
        }
      }

      const byName = new Map<string, ThirdPartyLicense>();
      for (const root of roots) {
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
          name: string;
          version: string;
          license?: string;
          repository?: unknown;
        };
        if (byName.has(manifest.name)) continue;
        const licenseFile = existsSync(root) ? readdirSync(root).find((f) => /^licen[cs]e/i.test(f)) : undefined;
        let file: string | null = null;
        if (licenseFile) {
          file = licenseFileName(manifest.name);
          this.emitFile({ type: 'asset', fileName: file, source: readFileSync(join(root, licenseFile), 'utf8') });
        }
        byName.set(manifest.name, {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license ?? 'UNKNOWN',
          repository: repositoryUrl(manifest.repository),
          file: file ? `/${file}` : null,
        });
      }

      const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: `${JSON.stringify(list, null, 2)}\n` });
    },
  };
}
