#!/usr/bin/env bash
# Install dsh-gitview into a DSH profile from this checkout.
#
# Usage:
#   tools/install-into-profile.sh [profile]        # default: web
#
# This legacy script writes to a DSH profile. It is idempotent and writes:
#
#   $DSH_HOME/profiles/<profile>/node_modules/<name>   (symlink -> this package)
#   $DSH_HOME/profiles/node_modules/<name>             (symlink -> this package)
#   $DSH_HOME/profiles/<profile>/cordis.patch.yml      (one appended insert row)
#
# Legacy checkout installer: retain only for existing manually linked profiles.
# New installs should use `dsh plugin --profile web add /absolute/checkout/path`.
# The standard manager activates this package's dsh.bundle.patch; do not combine
# that with this script's manual profile row.
set -euo pipefail

PROFILE="${1:-web}"
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_NAME="$(node -p "require('$PACKAGE_DIR/package.json').name")"
ENTRY_ID="git-tree"

DSH_BIN="${DSH_BIN:-dsh}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
PROFILES_NODE_MODULES="$DSH_HOME_DIR/profiles/node_modules"
BACKUP="$PATCH_FILE.bak-$ENTRY_ID"

for required in lib/index.js lib/client.js lib/git.js lib/ci.js; do
  test -f "$PACKAGE_DIR/$required" || { echo "missing $PACKAGE_DIR/$required" >&2; exit 1; }
done
test -f "$PATCH_FILE" || { echo "missing profile patch $PATCH_FILE" >&2; exit 1; }

# 1. Make the bare package name resolvable from the profile.
mkdir -p "$PROFILE_DIR/node_modules" "$PROFILES_NODE_MODULES"
ln -sfn "$PACKAGE_DIR" "$PROFILE_DIR/node_modules/$PACKAGE_NAME"
ln -sfn "$PACKAGE_DIR" "$PROFILES_NODE_MODULES/$PACKAGE_NAME"
echo "linked $PACKAGE_NAME -> $PACKAGE_DIR"

# 2. Append the loader row unless it is already there.
appended=0
if grep -qE "^[[:space:]]*-[[:space:]]*id:[[:space:]]*$ENTRY_ID[[:space:]]*$" "$PATCH_FILE"; then
  echo "patch entry '$ENTRY_ID' already present; leaving $PATCH_FILE untouched"
else
  cp "$PATCH_FILE" "$BACKUP"
  # The leading blank line also terminates a final line that lacked a newline,
  # so the appended item can never be glued onto the previous one.
  cat >>"$PATCH_FILE" <<EOF

# Git working-tree status tree for the web right sidebar (appended by $PACKAGE_NAME).
- insert:
    - id: $ENTRY_ID
      name: $PACKAGE_NAME
EOF
  appended=1
  echo "appended '$ENTRY_ID' insert to $PATCH_FILE (backup: $BACKUP)"
fi

