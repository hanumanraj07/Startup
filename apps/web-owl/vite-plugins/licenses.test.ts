import { describe, expect, it } from 'vitest';
import { licenseFileName, packageRoot, thirdPartyLicenses } from './licenses';

describe('packageRoot', () => {
  it('finds a scoped package inside the pnpm store', () => {
    expect(packageRoot('D:/repo/node_modules/.pnpm/@odoo+owl@2.8.3/node_modules/@odoo/owl/dist/owl.es.js')).toBe(
      'D:/repo/node_modules/.pnpm/@odoo+owl@2.8.3/node_modules/@odoo/owl',
    );
  });

  it('finds an unscoped package and ignores the query string', () => {
    expect(packageRoot('/repo/node_modules/zod/lib/index.mjs?v=123')).toBe('/repo/node_modules/zod');
  });

  it('normalises Windows separators', () => {
    expect(packageRoot('D:\\repo\\node_modules\\lucide\\dist\\esm\\lucide.js')).toBe('D:/repo/node_modules/lucide');
  });

  it('is null for our own code and for virtual modules', () => {
    expect(packageRoot('D:/repo/apps/web-owl/src/main.ts')).toBeNull();
    expect(packageRoot('D:/repo/packages/money/src/index.ts')).toBeNull();
    expect(packageRoot('\0vite/preload-helper.js')).toBeNull();
  });
});

describe('licenseFileName', () => {
  it('flattens scoped names into one safe file name', () => {
    expect(licenseFileName('@odoo/owl')).toBe('licenses/odoo__owl.txt');
    expect(licenseFileName('zod')).toBe('licenses/zod.txt');
  });
});

describe('thirdPartyLicenses', () => {
  it('lists a package that ships only an asset, such as a self-hosted font', () => {
    const emitted = new Map<string, string>();
    const context = {
      emitFile(file: { type: 'asset'; fileName: string; source: string }) {
        emitted.set(file.fileName, file.source);
        return file.fileName;
      },
    };
    const font = 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2';
    thirdPartyLicenses().generateBundle.call(context, {}, { 'font.woff2': { type: 'asset', originalFileNames: [font] } });

    const list = JSON.parse(emitted.get('licenses.json') ?? '[]') as { name: string; license: string; file: string | null }[];
    expect(list).toContainEqual(
      expect.objectContaining({ name: '@fontsource-variable/plus-jakarta-sans', license: 'OFL-1.1' }),
    );
    expect(emitted.has('licenses/fontsource-variable__plus-jakarta-sans.txt')).toBe(true);
  });
});
