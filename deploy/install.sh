#!/bin/sh
# Install Control Hub on this machine.
#
# Run it from the directory the release package was extracted into. It asks one thing per screen
# with the answers so far kept in view, validates each one where it is given, generates every
# secret itself, brings the stack up, and creates the first Owner.
#
#   ./install.sh              install, or continue an installation that stopped part-way
#   ./install.sh --dry-run    ask and validate everything, write the files, touch no container
#
# Two rules shape the whole file, and both come from `docs/specifications/deployment.md`:
#
# It never asks for a password. Not the database's, not the Owner's. A password that is typed is
# in the shell history, one that is printed is in the scrollback, and one that is stored is on
# disk for the life of the installation. Every secret here comes from /dev/urandom and is written
# straight to a file only root can read; the Owner is mailed a link and chooses their own.
#
# It can be run again. Every step looks first: an answer already in `.env` becomes the default, a
# secret already written is left exactly as it is, and a tenant that already exists is not a
# failure. Re-running is how somebody recovers from stopping half-way, which on a first install is
# the normal case rather than the strange one.
#
# POSIX sh and docker, nothing else -- a customer's server has no repository and no Node.
#
# CONTROL_HUB_RELEASE_URL   where the release file is read from (default: the latest release)
# SECRETS_DIRECTORY         where the secret files go (default: /etc/control-hub/secrets)
set -eu

RELEASE_URL="${CONTROL_HUB_RELEASE_URL:-https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.env}"
SECRETS_DIRECTORY="${SECRETS_DIRECTORY:-/etc/control-hub/secrets}"
SERVICES="API WORKER MIGRATE WEB"
TRAEFIK_FILE="traefik-control-hub.yaml"

dry_run=no
[ "${1:-}" = "--dry-run" ] && dry_run=yes

say() { printf '%s\n' "$*"; }
fail() { printf 'install: %s\n' "$*" >&2; exit 1; }

# --- what has to be true before anything is asked -------------------------------------------------

for file in compose.yaml compose.release.yaml compose.production.yaml; do
  [ -f "$file" ] || fail "no $file here. Run this from the directory the release package was extracted into."
done
[ -f deploy/postgres/init-app-user.sh ] ||
  fail "deploy/postgres/init-app-user.sh is missing. The release package is incomplete; download it again."

if [ "$dry_run" = no ]; then
  command -v docker >/dev/null 2>&1 || fail "docker is not on PATH."
  docker compose version >/dev/null 2>&1 || fail "docker compose v2 is not available."
  # Not a preference. The secret files have to be owned by root and mode 0400, and a process that
  # cannot chown them would leave them readable by whoever ran the installer -- which is the one
  # property the whole mounted-secrets design exists to provide.
  [ "$(id -u)" = "0" ] || fail "run this as root: the secret files must be owned by root and mode 0400."
fi

# --- asking -------------------------------------------------------------------------------------

# Everything answered so far, in the order it was asked, redisplayed above every question. An
# installer that shows one question and nothing else makes somebody hold the previous six in their
# head, and the seventh answer is the one that contradicts the second.
answers=""

remember() {
  answers="${answers}  $1
"
}

heading() {
  # Only when a person is watching. Clearing the screen inside a CI log or a pipe would fill it
  # with escape codes and bury the very output somebody would send when asking for help.
  [ -t 1 ] && printf '\033[H\033[2J'
  say "Control Hub -- installation"
  say ""
  [ -n "$answers" ] && printf '%s' "$answers"
  say ""
  say "  $1"
  say ""
}

# What an earlier run recorded, or the fallback when there is no earlier run. Two arguments rather
# than a `||`: printing nothing is still success, so `existing X || default` would never fire.
existing() {
  value=""
  [ -f .env ] && value=$(sed -n "s/^$1=//p" .env | head -1)
  [ -n "$value" ] || value="${2:-}"
  printf '%s' "$value"
}

# Reads one answer, offering a default. `read` returns non-zero at end of input, which under
# `set -e` would abort the script, so end of input is taken as «accept the default» -- and that is
# what lets a fully defaulted re-run happen without a terminal at all.
ask() {
  if [ -n "${2:-}" ]; then
    printf '%s [%s]: ' "$1" "$2"
  else
    printf '%s: ' "$1"
  fi
  if ! IFS= read -r reply; then reply=""; fi
  [ -n "$reply" ] || reply="${2:-}"
}

