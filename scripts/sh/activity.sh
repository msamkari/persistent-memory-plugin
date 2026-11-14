# Runs the plugin's own Node script activity.mjs. It exists so a skill can pre-approve this one exact shell script.
exec node "$(dirname "$0")/../activity.mjs" "$@"
