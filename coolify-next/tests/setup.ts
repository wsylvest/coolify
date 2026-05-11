/**
 * Vitest Setup File
 *
 * Global setup for all tests.
 */

import { beforeAll, afterAll, vi } from "vitest";

// Mock environment variables for tests
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/coolify_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.NEXTAUTH_SECRET = "test-secret-key-for-testing-purposes-only";
process.env.NEXTAUTH_URL = "http://localhost:3000";

// Mock logger to reduce noise in tests
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeAll(() => {
  // Global setup before all tests
});

afterAll(() => {
  // Global cleanup after all tests
});
