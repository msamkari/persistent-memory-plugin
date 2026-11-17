# Runs archive-external.mjs. Not listed in any skill's allowed-tools on purpose: the user approves each run.
exec node "$(dirname "$0")/../archive-external.mjs" "$@"
