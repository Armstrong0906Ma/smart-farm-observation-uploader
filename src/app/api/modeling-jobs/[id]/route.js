import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { getModelingJob } from '@/lib/repositories';

export async function GET(request, { params }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const job = await getModelingJob(id);
    if (!job || (process.env.AUTH_REQUIRED !== 'false' && job.createdBy !== user.uid)) {
      const error = new Error('找不到建模任務');
      error.status = 404;
      throw error;
    }
    return json({ job });
  } catch (error) {
    return errorResponse(error);
  }
}
