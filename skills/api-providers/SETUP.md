# SETUP — daily refresh cron

The skill works without this; the cron only keeps `~/vault/api/PROVIDERS.md` fresh automatically.

Requires: `bun`, `pass` (GPG agent must be usable from cron — trading crons already prove this on this box), seeded `~/vault/api/models.json`.

## Install

```bash
(crontab -l; echo '17 6 * * * $HOME/.bun/bin/bun $HOME/repos/arc-skills/skills/api-providers/refresh.ts >> $HOME/vault/api/refresh.log 2>&1') | crontab -
```

Fires 06:17 UTC daily. Failures land loudly in `~/vault/api/refresh.log` and as `FETCH FAILED` rows in the doc itself.

## Reversal

```bash
crontab -l | grep -v 'api-providers/refresh.ts' | crontab -
```
