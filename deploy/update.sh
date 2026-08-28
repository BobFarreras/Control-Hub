#!/bin/sh
# Update a Control Hub installation.
#
# Run it from the installation directory. It does, in this order: read the new release, back the
# database up, pull the images by digest, run the migration job, and only then replace the running
# services. If the migrations fail it stops there -- the previous stack is still up, because nothing
# has touched it yet -- and prints what it did and what it kept.
#
# This is the seven manual steps of `docs/runbooks/installation.md` as one command. The point is not
# convenience. A list of seven steps is a list somebody performs at 23:00 while something is broken,
# and step 2 -- the backup -- is the one that gets skipped because the other six feel like the work.
#
# POSIX sh and docker, nothing else. A customer's server has no repository, no Node and no
# toolchain, and this is not the file that should start requiring them.
#
#   ./update.sh            update to the latest published release
#   ./update.sh --check    say whether an update exists, change nothing
#
# CONTROL_HUB_RELEASE_URL   where to read the release from (default: the latest GitHub release)
# CONTROL_HUB_PACKAGE_URL   where to read the installation package from (default: beside the release)
# CONTROL_HUB_BACKUP_DIR    where the backup goes (default: ./backups)
set -eu

RELEASE_URL="${CONTROL_HUB_RELEASE_URL:-https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.env}"
# Beside the release file by default rather than spelled out again, so that pointing
# CONTROL_HUB_RELEASE_URL at a mirror moves both halves of a release together. A machine that read
# its digests from one place and its compose files from another would be assembling a version that
# was never published as a whole.
PACKAGE_URL="${CONTROL_HUB_PACKAGE_URL:-${RELEASE_URL%/*}/control-hub-install.tar.gz}"
BACKUP_DIR="${CONTROL_HUB_BACKUP_DIR:-./backups}"
SERVICES="API WORKER MIGRATE WEB"

check_only=no
[ "${1:-}" = "--check" ] && check_only=yes

say() { printf '%s\n' "$*"; }
fail() { printf 'update: %s\n' "$*" >&2; exit 1; }

# --- what has to be true before anything happens ------------------------------------------------

for file in compose.yaml compose.release.yaml .env release.env; do
  [ -f "$file" ] || fail "no $file here. Run this from the installation directory."
done
command -v docker >/dev/null 2>&1 || fail "docker is not on PATH."
command -v tar >/dev/null 2>&1 || fail "tar is not on PATH."
# The same guard `install.sh` carries, for the same reason and one more. This replaces files in a
# directory root owns and reads a `.env` mode 0600, so a non-root run cannot finish. What makes it a
# guard rather than a courtesy is where it would otherwise stop: the migrations run before any file
# is replaced, so a run with just enough permission to reach them and not enough to finish leaves a
# database migrated with the old code still in front of it. It has to fail before the backup, not
# halfway through. `--check` is not exempt: it writes `release.env.new` here like every other run.
[ "$(id -u)" = "0" ] || fail "run this as root: the update replaces files this directory owns."

# compose.production.yaml is part of a production installation and absent from a local one, so it
# joins the invocation only when it exists rather than being demanded above.
overlays="-f compose.yaml -f compose.release.yaml"
[ -f compose.production.yaml ] && overlays="$overlays -f compose.production.yaml"

# The relay overlay is decided by configuration rather than by presence: it ships in every package,
# so the file being here says nothing, and `SMTP_USER` is what `install.sh` writes when there is a
# credential to mount. Reading the file rather than sourcing it, because `.env` is not this script's
# environment and one stray line in it should not become one here.
smtp_user=$(sed -n 's/^SMTP_USER=//p' .env | head -1)
[ -n "$smtp_user" ] && overlays="$overlays -f compose.production.smtp.yaml"

# The connector overlay mounts the key ring. Loaded when the flag is on, read from `.env` for the
# same reason as `SMTP_USER` above. `install.sh` reaches the same decision from the variable it
# has in memory; this one reads the file, and the two must agree or an update silently drops a
# mount the installation needs.
flag_active() {
  case ",${2:-}," in *,"$1",*) return 0 ;; *) return 1 ;; esac
}
control_hub_flags=$(sed -n 's/^CONTROL_HUB_FLAGS=//p' .env | head -1)
flag_active connectors "$control_hub_flags" && overlays="$overlays -f compose.production.connectors.yaml"

# The routing, where install.sh could read the proxy well enough to write it. Presence is the signal
# for this one, and it can be: nothing ships it, so it exists only where it was generated. Leaving it
# out would take the installation off the proxy on the first update, silently -- the containers would
# come back up without the labels Traefik routes by, and the address would stop answering with
# nothing in any log to say why.
[ -f compose.proxy.yaml ] && overlays="$overlays -f compose.proxy.yaml"

