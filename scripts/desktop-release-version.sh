# Downcity Desktop 发布版本与交互辅助函数。
# 本文件只供 release shell 脚本 source，不作为独立命令执行。

read_package_version() {
  package_path=$1
  node --input-type=module -e '
    import fs from "node:fs";
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(typeof pkg.version === "string" ? pkg.version : "");
  ' "$package_path"
}

write_package_version() {
  package_path=$1
  version=$2
  node --input-type=module -e '
    import fs from "node:fs";
    const packagePath = process.argv[1];
    const version = process.argv[2];
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    pkg.version = version;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  ' "$package_path" "$version"
}

bump_semver() {
  current_version=$1
  bump_mode=$2

  if [ "$bump_mode" = "none" ]; then
    printf "%s" "$current_version"
    return 0
  fi

  old_ifs=$IFS
  IFS=.
  set -- $current_version
  IFS=$old_ifs

  if [ "$#" -ne 3 ]; then
    echo "Unsupported version format: $current_version" >&2
    exit 1
  fi

  major=$1
  minor=$2
  patch=$3

  case "$bump_mode" in
    patch)
      patch=$((patch + 1))
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    *)
      echo "Unsupported version bump: $bump_mode" >&2
      exit 1
      ;;
  esac

  printf "%s.%s.%s" "$major" "$minor" "$patch"
}

prompt_yes_no() {
  prompt=$1
  default_value=$2

  case "$default_value" in
    true) prompt_suffix="Y/n" ;;
    false) prompt_suffix="y/N" ;;
    *) echo "Invalid default boolean: $default_value" >&2; exit 1 ;;
  esac

  while :; do
    printf "%s [%s]: " "$prompt" "$prompt_suffix" >&2
    IFS= read -r answer
    answer=$(printf "%s" "$answer" | tr '[:upper:]' '[:lower:]')
    if [ -z "$answer" ]; then
      printf "%s" "$default_value"
      return 0
    fi

    case "$answer" in
      y|yes|true|1)
        printf "true"
        return 0
        ;;
      n|no|false|0)
        printf "false"
        return 0
        ;;
    esac

    echo "Please answer y or n." >&2
  done
}

prompt_choice() {
  prompt=$1
  default_value=$2
  shift 2

  options_display=$(printf "%s" "$*" | tr ' ' '/')

  while :; do
    printf "%s [%s] (%s): " "$prompt" "$default_value" "$options_display" >&2
    IFS= read -r answer
    answer=$(printf "%s" "$answer" | tr '[:upper:]' '[:lower:]')
    if [ -z "$answer" ]; then
      printf "%s" "$default_value"
      return 0
    fi

    for option in "$@"; do
      if [ "$answer" = "$option" ]; then
        printf "%s" "$option"
        return 0
      fi
    done

    echo "Please choose one of: $options_display" >&2
  done
}
