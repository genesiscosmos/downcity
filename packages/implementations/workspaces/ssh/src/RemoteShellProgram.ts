/** 临时远端命令监督进程：通道 EOF 或取消时终止子进程组；不安装远程服务。 */
export const remote_shell_program = String.raw `
import os, sys, json, base64, subprocess, select, signal, pty, fcntl, termios, struct
config = json.loads(base64.b64decode(sys.argv[1]))
os.chdir(config['cwd'])
environment = dict(os.environ)
environment.update(config.get('env', {}))
command = [config.get('shell') or environment.get('SHELL') or '/bin/sh', '-lc' if config.get('login') else '-c', config['cmd']]
terminal = config.get('terminal', False)
master = slave = None
if terminal:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', config.get('rows', 40), config.get('cols', 120), 0, 0))
    def setup():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, env=environment, preexec_fn=setup)
    os.close(slave)
else:
    process = subprocess.Popen(command, stdin=subprocess.PIPE, env=environment, start_new_session=True)
def terminate(*unused):
    # zsh 等解释器会给后台作业另建进程组；按本命令的独立 session 清理，而非仅杀前台组。
    try:
        listing = subprocess.run(['ps', '-A', '-o', 'pid='], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
        for raw in listing.stdout.split():
            try:
                pid = int(raw)
                if pid != os.getpid() and os.getsid(pid) == process.pid:
                    os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError): pass
    except (OSError, subprocess.TimeoutExpired): pass
    try: os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError: pass
signal.signal(signal.SIGHUP, terminate)
signal.signal(signal.SIGTERM, terminate)
try:
    while process.poll() is None:
        readable, _, _ = select.select([0] + ([master] if terminal else []), [], [], 0.1)
        if 0 in readable:
            content = os.read(0, 65536)
            if not content:
                terminate()
                break
            if terminal: os.write(master, content)
            else:
                try:
                    process.stdin.write(content)
                    process.stdin.flush()
                except BrokenPipeError: pass
        if terminal and master in readable:
            try: content = os.read(master, 65536)
            except OSError: content = b''
            if content: os.write(1, content)
    if terminal:
        while select.select([master], [], [], 0)[0]:
            try: content = os.read(master, 65536)
            except OSError: break
            if not content: break
            os.write(1, content)
finally:
    # Shell 退出后也清理同进程组内留下的子进程；主动 setsid 脱离者不在此监督范围。
    terminate()
    process.wait()
    if master is not None: os.close(master)
sys.exit(process.returncode if process.returncode >= 0 else 128 - process.returncode)
`;
