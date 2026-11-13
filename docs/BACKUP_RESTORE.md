# Backup and restore

This is the restore guide required for clinic operations. The same steps are summarized in `docs/BACKUP.md`.

The clinic database is one SQLite file. The default path is `server/data/smilecare.db` (or whatever `DATABASE_PATH` is set to).

## Backup (copy)

From the repository root, with the same `DATABASE_PATH` the API uses:

```powershell
cd server
npm run backup
```

This writes `server/data/backups/smilecare-<timestamp>.db` using SQLite’s online backup API. The API can stay running.

Schedule it once a day with Windows Task Scheduler or cron. The task should run `npm run backup` in the `server` directory. This repository does not install that schedule for you.

## Restore

1. Stop the API (`Ctrl+C`, or stop the Windows service / Docker container).
2. Replace `server/data/smilecare.db` with the chosen backup file (rename the backup to `smilecare.db` if needed).
3. Delete `smilecare.db-wal` and `smilecare.db-shm` next to the database if they exist.
4. Start the API again (`npm start` or `npm run dev`).

A backup taken while the API is running is a consistent snapshot of committed data. It does not include files outside the database (there is no attachment store yet).

## Check after restore

1. Open http://localhost:5173 and sign in.
2. Confirm patients and today’s appointments are present.
3. Optional: `GET http://localhost:3001/api/health` should return `{"ok":true}`.
