/**
 * 登记前的远端只读目录程序。Home 来自远端登录用户的 passwd 数据库。
 * 跟随目录符号链接并返回真实路径；路径只通过 stdin JSON 传递，不触碰宿主 fs。
 * 分页最多 100 个目录、单次扫描最多 20,000 个条目，JSON 最多 64 KiB。
 */
export const remote_directory_program = String.raw`
import os, sys, json, pwd, heapq

def browse():
    query = json.load(sys.stdin)
    value = query.get('path')
    if value is None:
        value = pwd.getpwuid(os.getuid()).pw_dir
    if not isinstance(value, str) or not os.path.isabs(value) or '\x00' in value:
        raise ValueError('Expected an absolute remote directory')
    current = os.path.realpath(value)
    # 与登记验证相同，从 / 逐段打开 realpath，拒绝解析后的目录被替换为 symlink。
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in current.split('/'):
            if not component: continue
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_fd
        cursor = query.get('cursor')
        if cursor is not None and not isinstance(cursor, str):
            raise ValueError('Invalid directory cursor')
        def candidates():
            with os.scandir(descriptor) as entries:
                for count, entry in enumerate(entries, 1):
                    if count > 20000:
                        raise ValueError('Directory exceeds the 20,000 entry scan limit')
                    # POSIX 非 UTF-8 名称无法无损往返 JS，明确失败，避免选择另一个路径。
                    entry.name.encode('utf-8', 'strict')
                    if cursor is not None and entry.name <= cursor: continue
                    try:
                        if not entry.is_dir(follow_symlinks=True): continue
                        yield (entry.name, entry.is_symlink())
                    except FileNotFoundError: continue
        selected = heapq.nsmallest(101, candidates())
        result = {'path': current, 'parent_path': os.path.dirname(current) if current != '/' else None,
                  'directories': [], 'next_cursor': None}
        for index, (name, symlink) in enumerate(selected[:100]):
            entry = {'name': name, 'path': os.path.join(current, name), 'is_symlink': symlink}
            result['directories'].append(entry)
            result['next_cursor'] = name if len(selected) > index + 1 else None
            if len(json.dumps({'ok': True, 'result': result}, ensure_ascii=True).encode('utf-8')) > 65535:
                result['directories'].pop()
                if not result['directories']:
                    raise ValueError('Directory entry exceeds the 64 KiB output limit')
                result['next_cursor'] = result['directories'][-1]['name']
                break
        return result
    finally:
        os.close(descriptor)

try:
    result = {'ok': True, 'result': browse()}
    encoded = json.dumps(result, ensure_ascii=True)
    if len(encoded.encode('utf-8')) > 65536:
        raise ValueError('Directory page exceeds the 64 KiB output limit')
    print(encoded)
except Exception as error:
    print(json.dumps({'ok': False, 'message': str(error), 'code': type(error).__name__}, ensure_ascii=True))
`;
