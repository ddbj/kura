#!/bin/sh
# Generates s3.json / iam.json from environment variables, then hands off to
# the stock SeaweedFS entrypoint. IAM policy variables like
# ${jwt:preferred_username} are escaped so they reach the JSON literally.
set -eu

: "${KURA_OIDC_ISSUER:?}"
: "${KURA_OIDC_CLIENT_ID:?}"
: "${KURA_OIDC_JWKS_URI:?}"
: "${KURA_STS_SIGNING_KEY:?}"
: "${KURA_ROOT_ACCESS_KEY:?}"
: "${KURA_ROOT_SECRET_KEY:?}"
: "${KURA_FILER_JWT_KEY:?}"

# A non-positive value is indistinguishable from quota-disabled on
# s3.bucket.list (see quota_reconcile below), so reject it at startup rather
# than let it silently defeat quota enforcement.
if [ -n "${KURA_QUOTA_DEFAULT_MB:-}" ]; then
  case "$KURA_QUOTA_DEFAULT_MB" in
    *[!0-9]* | '')
      echo "kura: KURA_QUOTA_DEFAULT_MB must be a positive integer, got '${KURA_QUOTA_DEFAULT_MB}'" >&2
      exit 1
      ;;
  esac
  if [ "$KURA_QUOTA_DEFAULT_MB" -eq 0 ]; then
    echo "kura: KURA_QUOTA_DEFAULT_MB must be a positive integer, got '0'" >&2
    exit 1
  fi
fi

mkdir -p /etc/seaweedfs

# Per-user buckets mean one collection per user. The default growth of 7
# volumes per collection exhausts volume slots quickly on a single volume
# server, so grow one volume at a time.
cat > /etc/seaweedfs/master.toml <<EOTOML
[master.volume_growth]
copy_1 = 1
copy_2 = 2
copy_3 = 3
copy_other = 1
EOTOML

# The filer write-signing key puts the filer IAM gRPC service (and filer HTTP
# writes) behind a Bearer token; in-cluster components sign with this same
# file. The read key stays unset so public delivery (nginx -> filer GET/HEAD)
# remains anonymous.
cat > /etc/seaweedfs/security.toml <<EOTOML
[jwt.filer_signing]
key = "${KURA_FILER_JWT_KEY}"
EOTOML

# KURA_ADMIN_SUBS: comma-separated Keycloak sub UUIDs -> JSON string array.
# Empty list falls back to a value no real sub can match, so KuraAdminRole
# becomes unassumable rather than open.
admin_subs_json=""
IFS=','
for sub in ${KURA_ADMIN_SUBS:-}; do
  # awk trims surrounding whitespace so "a, b" and "a,b" parse the same.
  sub=$(printf '%s' "$sub" | awk '{$1=$1; print}')
  [ -n "$sub" ] || continue
  admin_subs_json="${admin_subs_json:+${admin_subs_json}, }\"${sub}\""
done
unset IFS
[ -n "$admin_subs_json" ] || admin_subs_json='"unassigned"'

cat > /etc/seaweedfs/s3.json <<EOJSON
{
  "identities": [
    {
      "name": "kura-root",
      "credentials": [
        { "accessKey": "${KURA_ROOT_ACCESS_KEY}", "secretKey": "${KURA_ROOT_SECRET_KEY}" }
      ],
      "actions": ["Admin", "Read", "List", "Tagging", "Write"]
    }
  ]
}
EOJSON

