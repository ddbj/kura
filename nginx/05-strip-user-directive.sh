#!/bin/sh
# rootless podman + Lustre 対応 (a012 の kura-prod).
# nginx image default の /etc/nginx/nginx.conf の `user nginx;` を `user root;` に
# 置換する。userns_mode: private では container 内 root = host w3ddbjld にマップ
# されるため、host w3ddbjld で read できる Lustre bind mount 上の SPA / conf を
# worker から読める。user directive 未指定だと nginx は default で nobody
# (uid 65534) を worker に使い、subuid range 外なので Lustre が拒否する。
#
# docker-entrypoint.sh が /docker-entrypoint.d/*.sh を順に実行する仕組みを利用
# しており、envsubst / worker tuning より前 (05-) に走らせる。
sed -i "s|^user  *nginx;|user  root;|" /etc/nginx/nginx.conf
