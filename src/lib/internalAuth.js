export function requireInternalToken(request) {
  const expected = process.env.INTERNAL_TASK_TOKEN;
  const bearer = request.headers.get('authorization') === `Bearer ${expected}`;
  const taskHeader = request.headers.get('x-internal-task-token') === expected;
  if (!expected || (!bearer && !taskHeader)) {
    const error = new Error('Unauthorized internal task');
    error.status = 401;
    throw error;
  }
}