cat > /etc/seaweedfs/iam.json <<EOJSON
{
  "sts": {
    "tokenDuration": "1h",
    "maxSessionLength": "12h",
    "issuer": "kura-sts",
    "signingKey": "${KURA_STS_SIGNING_KEY}"
  },
  "providers": [
    {
      "name": "keycloak",
      "type": "oidc",
      "config": {
        "issuer": "${KURA_OIDC_ISSUER}",
        "clientId": "${KURA_OIDC_CLIENT_ID}",
        "jwksUri": "${KURA_OIDC_JWKS_URI}",
        "roleMapping": {
          "rules": [],
          "defaultRole": "arn:aws:iam::role/KuraUserRole"
        }
      }
    }
  ],
  "policies": [
    {
      "name": "KuraUserPolicy",
      "document": {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Sid": "OwnBucket",
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
              "arn:aws:s3:::\${jwt:preferred_username}",
              "arn:aws:s3:::\${jwt:preferred_username}/*"
            ]
          },
          {
            "Sid": "DenyBucketAdminOps",
            "Effect": "Deny",
            "Action": [
              "s3:PutBucketPolicy",
              "s3:DeleteBucketPolicy",
              "s3:PutBucketAcl",
              "s3:PutObjectAcl",
              "s3:PutBucketCors",
              "s3:DeleteBucketCors",
              "s3:PutLifecycleConfiguration",
              "s3:DeleteLifecycleConfiguration",
              "s3:PutBucketVersioning",
              "s3:PutObjectLockConfiguration",
              "s3:PutObjectRetention",
              "s3:PutObjectLegalHold"
            ],
            "Resource": ["arn:aws:s3:::*", "arn:aws:s3:::*/*"]
          }
        ]
      }
    },
    {
      "name": "KuraAdminPolicy",
      "document": {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Sid": "AdminAll",
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": ["arn:aws:s3:::*", "arn:aws:s3:::*/*"]
          }
        ]
      }
    }
  ],
  "roles": [
    {
      "roleName": "KuraUserRole",
      "roleArn": "arn:aws:iam::role/KuraUserRole",
      "attachedPolicies": ["KuraUserPolicy"],
      "trustPolicy": {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": { "Federated": "keycloak" },
            "Action": "sts:AssumeRoleWithWebIdentity"
          }
        ]
      }
    },
    {
      "roleName": "KuraAdminRole",
      "roleArn": "arn:aws:iam::role/KuraAdminRole",
      "attachedPolicies": ["KuraAdminPolicy"],
      "trustPolicy": {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": { "Federated": "keycloak" },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
              "StringEquals": { "oidc:sub": [${admin_subs_json}] }
            }
          }
        ]
      }
    }
  ]
}
EOJSON

# Default-quota reconciler (docs/operations.md): SeaweedFS has no native
# default quota for new buckets, so periodically set it on buckets without
# one. s3.bucket.list omits the quota field for unset buckets; disabled
# (negative) quotas also show no field, which is why kura ops never use
# -op=disable. Bucket names follow S3 naming (no whitespace), so the
# tab-separated output is safe to parse.
quota_reconcile() {
  # Piping weed shell straight into grep/awk/while would lose its exit status
  # (the while loop's own status wins), so capture it separately first.
  if ! list_output=$(echo "s3.bucket.list" | weed shell -master localhost:9333 2>&1); then
    echo "kura-ops: quota reconcile: s3.bucket.list failed: ${list_output}" >&2
    return 1
  fi
  echo "$list_output" \
    | grep "	size:" | grep -v "	quota:" | awk '{print $1}' \
    | while read -r bucket; do
        echo "s3.bucket.quota -name=${bucket} -op=set -sizeMB=${KURA_QUOTA_DEFAULT_MB:-1048576}" \
          | weed shell -master localhost:9333 \
          && echo "kura-ops: applied default quota to ${bucket}"
      done
}

# Waits until weed shell can reach the master (not up yet when this
# entrypoint starts) before the first quota reconcile; gives up after ~60s
# and proceeds anyway, matching quota_reconcile's own log-and-continue
# resilience.
wait_for_master() {
  i=0
  while [ "$i" -lt 30 ]; do
    if echo "s3.bucket.list" | weed shell -master localhost:9333 >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "kura-ops: master not reachable after 60s, proceeding anyway" >&2
}

(
  wait_for_master
  while true; do
    interval="${KURA_OPS_INTERVAL_SECONDS:-86400}"
    if quota_reconcile; then
      sleep "$interval"
    else
      echo "kura-ops: quota reconcile failed" >&2
      # Retry sooner than a full interval, capped to the interval itself so
      # short test intervals are not stretched out by the retry backoff.
      if [ "$interval" -lt 300 ]; then
        sleep "$interval"
      else
        sleep 300
      fi
    fi
  done
) &

exec /entrypoint.sh "$@"
