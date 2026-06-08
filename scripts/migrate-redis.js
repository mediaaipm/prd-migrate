// One-time migration: Upstash (old) -> Upstash (new)
// Usage: node scripts/migrate-redis.js

const { Redis } = require('@upstash/redis');

const OLD = new Redis({
  url: 'https://inspired-asp-130273.upstash.io',
  token: 'gQAAAAAAAfzhAAIgcDE3NjhlYmE2Y2U4ZjA0NDgyOGE2YWVmOTg5MGYzNmRkZg',
});

const NEW = new Redis({
  url: 'https://new-lamprey-118407.upstash.io',
  token: 'gQAAAAAAAc6HAAIgcDJmOWJkOGU5Y2EzMTA0NzhiODE0YzFjMDVhYTYzNWE2MQ',
});

async function migrate() {
  let cursor = 0;
  let totalKeys = 0;
  let migratedKeys = 0;
  const seen = new Set();

  do {
    const result = await OLD.scan(cursor, { count: 100 });
    cursor = Number(result[0]);
    const keys = result[1];
    totalKeys += keys.length;

    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const type = await OLD.type(key);
        const ttl = await OLD.ttl(key);

        if (type === 'string') {
          const val = await OLD.get(key);
          const strVal = typeof val === 'string' ? val : JSON.stringify(val);
          if (ttl > 0) {
            await NEW.set(key, strVal, { ex: ttl });
          } else {
            await NEW.set(key, strVal);
          }
        } else if (type === 'hash') {
          const val = await OLD.hgetall(key);
          if (val && Object.keys(val).length > 0) {
            const stringified = {};
            for (const [k, v] of Object.entries(val)) {
              stringified[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
            await NEW.hset(key, stringified);
            if (ttl > 0) await NEW.expire(key, ttl);
          }
        } else if (type === 'list') {
          const val = await OLD.lrange(key, 0, -1);
          if (val && val.length > 0) {
            await NEW.del(key);
            await NEW.rpush(key, ...val.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
            if (ttl > 0) await NEW.expire(key, ttl);
          }
        } else if (type === 'set') {
          const val = await OLD.smembers(key);
          if (val && val.length > 0) {
            await NEW.sadd(key, ...val.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
            if (ttl > 0) await NEW.expire(key, ttl);
          }
        } else if (type === 'zset') {
          const val = await OLD.zrange(key, 0, -1, { withScores: true });
          if (val && val.length > 0) {
            // @upstash/redis returns flat [member, score, member, score, ...] with withScores
            const members = [];
            for (let i = 0; i < val.length; i += 2) {
              const member = val[i];
              const score = val[i + 1];
              members.push({
                score: Number(score),
                member: typeof member === 'string' ? member : JSON.stringify(member),
              });
            }
            await NEW.zadd(key, ...members);
            if (ttl > 0) await NEW.expire(key, ttl);
          }
        } else {
          console.warn(`  SKIP ${key} (type: ${type})`);
          continue;
        }

        migratedKeys++;
        console.log(`  [${migratedKeys}] ${type} -> ${key}`);
      } catch (err) {
        console.error(`  ERROR ${key}:`, err.message);
      }
    }
  } while (cursor !== 0);

  console.log(`\nDone. ${migratedKeys}/${totalKeys} keys migrated.`);
}

migrate().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
