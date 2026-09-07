export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    databaseUrl: Boolean(process.env.DATABASE_URL),
    neonDatabaseUrl: Boolean(process.env.NEON_DATABASE_URL),
    postgresUrl: Boolean(process.env.POSTGRES_URL),
  });
}
