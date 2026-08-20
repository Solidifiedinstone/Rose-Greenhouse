#!/usr/bin/env bash
#
# Install Rose Greenhouse's desktop entry and icons for the current user.
#
# Everything goes under ~/.local, so no root is needed and nothing outside the
# user's own home is touched. Run install-desktop-entry.sh --uninstall to
# remove it again.
#
# The launcher command is resolved at install time and written into the desktop
# entry as an absolute path, because desktop entries do not inherit the shell's
# PATH — a bare "rose-greenhouse" fails to launch from a dock even when it works
# perfectly in a terminal.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
SIZES=(16 24 32 48 64 128 256)

uninstall() {
    rm -f "$APPS/rose-greenhouse.desktop"
    rm -f "$ICONS/scalable/apps/rose-greenhouse.svg"
    for size in "${SIZES[@]}"; do
        rm -f "$ICONS/${size}x${size}/apps/rose-greenhouse.png"
    done
    update_caches
    echo "Removed Rose Greenhouse desktop entry and icons."
}

update_caches() {
    command -v update-desktop-database >/dev/null 2>&1 &&
        update-desktop-database -q "$APPS" || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 &&
        gtk-update-icon-cache -q -t -f "$ICONS" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
    uninstall
    exit 0
fi

# ── Locate the executable ─────────────────────────────────────────
LAUNCHER="$(command -v rose-greenhouse || true)"
if [[ -z "$LAUNCHER" ]]; then
    # Fall back to the binary cargo just built, which is where it is for
    # anyone who has run `npm run tauri build` and not installed it yet.
    for candidate in \
        "$HERE/../src-tauri/target/release/rose-greenhouse" \
        "$HOME/rose-greenhouse/src-tauri/target/release/rose-greenhouse"; do
        if [[ -x "$candidate" ]]; then
            LAUNCHER="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
            break
        fi
    done
fi

if [[ -z "$LAUNCHER" ]]; then
    echo "Could not find the rose-greenhouse binary." >&2
    echo "Build it first:  npm run tauri build" >&2
    exit 1
fi

echo "Using launcher: $LAUNCHER"

# ── Icons ─────────────────────────────────────────────────────────
install -Dm644 "$HERE/rose-greenhouse.svg" "$ICONS/scalable/apps/rose-greenhouse.svg"

if command -v rsvg-convert >/dev/null 2>&1; then
    RENDER="rsvg-convert"
elif command -v magick >/dev/null 2>&1; then
    RENDER="magick"
else
    RENDER=""
    echo "No SVG rasteriser found; installing the scalable icon only." >&2
    echo "Docks that cannot read SVG will show a generic icon." >&2
fi

for size in "${SIZES[@]}"; do
    target="$ICONS/${size}x${size}/apps/rose-greenhouse.png"
    mkdir -p "$(dirname "$target")"
    case "$RENDER" in
        rsvg-convert)
            rsvg-convert -w "$size" -h "$size" "$HERE/rose-greenhouse.svg" -o "$target"
            ;;
        magick)
            magick -background none -density 384 "$HERE/rose-greenhouse.svg" \
                -resize "${size}x${size}" "$target"
            ;;
    esac
done

# ── Desktop entry ─────────────────────────────────────────────────
mkdir -p "$APPS"
sed "s|^Exec=rose-greenhouse$|Exec=$LAUNCHER|; s|^Exec=rose-greenhouse |Exec=$LAUNCHER |" \
    "$HERE/rose-greenhouse.desktop" > "$APPS/rose-greenhouse.desktop"
chmod 644 "$APPS/rose-greenhouse.desktop"

update_caches

if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$APPS/rose-greenhouse.desktop" &&
        echo "Desktop entry validates cleanly."
fi

echo
echo "Installed. Rose Greenhouse should now appear in your application menu."
echo "  entry: $APPS/rose-greenhouse.desktop"
echo "  icons: $ICONS/{scalable,48x48,256x256}/apps/rose-greenhouse.*"
