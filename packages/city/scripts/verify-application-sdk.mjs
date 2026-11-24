/** 构建验证：挂载公开对象及其返回对象后，接口扩展自动生成绑定、声明和帮助。 */
import { z } from 'zod';
import { PublicApplication } from '../bin/application/PublicApplication.js';
import { create_core_objects } from '../bin/application/CoreObjects.js';
import { compile_cell } from '../bin/city/power/builtin/runtime/engine/CompileCell.js';

const application = new PublicApplication([...create_core_objects(Object.freeze({}), 'build'), {
  name: 'verification',
  contract: z.object({ echo: z.function({ input: [z.object({ value: z.string() }).strict()], output: z.string() }).describe('Build-only public interface.') }),
  authorize: () => undefined,
  bind: () => ({ echo: input => input.value }),
}]);
compile_cell('const current = await downcity.context.current({}); return await downcity.verification.echo({value: current.agent_id});', 'typescript', application.declarations);
if (!application.help({symbol:'verification'}).symbols.length) throw new Error('Public object discovery failed');
console.log(`[city-sdk] verified generated bindings/declarations for ${application.descriptors.length} public members`);
