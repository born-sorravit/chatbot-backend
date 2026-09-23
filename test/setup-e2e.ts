import { config as loadEnv } from 'dotenv';

loadEnv();

// E2E runs against a dedicated database so a failed assertion can never
// leave junk in the development data. Created by `npm run test:e2e:setup`.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:1234@localhost:5433/chatbots_test';
process.env.DATABASE_LOGGING = 'false';

// The throttler is IP-based, and every request in the suite comes from the
// same address. Real limits would make the suite fail on request six rather
// than on anything it is actually asserting, so they are raised here.
// Rate limiting itself is exercised separately — see README "Verifying".
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

// A dedicated queue namespace, for the same reason as the dedicated database.
// Without it, a `npm run start:dev` process running alongside the suite
// consumes the tests' AI jobs — its worker writes the reply into the
// development database, and the test waits forever for a message that was
// delivered somewhere else. It fails intermittently, which is worse than
// failing outright.
process.env.REDIS_QUEUE_PREFIX = 'chatbots-test';
