import { router } from './trpc.js';
import { videoRouter } from './routers/video.js';
import { adminRouter } from './routers/admin.js';

export const appRouter = router({
  video: videoRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