# The one answer that is not the installer's to generate, and so the one place invariant 8 has to
# be kept by hand: echo off while it is typed, and it reaches a 0400 file without passing through a
# variable that anything prints. Terminals without `stty` fall through to a visible prompt rather
# than to no prompt -- a relay credential that cannot be entered is an installation that cannot mail.
ask_hidden() {
  printf '%s: ' "$1"
  if [ -t 0 ] && command -v stty >/dev/null 2>&1; then
    stty -echo 2>/dev/null || true
    if ! IFS= read -r reply; then reply=""; fi
    stty echo 2>/dev/null || true
    printf '\n'
  else
    if ! IFS= read -r reply; then reply=""; fi
  fi
}

confirm() {
  printf '%s [y/N]: ' "$1"
  if ! IFS= read -r reply; then reply="n"; fi
  case "$reply" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

# --- the questions ---------------------------------------------------------------------------------

heading "1 of 6 -- the address people will use"
say "The domain this installation answers on. It has to resolve already; TLS is terminated by the"
say "reverse proxy in front of this machine, and the last step prints what to give it."
say ""
ask "Domain" "$(existing APP_ORIGIN | sed 's|^https*://||')"
domain="$reply"
case "$domain" in
  "" | *[!a-zA-Z0-9.-]* | .* | *. | *..*) fail "«$domain» is not a domain name." ;;
esac
case "$domain" in
  *.*) ;;
  *) fail "«$domain» has no dot in it. A bare hostname cannot be given a certificate." ;;
esac

# Resolving is required; resolving to this exact machine is not. Behind NAT, a load balancer or a
# proxy the address legitimately belongs to something else, and refusing those outright would make
# the installer useless in the arrangement D2 actually describes. A name that resolves nowhere is a
# different thing: nothing downstream can work, and the cause is almost always a typo made here.
resolved=""
if command -v getent >/dev/null 2>&1; then
  resolved=$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' | head -1 || true)
elif command -v nslookup >/dev/null 2>&1; then
  # Only the answer, never the header. The `Address:` lines above `Name:` are the resolver's own,
  # and reading those made every name look resolvable -- including one that exists nowhere, which
  # is the single case this check is here for. Machines without `getent` are exactly the ones a
  # first installation tends to be prepared on, so the wrong answer would have been the usual one.
  answer='/^Name:/ { seen = 1 } seen && /^Address(es)?:[[:space:]]/ { print $NF; exit }'
  resolved=$(nslookup "$domain" 2>/dev/null | awk "$answer" || true)
fi
say ""
if [ -z "$resolved" ]; then
  say "  $domain does not resolve from this machine."
  confirm "  Continue anyway (the DNS record is not created yet)?" ||
    fail "stopped so the DNS record can be created first. Nothing has been written."
else
  say "  $domain resolves to $resolved"
fi
remember "Domain:        $domain"

heading "2 of 6 -- the first Owner"
say "The person this installation belongs to. They are mailed a link and choose their own"
say "password. None is asked for here, and none is ever displayed or stored."
say ""
ask "Owner email" "$(existing BOOTSTRAP_OWNER_EMAIL)"
owner_email="$reply"
case "$owner_email" in
  *@*.*) ;;
  *) fail "«$owner_email» is not an email address, and it is the only way into the Owner account." ;;
esac
ask "Owner name" "$(existing BOOTSTRAP_OWNER_NAME)"
owner_name="$reply"
[ -n "$owner_name" ] || fail "the Owner needs a name."
remember "Owner:         $owner_email"

heading "3 of 6 -- the organisation"
say "The company this installation is for. The short name reaches URLs and database identifiers,"
say "and changing it afterwards is a migration."
say ""
ask "Organisation name" "$(existing BOOTSTRAP_TENANT_NAME)"
tenant_name="$reply"
[ -n "$tenant_name" ] || fail "the organisation needs a name."
suggested=$(printf '%s' "$tenant_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
ask "Short name" "$(existing BOOTSTRAP_TENANT_SLUG "$suggested")"
tenant_slug="$reply"
printf '%s' "$tenant_slug" | grep -Eq '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' ||
  fail "«$tenant_slug» is not a short name: lowercase letters, digits and hyphens, three characters or more."
remember "Organisation:  $tenant_name ($tenant_slug)"

heading "4 of 6 -- sending mail"
say "Every way into this installation goes through mail: the Owner's link, invitations, password"
say "resets, address verification. It is checked here rather than discovered later."
say ""
ask "SMTP host" "$(existing SMTP_HOST)"
smtp_host="$reply"
[ -n "$smtp_host" ] || fail "an SMTP host is required. Nothing can be verified or recovered without one."
ask "SMTP port" "$(existing SMTP_PORT 587)"
smtp_port="$reply"
printf '%s' "$smtp_port" | grep -Eq '^[0-9]{1,5}$' || fail "«$smtp_port» is not a port."
ask "TLS on connect (true for 465, false for 587)" "$(existing SMTP_SECURE false)"
smtp_secure="$reply"
case "$smtp_secure" in
  true | false) ;;
  *) fail "answer true or false." ;;
