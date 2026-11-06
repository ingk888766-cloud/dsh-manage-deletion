/**
 * Pre-publish gate: validates the manifest a marketplace installer reads and
 * the files this package promises. Run by `prepack` and by `npm run check`.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    fail(`${rel} 不可读：${error.message}`);
    return null;
  }
}

const pkg = readJson('package.json');
if (pkg) {
  if (pkg.name !== 'dsh-manage-deletion') fail(`包名应为 dsh-manage-deletion，实际 ${pkg.name}`);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(pkg.version || ''))) fail(`版本号不是 semver：${pkg.version}`);
  if (!pkg.description) fail('缺少 description');
  if (pkg.license !== 'MIT') fail('license 应为 MIT');
  if (pkg.type !== 'module') fail('type 应为 module');
  if (!pkg.dsh) fail('缺少 dsh 清单字段');
  else {
    if (pkg.dsh.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch 应指向 ./cordis.patch.yml');
    if (pkg.dsh.client?.platform !== 'web') fail('dsh.client.platform 应为 web');
    if (!pkg.dsh.compatibility?.dsh) fail('dsh.compatibility.dsh 未声明');
    if (pkg.dsh.manifestVersion !== 1) notes.push('dsh.manifestVersion 不是 1');
  }
  if (!pkg.engines?.node) fail('engines.node 未声明');
  if (!pkg.exports?.['./client']) fail('exports 缺 ./client（客户端 bundle）');
  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('dsh-plugin')) fail('keywords 缺 dsh-plugin');
  if (pkg.publishConfig?.access !== 'public') fail('publishConfig.access 应为 public');
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail(`运行时依赖应为空（当前：${Object.keys(pkg.dependencies).join(', ')}）`);
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  for (const required of ['index.js', 'client.js', 'lib', 'cordis.patch.yml', 'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'icon.svg']) {
    if (!files.includes(required)) fail(`files 未包含 ${required}`);
  }
  for (const rel of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'icon.svg']) {
    if (!existsSync(join(root, rel))) fail(`缺少文件 ${rel}`);
  }
  for (const rel of ['lib/config.js', 'lib/classify.js', 'lib/store.js', 'lib/service.js', 'lib/tools.js', 'lib/http.js']) {
    if (!existsSync(join(root, rel)) || statSync(join(root, rel)).size === 0) fail(`缺少或为空：${rel}`);
  }
}

const patch = existsSync(join(root, 'cordis.patch.yml')) ? readFileSync(join(root, 'cordis.patch.yml'), 'utf8') : '';
if (patch && !/name:\s*'dsh-manage-deletion'/.test(patch)) fail('cordis.patch.yml 没有挂载 dsh-manage-deletion');

const client = existsSync(join(root, 'client.js')) ? readFileSync(join(root, 'client.js'), 'utf8') : '';
if (client) {
  const idMatch = client.match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/);
  if (!idMatch) fail('client.js 不是 ModuleLoader bundle（找不到 id）');
  else if (idMatch[1] !== pkg?.name) fail(`client bundle id ${idMatch[1]} 与包名 ${pkg?.name} 不一致`);
  if (!client.includes('exports.apply')) fail('client.js 没有导出 apply');
}

const hostEntry = existsSync(join(root, 'index.js')) ? readFileSync(join(root, 'index.js'), 'utf8') : '';
if (hostEntry && !/export const name = 'manage-deletion'/.test(hostEntry)) fail("index.js 没有导出 name = 'manage-deletion'");

if (notes.length > 0) for (const note of notes) console.log(`注意：${note}`);

if (failures.length > 0) {
  console.error(`清单检查失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('清单检查通过：manifest、挂载补丁、客户端 bundle、必需文件都在。');