# --- reading the new release ---------------------------------------------------------------------

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "neither curl nor wget is available to read $1"
  fi
}

# Validation, and the reason it is worth doing on a line-oriented file that CI already validated as
# JSON: this arrives over the network, and the failure that matters is not a malformed file -- it is
# a plausible one. A reference that resolves to something else looks exactly like a correct entry.
#
# Two properties carry the weight. Every image is pinned by digest, so nothing can arrive by a tag
# that later means something different. And all four share one registry namespace: four references
# that each look right but come from two registries is not a shape a release can have, and is
# precisely the shape a substituted image would have.
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

current=$(sed -n 's/^CONTROL_HUB_VERSION=//p' release.env)
say "Installed: ${current:-unknown}"

download "$RELEASE_URL" release.env.new || fail "could not read the release from $RELEASE_URL"
validate_release release.env.new
say "Available: $version"

if [ "$version" = "$current" ]; then
  rm -f release.env.new
  say ""
  say "Already up to date. Nothing to do."
  exit 0
fi

if [ "$check_only" = yes ]; then
  rm -f release.env.new
  say ""
  say "An update is available. Run this command without --check to apply it."
  exit 0
fi

compose_new() { docker compose --env-file .env --env-file release.env.new $overlays "$@"; }
compose_now() { docker compose --env-file .env --env-file release.env $overlays "$@"; }

# --- reading the product files ---------------------------------------------------------------------
#
# `release.env` names four images and nothing else, so until v0.4.2 this command could deliver only
# what lived inside an image. Everything else a release changes -- the compose files, the PostgreSQL
# init script, the installer itself -- stayed on the machine at whatever version installed it.
#
# That is not a small gap. v0.4.2 fixes an empty sidebar by naming `CONTROL_HUB_FLAGS` in
# `compose.yaml`; on an installation updated the old way the sidebar would have stayed empty and the
# operator would have concluded, reasonably, that the release did not work. A published fix that
# cannot reach a running machine is not a fix.
#
# So the package is read too. It carries exactly the files a release owns and none this machine
# owns -- no `.env`, no `release.env`, no `compose.proxy.yaml`, which install.sh generated from the
# answers somebody typed -- and that property is checked rather than trusted, because it arrives
# over the network and it is about to be written into this directory.
STAGING=.control-hub-package

say ""
say "Reading the product files for $version"
download "$PACKAGE_URL" package.tar.gz.new || { rm -f release.env.new; fail "could not read the package from $PACKAGE_URL. Nothing has changed; $current is still running."; }

entries=$(tar -tzf package.tar.gz.new) || { rm -f release.env.new package.tar.gz.new; fail "the package at $PACKAGE_URL is not a readable archive. Nothing has changed."; }
refuse() { rm -f release.env.new package.tar.gz.new; fail "$1 Nothing has changed; $current is still running."; }

