import { adminAuth } from '@/lib/firebaseAdmin';

export async function requireUser(request) {
  if (process.env.AUTH_REQUIRED === 'false') {
    return { uid: 'local-dev', email: 'local-dev@example.com' };
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    const error = new Error('未登入');
    error.status = 401;
    throw error;
  }

  try {
    return await adminAuth.verifyIdToken(token);
  } catch (cause) {
    const error = new Error('登入驗證失敗');
    error.status = 401;
    error.cause = cause;
    throw error;
  }
}