# 3. Validate that the patch still parses and carries our row.
#
# A YAML parser already ships inside the profile's own node_modules, so this
# needs no dependency of its own; `paths` makes it resolvable from a script
# anywhere. When no parser is available we fall back to a structural check
# instead of refusing to install, and say so.
verify_patch() {
  local script status=0
  script="$(mktemp "${TMPDIR:-/tmp}/git-tree-verify.XXXXXX")"
  cat >"$script" <<'JS'
const fs = require("node:fs");
const [file, id, searchFrom] = process.argv.slice(2);
// Exit codes are a contract with the caller: 0 valid, 3 no parser available (so
// the caller may fall back to a weaker check), anything else invalid.
function parser() {
  for (const name of ["js-yaml", "yaml"]) {
    try {
      return require(require.resolve(name, { paths: [searchFrom] }));
    } catch {}
  }
  return undefined;
}
const yaml = parser();
if (yaml === undefined) {
  console.error(`no YAML parser resolvable from ${searchFrom}`);
  process.exit(3);
}
let doc;
try {
  doc = (yaml.load ?? yaml.parse)(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.error(`the patch is not valid YAML: ${error.message.split("\n")[0]}`);
  process.exit(1);
}
const rows = Array.isArray(doc) ? doc : [];
if (rows.length === 0) {
  console.error("the patch does not parse as a top-level list of patch entries");
  process.exit(1);
}
const ids = rows.flatMap((row) => (row && Array.isArray(row.insert) ? row.insert : [])).map((entry) => entry && entry.id);
if (!ids.includes(id)) {
  console.error(`the patch parsed but has no insert row with id "${id}"`);
  process.exit(1);
}
console.log(`patch parses as YAML; insert rows: ${ids.join(", ")}`);
JS
  # An `if` condition keeps `set -e` out of the way, and `$?` in the else branch
  # is the validator's own exit code (0 valid / 3 no parser / 1 invalid).
  if node "$script" "$PATCH_FILE" "$ENTRY_ID" "$PROFILES_NODE_MODULES"; then
    status=0
  else
    status=$?
  fi
  rm -f "$script"
  return $status
}

# The row is structurally present in the patch text.
verify_patch_structurally() {
  grep -qE "^[[:space:]]*-[[:space:]]*id:[[:space:]]*$ENTRY_ID[[:space:]]*$" "$PATCH_FILE" &&
    grep -qE "^[[:space:]]*name:[[:space:]]*$PACKAGE_NAME[[:space:]]*$" "$PATCH_FILE"
}

# Roll the patch back to what it was before this run.
rollback_patch() {
  if [ "$appended" = 1 ]; then
    mv "$BACKUP" "$PATCH_FILE"
    echo "restored $PATCH_FILE from backup" >&2
  fi
}

status=0
verify_patch || status=$?
case "$status" in
  0)
    ;;
  3)
    # No parser on this machine: accept the weaker textual check, but say so
    # rather than pretending the patch was parsed.
    if verify_patch_structurally; then
      echo "warning: no YAML parser found; checked the inserted row textually instead" >&2
    else
      echo "patch validation failed: the inserted row is not present" >&2
      rollback_patch
      exit 1
    fi
    ;;
  *)
    echo "patch validation failed" >&2
    rollback_patch
    exit 1
    ;;
esac

# 4. Optional: compose the whole profile. This is OFF by default because
# `dsh --dump-config` writes the profile's own cordis.yml as a side effect and
# can fail for reasons unrelated to this patch; a failure here is reported but
# never rolls the install back.
if [ "${DSH_VERIFY_DUMP:-0}" = 1 ]; then
  if "$DSH_BIN" --profile "$PROFILE" --dump-config >/tmp/"$ENTRY_ID"-dump.txt 2>/tmp/"$ENTRY_ID"-dump.err; then
    if grep -q "$ENTRY_ID" /tmp/"$ENTRY_ID"-dump.txt; then
      echo "composed profile contains the '$ENTRY_ID' row"
    else
      echo "warning: '$ENTRY_ID' not visible in the composed dump" >&2
    fi
  else
    echo "warning: 'dsh --dump-config' failed; this patch may be unrelated:" >&2
    cat /tmp/"$ENTRY_ID"-dump.err >&2
  fi
fi

cat <<'DONE'

install complete.
  - a live profile (patchReload: live) reloads this patch without a restart
  - reload the browser page so the new client bundle is fetched
  - then open the right sidebar's Start page and pick the Git entry
  - to also compose the profile during install: DSH_VERIFY_DUMP=1 re-run this script

uninstall:
  remove the 'insert' row naming id: git-tree from the profile's cordis.patch.yml,
  then delete these two symlinks:
    ~/.dsh/profiles/<profile>/node_modules/dsh-gitview
    ~/.dsh/profiles/node_modules/dsh-gitview

troubleshooting:
  the tab exists but the tree says the host half is missing  -> the row is absent
    from cordis.patch.yml, or the name in it does not resolve
  the guide button is missing entirely                      -> lib/client.js did not
    load; check the browser console, then that ./client is exported
DONE
