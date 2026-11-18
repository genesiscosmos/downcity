#!/bin/bash
# 仅在 Harbor 容器内执行。依赖 Bash/coreutils，不安装依赖、不接触任务目录。
# stdout 为四行协议：退出码、截断标记、stdout base64、stderr base64。
# 普通子孙进程由 Bash job control 创建的进程组清理；主动脱组进程由 Harbor 销毁环境。
set -u
state_dir=$1
request_id=$2
command=$3
command_cwd=$4
timeout_sec=$5
output_limit=$6
command_dir="$state_dir/$request_id"
mkdir -m 700 "$command_dir" || exit 125
mkfifo "$command_dir/out.pipe" "$command_dir/err.pipe" || exit 125
command_pid=""
watchdog_pid=""
out_pid=""
err_pid=""

# 每个后台 job 都使用独立进程组，方便中止 watchdog 与输出排空程序。
set -m

cleanup() {
    for child_pid in "$command_pid" "$watchdog_pid" "$out_pid" "$err_pid"; do
        if [ -n "$child_pid" ]; then
            kill -KILL -- "-$child_pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    rm -f "$state_dir/$request_id.pid" "$state_dir/$request_id.wrapper"
    rm -rf "$command_dir"
}
trap cleanup EXIT
trap 'exit 125' TERM INT HUP
printf '%s' "$$" > "$state_dir/$request_id.wrapper"

if [ -f "$state_dir/$request_id.cancel" ]; then
    exit 125
fi
# 只保留 N+1 个字节判定截断，余下输出持续排空，避免 SIGPIPE 改变任务命令行为。
timeout "$((timeout_sec + 2))" /bin/bash -c 'head -c "$1" > "$2"; cat > /dev/null' _ \
    "$((output_limit + 1))" "$command_dir/stdout" < "$command_dir/out.pipe" &
out_pid=$!
timeout "$((timeout_sec + 2))" /bin/bash -c 'head -c "$1" > "$2"; cat > /dev/null' _ \
    "$((output_limit + 1))" "$command_dir/stderr" < "$command_dir/err.pipe" &
err_pid=$!
(
    cd -- "$command_cwd" || exit 125
    exec /bin/bash -c "$command"
) > "$command_dir/out.pipe" 2> "$command_dir/err.pipe" &
command_pid=$!
printf '%s' "$command_pid" > "$state_dir/$request_id.pid"
if [ -f "$state_dir/$request_id.cancel" ]; then
    kill -KILL -- "-$command_pid" 2>/dev/null || true
fi
(
    sleep "$timeout_sec"
    touch "$command_dir/timed-out"
    kill -KILL -- "-$command_pid" 2>/dev/null || true
) >/dev/null 2>&1 &
watchdog_pid=$!
wait "$command_pid" 2>/dev/null
return_code=$?
# 正常退出也清理 shell 留下的普通后台子进程，使 verifier 不受其干扰。
kill -KILL -- "-$command_pid" 2>/dev/null || true
kill -KILL -- "-$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
watchdog_pid=""
wait "$out_pid" 2>/dev/null || true
wait "$err_pid" 2>/dev/null || true
out_pid=""
err_pid=""
if [ -f "$command_dir/timed-out" ]; then return_code=124; fi
truncated=false
for output_file in "$command_dir/stdout" "$command_dir/stderr"; do
    if [ "$(wc -c < "$output_file")" -gt "$output_limit" ]; then truncated=true; fi
done
printf '%s\n%s\n' "$return_code" "$truncated"
head -c "$output_limit" "$command_dir/stdout" | base64 -w 0
printf '\n'
head -c "$output_limit" "$command_dir/stderr" | base64 -w 0
printf '\n'
