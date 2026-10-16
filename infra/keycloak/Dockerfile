# Stock Keycloak plus the custom login theme (themes/rag). Built instead of bind-mounting so the
# theme travels with the image on Dokploy/any host. Select it in the realm: Realm settings -> Themes
# -> Login theme = rag (setup-realm.sh does this automatically).
FROM quay.io/keycloak/keycloak:26.0
COPY themes/rag /opt/keycloak/themes/rag
