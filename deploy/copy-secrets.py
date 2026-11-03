"""Create namespace pdf-edit and copy the two secrets it needs from default.

Values pass from one kubectl call to the next in memory; nothing is printed
or written to disk.
"""
import json
import subprocess

NS = "pdf-edit"


def kubectl(*args, stdin=None):
    r = subprocess.run(["kubectl", *args], input=stdin, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"kubectl {' '.join(args[:3])} failed: {r.stderr.strip()}")
    return r.stdout


def apply(obj):
    out = kubectl("apply", "-f", "-", stdin=json.dumps(obj))
    print(out.strip())


apply({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": NS}})

# Image download login: same type and data, new namespace.
pull = json.loads(kubectl("get", "secret", "ghcr-pull-secret", "-n", "default", "-o", "json"))
apply({
    "apiVersion": "v1",
    "kind": "Secret",
    "type": pull["type"],
    "metadata": {"name": "ghcr-pull-secret", "namespace": NS},
    "data": pull["data"],
})

# Only JWT_SECRET from energia-secrets (none of its other keys).
energia = json.loads(kubectl("get", "secret", "energia-secrets", "-n", "default", "-o", "json"))
apply({
    "apiVersion": "v1",
    "kind": "Secret",
    "type": "Opaque",
    "metadata": {"name": "pdf-edit-secrets", "namespace": NS},
    "data": {"JWT_SECRET": energia["data"]["JWT_SECRET"]},
})