esac
ask "From address" "$(existing SMTP_FROM "control-hub@$domain")"
smtp_from="$reply"
case "$smtp_from" in
  *@*.*) ;;
  *) fail "«$smtp_from» is not an email address." ;;
esac

# Almost every relay worth pointing at refuses an unauthenticated session, and the message it
# refuses first is the Owner's only way into their own account. Asked rather than generated: this
# credential belongs to the relay, not to this installation.
say ""
say "  Leave the user blank for a relay that accepts mail from this machine without credentials."
say ""
ask "Relay user" "$(existing SMTP_USER)"
smtp_user="$reply"
smtp_password=""
if [ -n "$smtp_user" ]; then
  if [ -f "$SECRETS_DIRECTORY/smtp_password" ]; then
    say ""
    say "  A relay password is already stored. Leave this blank to keep it."
  fi
  ask_hidden "Relay password"
  smtp_password="$reply"
  reply=""
  if [ -z "$smtp_password" ] && [ ! -f "$SECRETS_DIRECTORY/smtp_password" ]; then
    fail "a relay user without a password authenticates with an empty one, and the relay refuses every message."
  fi
elif [ -f "$SECRETS_DIRECTORY/smtp_password" ]; then
  say ""
  say "  No relay user, so the stored password in $SECRETS_DIRECTORY is no longer used."
  say "  It is left in place; delete it by hand if the relay credential is gone for good."
fi

# A connection, and deliberately not a delivery. An installer that proves it can send mail has to
# send it to somebody, and the only address it knows belongs to a person who has not been told any
# of this is happening. The Owner's link is the first real message; this is what makes it likely to
# arrive. Nothing is pulled to run the check either: a relay is reachable or it is not, and
# downloading an image to find out would add a dependency to answer a question about the network.
say ""
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 5 "$smtp_host" "$smtp_port" >/dev/null 2>&1; then
    say "  $smtp_host:$smtp_port accepted a connection."
  else
    say "  Nothing answered at $smtp_host:$smtp_port."
    confirm "  Continue anyway (the Owner will not receive their link until this works)?" ||
      fail "stopped so the mail relay can be fixed first. Nothing has been written."
  fi
else
  say "  No nc on this machine, so $smtp_host:$smtp_port was not contacted."
fi
if [ -n "$smtp_user" ]; then
  remember "Mail:          $smtp_host:$smtp_port as $smtp_from, authenticating as $smtp_user"
else
  remember "Mail:          $smtp_host:$smtp_port as $smtp_from, unauthenticated"
fi

heading "5 of 6 -- which modules are on"
say "Comma separated, and changeable later by editing CONTROL_HUB_FLAGS in .env. A name that is"
say "not a module is ignored, and the API says which at startup."
say ""
say "  The list this release knows is in docs/runbooks/installation.md."
say ""
ask "Modules" "$(existing CONTROL_HUB_FLAGS projects_and_time)"
flags="$reply"
remember "Modules:       ${flags:-none}"

heading "6 of 6 -- backups"
say "Where the database dump goes before every update. Somewhere on this machine: copying it off"
say "the machine is a separate job, and this installer does not do it."
say ""
ask "Backup directory" "$(existing CONTROL_HUB_BACKUP_DIR ./backups)"
backup_dir="$reply"
[ -n "$backup_dir" ] || fail "a backup directory is required."
remember "Backups:       $backup_dir"

heading "Ready"
say "Nothing has been written yet. What follows generates the secrets, writes the configuration"
say "and starts the installation."
say ""
confirm "Go ahead?" || fail "stopped. Nothing has been written."

# --- secrets --------------------------------------------------------------------------------------

