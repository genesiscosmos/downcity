/**
 * 通过 python3 -c 临时执行的远端文件协议，不在远端写入程序或启动服务。
 * 请求通过 stdin JSON 传递；文件路径以目录描述符逐段打开并拒绝 symlink 竞态。
 * 只依赖已安装的 Python 3.8+、POSIX 文件系统和搜索时使用的 ripgrep。
 */
export const remote_program = String.raw `
import os, sys, json, stat, base64, hashlib, tempfile, datetime, subprocess, errno, fcntl, ctypes, shutil, codecs, signal
request = json.load(sys.stdin)
root = os.path.realpath(request['root'])
operation = request['operation']
arguments = request.get('arguments', {})
if (operation != 'validate' or not arguments.get('resolve_root', False)) and root != os.path.normpath(request['root']):
    raise RuntimeError('Registered SSH root now resolves through a symbolic link; reconnect and verify the directory')
# 从 / 开始逐段 openat，关闭根路径祖先被替换为符号链接的竞态窗口。
root_fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    for component in root.split('/'):
        if not component: continue
        next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        os.close(root_fd)
        root_fd = next_fd
except:
    os.close(root_fd)
    raise
MAX_FILE = 64 * 1024 * 1024
MAX_WRITE = 1024 * 1024
MAX_WINDOW = 64 * 1024

def fail(code, message):
    raise ValueError(code + ': ' + message)

def relative(value):
    candidate = os.path.realpath(value if os.path.isabs(value) else os.path.join(root, value))
    if os.path.commonpath([root, candidate]) != root:
        fail('sandbox_denied', 'Path escapes remote Workspace')
    return os.path.relpath(candidate, root)

def parent(value, create=False):
    parts = relative(value).split('/')
    descriptor = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            if part == '.': continue
            if create:
                try: os.mkdir(part, dir_fd=descriptor)
                except FileExistsError: pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_fd
        return descriptor, parts[-1]
    except:
        os.close(descriptor)
        raise

def open_file(value):
    descriptor, name = parent(value)
    try:
        result = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        if not stat.S_ISREG(os.fstat(result).st_mode):
            os.close(result)
            fail('not_a_file', 'Expected a regular file')
        return os.fdopen(result, 'rb')
    finally: os.close(descriptor)

def metadata(value):
    descriptor, name = parent(value)
    try:
        info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode): fail('sandbox_denied', 'Symlink changed during access')
        return {'size': info.st_size, 'modified_at': info.st_mtime * 1000, 'is_directory': stat.S_ISDIR(info.st_mode), 'is_file': stat.S_ISREG(info.st_mode)}
    finally: os.close(descriptor)

def read_bytes(value):
    with open_file(value) as stream:
        if os.fstat(stream.fileno()).st_size > MAX_FILE: fail('file_too_large', 'File exceeds 64 MiB')
        content = stream.read(MAX_FILE + 1)
        if len(content) > MAX_FILE: fail('file_too_large', 'File exceeds 64 MiB')
        return content

def write_atomic(value, content, overwrite=True, expected=None):
    descriptor, name = parent(value, True)
    if name == '.': fail('invalid_path', 'Cannot replace Workspace root')
    temporary_name = '.downcity-' + os.urandom(16).hex()
    try:
        # 父目录锁协调本适配器的写事务，完整内容只在同目录原子替换时可见。
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        mode = 0o666
        exists = False
        try:
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode): fail('not_a_file', 'Expected a regular file')
            exists = True
            mode = stat.S_IMODE(info.st_mode)
        except FileNotFoundError: pass
        if exists and not overwrite: fail('file_exists', 'File already exists; use overwrite=true')
        if expected == 'missing' and exists: fail('file_changed', 'File was created before commit')
        if expected not in [None, 'missing'] and (not exists or hashlib.sha256(read_bytes(value)).hexdigest() != expected): fail('file_changed', 'File changed before commit')
        temporary_fd = os.open(temporary_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=descriptor)
        with os.fdopen(temporary_fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.rename(temporary_name, name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
        else:
            os.link(temporary_name, name, src_dir_fd=descriptor, dst_dir_fd=descriptor, follow_symlinks=False)
            os.unlink(temporary_name, dir_fd=descriptor)
        try: os.fsync(descriptor)
        except OSError as error:
            if error.errno != errno.EINVAL: raise
        return exists
    finally:
        try: os.unlink(temporary_name, dir_fd=descriptor)
        except FileNotFoundError: pass
        os.close(descriptor)

def remove_entry(descriptor, name):
    info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
    if stat.S_ISDIR(info.st_mode):
        child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
        try:
            for entry in os.listdir(child_fd): remove_entry(child_fd, entry)
        finally: os.close(child_fd)
        os.rmdir(name, dir_fd=descriptor)
    else: os.unlink(name, dir_fd=descriptor)

def text_encoding(content):
    if content.startswith(b'\xff\xfe'): return 'utf-16le', 'utf-16-le', 2
    if content.startswith(b'\xfe\xff'): return 'utf-16be', 'utf-16-be', 2
    return 'utf-8', 'utf-8', 3 if content.startswith(b'\xef\xbb\xbf') else 0

def raw_line(stream, limit, encoding):
    if encoding == 'utf-8': return stream.readline(limit)
    content = bytearray()
    newline = b'\n\x00' if encoding == 'utf-16-le' else b'\x00\n'
    while len(content) + 2 <= limit:
        unit = stream.read(2)
        if not unit: break
        content.extend(unit)
        if unit == newline: break
    return bytes(content)

def file_action():
    action = arguments['action']
    data = arguments['input']
    value = data['file_path']
    absolute = os.path.join(root, relative(value))
    if action == 'read':
        with open_file(value) as stream:
            info = os.fstat(stream.fileno())
            version = '%s:%s:%s:%s:%s' % (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            selection = data.get('range') or {'type': 'lines'}
            if selection.get('expected_version') and selection['expected_version'] != version: fail('file_changed', 'File changed; read from the beginning')
            sample = stream.read(8192)
            encoding_name, encoding, bom_size = text_encoding(sample)
            binary = sample.startswith(b'%PDF-') or (encoding == 'utf-8' and b'\x00' in sample)
            try: codecs.getincrementaldecoder(encoding)().decode(sample[bom_size:], final=False)
            except UnicodeDecodeError: binary = True
            if binary:
                return dict(success=True, file_path=absolute, total_bytes=info.st_size, total_lines=0, start_line=0, end_line=-1, content='', truncated=False, type='binary', file_version=version)
            stream.seek(bom_size)
            start = max(0, int(selection.get('offset', 0)))
            byte_mode = selection['type'] == 'bytes'
            limit = min(2000, max(1, int(selection.get('limit', 500))))
            newline = b'\n' if encoding == 'utf-8' else b'\n\x00' if encoding == 'utf-16-le' else b'\x00\n'
            if byte_mode:
                if encoding != 'utf-8' and start % 2: fail('encoding_error', 'UTF-16 byte offset must be aligned')
                stream.seek(max(start, bom_size))
            else:
                for index in range(start):
                    skipped = raw_line(stream, MAX_WINDOW, encoding)
                    if not skipped: break
                    while skipped and not skipped.endswith(newline):
                        skipped = raw_line(stream, MAX_WINDOW, encoding)
                        if stream.tell() > MAX_FILE: fail('file_too_large', 'Line scan exceeds 64 MiB; use byte continuation')
                    if stream.tell() > MAX_FILE: fail('file_too_large', 'Line scan exceeds 64 MiB; use byte continuation')
            start_byte = stream.tell()
            output = b''
            count = 0
            while count < (2000 if byte_mode else limit) and len(output) < MAX_WINDOW:
                chunk = raw_line(stream, MAX_WINDOW - len(output), encoding)
                if not chunk: break
                output += chunk
                count += 1
            # 增量解码器保留被截断的字符尾部，游标只推进已经披露的原始字节。
            try:
                decoder = codecs.getincrementaldecoder(encoding)()
                text = decoder.decode(output, final=stream.tell() >= info.st_size)
                remaining = decoder.getstate()[0]
                if remaining: output = output[:-len(remaining)]
            except UnicodeDecodeError: fail('encoding_error', 'Text contains invalid encoded characters')
            # 输出预算按 UTF-8 文本字节计算；UTF-16 的 CJK 文本不能放大到超过披露上限。
            encoded_text = text.encode('utf-8')
            if len(encoded_text) > MAX_WINDOW:
                budget_decoder = codecs.getincrementaldecoder('utf-8')()
                text = budget_decoder.decode(encoded_text[:MAX_WINDOW], final=False)
                output = text.encode(encoding)
            next_byte = start_byte + len(output)
            if version != '%s:%s:%s:%s:%s' % tuple(getattr(os.fstat(stream.fileno()), key) for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']): fail('file_changed', 'File changed while reading')
            truncated = next_byte < info.st_size
            result = dict(success=True, file_path=absolute, total_bytes=info.st_size, total_lines=None if truncated or start_byte > bom_size else len(text.splitlines()), start_line=-1 if byte_mode else start, end_line=-1 if byte_mode else start + len(text.splitlines()) - 1, content=text, truncated=truncated, type='text', encoding=encoding_name, file_version=version, start_byte=start_byte)
            if truncated: result['next_byte_offset'] = next_byte
            if not truncated and start_byte == bom_size: result['sha256'] = hashlib.sha256(sample[:bom_size] + output).hexdigest()
            return result
    if action == 'write':
        content = data['content'].encode('utf-8')
        if len(content) > MAX_WRITE: fail('content_too_large', 'Write exceeds 1 MiB')
        overwritten = write_atomic(value, content, data.get('overwrite', False))
        return dict(success=True, file_path=absolute, bytes_written=len(content), lines_written=len(data['content'].splitlines()), overwritten=overwritten, timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(), sha256=hashlib.sha256(content).hexdigest())
    original = read_bytes(value)
    previous_sha = hashlib.sha256(original).hexdigest()
    if data.get('expected_sha256') and data['expected_sha256'] != previous_sha: fail('file_changed', 'SHA256 does not match')
    _, encoding, bom_size = text_encoding(original)
    if encoding == 'utf-8' and b'\x00' in original: fail('binary_file', 'Cannot edit binary content')
    text = original[bom_size:].decode(encoding)
    edits = data['edits']
    if not edits: fail('no_edits', 'edits must not be empty')
    if len(edits) > 10: fail('too_many_edits', 'At most ten edits')
    regions, details = [], []
    for index, edit in enumerate(edits):
        old, new = edit['old_text'], edit['new_text']
        if not old or len(old) > 10000 or len(new) > 50000: fail('edit_too_large', 'Invalid edit size')
        count, position = 0, 0
        while True:
            position = text.find(old, position)
            if position < 0: break
            count += 1
            position += 1
        if count != 1: fail('duplicate_match' if count else 'not_found', 'Each old_text must match exactly once')
        begin = text.index(old)
        regions.append((begin, begin + len(old), new))
        details.append(dict(index=index, status='applied', match_count=1, line_start=text[:begin].count('\n')))
    regions.sort()
    if any(regions[index][1] > regions[index + 1][0] for index in range(len(regions) - 1)): fail('overlapping_edits', 'Edit regions overlap')
    for begin, end, new in reversed(regions): text = text[:begin] + new + text[end:]
    content = original[:bom_size] + text.encode(encoding)
    if len(content) > MAX_FILE: fail('content_too_large', 'Edited file exceeds 64 MiB')
    write_atomic(value, content, True, previous_sha)
    return dict(success=True, file_path=absolute, applied=len(edits), details=details, new_total_lines=len(text.splitlines()), previous_sha256=previous_sha, sha256=hashlib.sha256(content).hexdigest())

def search_action():
    action, data = arguments['action'], arguments['input']
    value = relative(data.get('path', '.'))
    limit = min(2000, max(1, int(data.get('max_results', 200))))
    descriptor, name = parent(value)
    results, scanned, output_bytes, truncated = [], 0, 0, False
    directory = None
    try:
        info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.fchdir(directory)
            candidate_command = ['rg', '--files', '--hidden', '--null']
            if action == 'find': candidate_command.extend(['-g', data['pattern']])
            else:
                for pattern in data.get('glob', []): candidate_command.extend(['-g', pattern])
            candidate_command.extend(['--', '.'])
            process = subprocess.Popen(candidate_command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                pending = b''
                candidates = []
                candidate_bytes = 0
                while True:
                    chunk = process.stdout.read(16384)
                    if not chunk: break
                    pending += chunk
                    candidate_bytes += len(chunk)
                    if candidate_bytes > 2 * 1024 * 1024:
                        truncated = True
                        process.kill()
                        break
                    parts = pending.split(b'\x00')
                    pending = parts.pop()
                    candidates.extend(parts)
                process.wait()
                if process.returncode not in [0, 1] and not truncated: fail('search_failed', 'ripgrep file discovery failed')
            finally:
                if process.poll() is None: process.kill()
                process.wait()
            candidates = [os.path.normpath(os.path.join(value, item.decode('utf-8'))) for item in candidates]
        elif stat.S_ISREG(info.st_mode) and action == 'grep': candidates = [value]
        else: fail('not_a_directory', 'Search path must be a directory')
        os.fchdir(root_fd)
        for candidate in candidates:
            # rg 只发现名称；真正读取使用 rooted openat，拒绝搜索期间被替换的越界符号链接。
            try:
                with open_file(candidate) as stream:
                    file_size = os.fstat(stream.fileno()).st_size
                    if action == 'find':
                        results.append(candidate)
                        if len(results) > limit:
                            truncated = True
                            break
                        continue
                    if file_size > MAX_FILE: continue
                    command = ['rg', '--json', '--max-count', str(limit), '--max-columns', '4096']
                    if not data.get('case_sensitive', False): command.append('-i')
                    if data.get('literal', True): command.append('-F')
                    command.extend(['--', data['query'], '-'])
                    # 已校验的描述符直接作为 rg stdin，不按名称再次打开项目文件。
                    search = subprocess.Popen(command, stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                    scanned += 1
                    try:
                        while True:
                            line = search.stdout.readline(2 * 1024 * 1024 + 1)
                            if not line: break
                            output_bytes += len(line)
                            if output_bytes > 2 * 1024 * 1024:
                                truncated = True
                                break
                            record = json.loads(line)
                            if record['type'] != 'match': continue
                            item = record['data']
                            for match in item['submatches']:
                                results.append(dict(file_path=candidate, line_number=item['line_number'], column=match['start'] + 1, text=item['lines']['text'].rstrip('\n')[:4096], match_text=match['match'].get('text', '')[:4096], line_truncated=len(item['lines']['text']) > 4096))
                                if len(results) > limit:
                                    truncated = True
                                    break
                            if truncated: break
                        if truncated: search.kill()
                        search.wait()
                        if search.returncode not in [0, 1] and not truncated: fail('invalid_pattern', 'ripgrep rejected the query')
                    finally:
                        if search.poll() is None: search.kill()
                        search.wait()
                    if truncated: break
            except (FileNotFoundError, PermissionError): continue
    finally:
        os.close(descriptor)
        if directory is not None: os.close(directory)
    base = dict(success=True, root_path=root, search_path=os.path.join(root, value), match_count=min(limit, len(results)), truncated=truncated)
    if action == 'find': base.update(pattern=data['pattern'], files=sorted(results[:limit]))
    else: base.update(query=data['query'], matches=results[:limit], files_searched=scanned)
    return base

def dispatch():
    value = arguments.get('path', '.')
    if operation == 'validate':
        if sys.version_info < (3, 8): fail('internal_error', 'SSH Workspace needs Python 3.8+; run SSH Workspace dependency initialization')
        if sys.platform not in ['linux', 'darwin']: fail('internal_error', 'Only Linux/macOS SSH hosts are supported')
        if shutil.which('ps') is None: fail('internal_error', 'SSH Workspace needs POSIX ps for process cleanup; run SSH Workspace dependency initialization')
        if shutil.which('rg') is None: fail('rg_unavailable', 'SSH Workspace needs ripgrep (rg); run SSH Workspace dependency initialization')
        if not os.access(root, os.R_OK | os.X_OK): fail('permission_denied', 'Remote directory is not readable')
        return dict(root_path=root, platform=sys.platform, env={key: os.environ[key] for key in ['HOME', 'PATH', 'SHELL', 'LANG', 'USER', 'TMPDIR'] if key in os.environ})
    if operation == 'file_action': return file_action()
    if operation == 'search_action': return search_action()
    if operation == 'media':
        with open_file(value) as stream:
            info = os.fstat(stream.fileno())
            version = '%s:%s:%s:%s:%s' % (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            if version != arguments['expected_version']: fail('file_changed', 'Media changed before content capture')
            if info.st_size > 2 * 1024 * 1024: fail('media_too_large', 'Media exceeds 2 MiB')
            content = stream.read(2 * 1024 * 1024 + 1)
            after = os.fstat(stream.fileno())
            if len(content) > 2 * 1024 * 1024 or (info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns): fail('file_changed', 'Media changed during capture')
            return base64.b64encode(content).decode('ascii')
    if operation == 'stat': return metadata(value)
    if operation == 'read': return base64.b64encode(read_bytes(value)).decode('ascii')
    if operation == 'list':
        descriptor, name = parent(value)
        try:
            directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            try:
                result = []
                for item in os.scandir(directory):
                    if len(result) >= 10000: fail('file_too_large', 'Directory exceeds 10000 entries')
                    info = item.stat(follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode): continue
                    result.append(dict(name=item.name, is_directory=stat.S_ISDIR(info.st_mode), is_file=stat.S_ISREG(info.st_mode), size=info.st_size, modified_at=info.st_mtime * 1000))
                return result
            finally: os.close(directory)
        finally: os.close(descriptor)
    if operation == 'mkdir':
        descriptor, name = parent(os.path.join(value, '.downcity-directory-marker'), True)
        os.close(descriptor)
        return None
    if operation == 'write':
        content = base64.b64decode(arguments['content'])
        if len(content) > MAX_FILE: fail('content_too_large', 'Write exceeds 64 MiB')
        write_atomic(value, content)
        return None
    if operation == 'append':
        try:
            original = read_bytes(value)
            expected = hashlib.sha256(original).hexdigest()
        except FileNotFoundError:
            original = b''
            expected = 'missing'
        content = original + base64.b64decode(arguments['content'])
        if len(content) > MAX_FILE: fail('content_too_large', 'Append exceeds 64 MiB')
        write_atomic(value, content, True, expected)
        return None
    if operation == 'remove':
        descriptor, name = parent(value)
        try:
            if name == '.': fail('invalid_path', 'Cannot delete Workspace root')
            try: remove_entry(descriptor, name)
            except FileNotFoundError: pass
        finally: os.close(descriptor)
        return None
    if operation == 'move':
        source_fd, source_name = parent(value)
        target_fd, target_name = parent(arguments['target'])
        try:
            if source_name == '.' or target_name == '.': fail('invalid_path', 'Cannot move Workspace root')
            try:
                os.stat(target_name, dir_fd=target_fd, follow_symlinks=False)
                fail('file_exists', 'Move target exists')
            except FileNotFoundError: pass
            # 内核原子 no-replace；不能用先检查再 rename 的窗口覆盖外部新文件。
            library = ctypes.CDLL(None, use_errno=True)
            if sys.platform == 'linux':
                rename = library.renameat2
                flag = 1
            else:
                rename = library.renameatx_np
                flag = 4
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            if rename(source_fd, os.fsencode(source_name), target_fd, os.fsencode(target_name), flag) != 0:
                error = ctypes.get_errno()
                raise OSError(error, os.strerror(error))
        finally:
            os.close(source_fd)
            os.close(target_fd)
        return None
    fail('internal_error', 'Unknown remote operation')

def cancel_request(*unused):
    raise InterruptedError('SSH channel closed; operation result may be unknown')
signal.signal(signal.SIGHUP, cancel_request)
signal.signal(signal.SIGTERM, cancel_request)

try:
    result = dispatch()
    print(json.dumps({'ok': True, 'result': result}, ensure_ascii=True))
except Exception as error:
    code = 'internal_error'
    if isinstance(error, FileNotFoundError): code = 'file_not_found'
    elif isinstance(error, FileExistsError): code = 'file_exists'
    elif isinstance(error, OSError) and error.errno == errno.ELOOP: code = 'sandbox_denied'
    elif isinstance(error, PermissionError): code = 'permission_denied'
    elif isinstance(error, UnicodeError): code = 'encoding_error'
    elif isinstance(error, ValueError): code = str(error).split(':', 1)[0]
    print(json.dumps({'ok': False, 'code': code, 'message': str(error)}, ensure_ascii=True))
finally: os.close(root_fd)
`;
