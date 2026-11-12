# Backup and restore

The clinic database is one SQLite file. The default path is `server/data/smilecare.db`.

## Copy

From the `server` directory, with the same `DATABASE_PATH` the API uses:

```powershell
npm run backup
```

This writes `server/data/backups/smilecare-<timestamp>.db` using SQLite's online backup. The API can stay running.

Schedule it once a day with Windows Task Scheduler or cron. The task should run `npm run backup` in the `server` directory. This repository does not install that schedule for you.

## Restore

1. Stop the API.
2. Replace `server/data/smilecare.db` with the backup file. Remove `smilecare.db-wal` and `smilecare.db-shm` if they are present.
3. Start the API again.

A backup taken while the API is running is a consistent snapshot of committed data. It does not include files outside the database.