# Hexadecimal on purpose. These values travel inside connection URIs, YAML and shell arguments, and
# base64's `+` and `/` need escaping in at least one of those -- a password that arrives different
# from the one that was set fails at connect time with nothing to point at.
random_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

# Written once and never rewritten, which is most of what makes a second run safe. Regenerating a
# password would leave PostgreSQL holding the old one -- the script that creates the role runs on
# an empty data directory and never again -- so the re-run would produce a configuration that
# cannot connect to its own database, and would look like a corrupted volume.
secret() {
  path="$SECRETS_DIRECTORY/$1"
  if [ ! -f "$path" ]; then
    (umask 077 && printf '%s' "$2" > "$path")
    [ "$dry_run" = yes ] || chown root:root "$path"
    chmod 0400 "$path"
  fi
  cat "$path"
}

mkdir -p "$SECRETS_DIRECTORY"
chmod 0700 "$SECRETS_DIRECTORY"
[ "$dry_run" = yes ] || chown root:root "$SECRETS_DIRECTORY"

say ""
say "Secrets in $SECRETS_DIRECTORY"
admin_password=$(secret postgres_admin_password "$(random_hex 32)")
app_password=$(secret postgres_app_password "$(random_hex 32)")
secret better_auth_secret "$(random_hex 32)" > /dev/null
secret migration_database_url "postgres://control_hub_admin:${admin_password}@postgres:5432/control_hub" > /dev/null
secret database_url "postgres://control_hub_app:${app_password}@postgres:5432/control_hub" > /dev/null
# Generated whether or not connectors are on today. An unused key ring is one file; a missing one
# is an installation that cannot turn the module on later without somebody coming back to it.
secret connector_key_ring \
  "{\"activeKeyId\":\"k1\",\"keys\":{\"k1\":\"$(head -c 32 /dev/urandom | base64 | tr -d '\n')\"}}" > /dev/null
# Not through `secret()`. That helper exists to never rewrite what it generated -- regenerating a
# database password would leave PostgreSQL holding the old one -- and this is the one secret here
# that somebody else owns and can legitimately change under us. A blank answer keeps what is stored.
if [ -n "$smtp_password" ]; then
  # Made writable for the moment of the rewrite. Root is allowed to write a 0400 file anyway, but
  # depending on that would make the one path this script has that overwrites a secret work only
  # because of who is running it -- and the failure, when it came, would be a redirection error
  # after every question had been answered.
  [ -f "$SECRETS_DIRECTORY/smtp_password" ] && chmod 0600 "$SECRETS_DIRECTORY/smtp_password"
  (umask 077 && printf '%s' "$smtp_password" > "$SECRETS_DIRECTORY/smtp_password")
  [ "$dry_run" = yes ] || chown root:root "$SECRETS_DIRECTORY/smtp_password"
  chmod 0400 "$SECRETS_DIRECTORY/smtp_password"
  smtp_password=""
  say "  Seven files, mode 0400, owned by root."
else
  say "  Six files, mode 0400, owned by root."
fi

# --- ports ----------------------------------------------------------------------------------------

# Which ports this machine already has something listening on. Asked once: `ss` is a process spawn,
# and asking it per port would run it four times to answer one question.
#
# Only the port number is kept. What is listening on 127.0.0.1:5432 and what is listening on
# 0.0.0.0:5432 are different things to a network engineer and the same thing to `docker compose up`,
# which refuses the bind either way.
listening_ports() {
  if command -v ss > /dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }'
  elif command -v netstat > /dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '/^tcp/ { print $4 }'
  fi
}

# A machine with neither tool answers «nothing is listening», and the preferred ports are kept. That
# is the same outcome as before any of this existed, which is the right way to be wrong here: the
# installation either starts, or fails at `docker compose up` with the error it always gave.
taken=$(listening_ports | sed 's/.*://' | grep -E '^[0-9]+$' | sort -u || true)

free_port() {
  candidate=$1
  attempts=0
  while printf '%s\n' "$taken" | grep -qx "$candidate"; do
    candidate=$((candidate + 1))
    attempts=$((attempts + 1))
    # A bound, not a policy. A machine with fifty consecutive ports taken from the preferred one has
    # something wrong with it that a fifty-first port would not fix.
    [ "$attempts" -lt 50 ] || fail "no free port between $1 and $candidate. Something is very wrong with this machine."
  done
  printf '%s' "$candidate"
}

