#!/usr/bin/env python3
"""Trim an Hourglass contact list to the columns the app needs, saved privately.

Usage: ./trim-contacts.py "hourglass-contactlist.numbers"   (or a .csv export)
Writes contacts.csv next to this script (mode 600).
"""
import csv, os, subprocess, sys, tempfile
from pathlib import Path

COLS = ["lastname", "firstname", "fullname", "descriptor", "sex", "cellphone"]
OUT = Path(__file__).resolve().parent / "contacts.csv"


def numbers_to_csv(src: Path, dst: Path):
    script = f'''
    tell application "Numbers"
      set d to open POSIX file "{src}"
      export d to POSIX file "{dst}" as CSV
      close d saving no
    end tell'''
    subprocess.run(["osascript", "-e", script], check=True)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).expanduser().resolve()
    os.umask(0o077)
    with tempfile.TemporaryDirectory() as tmp:
        csv_path = src
        if src.suffix == ".numbers":
            csv_path = Path(tmp) / "export.csv"
            numbers_to_csv(src, csv_path)
        with open(csv_path, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
    missing = [c for c in COLS if c not in (rows[0] if rows else {})]
    if missing:
        sys.exit(f"Missing columns: {', '.join(missing)}")
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows({c: r[c] for c in COLS} for r in rows)
    OUT.chmod(0o600)
    print(f"{len(rows)} contacts → {OUT}")
    print("Now click 'Import contacts CSV' in the app and pick contacts.csv in this folder.")


if __name__ == "__main__":
    main()
