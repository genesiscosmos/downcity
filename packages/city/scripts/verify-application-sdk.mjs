/** 构建校验：公开 schema 生成声明，扩展导出可被同一编译器发现，无需更改执行 schema。 */
import { z } from 'zod';
import { ApplicationCatalog } from '../bin/application/ApplicationCatalog.js';
import { create_core_application } from '../bin/application/CoreApplication.js';
import { compile_cell } from '../bin/city/power/builtin/runtime/engine/CompileCell.js';

const access = Object.freeze({});
const catalog = new ApplicationCatalog([...create_core_application(access, 'build'), {
  namespace: 'verification',
  exports: [{ symbol: 'verification.echo', description: 'Build-only public contract validation.',
    input: z.object({ value: z.string() }).strict(), output: z.string(), effect: 'read',
    authorize: () => undefined, invoke: input => input.value }],
}]);
compile_cell('const current = await downcity.context.current({}); return await downcity.verification.echo({value: current.agent_id});', 'typescript', catalog.declarations);
if (!catalog.help({symbol:'verification'}).symbols.length) throw new Error('Public export discovery failed');
console.log(`[city-sdk] verified generated bindings/declarations for ${catalog.descriptors.length} public exports`);