for entry in $entries; do
  # The archive is rooted at `.`, and that prefix has to come off before the name is judged: an
  # absolute path inside such an archive arrives as `.//etc/passwd`, which begins with neither `/`
  # nor `..` and would walk straight past a check that read the entry as tar printed it.
  name=${entry#./}
  case "$name" in
    "" | */) continue ;;
  esac
  # An archive is a list of paths chosen by whoever built it, and the two that matter are a path
  # that climbs out of this directory and a path that never was relative to begin with. GNU tar
  # strips both on extraction and says so, but a warning on somebody's terminal is not a control.
  case "$name" in
    /*|*..*) refuse "the package carries $name, which would write outside this directory." ;;
  esac
  # And the files this installation owns. A release has no business shipping any of them; if one
  # ever does, that is a mistake in the release and not something to apply quietly.
  case "$name" in
    .env|release.env|release.env.previous|compose.proxy.yaml)
      refuse "the package carries $name, which belongs to this installation and not to a release." ;;
  esac
done

case "$entries" in
  *compose.yaml*) ;;
  *) refuse "the package at $PACKAGE_URL carries no compose.yaml, so it is not an installation package." ;;
esac

# --- the backup, before anything is pulled or run ------------------------------------------------

mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/control-hub-${current:-unknown}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

say ""
say "Backing up to $backup"

# `pg_dump | gzip > file` reports gzip's exit status, not pg_dump's -- so a dump that fails, or one
# that dies at 90%, still leaves the pipeline looking successful. This was measured rather than
# assumed: dumping a database that does not exist produced a perfectly valid 20-byte archive that
# `gzip -t` accepted. A backup nobody can restore is worse than no backup, because the update
# proceeds on the strength of it.
#
# So pg_dump's own verdict is carried out of the pipeline in a file. POSIX sh has no `pipefail`.
failed=$(mktemp)
# The password stays inside the container: it is read from the environment postgres already has,
# so it reaches neither this script's command line nor anybody's shell history.
{ compose_now exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U control_hub_admin -d control_hub' ||
    echo yes > "$failed"; } | gzip > "$backup"

if [ -s "$failed" ]; then
  rm -f "$failed" "$backup" release.env.new package.tar.gz.new
  fail "the backup failed -- see the output above. Nothing has changed; $current is still running."
fi
rm -f "$failed"

# Belt and braces behind the real check above: unreadable or implausibly small means something went
# wrong in a way pg_dump did not report.
gzip -t "$backup" 2>/dev/null || { rm -f release.env.new package.tar.gz.new; fail "the backup at $backup is not readable. Nothing has changed."; }
size=$(wc -c < "$backup")
[ "$size" -gt 1000 ] || { rm -f release.env.new package.tar.gz.new; fail "the backup at $backup is only $size bytes. Nothing has changed."; }
say "Backup written, $size bytes."

# --- the product files, once there is a backup and before anything is pulled ----------------------
#
# Here rather than beside `release.env` at the end, because `pull` and the migration job run from
# these definitions. Replacing them afterwards would mean migrating a new database with the old
# release's idea of what the migrate service is, which is a correctness question rather than a
# tidiness one.
#
# The running containers are not touched by any of this -- compose reads these files, it does not
# watch them -- so a migration that fails still leaves the previous version up, which is the promise
# this command makes. What changes is that a rollback now needs the outgoing definitions as well as
# the outgoing digests, and `previous/` is where they are.
say ""
say "Replacing the product files"
rm -rf "$STAGING" previous.new
mkdir -p "$STAGING" previous.new
tar -xzf package.tar.gz.new -C "$STAGING" ||
  { rm -rf "$STAGING" previous.new; rm -f release.env.new package.tar.gz.new; fail "the package could not be unpacked. Nothing has changed; $current is still running."; }

for file in $(cd "$STAGING" && find . -type f | sed 's|^\./||'); do
  directory=$(dirname "$file")
  [ "$directory" = "." ] || mkdir -p "previous.new/$directory" "$directory"
  [ -f "$file" ] && cp -p "$file" "previous.new/$file"
  # Renamed into place rather than written over. This script is one of the files being replaced and
  # sh reads it as it goes, so overwriting it in place would change the source under a running
  # interpreter; a rename leaves the old inode open and this run finishes reading the file it
  # started with. The new one is what the next update uses.
  cp "$STAGING/$file" "$file.incoming" && mv "$file.incoming" "$file"
done

[ -f install.sh ] && chmod +x install.sh
[ -f update.sh ] && chmod +x update.sh
rm -rf previous && mv previous.new previous
rm -rf "$STAGING"
rm -f package.tar.gz.new
say "Product files replaced; the outgoing set is in previous/."

# --- pull, then migrate, and stop here if that fails ----------------------------------------------

say ""
say "Pulling $version by digest"
compose_new pull || { rm -f release.env.new; fail "could not pull the images. Nothing has changed; $current is still running."; }

say ""
say "Running migrations"
if ! compose_new run --rm migrate; then
  rm -f release.env.new
  say ""
  say "The migrations failed, so the update stopped before replacing anything."
  say ""
  say "  Still running:  $current, untouched -- the new images were pulled but never started."
  say "  Kept:           $backup"
  say "  Kept:           release.env, still naming $current."
  say "  Replaced:       the product files are now $version's. previous/ holds the outgoing set,"
  say "                  which is what the running containers were started from."
  say ""
  say "Nothing was rolled back because nothing was changed. Send the output above to support"
  say "before running this again: a migration that failed once fails the same way twice."
  exit 1
fi

# --- only now does the running installation change -------------------------------------------------

# The outgoing file is kept, not overwritten: it names the digests of the version that was working
# ten seconds ago, and it is the whole of what a rollback needs.
cp release.env release.env.previous
mv release.env.new release.env

say ""
say "Starting $version"
if ! compose_now up -d; then
  say ""
  say "The new version did not start. The database is already migrated, so going back means"
  say "restoring the backup as well as the images:"
  say ""
  say "  cp -p previous/. . 2>/dev/null || cp -Rp previous/. ."
  say "  cp release.env.previous release.env"
  say "  docker compose --env-file .env --env-file release.env $overlays up -d"
  say "  gunzip -c $backup | docker compose exec -T postgres psql -U control_hub_admin -d control_hub"
  exit 1
fi

say ""
say "Now running $version."
say ""
say "  Backup:            $backup"
say "  Previous version:  release.env.previous names $current and previous/ holds the compose files"
say "                     it ran with; its images are still on this machine. Do not prune them"
say "                     until this version has run for a day."