# What an earlier run chose wins, and is never probed. On a re-run the installation itself is what is
# holding these ports, so looking would find every one of them busy and walk the configuration off
# its own ports -- an update that moves the address Traefik was told about.
choose_port() {
  chosen=$(existing "$1")
  [ -n "$chosen" ] || chosen=$(free_port "$2")
  printf '%s' "$chosen"
}

# Not questions, deliberately. These are 127.0.0.1 ports nobody has ever typed, and one more
# conditional question is one more question that does not appear on some machine and shifts every
# answer after it onto the wrong prompt -- the defect P7 already paid for.
web_port=$(choose_port WEB_PORT 3001)
api_port=$(choose_port API_PORT 4000)
postgres_port=$(choose_port POSTGRES_PORT 5432)
redis_port=$(choose_port REDIS_PORT 6379)

say ""
say "Ports"
moved=no
for pair in "web 3001 $web_port" "api 4000 $api_port" "postgres 5432 $postgres_port" "redis 6379 $redis_port"; do
  # Positional, because `set --` inside a function would eat the function's own arguments and this
  # is the one place three fields have to be read out of one string.
  name=${pair%% *}
  rest=${pair#* }
  wanted=${rest%% *}
  got=${rest#* }
  if [ "$wanted" != "$got" ]; then
    say "  $name: $wanted is taken, using $got."
    moved=yes
  fi
done
[ "$moved" = yes ] || say "  The usual four are free: $web_port, $api_port, $postgres_port, $redis_port."

# --- configuration ------------------------------------------------------------------------------

# `.env` is what an operator chose; `release.env` is what the release decided. An update rewrites
# the second and never touches the first, which is the whole reason they are two files.
say ""
say "Writing .env"
umask 077
cat > .env <<EOF
# Written by install.sh. Everything here is configuration and none of it is secret: the secrets
# are files in $SECRETS_DIRECTORY. Safe to edit by hand; re-run install.sh to change it through
# the questions instead.
NODE_ENV=production
SECRETS_DIRECTORY=$SECRETS_DIRECTORY
SECRETS_PROVIDER=runtime_files
LOG_LEVEL=info
WEB_PORT=$web_port
API_PORT=$api_port
POSTGRES_PORT=$postgres_port
REDIS_PORT=$redis_port
MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025
API_HOST=127.0.0.1
API_INTERNAL_URL=http://api:4000
APP_ORIGIN=https://$domain
MCP_ISSUER=https://$domain
WEBAUTHN_RP_ID=$domain
WEBAUTHN_ORIGIN=https://$domain
NEXT_PUBLIC_DEFAULT_LOCALE=ca
SMTP_HOST=$smtp_host
SMTP_PORT=$smtp_port
SMTP_SECURE=$smtp_secure
SMTP_FROM=$smtp_from
SMTP_USER=$smtp_user
CONTROL_HUB_FLAGS=$flags
CONTROL_HUB_UPDATE_CHECK=true
CONTROL_HUB_BACKUP_DIR=$backup_dir
BOOTSTRAP_OWNER_EMAIL=$owner_email
BOOTSTRAP_OWNER_NAME=$owner_name
BOOTSTRAP_TENANT_NAME=$tenant_name
BOOTSTRAP_TENANT_SLUG=$tenant_slug
EOF
chmod 0600 .env
say "  .env written, mode 0600."

# The reverse proxy is neither installed nor owned by this script. On the machine D2 describes,
# Traefik is already running and is shared with other people's services, so the installer writes
# the routing beside the installation and says where to copy it. An installer that edits a shared
# proxy's live configuration is how one installation takes another one down.
cat > "$TRAEFIK_FILE" <<EOF
# Routing for this installation, for the Traefik already running on this machine.
# Copy it into Traefik's dynamic configuration directory; it is not read from here.
http:
  routers:
    control-hub:
      rule: "Host(\`$domain\`)"
      entryPoints: [websecure]
      service: control-hub
      tls:
        certResolver: letsencrypt
  services:
    control-hub:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:$web_port"
EOF
say "  $TRAEFIK_FILE written."

# --- the release ----------------------------------------------------------------------------------

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "neither curl nor wget is available to read $1"
  fi
}

# The same three properties `deploy/update.sh` insists on, and `scripts/install.test.mjs` holds the
# two scripts to refusing the same files rather than trusting that they still agree. This arrives
# over the network, and the failure that matters is not a malformed release: it is a plausible one,
# where every reference looks right and one of them resolves somewhere else.
validate_release() {
  file="$1"
  version=$(sed -n 's/^CONTROL_HUB_VERSION=//p' "$file")
  [ -n "$version" ] || fail "$file names no CONTROL_HUB_VERSION"

  namespace=""
  for service in $SERVICES; do
    image=$(sed -n "s/^CONTROL_HUB_${service}_IMAGE=//p" "$file")
    [ -n "$image" ] || fail "$file names no image for $service"
    case "$image" in
      *@sha256:*) ;;
      *) fail "$service is not pinned by digest: $image" ;;
    esac
    # Everything up to the last slash: the registry and owner the image lives under.
    here=${image%/*}
    [ -n "$namespace" ] || namespace="$here"
    [ "$here" = "$namespace" ] || fail "the images come from two places, $namespace and $here"
  done

  extra=$(grep -cv '^CONTROL_HUB_\(VERSION\|API_IMAGE\|WORKER_IMAGE\|MIGRATE_IMAGE\|WEB_IMAGE\)=\|^#\|^$' "$file" || true)
  [ "$extra" -eq 0 ] || fail "$file carries $extra line(s) that a release file has no business carrying"
}

say ""
say "Reading the release"
# So a rejected candidate never survives the exit to be mistaken for the real file by a later run.
trap 'rm -f release.env.new' EXIT
download "$RELEASE_URL" release.env.new || fail "could not read the release from $RELEASE_URL"
validate_release release.env.new
mv release.env.new release.env
say "  Version $version, four images pinned by digest."

if [ "$dry_run" = yes ]; then
  say ""
  say "Dry run. The secrets and the configuration are written; nothing was started."
  exit 0
fi

# --- starting -------------------------------------------------------------------------------------

# The relay overlay joins the invocation only when there is a credential to mount. It ships in
# every package, so its presence on disk says nothing; what decides is `SMTP_USER`, the half that
# lives in `.env`. `deploy/update.sh` reads the same variable to reach the same decision, and
# `scripts/install.test.mjs` holds the two to it: an overlay one script loads and the other does
# not is an installation that silently loses a mount on its first update.
overlays="-f compose.yaml -f compose.release.yaml -f compose.production.yaml"
[ -n "$smtp_user" ] && overlays="$overlays -f compose.production.smtp.yaml"

compose() {
  docker compose --env-file .env --env-file release.env $overlays "$@"
}

say ""
say "Pulling $version by digest"
compose pull || fail "could not pull the images. Nothing is running yet."

say ""
say "Starting, and migrating on the way up"
compose up -d --wait || fail "the stack did not come up. 'docker compose logs' says why."

# --- the first Owner ---------------------------------------------------------------------------

# The bootstrap refuses to run when a tenant already exists, and that refusal is what makes
# re-running the installer safe: on a second pass this reports what is already true instead of
# turning a completed installation into a failed one.
say ""
say "Creating the first Owner"
if compose --profile bootstrap run --rm bootstrap; then
  owner_state="mailed a link to set their own password"
else
  say ""
  say "  This installation already has an organisation, so no Owner was created."
  say "  If nobody can sign in, use «forgot password» on the sign-in page."
  owner_state="already existed; nothing was changed"
fi

# --- what happened, and what did not ---------------------------------------------------------------

say ""
say "Control Hub $version is running."
say ""
say "  Address:       https://$domain, once $TRAEFIK_FILE reaches Traefik"
say "  Owner:         $owner_email, $owner_state"
say "  Configuration: .env, here in $(pwd)"
say "  Secrets:       $SECRETS_DIRECTORY, mode 0400, owned by root"
say "  Release:       release.env names $version"
say ""
say "What this installer did not do:"
say ""
say "  - It did not touch Traefik. Copy $TRAEFIK_FILE into its dynamic configuration"
say "    directory and reload it; nothing is reachable from outside until you do."
say "  - Modules that are off: everything not in «${flags:-none}». Turn one on by editing"
say "    CONTROL_HUB_FLAGS in .env and starting the stack again."
say "  - No connector is configured. Mail, calendar and the rest are set up from the panel by"
say "    the Owner, after signing in."
say "  - No backup exists yet. The first one is taken by ./update.sh, which backs up before it"
say "    changes anything; nothing here has taken one because there was nothing to lose."
say "  - Nothing copies $backup_dir off this machine. That one is still yours."
