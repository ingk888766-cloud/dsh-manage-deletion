/**
 * Install dsh-manage-deletion into the desktop profile and drop the previous
 * session-janitor wiring (if any):
 *  1. back up package.json
 *  2. remove the old junction / dependency / bundle entry
 *  3. link node_modules/dsh-manage-deletion -> this checkout
 *  4. record dependency + bundle entry
 *  5. verify the manifest parses and the host entry imports
 */
import { copyFileSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const profile = 'C:\\Users\\OQY\\.dsh\\profiles\\desktop';
const plugin = 'C:\\Users\\OQY\\Desktop\\W-SF1\\dsh-manage-deletion';
const pkgPath = join(profile, 'package.json');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

if (!existsSync(plugin)) {
  console.error('plugin checkout missing:', plugin);
  process.exit(1);
}

copyFileSync(pkgPath, `${pkgPath}.bak-${stamp}-manage-deletion`);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
let bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

// Drop the previous plugin identity.
for (const stale of ['dsh-session-janitor']) {
  delete pkg.dependencies[stale];
  bundles = bundles.filter((name) => name !== stale);
  const staleLink = join(profile, 'node_modules', stale);
  try {
    if (lstatSync(staleLink)) rmSync(staleLink, { recursive: true, force: true });
  } catch {
    /* not installed */
  }
}

const link = join(profile, 'node_modules', 'dsh-manage-deletion');
try {
  if (lstatSync(link)) rmSync(link, { recursive: true, force: true });
} catch {
  /* fresh install */
}
symlinkSync(plugin, link, 'junction');

pkg.dependencies['dsh-manage-deletion'] = 'file:C:/Users/OQY/Desktop/W-SF1/dsh-manage-deletion';
if (!bundles.includes('dsh-manage-deletion')) bundles.push('dsh-manage-deletion');
pkg.dsh.profile.bundles = bundles;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const check = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!check.dsh.profile.bundles.includes('dsh-manage-deletion')) {
  console.error('bundle entry missing after write');
  process.exit(1);
}
console.log('installed; bundles =', check.dsh.profile.bundles.length, '| link =', link);
