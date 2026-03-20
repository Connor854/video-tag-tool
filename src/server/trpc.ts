import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import superjson from 'superjson';
import { supabase } from '../lib/supabase.js';

export function createContext({ req }: CreateExpressContextOptions) {
  const xAdminSecret = req.headers['x-admin-secret'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;
  const adminSecret =
    xAdminSecret ??
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  return {
    adminSecret: adminSecret as string | undefined,
    bearerToken,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const workspaceMiddleware = t.middleware(async ({ ctx, next }) => {
  let workspaceId: string | null = null;
  let userId: string | null = null;
  let authMethod: 'admin_secret' | 'jwt' | 'fallback' = 'fallback';

  const envAdminSecret = process.env['ADMIN_SECRET'];
  const envDefaultWorkspace = process.env['DEFAULT_WORKSPACE_ID'];

  // 1. Admin secret fallback (x-admin-secret or Bearer <secret>)
  if (
    ctx.adminSecret &&
    envAdminSecret &&
    ctx.adminSecret === envAdminSecret
  ) {
    workspaceId = envDefaultWorkspace ?? null;
    authMethod = 'admin_secret';
  }
  // 2. JWT — verify and resolve workspace from membership
  else if (ctx.bearerToken) {
    if (ctx.bearerToken === envAdminSecret) {
      workspaceId = envDefaultWorkspace ?? null;
      authMethod = 'admin_secret';
    } else {
      const { data: { user }, error } = await supabase.auth.getUser(
        ctx.bearerToken,
      );
      if (!error && user) {
        userId = user.id;
        const { data: member } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (member) {
          workspaceId = member.workspace_id;
          authMethod = 'jwt';
        }
      }
    }
  }

  // 3. Fallback for local dev (no auth headers)
  if (!workspaceId && envDefaultWorkspace) {
    workspaceId = envDefaultWorkspace;
    authMethod = 'fallback';
  }

  if (!workspaceId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'No workspace. Sign in or provide admin secret.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId,
      workspaceId,
      authMethod,
    },
  });
});

const adminMiddleware = t.middleware(({ ctx, next }) => {
  const secret = process.env['ADMIN_SECRET'];
  if (!secret) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'ADMIN_SECRET not configured on server',
    });
  }
  if (ctx.adminSecret !== secret) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin secret' });
  }
  return next({ ctx });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const workspaceProcedure = publicProcedure.use(workspaceMiddleware);
export const adminProcedure = workspaceProcedure.use(adminMiddleware);
