import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';
import { getModelingJob, updateModelingJobProgress } from '@/lib/repositories';
import { modelingProgressSchema } from '@/lib/validation';

export async function POST(request, { params }) {
  try {
    requireInternalToken(request);
    const { id } = await params;
    const progress = modelingProgressSchema.parse(await request.json());
    const job = await updateModelingJobProgress(id, progress);
    if (job) return json({ job, updated: true });
    const current = await getModelingJob(id);
    if (!current) {
      const error = new Error('找不到建模任務');
      error.status = 404;
      throw error;
    }
    return json({ job: current, updated: false });
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = 'Invalid modeling progress payload';
    }
    return errorResponse(error);
  }
}
